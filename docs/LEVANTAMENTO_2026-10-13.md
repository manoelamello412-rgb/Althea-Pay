# Althea Pay — Primeiro levantamento (estado atual × escopo)

Data: 2026-10-13

Fonte: leitura do repositório — frontend (`app/`), 46 Edge Functions, 624 migrations e `types/supabase.ts`. Não foram rodados typecheck/testes (sem `node_modules`) nem consultado o banco de produção.

## Resumo

O backend está bem mais avançado que o frontend. Ingestão de eventos por funil, tokens, webhooks de gateway com idempotência, outbox de mensagens e RLS por organização já existem e são sólidos. As lacunas principais:

1. Não existe uma entidade de cliente/lead canônica.
2. Kanban, Call, remarketing e Infobip não existem.
3. Muitas tabelas e RPCs do CRM não têm tela nenhuma.

## Multi-funil (o "centralizador de páginas")

| Requisito | Status | Onde |
|---|---|---|
| ID único por funil | ✅ | tabela `funnels` |
| Token por página/funil | ✅ | `funnel_ingestion_tokens` guarda só o hash, mostra o token uma vez e gerar outro revoga o anterior (`app/api/funnels/ingestion-token/route.ts`) |
| Token de browser de curta duração | ✅ backend, ❌ sem uso no front | `funnel-client-token` (HMAC, `aud`, `exp`, `scope`) |
| Endpoint de eventos | ✅ | `funnel-events`: valida o token, recusa evento de outro funil (`token_funnel_mismatch`), rate limit por token, idempotência por `event_id`, catálogo `funnel_event_types` |
| API aberta | ✅ parcial | `althea-public-api/v1`: funnels, products, sales, transactions (leitura) e events (escrita), com API key por escopo |
| Webhooks de saída | ✅ | `outbound_webhooks` + dispatcher |
| SDK / snippet para colar na página | ⚠️ | só `examples/sdk-quickstart/index.js`. Falta um `<script>` oficial que gere `visitor_id`/`session_id` e envie `page_view` automaticamente |
| Documentação da API | ⚠️ desatualizada | `docs/openapi.yaml` e `docs/API.md` citam `gateway-refund`, que não existe mais nas functions |

## Status por módulo do escopo

| # | Módulo | Status | Observação |
|---|---|---|---|
| 1 | Dashboard | 🟡 | O dashboard principal usa o RPC `dashboard_production_data_for_user_secure` (correto). `analytics/page.tsx` baixa até 10 mil linhas e calcula métricas no browser, violando a regra "nada calculado no front". Faltam filtros por produto/gateway/status no backend. |
| 2 | Funis | 🟢 | Cadastro, domínio, conexão, binding de gateway/produto, steps, jornada (`v_funnel_live_journeys`) e drift worker. |
| 3 | Eventos | 🟢 | Camada central em `integration_events`, com dead letter, retry e espelho em `crm_webhook_events`. Conferir se `lead_created` e `payment_expired` estão no catálogo. |
| 4 | Gateways | 🟢 | Registry dinâmico (Stripe, Mercado Pago, Asaas, Adyen, generic_http, sandbox), normalização de status (`_shared/gateway-webhook-normalization.ts`), idempotência, recovery e reconciliação. Adapter nativo só para Mercado Pago; os demais passam pelo `generic_http`. |
| 5 | Transações | 🟡 | Dados em `gateway_transactions`, mas `pagamentos/page.tsx` faz query direta com limite de 5000, sem paginação e sem histórico de eventos por transação na UI. |
| 6 | CRM / cliente canônico | 🔴 | **Maior problema.** Não existe tabela `customers`/`leads`. `clientes/page.tsx` lê a tabela legada `clients` (JSON solto) e o Customer 360 correlaciona por **e-mail**. Contradiz "não criar clientes diferentes para funil, chat e CRM". |
| 7 | Kanban | 🔴 | Não existe: sem pipeline, etapas ou tela. |
| 8 | Chat | 🟢/🟡 | `crm/page.tsx` tem inbox realtime, envio idempotente, atribuição e times. `crm_quick_replies`, `crm_tasks`, `crm_tags` e `crm_segments` existem **sem tela**. |
| 9 | Call | 🔴 | Não existe. |
| 10 | Cliente 360 | 🟡 | RPC existe, mas depende do item 6. |
| 11 | Estados de UI | 🟡 | O CRM trata bem (realtime, reconexão). As demais páginas são mais simples. |
| 12 | Permissões | 🟡 | Papéis + capabilities por membro (`docs/ORGANIZATION_ACCESS_MODEL.md`). Várias páginas ainda filtram por `user_id` (dono) em vez de `organization_id`; o próprio doc admite migração incompleta. Ex.: `funil/page.tsx` e `funnel-events` (`.eq('user_id', uid)`). |
| 13 | Auditoria | 🟢 | `audit_logs`, `transaction_audit_events` e tela `security/audit`. |
| 14 | Arquitetura | 🟢 | Fluxo Funil/Gateway → Edge Function → Supabase → telas já segue o escopo. |

## Remarketing (e-mail via Resend, WhatsApp via Infobip)

### Já existe e pode ser reaproveitado

- `crm_channel_message_outbox` + `crm-channel-outbox-dispatcher`: fila durável com retry e replay. Providers atuais: **Resend** (e-mail), **Meta WhatsApp Cloud** e **Twilio** (SMS).
- `crm-channel-resend-webhook`: valida assinatura Svix, recebe status de entrega e e-mails de resposta.
- `checkout-recovery-worker` e `automation-engine-v2` já gravam no outbox — recuperação de carrinho abandonado e pagamento recusado já tem o encanamento.
- Tabela `crm_segments`.

### Falta

1. **Adapter Infobip** no dispatcher (ao lado de Meta e Twilio) + webhook de entrada/status (`crm-channel-infobip-webhook`), no mesmo padrão do webhook do Resend.
2. **Templates de WhatsApp aprovados.** Fora da janela de 24h, a Meta só permite template aprovado (vale também via Infobip). Remarketing por WhatsApp é, quase sempre, envio de template.
3. **Consentimento e opt-out** (LGPD, regras Meta/Gmail): tabela de consentimento por canal, header `List-Unsubscribe` no e-mail, tratamento de "SAIR" no WhatsApp. Hoje não existe.
4. **Campanhas:** entidade campanha (segmento + template + canal + agendamento), disparo em massa alimentando o outbox existente, métricas por campanha (enviado, entregue, lido, clicado, convertido).
5. **Gatilhos automáticos** (`checkout_abandoned`, `payment_failed`, `payment_expired` → sequência de mensagens), sobre o `automation_rules` existente.
6. **Telas** para conectar contas (`crm_channel_accounts` sem UI), segmentos, templates e campanhas.

## Ordem de execução recomendada

1. **Identidade canônica de cliente/lead:** `customers` + `customer_identities` (email, telefone, `visitor_id`, id externo do gateway) e merge. CRM, 360, Kanban, Call e remarketing dependem disso.
2. **Fechar a migração `user_id` → `organization_id`** nas páginas e functions restantes.
3. **Snippet oficial para as páginas** + atualizar OpenAPI. Destrava o caso "subo 10 páginas".
4. **Kanban:** `crm_pipelines` + `crm_stages` + RPC de mover card, com auditoria.
5. **Telas para o que já existe:** tarefas, tags, respostas rápidas, segmentos, contas de canal.
6. **Remarketing:** Infobip + consentimento + templates + campanhas, sobre o outbox existente.
7. **Call:** tentativas e resultados que atualizam a etapa no CRM.
8. **Dashboard/Analytics:** mover cálculos de `analytics/page.tsx` para RPC e adicionar filtros.

## Decisões pendentes

- ~~**Fonte de WhatsApp**~~ — **decidido (2026-10-13): Infobip substitui o Meta WhatsApp Cloud.** O adapter Meta sai do dispatcher; o WhatsApp passa a ser só Infobip, atrás do mesmo outbox.
- **Atualização (2026-10-14):** o WhatsApp agora usa Baileys (QR, como o Bellevo, via `whatsapp-bridge/`) **ou** Infobip, escolhido pela organização em CRM › Configurações › WhatsApp. A única mensagem automática é a de pagamento pendente há mais de 5 minutos.
- ~~**Regra de merge de cliente**~~ — **decidido (2026-10-13): anexa identidade.** Se o evento casa com um cliente existente por qualquer identidade, as identidades novas são anexadas a ele. Se identidades diferentes apontarem para clientes diferentes, nada é juntado automaticamente: o caso vira candidato a merge para revisão humana.

## Requisitos adicionados depois do levantamento

- **Comprovante de transferência no chat (2026-10-13):** o cliente precisa conseguir anexar o comprovante de transferência (imagem/PDF) na conversa. Isso exige upload no widget de chat do funil (Storage privado por organização, com limite de tipo e tamanho), mensagem com anexo em `crm_messages`, preview no inbox do CRM e, idealmente, um vínculo do comprovante com a transação para conciliação manual.

## Correção ao levantamento

O item 6 estava impreciso. Já existe um cliente canônico embrionário: a tabela `clients` (FK de `crm_conversations.customer_id`, com `organization_id`), que é materializada por `materialize_gateway_customer_identity` e `materialize_funnel_chat_event`, além de `crm_channel_identities`. O problema real é que a resolução acontece **só por e-mail dentro do jsonb**: não há tabela de identidades (telefone, `visitor_id`, id do gateway) nem regra de merge. A frente 1 vai evoluir `clients`, não criar `customers` do zero.
