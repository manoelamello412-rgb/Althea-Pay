# IARA — Programa de Excelência Global

## Objetivo

Transformar a IARA na camada de inteligência operacional nativa da ALTHEA PAY, com capacidade de compreender, analisar, planejar, autorizar, executar, verificar e monitorar operações de vendas e pagamentos.

**Meta:** superar concorrentes por combinação de inteligência contextual, execução operacional, segurança, governança, memória, analytics, automação e integração de toda a cadeia econômica do merchant.

> A meta de superioridade é um objetivo de engenharia e produto. Nenhuma afirmação de "100% superior" será considerada válida sem testes objetivos, benchmarks reproduzíveis e evidência por eixo.

## Benchmark global

- **Stripe:** pagamentos programáveis, Agentic Commerce, wallets para agentes, fraud detection e infraestrutura financeira para agentes. Stripe anunciou em 2026 suporte a wallets para agentes e expansão do Agentic Commerce Suite. [1]
- **Ramp:** agentes financeiros, execução de workflows, políticas inteligentes, accounting/finance intelligence e automação end-to-end. [2]
- **Salesforce Agentforce:** agentes empresariais, CRM, commerce e orquestração de jornadas. [3]
- **PayPal:** agentic commerce, descoberta de produtos, carrinho e compra através de interfaces conversacionais. [4]

## Eixos obrigatórios

### 1. Inteligência contextual

IARA deve correlacionar:

`tráfego → funil → checkout → produto → cliente → pagamento → gateway → CRM → afiliado → receita`

### 2. Agentic execution

Cada ação passa por:

`identidade → autenticação → autorização → risco → ferramenta → execução → verificação → auditoria`

### 3. Multiagente

Arquitetura alvo:

- Orchestrator Agent
- Sales Agent
- Payments Agent
- Checkout Agent
- Funnel Agent
- CRM Agent
- Gateway Agent
- Affiliate Agent
- Analytics Agent
- Risk Agent
- Research Agent
- Finance Agent

Agentes especializados não recebem privilégios implícitos. Todos usam o mesmo perímetro de autorização e auditoria.

### 4. Memória

Hierarquia:

- Session Memory
- Conversation Memory
- User Memory
- Business Memory
- Product Memory
- Decision Memory
- Operational Memory
- Audit Memory

Fonte de verdade: PostgreSQL/Supabase. Redis, quando adotado, é coordenação/cache e não autoridade de dados.

### 5. Analytics

A IARA deverá evoluir de métricas descritivas para:

- anomaly detection;
- forecasting;
- cohort analysis;
- funnel diagnosis;
- conversion decomposition;
- causal hypotheses;
- gateway performance attribution;
- customer propensity;
- revenue forecasting;
- scenario simulation.

### 6. Agentic Commerce

A arquitetura deverá suportar, quando os trilhos e integrações estiverem disponíveis:

- descoberta de produtos por agentes;
- checkout agent-ready;
- pagamentos iniciados por agentes;
- autorização delegada;
- machine-to-machine payments;
- identidade de agente;
- limites de gasto;
- aprovação humana por risco;
- prevenção de fraude específica para agentes.

### 7. Governança

**Autonomia máxima na operação. Autonomia zero sobre código e infraestrutura.**

A IARA nunca poderá:

- alterar código-fonte;
- criar/deletar arquivos de aplicação;
- fazer deploy;
- alterar infraestrutura;
- alterar secrets/chaves privadas;
- elevar privilégios;
- modificar suas próprias regras de segurança.

Essa fronteira deve existir no backend/tool layer, e não apenas no prompt.

### 8. Segurança

Obrigatório:

- RBAC/ABAC;
- RLS;
- least privilege;
- tenant isolation;
- idempotência;
- rate limiting;
- input/output validation;
- audit trail;
- concurrency control;
- encrypted sensitive payloads;
- key separation;
- replay protection;
- observability.

### 9. Realtime

A arquitetura atual utiliza Supabase Realtime como transporte nativo. Não criar um servidor WebSocket paralelo apenas para reproduzir uma capacidade já disponível na plataforma.

Eventos críticos devem possuir identidade, sequência quando necessária, tenant scope e semântica de reconciliação.

### 10. Confiabilidade

A IARA nunca deve declarar sucesso sem verificar o estado final.

Para operações transacionais:

`request → idempotency → execute → commit → verify → audit → response`

Falhas devem produzir estado observável e recuperável.

## Estado atual da arquitetura

```text
Next.js / Vercel
       │
       ▼
Authenticated API
       │
       ▼
IARA Core — Supabase Edge Function
       │
 ┌─────┼───────────┐
 ▼     ▼           ▼
Tools Memory      LLM Gateway
 │     │           │
 └─────┼───────────┘
       ▼
Operational Data + Events
       │
       ▼
Supabase Realtime
       │
 ┌─────┴─────┐
 ▼           ▼
CRM       Dashboard
```

## Critérios de aceitação global

Nenhum eixo será considerado concluído por aparência ou por existência de código. Deve haver:

1. contrato tipado;
2. implementação real;
3. autorização backend;
4. persistência real quando aplicável;
5. observabilidade;
6. testes unitários;
7. testes de integração;
8. testes de concorrência quando aplicável;
9. teste de falha/recuperação;
10. benchmark comparável;
11. documentação operacional;
12. evidência de produção antes de declarar maturidade.

## Fontes de benchmark

[1] Stripe Sessions 2026 — infraestrutura econômica para IA e Agentic Commerce.
[2] Ramp — AI Agents in Finance / Applied AI Solutions 2026.
[3] Salesforce — Agentforce Commerce 2026.
[4] PayPal Developer — Agentic Commerce Services 2026.
