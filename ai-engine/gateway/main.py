from __future__ import annotations

import os
import time
import uuid
from collections import defaultdict, deque
from typing import Any

import httpx
from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

APP_VERSION = "1.0.0"
GATEWAY_KEY = os.getenv("ALTHEA_AI_ENGINE_KEY", "")
FAST_UPSTREAM = os.getenv("FAST_UPSTREAM_URL", "http://worker-fast:8000/v1")
REASONING_UPSTREAM = os.getenv("REASONING_UPSTREAM_URL", "http://worker-reasoning:8000/v1")
CODING_UPSTREAM = os.getenv("CODING_UPSTREAM_URL", "http://worker-coding:8000/v1")
DEFAULT_UPSTREAM = os.getenv("DEFAULT_UPSTREAM_URL", REASONING_UPSTREAM)
MAX_BODY_BYTES = int(os.getenv("MAX_BODY_BYTES", "1048576"))
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "60"))
ALLOWED_TOOLS = {
    "sales_summary",
    "transaction_search",
    "funnel_summary",
    "checkout_summary",
    "gateway_health",
    "crm_search",
}

app = FastAPI(title="Althea AI Engine", version=APP_VERSION, docs_url=None, redoc_url=None)
_client = httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=5.0))
_buckets: dict[str, deque[float]] = defaultdict(deque)


def _auth(authorization: str | None, x_api_key: str | None) -> str:
    presented = x_api_key or (authorization[7:] if authorization and authorization.lower().startswith("bearer ") else "")
    if not GATEWAY_KEY or presented != GATEWAY_KEY:
        raise HTTPException(status_code=401, detail="AI engine authentication failed")
    return presented


def _rate_limit(identity: str) -> None:
    now = time.monotonic()
    bucket = _buckets[identity]
    while bucket and now - bucket[0] >= 60:
        bucket.popleft()
    if len(bucket) >= RATE_LIMIT_PER_MINUTE:
        raise HTTPException(status_code=429, detail="AI engine rate limit exceeded")
    bucket.append(now)


def _upstream(model: str | None) -> str:
    name = (model or "althea-reasoning").lower()
    if "fast" in name:
        return FAST_UPSTREAM
    if "cod" in name:
        return CODING_UPSTREAM
    return DEFAULT_UPSTREAM


def _sanitize_tools(payload: dict[str, Any]) -> None:
    tools = payload.get("tools")
    if not tools:
        return
    if not isinstance(tools, list) or len(tools) > 16:
        raise HTTPException(status_code=400, detail="Invalid tool set")
    for tool in tools:
        function = tool.get("function") if isinstance(tool, dict) else None
        name = function.get("name") if isinstance(function, dict) else None
        if name not in ALLOWED_TOOLS:
            raise HTTPException(status_code=403, detail=f"Tool '{name}' is not permitted")


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {"status": "ok", "service": "althea-ai-engine", "version": APP_VERSION, "time": time.time()}


@app.get("/readyz")
async def readyz() -> JSONResponse:
    upstream = DEFAULT_UPSTREAM.rstrip("/") + "/models"
    try:
        response = await _client.get(upstream, timeout=5.0)
        if response.status_code >= 400:
            return JSONResponse({"status": "degraded", "upstream_status": response.status_code}, status_code=503)
        return JSONResponse({"status": "ready"})
    except Exception as exc:
        return JSONResponse({"status": "not_ready", "error": type(exc).__name__}, status_code=503)


@app.get("/v1/models")
async def models(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
) -> Response:
    key = _auth(authorization, x_api_key)
    _rate_limit(key)
    response = await _client.get(DEFAULT_UPSTREAM.rstrip("/") + "/models")
    return Response(content=response.content, status_code=response.status_code, media_type="application/json")


@app.post("/v1/chat/completions")
async def chat_completions(
    request: Request,
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
) -> Response:
    key = _auth(authorization, x_api_key)
    _rate_limit(key)
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Request body too large")
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    if not isinstance(payload, dict) or not isinstance(payload.get("messages"), list):
        raise HTTPException(status_code=400, detail="messages is required")
    _sanitize_tools(payload)
    payload["user"] = "althea-iara"
    payload.setdefault("stream", False)
    request_id = request.headers.get("x-request-id") or f"req_{uuid.uuid4().hex}"
    upstream = _upstream(payload.get("model"))
    headers = {"Authorization": f"Bearer {os.getenv('UPSTREAM_API_KEY', 'internal')}", "Content-Type": "application/json", "X-Request-ID": request_id}
    try:
        upstream_response = await _client.post(upstream.rstrip("/") + "/chat/completions", json=payload, headers=headers)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Inference upstream timeout")
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Inference upstream unavailable")
    out_headers = {"X-Request-ID": request_id, "X-Althea-AI-Engine": APP_VERSION}
    content_type = upstream_response.headers.get("content-type", "application/json")
    if payload.get("stream") and upstream_response.status_code < 400:
        return StreamingResponse(iter([upstream_response.content]), status_code=upstream_response.status_code, media_type=content_type, headers=out_headers)
    return Response(content=upstream_response.content, status_code=upstream_response.status_code, media_type=content_type.split(";")[0], headers=out_headers)


@app.on_event("shutdown")
async def shutdown() -> None:
    await _client.aclose()
