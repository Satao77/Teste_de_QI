# Teste de QI

O teste e gratuito. O resultado detalhado e cobrado pelo Mercado Pago Checkout Pro.

## Como rodar

```bash
npm install
npm start
```

O processo encerra se `MP_ACCESS_TOKEN` ou `BASE_URL` faltarem no `.env`.

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
