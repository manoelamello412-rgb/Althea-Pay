import { Client } from 'pg';

let client: Client | null = null;
let connected = false;

function isEnabled() {
  return !!process.env.DATABASE_URL;
}

export async function ensureClient() {
  if (!isEnabled()) return null;
  if (client && connected) return client;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  connected = true;
  return client;
}

export async function query(text: string, params: any[] = []) {
  const c = await ensureClient();
  if (!c) throw new Error('DB not configured');
  return c.query(text, params);
}

export async function close() {
  if (client && connected) {
    await client.end();
    connected = false;
    client = null;
  }
}
