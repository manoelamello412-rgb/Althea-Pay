# IARA — Global Leadership Architecture

## 1. Mission

IARA is the native operational intelligence of ALTHEA PAY. Its target is not to be a chat interface; it is an authorized agentic operating layer that understands, analyzes, plans, executes, verifies and monitors the complete commercial lifecycle of a business.

**Core invariant:** maximum autonomy in authorized operations; zero autonomy over application code and infrastructure.

## 2. Competitive target

IARA is engineered against four reference classes:

- Stripe: payment intelligence, programmable commerce and agentic commerce.
- Ramp: autonomous finance operations, agent identity, policy, approvals and auditability.
- Salesforce Agentforce: enterprise agents, CRM, orchestration and data context.
- PayPal: agentic commerce, discovery, cart and agent-initiated purchase flows.

The objective is not to clone any competitor. IARA combines the strongest applicable capabilities into one vertical intelligence layer for ALTHEA PAY.

## 3. End-to-end business graph

```text
Traffic
  -> Funnel
  -> Product / Offer
  -> Checkout
  -> Payment
  -> Gateway
  -> Customer
  -> CRM / Conversation
  -> Affiliate
  -> Revenue
  -> Financial / Commercial Metrics
  -> Forecast / Decision / Action
```

IARA must be able to traverse this graph with explicit tenant, user, resource and permission boundaries.

## 4. Agentic architecture

```text
                         IARA ORCHESTRATOR
                                |
       +------------------------+------------------------+
       |                        |                        |
   CONTEXT                    POLICY                  MEMORY
       |                        |                        |
       +------------------------+------------------------+
                                |
                         PLANNER / REASONER
                                |
                +---------------+---------------+
                |               |               |
             TOOLS           SPECIALISTS       RESEARCH
                |               |               |
                |      +--------+--------+      |
                |      |        |        |      |
                |    Sales   Payments   CRM   External
                |    Agent    Agent    Agent  Sources
                |      |        |        |      |
                +------+--------+--------+------+
                                |
                         EXECUTION POLICY
                                |
                     +----------+----------+
                     |                     |
                  APPROVE                 EXECUTE
                     |                     |
                     +----------+----------+
                                |
                             VERIFY
                                |
                            AUDIT / EVENT
                                |
                         MONITOR / PROACT
```

## 5. Specialist agents

The architecture reserves typed specialist capabilities for:

- Sales Agent — revenue, conversion, offers, sales diagnosis and commercial actions.
- Payments Agent — transactions, approval, decline analysis, reconciliation and payment operations.
- Gateway Agent — health, latency, routing, failover recommendations and gateway diagnostics.
- Funnel Agent — funnel performance, stage conversion, drop-off and experimentation.
- Checkout Agent — checkout conversion, abandonment and recovery operations.
- CRM Agent — customers, conversations, lead qualification and follow-up workflows.
- Affiliate Agent — attribution, commissions, partner performance and anomalies.
- Analytics Agent — KPIs, cohorts, anomaly detection, forecasting and causal analysis.
- Risk Agent — fraud/risk signals, policy checks and high-risk action escalation.
- Finance Agent — revenue, fees, payouts, margins, cash-flow analysis and reconciliation.
- Research Agent — public external research with source, date, reliability and fact/inference separation.

Specialists never bypass the central authorization and audit layers.

## 6. Mandatory execution loop

```text
UNDERSTAND
  -> ANALYZE
  -> PLAN
  -> AUTHORIZE
  -> EXECUTE
  -> VERIFY
  -> EXPLAIN
  -> MONITOR
```

An operation is not reported as completed until its result is verified against authoritative state.

## 7. Risk-based autonomy

### Low risk

Read operations, diagnostics, summarization, calculations and recommendations can execute automatically within the user's existing permissions.

### Medium risk

Actions that materially affect commercial workflows require contextual validation according to policy. The system should explain what will change before execution when policy requires it.

### High impact

Financial movement, irreversible deletion, permission changes, security changes, credential operations and other high-impact actions require explicit human confirmation and backend authorization.

IARA can never elevate its own privileges.

## 8. Security boundary

The mandatory authorization chain is:

```text
Identity
 -> Authentication
 -> Authorization
 -> RBAC / ABAC
 -> Policy
 -> Tool
 -> Resource
 -> Audit
```

Authorization is enforced in backend services and database policies, not by frontend visibility.

IARA must never:

- modify source code;
- create, delete or rewrite application files;
- deploy software;
- modify infrastructure;
- alter environment secrets or private keys;
- weaken security controls;
- bypass RLS or authorization;
- grant itself permissions;
- operate outside the authenticated user's scope.

## 9. Memory system

Memory is separated into:

- session memory;
- conversation memory;
- user memory;
- business memory;
- product memory;
- decision memory;
- operational memory;
- audit memory.

PostgreSQL is the source of truth. Redis, when introduced, is coordination/cache/rate-limit infrastructure only.

Memory architecture:

```text
Event Journal
     |
Structured Memory ---- Semantic Memory
     |                    |
     +--------+-----------+
              |
       Context Reconstructor
              |
        Snapshot + Events
              |
        Current Context
              |
        IARA Orchestrator
```

Long-term memory must be selective. Raw chat text is not automatically promoted to durable memory.

## 10. Tool registry

Every tool must have:

- stable identifier and version;
- typed input/output schema;
- authorization policy;
- risk class;
- idempotency requirements;
- timeout and retry policy;
- resource scope;
- audit contract;
- observability metadata;
- deterministic error semantics.

The model may request a tool. The backend decides whether that tool can execute.

## 11. Transactional reliability

All financial or state-changing tools must provide:

- idempotency;
- request correlation ID;
- concurrency control;
- transactional boundaries;
- safe retries only for transient failures;
- exponential backoff with jitter where appropriate;
- fencing/lease semantics where distributed coordination is necessary;
- post-execution verification;
- recovery semantics;
- immutable audit evidence.

PostgreSQL remains authoritative for transactional state and sequencing.

## 12. External intelligence

Research is a separate capability boundary. IARA must identify:

- source;
- publication/update date;
- relevance;
- reliability;
- fact vs inference;
- uncertainty.

External information must never silently become internal operational truth.

## 13. Proactive intelligence

IARA must evolve from request/response to event-driven intelligence.

It should detect and surface:

- conversion drops;
- abnormal gateway latency;
- approval-rate degradation;
- revenue anomalies;
- checkout abandonment spikes;
- CRM response degradation;
- unusual customer behavior;
- affiliate anomalies;
- operational bottlenecks;
- forecast deviations;
- emerging commercial opportunities.

Proactive alerts must contain evidence, impact estimate, confidence and recommended next action.

## 14. Analytics maturity

The target stack is:

1. descriptive — what happened;
2. diagnostic — why it happened;
3. predictive — what is likely to happen;
4. prescriptive — what should be done;
5. agentic — execute the authorized action;
6. verified — measure the actual outcome.

IARA must not claim causality when the available evidence only supports correlation.

## 15. Agentic commerce

The architecture must support future agent-to-agent and agent-to-business commerce without weakening human authorization or payment security.

Required concepts include:

- machine-readable product/catalog data;
- agent-ready checkout contracts;
- delegated payment authority;
- spending limits;
- agent identity;
- transaction attribution;
- real-time audit;
- fraud/risk signals;
- reversible/confirmable purchase flows where applicable.

## 16. Realtime

The current platform direction uses Supabase Realtime as the application realtime transport. A custom long-lived WebSocket server is not a prerequisite for the Vercel/Supabase architecture.

Realtime messages must be typed, tenant-scoped, deduplicatable and correlated to durable events when durability is required.

## 17. Observability

Every IARA execution should be traceable by execution ID and record, where applicable:

- authenticated user;
- session/conversation;
- original request;
- interpreted intent;
- selected tools;
- authorization decisions;
- execution timestamps;
- latency;
- model/provider route;
- retries;
- errors;
- resources affected;
- final verified state;
- confirmation events.

## 18. Reliability objectives

No hard latency promise is encoded without measured evidence. Production SLOs must be defined from telemetry and validated with representative load tests.

The system must prioritize correctness over an artificial latency target, especially for financial operations.

## 19. Current platform boundary

The repository currently follows a Next.js/Vercel + Supabase + Supabase Edge Functions + dedicated AI Engine architecture. The IARA core already has authenticated chat, operational context, read tools, persistence and execution observability. New capabilities must extend this architecture rather than create a competing backend.

## 20. Non-negotiable engineering rules

1. No mock persistence in production paths.
2. No `any` in IARA core contracts.
3. No secrets in source control.
4. No model-authorized bypass of backend policy.
5. No unverified execution claims.
6. No cross-tenant data access.
7. No irreversible high-impact action without required confirmation.
8. No Redis-as-source-of-truth.
9. No custom server architecture merely to duplicate existing platform capabilities.
10. No code or infrastructure autonomy for IARA.
