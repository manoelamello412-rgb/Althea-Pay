// Simple idempotency helper with in-memory fallback and DB-ready hooks.
// Intended to be used by orchestrator and sandbox handlers.

type IdempotencyRecord = {
  key: string;
  response?: any;
  created_at: string;
};

const MEM_STORE: Record<string, IdempotencyRecord> = {};

export async function getIdempotency(key: string) {
  // TODO: Replace with DB lookup when DATABASE_URL is provided
  return MEM_STORE[key] || null;
}

export async function saveIdempotency(key: string, response: any) {
  // TODO: Replace with transactional DB upsert
  MEM_STORE[key] = { key, response, created_at: new Date().toISOString() };
}

export async function useIdempotency<T>(key: string, handler: () => Promise<T>) {
  const existing = await getIdempotency(key);
  if (existing) return existing.response as T;
  const result = await handler();
  await saveIdempotency(key, result);
  return result;
}
