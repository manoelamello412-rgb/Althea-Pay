# Althea AI Engine

External, self-hosted inference layer for Iara. The application never talks directly to a model vendor. It talks to this gateway, which authenticates, rate-limits, validates tool access, routes requests, and proxies them to private GPU inference workers.

## Architecture

```text
Althea Pay / Iara
        |
        | HTTPS + engine key
        v
  AI Gateway :9000
        |
        +--> reasoning worker -> Qwen3-235B-A22B
        +--> fast worker      -> Qwen3-30B-A3B
        +--> coding worker    -> Qwen3-Coder-30B-A3B-Instruct
```

The reasoning worker is the primary profile. Fast and coding workers are optional Compose profiles so the cluster can scale by workload instead of forcing every model onto every GPU node.

## Security boundary

The gateway is the only public AI endpoint. Model workers are private on the Docker network. The gateway:

- requires `ALTHEA_AI_ENGINE_KEY`;
- applies per-key rate limiting;
- caps request body size;
- allows only Iara's read-only operational tools;
- never accepts arbitrary tool execution;
- generates/propagates `X-Request-ID`;
- does not expose model worker ports publicly.

Use a TLS reverse proxy, private network/VPC, firewall, and secret manager in production. Do not expose the vLLM worker ports to the Internet.

## Model baseline

The default reasoning profile uses `Qwen/Qwen3-235B-A22B`, a 235B-parameter MoE model with 22B activated parameters. Its model card documents reasoning/tool capabilities and vLLM deployment. The current vLLM release used by this stack is pinned to `v0.28.0` so the runtime is reproducible.

The model is intentionally configurable. If a newer validated open-weight model becomes preferable, change the worker image/model configuration without changing Iara's contract.

## GPU requirement

The default reasoning profile is an enterprise GPU deployment profile: tensor parallelism is set to 8 and the model should be deployed on a node/cluster with enough VRAM for the selected precision and context window. This repository does not pretend that Vercel or Supabase can provide those GPUs.

For production, deploy `ai-engine/` on dedicated GPU infrastructure and point Iara's `ALTHEA_AI_ENGINE_URL` at the gateway's HTTPS endpoint.

## Start

```bash
cd ai-engine
cp .env.example .env
# set real random secrets in .env

docker compose up -d
# optional workload profiles:
# docker compose --profile fast --profile coding up -d
```

Health:

```bash
curl https://ai.example.com/healthz
curl -H "Authorization: Bearer $ALTHEA_AI_ENGINE_KEY" https://ai.example.com/v1/models
```

## Iara integration

The Supabase `iara-ai-core` function uses the following secret configuration:

- `ALTHEA_AI_ENGINE_URL` — HTTPS base URL, for example `https://ai.altheapay.com`;
- `ALTHEA_AI_ENGINE_KEY` — gateway secret;
- `ALTHEA_AI_ENGINE_MODEL` — optional model alias, default `althea-reasoning`.

The Iara function keeps its own operational data/tool policy and only delegates text generation to this engine. If the engine is unavailable, Iara must fail closed for generative mode rather than silently claiming that a fallback model is the proprietary engine.

## Production acceptance criteria

Before declaring the engine live:

1. GPU host is provisioned and private.
2. Model worker reaches `/v1/models` successfully.
3. Gateway `/readyz` is green.
4. TLS is active at the gateway edge.
5. Engine key is stored in a secret manager, never Git.
6. Iara Supabase secret `ALTHEA_AI_ENGINE_URL` and `ALTHEA_AI_ENGINE_KEY` are configured.
7. Authenticated Iara request produces a model-generated response.
8. Tool calls are limited to the allowlist and remain read-only.
9. Request IDs and inference latency are observable.
10. No production request depends on `IARA_LLM_API_KEY` for the primary path.
