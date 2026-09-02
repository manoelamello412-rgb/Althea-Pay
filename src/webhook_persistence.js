// webhook persistence stub
// When connected to a real DB, implement insertion into webhook_events table.

async function persistWebhookEvent(dbClient, event) {
  // Placeholder implementation for CI/testing environments.
  return { stored: false, event };
}

module.exports = { persistWebhookEvent };
