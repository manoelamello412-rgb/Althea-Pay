export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function requestId(req: Request) {
  return req.headers.get('x-request-id') ?? crypto.randomUUID();
}

export function corsHeaders(origin?: string | null) {
  const allowed = Deno.env.get('ALTHEA_ALLOWED_ORIGINS')?.split(',').map((v) => v.trim()).filter(Boolean) ?? [];
  const allowOrigin = origin && allowed.includes(origin) ? origin : (allowed[0] ?? 'null');
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-request-id',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    vary: 'Origin',
  };
}
