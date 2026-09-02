// idempotency helper (stub)
// Replace with real DB upsert implementation once DATABASE_URL is available.

async function upsertIdempotency(dbClient, key, payload) {
  // dbClient is expected to be a client/connection when used in production.
  // This stub returns a consistent shape for tests and for CI runs without DB.
  return { applied: true, key, payload, timestamp: new Date().toISOString() };
}

module.exports = { upsertIdempotency };
