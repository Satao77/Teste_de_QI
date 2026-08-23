import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { getPublicCatalog } from "./server/catalog.js";
import { scoreAttempt, theoreticalPercentile } from "./server/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

const RENDER_URL = (process.env.RENDER_EXTERNAL_URL || "https://teste-de-qi-1.onrender.com").replace(/\/+$/, "");

const config = {
  mpToken: (process.env.MP_ACCESS_TOKEN || "").trim(),
  webhookSecret: process.env.MP_WEBHOOK_SECRET || "",
  baseUrl: (process.env.BASE_URL || RENDER_URL).replace(/\/+$/, ""),
  preco: Number(process.env.PRECO_LAUDO ?? 29.9),
  porta: Number(process.env.PORT ?? 3000),
  host: process.env.HOST || "0.0.0.0",
  owner: {
    nome: process.env.OWNER_NAME ?? "",
    banco: process.env.OWNER_BANK_NAME ?? "",
    agencia: process.env.OWNER_BANK_AGENCY ?? "",
    conta: process.env.OWNER_BANK_ACCOUNT ?? "",
  },
};

if (!config.baseUrl.startsWith("https://")) {
  console.warn("[AVISO] BASE_URL não é HTTPS. O MP não entrega webhooks em HTTP nem localhost.");
}
if (!config.mpToken) {
  console.warn("[AVISO] MP_ACCESS_TOKEN ausente: o site sobe, mas o checkout fica desligado.");
}
if (!config.webhookSecret) {
  console.warn("[AVISO] MP_WEBHOOK_SECRET ausente: assinatura não será verificada.");
}
if (!Number.isFinite(config.preco) || config.preco <= 0) {
  console.error("[ERRO] PRECO_LAUDO inválido.");
  process.exit(1);
}

const mpClient = config.mpToken
  ? new MercadoPagoConfig({ accessToken: config.mpToken, options: { timeout: 8000 } })
  : null;
const preferenceApi = mpClient ? new Preference(mpClient) : null;
const paymentApi = mpClient ? new Payment(mpClient) : null;

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const DB_PATH = process.env.DB_PATH ?? path.join(dataDir, "pagamentos.json");

let db = {};
try {
  db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
} catch {
  db = {};
}

const persistir = () => {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch (err) {
    console.warn("[AVISO] Não foi possível gravar o banco local:", err?.message ?? err);
  }
};

function criarRegistro(testeId, respostas) {
  db[testeId] = {
    testeId,
    respostas,
    status: "pendente",
    pagamentoId: null,
    criadoEm: new Date().toISOString(),
    pagoEm: null,
  };
  persistir();
  return db[testeId];
}

const buscarRegistro = (testeId) => db[testeId] ?? null;

function marcarComoPago(testeId, pagamentoId) {
  const reg = db[testeId];
  if (!reg) return null;
  if (reg.status === "pago") return reg;
  reg.status = "pago";
  reg.pagamentoId = String(pagamentoId);
  reg.pagoEm = new Date().toISOString();
  persistir();
  console.log(`[OK] Resultado liberado para o teste ${testeId}`);
  return reg;
}

function respostasParaMapa(respostas) {
  const mapa = {};
  for (const item of respostas || []) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.id !== "string") continue;
    const opcao = Number(item.opcao);
    if (!Number.isInteger(opcao)) continue;
    mapa[item.id] = opcao;
  }
  return mapa;
}

function calcularResultado(respostas) {
  const scored = scoreAttempt(respostasParaMapa(respostas));
  return {
    pontuacao: scored.iq,
    percentil: theoreticalPercentile(scored.iq),
    faixa: scored.band,
    descricao: scored.description,
    acertos: scored.totalCorrect,
    total: scored.totalQuestions,
    detalhamento: scored.breakdown,
  };
}

function assinaturaValida(req) {
  if (!config.webhookSecret) return true;

  const xSignature = req.headers["x-signature"];
  const xRequestId = req.headers["x-request-id"];
  if (!xSignature || !xRequestId) return false;

  const partes = Object.fromEntries(
    String(xSignature)
      .split(",")
      .map((p) => p.split("=").map((s) => s.trim()))
  );
  const { ts, v1 } = partes;
  if (!ts || !v1) return false;

  const dataId = String(req.query["data.id"] ?? req.body?.data?.id ?? "").toLowerCase();
  const manifesto = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const esperado = crypto.createHmac("sha256", config.webhookSecret).update(manifesto).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(v1));
  } catch {
    return false;
  }
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use(express.static(PUBLIC_DIR));

const janela = new Map();
function limitar(req, res, next) {
  const agora = Date.now();
  const hits = (janela.get(req.ip) ?? []).filter((t) => agora - t < 60_000);
  if (hits.length >= 20) {
    return res.status(429).json({ erro: "Muitas requisições. Aguarde um minuto." });
  }
  hits.push(agora);
  janela.set(req.ip, hits);
  next();
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/preco", (_req, res) => {
  res.json({ preco: config.preco, moeda: "BRL" });
});

app.get("/api/catalog", (_req, res) => {
  res.json(getPublicCatalog());
});

app.post("/api/checkout", limitar, async (req, res) => {
  try {
    if (!preferenceApi) {
      return res.status(503).json({ erro: "Pagamento não configurado no servidor." });
    }

    const { respostas } = req.body ?? {};
    if (!Array.isArray(respostas) || respostas.length === 0) {
      return res.status(400).json({ erro: "Respostas do teste não recebidas." });
    }

    const testeId = crypto.randomUUID();
    criarRegistro(testeId, respostas);

    const pref = await preferenceApi.create({
      body: {
        items: [
          {
            id: "resultado-qi",
            title: "Resultado detalhado do teste de QI",
            description: "Pontuação, percentil e detalhamento por área",
            quantity: 1,
            unit_price: config.preco,
            currency_id: "BRL",
          },
        ],
        external_reference: testeId,
        back_urls: {
          success: `${config.baseUrl}/resultado/${testeId}`,
          failure: `${config.baseUrl}/pagamento/erro`,
          pending: `${config.baseUrl}/pagamento/pendente`,
        },
        auto_return: "approved",
        notification_url: `${config.baseUrl}/api/webhooks/mercadopago`,
        statement_descriptor: "TESTE QI",
      },
    });

    res.json({ testeId, checkoutUrl: pref.init_point });
  } catch (err) {
    console.error("[ERRO] Falha ao criar preferência:", err?.message ?? err);
    res.status(502).json({ erro: "Não foi possível iniciar o pagamento." });
  }
});

app.post("/api/webhooks/mercadopago", async (req, res) => {
  res.sendStatus(200);

  try {
    if (!assinaturaValida(req)) {
      console.warn("[SEGURANÇA] Webhook com assinatura inválida — descartado.");
      return;
    }

    const tipo = req.body?.type ?? req.query.topic;
    if (tipo !== "payment") return;

    const pagamentoId = req.body?.data?.id ?? req.query["data.id"] ?? req.query.id;
    if (!pagamentoId || !paymentApi) return;

    const pagamento = await paymentApi.get({ id: pagamentoId });
    if (pagamento.status !== "approved") {
      console.log(`[INFO] Pagamento ${pagamentoId}: ${pagamento.status}`);
      return;
    }

    const testeId = pagamento.external_reference;
    const registro = buscarRegistro(testeId);
    if (!registro) {
      console.warn(`[AVISO] Pagamento aprovado sem teste correspondente: ${testeId}`);
      return;
    }

    if (Number(pagamento.transaction_amount) < config.preco) {
      console.warn(`[SEGURANÇA] Valor divergente no teste ${testeId}.`);
      return;
    }

    marcarComoPago(testeId, pagamentoId);
  } catch (err) {
    console.error("[ERRO] Webhook:", err?.message ?? err);
  }
});

app.get("/api/status/:testeId", (req, res) => {
  const registro = buscarRegistro(req.params.testeId);
  if (!registro) return res.status(404).json({ erro: "Teste não encontrado." });
  res.json({ status: registro.status });
});

app.get("/api/resultado/:testeId", (req, res) => {
  const registro = buscarRegistro(req.params.testeId);
  if (!registro) return res.status(404).json({ erro: "Teste não encontrado." });

  if (registro.status !== "pago") {
    return res.status(402).json({ erro: "Pagamento não confirmado.", status: registro.status });
  }

  res.json({
    testeId: registro.testeId,
    pagoEm: registro.pagoEm,
    resultado: calcularResultado(registro.respostas),
  });
});

app.get("/api/comprovante/:testeId", (req, res) => {
  const registro = buscarRegistro(req.params.testeId);
  if (!registro || registro.status !== "pago") {
    return res.status(404).json({ erro: "Comprovante indisponível." });
  }

  const conta = config.owner.conta;
  res.json({
    titular: config.owner.nome,
    instituicao: config.owner.banco,
    agencia: config.owner.agencia,
    conta: conta ? `****${conta.slice(-4)}` : "",
    valor: config.preco,
    pagamentoId: registro.pagamentoId,
    pagoEm: registro.pagoEm,
  });
});

function pagina(res) {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
}

app.get("/resultado/:testeId", (_req, res) => pagina(res));
app.get("/pagamento/erro", (_req, res) => pagina(res));
app.get("/pagamento/pendente", (_req, res) => pagina(res));
app.get("*", (_req, res) => pagina(res));

app.listen(config.porta, config.host, () => {
  console.log(`Servidor no ar em http://${config.host}:${config.porta}`);
  console.log(`URL pública: ${config.baseUrl}`);
  console.log(`Webhook a cadastrar no painel MP: ${config.baseUrl}/api/webhooks/mercadopago`);
});
