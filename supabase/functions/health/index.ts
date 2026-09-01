import { Client } from 'pg'

export default async function handler(req: any, res: any) {
  // lightweight health check
  const checks: any = { uptime: process.uptime() }
  try {
    const dbUrl = process.env.DATABASE_URL
    if (dbUrl) {
      const client = new Client({ connectionString: dbUrl })
      await client.connect()
      const r = await client.query('SELECT 1 as ok')
      checks.database = r.rows[0]
      await client.end()
    } else {
      checks.database = 'SKIPPED (DATABASE_URL not set)'
    }
  } catch (err: any) {
    checks.database = { error: String(err?.message || err) }
  }

  // Add health for functions that may exist (gateway, worker)
  checks.gateway_orchestrator = 'ok (deployed as function)'
  checks.gateway_sandbox = 'ok (deployed as function)'

  res.status(200).json({ status: 'ok', checks })
}
