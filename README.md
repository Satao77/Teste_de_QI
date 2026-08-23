# Teste de QI

O teste e gratuito. O resultado detalhado e cobrado pelo Mercado Pago Checkout Pro.

## Como rodar

```bash
npm install
npm start
```

No Render o site sobe sem `MP_ACCESS_TOKEN`. Sem esse token, o teste abre e o checkout fica desligado.

## Render

Servico: `https://teste-de-qi-1.onrender.com`

- Runtime: Node
- Build: `npm install`
- Start: `npm start`
- Health check: `/api/health`
- `BASE_URL` nao e obrigatorio. O Render preenche `RENDER_EXTERNAL_URL`.
- Em Environment, coloque `MP_ACCESS_TOKEN` para o pagamento funcionar.
- Depois do push, use Manual Deploy → Deploy latest commit.

## Fluxo

1. O preco aparece na home, antes do teste.
2. O usuario responde as questoes.
3. O servidor cria a preferencia com o preco de `PRECO_LAUDO`.
4. O usuario paga no Mercado Pago.
5. O webhook confirma o valor e libera o resultado.
6. A pagina `/resultado/:testeId` consulta o status ate o pagamento ser confirmado.

## API

| Metodo | Rota |
| --- | --- |
| GET | `/api/preco` |
| POST | `/api/checkout` |
| POST | `/api/webhooks/mercadopago` |
| GET | `/api/status/:testeId` |
| GET | `/api/resultado/:testeId` |
| GET | `/api/comprovante/:testeId` |

Resultado de teste nao pago devolve `402`, sem o relatorio.

## Aviso

Teste recreativo. Nao constitui avaliacao profissional.
