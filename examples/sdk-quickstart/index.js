// Minimal SDK quickstart example
const fetch = require('node-fetch');

async function quickCharge() {
  const resp = await fetch(process.env.ALPHEA_API_URL + '/functions/v1/gateway-orchestrator', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'sdk-quickstart-1' },
    body: JSON.stringify({ amount: 1000, currency: 'BRL' })
  });
  const json = await resp.json();
  console.log('response', json);
}

quickCharge().catch(e=>console.error(e));
