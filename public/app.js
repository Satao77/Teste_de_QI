const state = {
  tests: [],
  preco: null,
  currentTest: 0,
  currentQuestion: 0,
  answers: {},
  selected: null,
  startedAt: 0,
  timerId: null,
  submitting: false,
  testeId: null,
};

const $ = (sel) => document.querySelector(sel);

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(`#${id}`).classList.add("active");
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatBRL(amount) {
  return Number(amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function route() {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const result = path.match(/^\/resultado\/([^/]+)$/);
  if (result) {
    state.testeId = result[1];
    showScreen("screen-waiting");
    aguardarPagamento(state.testeId);
    return "resultado";
  }
  if (path === "/pagamento/erro") {
    showScreen("screen-pay-error");
    return "erro";
  }
  if (path === "/pagamento/pendente") {
    state.testeId = localStorage.getItem("testeId");
    showScreen("screen-waiting");
    $("#waiting-text").textContent = "Seu pagamento ficou pendente. Consultamos de novo em instantes.";
    if (state.testeId) aguardarPagamento(state.testeId);
    return "pendente";
  }
  showScreen("screen-home");
  return "home";
}

async function loadHome() {
  try {
    const [preco, catalog] = await Promise.all([
      fetch("/api/preco").then((r) => r.json()),
      fetch("/api/catalog").then((r) => r.json()),
    ]);
    state.preco = preco.preco;
    state.tests = catalog.tests;
    $("#home-price").textContent = formatBRL(preco.preco);
    $("#home-badge").textContent = `${catalog.testCount} testes · ${catalog.questionCount} questoes · resultado ${formatBRL(preco.preco)}`;
    $("#test-list").innerHTML = catalog.tests
      .map(
        (t, i) => `
      <div class="test-card">
        <div class="test-icon ${t.iconClass}">${escapeHtml(t.icon)}</div>
        <div class="test-info">
          <h3>${i + 1}. ${escapeHtml(t.title)}</h3>
          <p>${escapeHtml(t.description)} · ${t.questions.length} questoes</p>
        </div>
      </div>`
      )
      .join("");
    $("#btn-start").disabled = false;
  } catch (_err) {
    $("#home-badge").textContent = "Servidor indisponivel";
    toast("Nao foi possivel carregar o preco e o catalogo.");
  }
}

function totalQuestions() {
  return state.tests.reduce((sum, t) => sum + t.questions.length, 0);
}

function globalQuestionIndex() {
  let idx = 0;
  for (let i = 0; i < state.currentTest; i++) idx += state.tests[i].questions.length;
  return idx + state.currentQuestion;
}

function currentQuestion() {
  return state.tests[state.currentTest].questions[state.currentQuestion];
}

function renderBody(question) {
  if (question.type === "sequence") {
    return `<span class="sequence-display">${question.body.items.map(escapeHtml).join(", ")}</span>`;
  }
  if (question.type === "pattern") {
    const cells = question.body.cells
      .map((c) => {
        const cls = c === "?" ? "pattern-cell question" : "pattern-cell filled";
        return `<div class="${cls}">${escapeHtml(c)}</div>`;
      })
      .join("");
    return `<div class="pattern-grid">${cells}</div>`;
  }
  return escapeHtml(question.body.text || "");
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function startTimer() {
  stopTimer();
  state.startedAt = Date.now();
  $("#quiz-timer").textContent = "00:00";
  state.timerId = setInterval(() => {
    $("#quiz-timer").textContent = formatTime(Date.now() - state.startedAt);
  }, 500);
}

function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function renderQuestion() {
  const test = state.tests[state.currentTest];
  const q = currentQuestion();
  const globalIdx = globalQuestionIndex();
  const total = totalQuestions();
  $("#quiz-label").textContent = `${test.title} · Questao ${state.currentQuestion + 1}/${test.questions.length}`;
  $("#progress-fill").style.width = `${((globalIdx + 1) / total) * 100}%`;
  $("#question-title").textContent = q.text;
  $("#question-body").innerHTML = renderBody(q);
  const letters = ["A", "B", "C", "D"];
  $("#options").innerHTML = q.options
    .map(
      (opt, i) => `
    <button class="option" type="button" data-index="${i}">
      <span class="option-letter">${letters[i]}</span>
      <span>${escapeHtml(opt)}</span>
    </button>`
    )
    .join("");
  state.selected = null;
  $("#btn-next").disabled = true;
  $("#btn-next").textContent =
    state.currentTest === state.tests.length - 1 && state.currentQuestion === test.questions.length - 1
      ? "Ir ao pagamento →"
      : "Proxima →";
  $("#options").querySelectorAll(".option").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selected = Number(btn.dataset.index);
      $("#options").querySelectorAll(".option").forEach((el, i) => el.classList.toggle("selected", i === state.selected));
      $("#btn-next").disabled = false;
    });
  });
}

function startQuiz() {
  if (!state.tests.length) {
    toast("O catalogo ainda nao carregou.");
    return;
  }
  state.currentTest = 0;
  state.currentQuestion = 0;
  state.answers = {};
  state.selected = null;
  showScreen("screen-quiz");
  startTimer();
  renderQuestion();
}

async function nextQuestion() {
  if (state.selected === null || state.submitting) return;
  const q = currentQuestion();
  state.answers[q.id] = state.selected;
  const test = state.tests[state.currentTest];
  if (state.currentQuestion < test.questions.length - 1) {
    state.currentQuestion += 1;
    renderQuestion();
    return;
  }
  if (state.currentTest < state.tests.length - 1) {
    state.currentTest += 1;
    state.currentQuestion = 0;
    renderQuestion();
    return;
  }
  await iniciarCheckout();
}

async function iniciarCheckout() {
  state.submitting = true;
  $("#btn-next").disabled = true;
  $("#btn-next").textContent = "Abrindo pagamento...";
  stopTimer();
  const respostas = Object.entries(state.answers).map(([id, opcao]) => ({ id, opcao }));
  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ respostas }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || "Nao foi possivel iniciar o pagamento.");
    localStorage.setItem("testeId", data.testeId);
    window.location.href = data.checkoutUrl;
  } catch (err) {
    toast(err.message);
    $("#btn-next").disabled = false;
    $("#btn-next").textContent = "Ir ao pagamento →";
    startTimer();
  } finally {
    state.submitting = false;
  }
}

async function aguardarPagamento(testeId, tentativas = 30) {
  $("#waiting-text").textContent = "Estamos confirmando seu pagamento. Isso pode levar alguns segundos.";
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await fetch(`/api/status/${testeId}`);
      const data = await res.json();
      if (res.ok && data.status === "pago") {
        await mostrarResultado(testeId);
        return;
      }
    } catch (_err) {
      /* tenta de novo */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  $("#waiting-text").textContent = "Ainda estamos confirmando seu pagamento. Consulte novamente em alguns segundos.";
}

async function mostrarResultado(testeId) {
  const res = await fetch(`/api/resultado/${testeId}`);
  if (res.status === 402) {
    showScreen("screen-waiting");
    return;
  }
  if (!res.ok) {
    toast("Nao foi possivel carregar o resultado.");
    return;
  }
  const data = await res.json();
  const r = data.resultado;
  showScreen("screen-results");
  $("#iq-score").textContent = r.pontuacao;
  $("#score-band").textContent = r.faixa || "";
  $("#score-desc").textContent = `${r.acertos} de ${r.total} acertos. ${r.descricao || ""}`;
  const bits = [];
  if (r.percentil != null) bits.push(`<span>Percentil: <strong>${r.percentil}</strong></span>`);
  if (data.pagoEm) bits.push(`<span>Pago em <strong>${new Date(data.pagoEm).toLocaleString("pt-BR")}</strong></span>`);
  $("#score-meta").innerHTML = bits.join("");
  const pct = r.total ? r.acertos / r.total : 0;
  const circumference = 2 * Math.PI * 52;
  const ring = $("#ring-fill");
  ring.style.strokeDasharray = circumference;
  ring.style.strokeDashoffset = circumference * (1 - pct);
  $("#breakdown").innerHTML = (r.detalhamento || [])
    .map(
      (b) => `
    <div class="breakdown-item">
      <div>
        <span>${escapeHtml(b.title)}</span>
        <div class="breakdown-bar"><span style="width:${Math.round((b.pct || 0) * 100)}%"></span></div>
      </div>
      <span class="breakdown-score">${b.correct}/${b.total}</span>
    </div>`
    )
    .join("");

  try {
    const rec = await fetch(`/api/comprovante/${testeId}`).then((x) => x.json());
    if (rec.titular || rec.conta) {
      $("#receipt").hidden = false;
      $("#receipt-body").innerHTML = [
        rec.titular ? `<span>Titular: <strong>${escapeHtml(rec.titular)}</strong></span>` : "",
        rec.instituicao ? `<span>Instituicao: <strong>${escapeHtml(rec.instituicao)}</strong></span>` : "",
        rec.conta ? `<span>Conta: <strong>${escapeHtml(rec.conta)}</strong></span>` : "",
        rec.valor != null ? `<span>Valor: <strong>${formatBRL(rec.valor)}</strong></span>` : "",
      ].join("");
    }
  } catch (_err) {
    /* comprovante opcional */
  }
}

$("#btn-start").addEventListener("click", startQuiz);
$("#btn-next").addEventListener("click", nextQuestion);
$("#btn-back").addEventListener("click", () => {
  if (confirm("Deseja sair? Seu progresso sera perdido.")) {
    stopTimer();
    history.pushState({}, "", "/");
    showScreen("screen-home");
  }
});
$("#btn-recheck").addEventListener("click", () => {
  if (state.testeId) aguardarPagamento(state.testeId);
});
document.addEventListener("keydown", (event) => {
  if (!$("#screen-quiz").classList.contains("active")) return;
  const map = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 };
  if (event.code in map) {
    const btn = $("#options").querySelector(`[data-index="${map[event.code]}"]`);
    if (btn) btn.click();
  }
  if (event.key === "Enter") nextQuestion();
});

(async function init() {
  const tela = route();
  if (tela === "home") await loadHome();
  else await loadHome().catch(() => {});
})();
