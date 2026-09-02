# Althea Pay Sandbox — quickstart

Objetivo: integrar a camada de controle da Althea Pay sem armazenar PAN/CVC e sem mover o dinheiro para a Althea.

## 1. Crie uma API key

No painel Althea Pay, crie uma chave com pelo menos:

- `funnels:read`
- `events:write`
- `transactions:read`

A chave deve ser tratada como segredo e usada apenas no servidor.

## 2. Descubra um funil

```bash
curl -sS \
  -H "x-althea-api-key: $ALTHEA_API_KEY" \
  "https://hkraryqoziravulvqkid.supabase.co/functions/v1/althea-public-api/v1/funnels"
```

Copie o `id` do funil para `FUNNEL_ID`.

## 3. Envie um evento

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "x-althea-api-key: $ALTHEA_API_KEY" \
  -H "x-request-id: sandbox-$(date +%s)" \
  -d '{
    "event_type": "purchase",
    "external_id": "order-sandbox-001",
    "funnel_id": "'$FUNNEL_ID'",
    "payload": {
      "amount": 199.90,
      "currency": "BRL",
      "scenario": "approved"
    }
  }' \
  "https://hkraryqoziravulvqkid.supabase.co/functions/v1/althea-public-api/v1/events"
```

A resposta deve conter `accepted: true`, um `event_id` e um status de processamento. Reenviar o mesmo `external_id` para o mesmo merchant não deve criar um segundo evento.

## 4. Consulte a transação

```bash
curl -sS \
  -H "x-althea-api-key: $ALTHEA_API_KEY" \
  "https://hkraryqoziravulvqkid.supabase.co/functions/v1/althea-public-api/v1/transactions?limit=20"
```

## Cenários de sandbox

O simulador determinístico suporta `approved`, `declined`, `error`, `refund` e `chargeback`. O mesmo contrato é usado como base para a futura camada de adapters de PSP.

## Segurança

- Nunca envie PAN ou CVC para a Althea Pay.
- Nunca coloque a API key em JavaScript de navegador.
- Use `external_id` estável para deduplicação.
- Propague `x-request-id` para rastreabilidade.
- Em produção, use webhooks assinados com HMAC e proteção contra replay.
