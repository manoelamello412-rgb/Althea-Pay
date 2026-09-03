import { withSupabase } from 'npm:@supabase/server'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}
const enc = new TextEncoder()

function token() {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return `whsec_${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

async function sha(v: string) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(v))
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

function json(v: unknown, status = 200) {
  return Response.json(v, { status, headers: { ...cors, 'content-type': 'application/json' } })
}

Deno.serve(withSupabase({ auth: 'user' }, async (req, ctx) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = ctx.supabaseAdmin
  const user = ctx.user
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401)

  const u = new URL(req.url)
  const parts = u.pathname.split('/').filter(Boolean)
  const action = parts.at(-1)
  const id = parts.length >= 2 ? parts.at(-2) : null

  try {
    if (req.method === 'GET') {
      const { data, error } = await db
        .from('webhook_integrations')
        .select('id,funnel_id,name,provider,endpoint_key,secret_prefix,status,created_at,updated_at,last_used_at,last_event_at,event_count')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return json({ ok: true, integrations: data || [] })
    }

    const body = await req.json().catch(() => ({}))

    if (req.method === 'POST' && action === 'rotate' && id) {
      const secret = token()
      const current = await db.from('webhook_integrations').select('id,vault_secret_id').eq('id', id).eq('user_id', user.id).single()
      if (current.error) throw current.error

      let vaultId = current.data.vault_secret_id
      if (vaultId) {
        const { data, error } = await db.rpc('update_webhook_secret', { p_secret_id: vaultId, p_secret: secret, p_name: `Althea webhook ${id}` })
        if (error) throw error
        vaultId = data
      } else {
        const { data, error } = await db.rpc('store_webhook_secret', { p_secret: secret, p_name: `Althea webhook ${id}` })
        if (error) throw error
        vaultId = data
      }

      const { data, error } = await db.from('webhook_integrations').update({
        vault_secret_id: vaultId,
        secret: null,
        secret_hash: await sha(secret),
        secret_prefix: secret.slice(0, 14),
        updated_at: new Date().toISOString(),
      }).eq('id', id).eq('user_id', user.id)
        .select('id,funnel_id,name,provider,endpoint_key,secret_prefix,status').single()
      if (error) throw error
      return json({ ok: true, integration: data, secret, endpoint: `${Deno.env.get('SUPABASE_URL')}/functions/v1/althea-webhook/${data.endpoint_key}`, secret_once: true })
    }

    if (req.method === 'POST') {
      const funnelId = body.funnel_id ? String(body.funnel_id) : null
      if (!funnelId) return json({ ok: false, error: 'funnel_id_required' }, 400)

      const secret = token()
      const endpointKey = `ep_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`
      const row = {
        user_id: user.id,
        funnel_id: funnelId,
        name: String(body.name || `Webhook ${new Date().toLocaleDateString('pt-BR')}`),
        provider: String(body.provider || 'custom'),
        endpoint_key: endpointKey,
        secret_hash: await sha(secret),
        secret_prefix: secret.slice(0, 14),
        status: 'active',
      }
      const { data: created, error: createError } = await db.from('webhook_integrations').insert(row)
        .select('id,funnel_id,name,provider,endpoint_key,secret_prefix,status,created_at').single()
      if (createError) throw createError

      const { data: vaultId, error: vaultError } = await db.rpc('store_webhook_secret', { p_secret: secret, p_name: `Althea webhook ${created.id}` })
      if (vaultError) {
        await db.from('webhook_integrations').delete().eq('id', created.id).eq('user_id', user.id)
        throw vaultError
      }

      const { data, error } = await db.from('webhook_integrations').update({ vault_secret_id: vaultId })
        .eq('id', created.id).eq('user_id', user.id)
        .select('id,funnel_id,name,provider,endpoint_key,secret_prefix,status,created_at').single()
      if (error) throw error
      return json({ ok: true, integration: data, secret, endpoint: `${Deno.env.get('SUPABASE_URL')}/functions/v1/althea-webhook/${endpointKey}`, secret_once: true }, 201)
    }

    if (!id) return json({ ok: false, error: 'integration_id_required' }, 400)

    if (req.method === 'PATCH') {
      const patch: Record<string, unknown> = {}
      if (body.name !== undefined) patch.name = String(body.name)
      if (body.provider !== undefined) patch.provider = String(body.provider)
      if (body.funnel_id !== undefined) patch.funnel_id = String(body.funnel_id)
      if (body.status !== undefined) patch.status = body.status === 'disabled' ? 'disabled' : 'active'
      patch.updated_at = new Date().toISOString()
      const { data, error } = await db.from('webhook_integrations').update(patch).eq('id', id).eq('user_id', user.id)
        .select('id,funnel_id,name,provider,endpoint_key,secret_prefix,status,updated_at').single()
      if (error) throw error
      return json({ ok: true, integration: data })
    }

    if (req.method === 'DELETE') {
      const { error } = await db.from('webhook_integrations').update({ status: 'disabled', updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id)
      if (error) throw error
      return json({ ok: true, disabled: true })
    }

    return json({ ok: false, error: 'not_found' }, 404)
  } catch (e) {
    console.error(e)
    return json({ ok: false, error: 'webhook_integrations_error' }, 500)
  }
}))
