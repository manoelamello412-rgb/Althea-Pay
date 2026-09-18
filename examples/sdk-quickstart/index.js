// Minimal Althea Pay public API quickstart.
// Requires Node.js 18+ (native fetch) and an API key with the "funnels:read" scope.

const baseUrl = (process.env.ALTHEA_PUBLIC_API_URL || '').replace(/\/$/, '')
const apiKey = process.env.ALTHEA_API_KEY || ''

if (!baseUrl || !apiKey) {
  throw new Error('Set ALTHEA_PUBLIC_API_URL and ALTHEA_API_KEY before running this example.')
}

async function listFunnels() {
  const response = await fetch(`${baseUrl}/v1/funnels?limit=10`, {
    headers: {
      'x-althea-api-key': apiKey,
      'x-request-id': crypto.randomUUID(),
    },
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`Althea API request failed (${response.status}): ${JSON.stringify(payload)}`)
  }

  console.log(JSON.stringify(payload, null, 2))
}

listFunnels().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
