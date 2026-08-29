import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json, requestId } from '../_shared/http.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

Deno.serve(async (req) => {
  const rid = requestId(req);
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  if (!supabaseUrl || !publishableKey) {
    return json({ error: 'server_not_configured', request_id: rid }, 500, cors);
  }

  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return json({ error: 'unauthorized', request_id: rid }, 401, cors);
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: auth } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return json({ error: 'unauthorized', request_id: rid }, 401, cors);

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/althea-api\/?/, '').replace(/^\/+|\/+$/g, '');

  if (req.method === 'GET' && path === 'me') {
    const { data: profile } = await supabase.from('profiles').select('id,display_name,avatar_url').eq('id', user.id).maybeSingle();
    const { data: memberships } = await supabase.from('organization_members').select('organization_id,role,organizations(id,name,slug)').eq('user_id', user.id);
    return json({ user: { id: user.id, email: user.email }, profile, memberships, request_id: rid }, 200, cors);
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

    return json({
      funnels: funnels.count ?? 0,
      products: products.count ?? 0,
      customers: customers.count ?? 0,
      leads: leads.count ?? 0,
      approved_sales: sales.count ?? 0,
      open_chats: chats.count ?? 0,
      request_id: rid,
    }, 200, cors);
  }

  return json({ error: 'not_found', request_id: rid }, 404, cors);
});
