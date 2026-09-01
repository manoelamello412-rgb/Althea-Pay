import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json, requestId } from '../_shared/http.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const textEncoder = new TextEncoder();

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const rid = requestId(req);
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  if (!supabaseUrl || !publishableKey) return json({ error: 'server_not_configured', request_id: rid }, 500, cors);
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'unauthorized', request_id: rid }, 401, cors);

  const supabase = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return json({ error: 'unauthorized', request_id: rid }, 401, cors);

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/althea-api\/?/, '').replace(/^\/+|\/+$/g, '');

  if (req.method === 'GET' && path === 'me') {
    const { data: profile } = await supabase.from('profiles').select('id,display_name,avatar_url').eq('id', user.id).maybeSingle();
    const { data: memberships } = await supabase.from('organization_members').select('organization_id,role,organizations(id,name,slug)').eq('user_id', user.id);
    return json({ user: { id: user.id, email: user.email }, profile, memberships, request_id: rid }, 200, cors);
  }

  if (path === 'api-keys') {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('api_keys').select('id,name,key_prefix,scopes,expires_at,last_used_at,revoked_at,created_at').eq('user_id', user.id).order('created_at', { ascending: false });
      if (error) return json({ error: 'database_error', request_id: rid }, 500, cors);
      return json({ data, request_id: rid }, 200, cors);
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : 'Althea API Key';
      const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s: unknown) => typeof s === 'string').slice(0, 50) : ['funnels:read', 'products:read', 'sales:read', 'transactions:read', 'events:write'];
      const expiresAt = body.expires_at ? new Date(body.expires_at).toISOString() : null;
      if (body.expires_at && Number.isNaN(new Date(body.expires_at).getTime())) return json({ error: 'invalid_expiration', request_id: rid }, 400, cors);
      const rawKey = `althea_live_${randomHex(32)}`;
      const prefix = rawKey.slice(0, 18);
      const hash = await sha256(rawKey);
      const { data, error } = await supabase.from('api_keys').insert({ user_id: user.id, name, key_prefix: prefix, key_hash: hash, scopes, expires_at: expiresAt }).select('id,name,key_prefix,scopes,expires_at,created_at').single();
      if (error) return json({ error: 'key_creation_failed', request_id: rid }, 500, cors);
      return json({ data, secret: rawKey, warning: 'Store this secret now. It will not be shown again.', request_id: rid }, 201, cors);
    }
  }

  const keyMatch = path.match(/^api-keys\/([0-9a-f-]+)(?:\/(rotate))?$/i);
  if (keyMatch) {
    const keyId = keyMatch[1];
    if (req.method === 'DELETE') {
      const { error } = await supabase.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', keyId).eq('user_id', user.id);
      if (error) return json({ error: 'revoke_failed', request_id: rid }, 500, cors);
      return json({ ok: true, revoked: true, request_id: rid }, 200, cors);
    }
    if (req.method === 'POST' && keyMatch[2] === 'rotate') {
      const { data: oldKey, error: oldError } = await supabase.from('api_keys').select('name,scopes').eq('id', keyId).eq('user_id', user.id).maybeSingle();
      if (oldError || !oldKey) return json({ error: 'key_not_found', request_id: rid }, 404, cors);
      const rawKey = `althea_live_${randomHex(32)}`;
      const prefix = rawKey.slice(0, 18);
      const hash = await sha256(rawKey);
      const { data, error } = await supabase.from('api_keys').insert({ user_id: user.id, name: `${oldKey.name} (rotated)`, key_prefix: prefix, key_hash: hash, scopes: oldKey.scopes }).select('id,name,key_prefix,scopes,expires_at,created_at').single();
      if (error) return json({ error: 'rotation_failed', request_id: rid }, 500, cors);
      await supabase.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', keyId).eq('user_id', user.id);
      return json({ data, secret: rawKey, warning: 'Store this secret now. It will not be shown again.', request_id: rid }, 201, cors);
    }
  }

  if (req.method === 'GET' && path === 'dashboard') {
    const { data: memberships, error: membershipError } = await supabase.from('organization_members').select('organization_id,role').eq('user_id', user.id);
    if (membershipError) return json({ error: 'database_error', request_id: rid }, 500, cors);
    const organizationIds = (memberships ?? []).map((m) => m.organization_id);
    if (!organizationIds.length) return json({ funnels: 0, products: 0, customers: 0, leads: 0, sales: 0, chats: 0, request_id: rid }, 200, cors);
    const [funnels, products, customers, leads, sales, chats] = await Promise.all([
      supabase.from('funnels').select('id', { count: 'exact', head: true }).in('organization_id', organizationIds),
      supabase.from('products').select('id', { count: 'exact', head: true }).in('organization_id', organizationIds),
      supabase.from('customers').select('id', { count: 'exact', head: true }).in('organization_id', organizationIds),
      supabase.from('leads').select('id', { count: 'exact', head: true }).in('organization_id', organizationIds),
      supabase.from('sales').select('id', { count: 'exact', head: true }).in('organization_id', organizationIds).eq('status', 'approved'),
      supabase.from('chat_conversations').select('id', { count: 'exact', head: true }).in('organization_id', organizationIds).neq('status', 'closed'),
    ]);
    return json({ funnels: funnels.count ?? 0, products: products.count ?? 0, customers: customers.count ?? 0, leads: leads.count ?? 0, approved_sales: sales.count ?? 0, open_chats: chats.count ?? 0, request_id: rid }, 200, cors);
  }

  return json({ error: 'not_found', request_id: rid }, 404, cors);
});
