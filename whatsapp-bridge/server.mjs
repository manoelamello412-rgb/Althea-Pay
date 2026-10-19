// WhatsApp bridge (Baileys). Port of Bellevo's BaileysService as a standalone process: the Baileys
// socket must stay open, which Vercel and Supabase Edge Functions cannot do. One session per
// crm_channel_accounts.id; credentials persist in WHATSAPP_AUTH_DIR (mount a volume in production).
//
// Env: BRIDGE_TOKEN (required, same value as WHATSAPP_BRIDGE_TOKEN in Next and Supabase)
//      INBOUND_WEBHOOK_URL (<SUPABASE_URL>/functions/v1/crm-channel-whatsapp-webhook)
//      PORT (8080), WHATSAPP_AUTH_DIR (./whatsapp-auth)
import http from 'node:http'
import { join } from 'node:path'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import pino from 'pino'
import QRCode from 'qrcode'

const TOKEN = process.env.BRIDGE_TOKEN ?? ''
const WEBHOOK = process.env.INBOUND_WEBHOOK_URL ?? ''
const AUTH_BASE = process.env.WHATSAPP_AUTH_DIR ?? join(process.cwd(), 'whatsapp-auth')
const MAX_RETRIES = 5
const RETRY_BASE = 3_000
const RETRY_MAX = 30_000
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
if (TOKEN.length < 24) throw new Error('BRIDGE_TOKEN must be at least 24 characters')

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })
const sessions = new Map() // id → socket when open, null while connecting
const pendingQr = new Map()
const pendingPhone = new Map() // id → phone when pairing by code instead of QR
const pairingCodes = new Map()
const retryCounts = new Map()
const sockets = new Map() // id → latest socket in any state, so stop() can close one still connecting

const authDir = id => join(AUTH_BASE, id)
const clearAuth = id => rmSync(authDir(id), { recursive: true, force: true })
const phoneOf = sock => (sock.authState?.creds?.me?.id ?? '').split(':')[0].split('@')[0].replace(/\D/g, '') || null
// The socket is ready for a pairing code once it emits its first QR; one code per socket.
async function requestCode(id, phone) {
  const sock = sockets.get(id)
  if (!sock || pairingCodes.has(id)) return
  pairingCodes.set(id, null)
  try { pairingCodes.set(id, await sock.requestPairingCode(phone)) } catch (err) { pairingCodes.delete(id); throw err }
}
const jidPhone = jid => (jid?.endsWith('@s.whatsapp.net') ? jid.split('@')[0].split(':')[0] : '')

async function forward(id, msg) {
  if (!WEBHOOK) return
  const res = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bridge-token': TOKEN },
    body: JSON.stringify({ account_id: id, ...msg }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error('webhook_http_' + res.status)
}

async function connect(id) {
  mkdirSync(authDir(id), { recursive: true })
  const { state, saveCreds } = await useMultiFileAuthState(authDir(id))
  // Without saved creds nobody scanned yet: a QR timeout must not loop forever.
  const hadCredentials = !!state.creds?.me
  let version
  try { ({ version } = await fetchLatestBaileysVersion()) } catch { version = [2, 3000, 1014080102] }

  const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false, retryRequestDelayMs: 250 })
  sessions.set(id, null)
  sockets.set(id, sock)
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      pendingQr.set(id, qr)
      if (pendingPhone.has(id)) requestCode(id, pendingPhone.get(id)).catch(err => log.error({ id, err: err.message }, 'pairing code failed'))
    }
    if (connection === 'open') {
      sessions.set(id, sock)
      pendingQr.delete(id); pendingPhone.delete(id); pairingCodes.delete(id)
      retryCounts.set(id, 0)
      log.info({ id, phone: phoneOf(sock) }, 'connected')
    }
    if (connection !== 'close') return
    sessions.set(id, null)
    pairingCodes.delete(id)
    sock.ev.removeAllListeners()
    const code = lastDisconnect?.error?.output?.statusCode
    const retries = (retryCounts.get(id) ?? 0) + 1
    if (code === DisconnectReason.loggedOut || (code === 408 && !hadCredentials) || retries >= MAX_RETRIES) {
      clearAuth(id)
      pendingQr.delete(id); pendingPhone.delete(id)
      retryCounts.delete(id)
      sessions.delete(id) // not_started: the panel must ask for a new QR
      log.warn({ id, code }, 'session ended')
      return
    }
    retryCounts.set(id, retries)
    setTimeout(() => sessions.has(id) && connect(id).catch(err => log.error({ id, err: err.message }, 'reconnect failed')), Math.min(RETRY_BASE * 2 ** (retries - 1), RETRY_MAX))
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe || msg.key.remoteJid?.endsWith('@g.us')) continue
      // Baileys 7 may address chats by LID; the phone number then comes in remoteJidAlt.
      const from = jidPhone(msg.key.remoteJid) || jidPhone(msg.key.remoteJidAlt)
      const m = msg.message
      const text = m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.videoMessage?.caption ?? m.buttonsResponseMessage?.selectedDisplayText ?? null
      if (!from || !text) continue
      await forward(id, { from, message_id: msg.key.id, text, name: msg.pushName || null, type: Object.keys(m)[0], timestamp: Number(msg.messageTimestamp ?? 0) })
        .catch(err => log.error({ id, err: err.message }, 'inbound forward failed'))
    }
  })
}

// phone: pair by 8-character code typed in the phone instead of scanning the QR.
async function start(id, phone) {
  if (sessions.get(id)) return
  if (phone) pendingPhone.set(id, phone); else pendingPhone.delete(id)
  if (!sessions.has(id)) return connect(id)
  if (phone && pendingQr.has(id)) await requestCode(id, phone)
}

async function stop(id) {
  const sock = sockets.get(id)
  if (sock) { sock.ev.removeAllListeners(); await sock.logout().catch(() => sock.end(undefined)) }
  clearAuth(id)
  sessions.delete(id); sockets.delete(id); pendingQr.delete(id); pendingPhone.delete(id); pairingCodes.delete(id); retryCounts.delete(id)
}

async function status(id) {
  const sock = sessions.get(id)
  if (sock) return { status: 'connected', qr: null, code: null, phone: phoneOf(sock) }
  if (!sessions.has(id)) return { status: 'disconnected', qr: null, code: null, phone: null }
  if (pendingPhone.has(id)) {
    const code = pairingCodes.get(id)
    return code ? { status: 'waiting_scan', qr: null, code, phone: null } : { status: 'connecting', qr: null, code: null, phone: null }
  }
  const qr = pendingQr.get(id)
  return qr ? { status: 'waiting_scan', qr: await QRCode.toDataURL(qr), code: null, phone: null } : { status: 'connecting', qr: null, code: null, phone: null }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Shows "recording…"/"typing…" for a moment before each message, like a person would.
async function present(sock, jid, state) {
  await sock.sendPresenceUpdate(state, jid).catch(() => {})
  await sleep(1_500 + Math.random() * 2_500)
  await sock.sendPresenceUpdate('paused', jid).catch(() => {})
}

async function send(id, to, text, audio) {
  const sock = sessions.get(id)
  if (!sock) throw Object.assign(new Error('whatsapp_not_connected'), { status: 503 })
  // onWhatsApp resolves the real JID (handles Brazil's optional 9th digit).
  const [found] = await sock.onWhatsApp(to.replace(/\D/g, '') + '@s.whatsapp.net')
  if (!found?.exists) throw Object.assign(new Error('whatsapp_number_not_found'), { status: 422 })
  if (audio) {
    await present(sock, found.jid, 'recording')
    // .ogg (opus) goes as a voice note; other formats as an audio file.
    await sock.sendMessage(found.jid, { audio: { url: audio.url }, mimetype: audio.mimetype, ptt: audio.mimetype.startsWith('audio/ogg') })
  }
  await present(sock, found.jid, 'composing')
  const sent = await sock.sendMessage(found.jid, { text })
  return { id: sent?.key?.id ?? null, jid: found.jid }
}

function connected(id) {
  const sock = sessions.get(id)
  if (!sock) throw Object.assign(new Error('whatsapp_not_connected'), { status: 503 })
  return sock
}

async function groups(id) {
  const all = await connected(id).groupFetchAllParticipating()
  return Object.values(all).map(g => ({ id: g.id, name: g.subject, size: g.participants?.length ?? g.size ?? 0 })).sort((a, b) => a.name.localeCompare(b.name))
}

// Baileys 7 may list participants by LID; the phone then comes in phoneNumber. LID-only ones have no phone and are skipped.
async function groupPhones(id, groupId) {
  const sock = connected(id)
  const { subject, participants } = await sock.groupMetadata(groupId)
  const own = phoneOf(sock)
  const phones = [...new Set(participants.map(p => jidPhone(p.phoneNumber) || jidPhone(p.id) || jidPhone(p.jid)).filter(p => p && p !== own))]
  return { name: subject, phones, skipped: participants.length - phones.length }
}

function authorized(req) {
  const given = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer /, ''))
  const expected = Buffer.from(TOKEN)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

async function body(req) {
  let raw = ''
  for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) throw Object.assign(new Error('payload_too_large'), { status: 413 }) }
  try { return JSON.parse(raw || '{}') } catch { throw Object.assign(new Error('invalid_json'), { status: 400 }) }
}

const reply = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }

http.createServer(async (req, res) => {
  try {
    if (req.url === '/health') return reply(res, 200, { ok: true, sessions: sessions.size })
    if (!authorized(req)) return reply(res, 401, { error: 'unauthorized' })
    const [, scope, id, action, groupId] = (req.url ?? '').split('?')[0].split('/').map(decodeURIComponent)
    // The id names a directory on disk: anything but a UUID is rejected (path traversal).
    if (scope !== 'instances' || !ID.test(id ?? '')) return reply(res, 404, { error: 'not_found' })
    if (req.method === 'GET' && !action) return reply(res, 200, await status(id))
    if (req.method === 'GET' && action === 'groups' && !groupId) return reply(res, 200, { groups: await groups(id) })
    if (req.method === 'GET' && action === 'groups' && /^[\d-]+@g\.us$/.test(groupId)) return reply(res, 200, await groupPhones(id, groupId))
    if (req.method === 'POST' && action === 'start') {
      const { phone } = await body(req)
      if (phone !== undefined && (typeof phone !== 'string' || !/^\d{10,15}$/.test(phone))) return reply(res, 400, { error: 'invalid_phone' })
      await start(id, phone); return reply(res, 200, await status(id)) }
    if (req.method === 'POST' && action === 'send') {
      const { to, text, audio_url: audioUrl, audio_mimetype: audioMime } = await body(req)
      if (typeof to !== 'string' || typeof text !== 'string' || !to.replace(/\D/g, '') || !text.trim() || text.length > 4096) return reply(res, 400, { error: 'invalid_message' })
      if (audioUrl !== undefined && (typeof audioUrl !== 'string' || !/^https?:\/\//.test(audioUrl) || typeof audioMime !== 'string' || !audioMime.startsWith('audio/'))) return reply(res, 400, { error: 'invalid_audio' })
      return reply(res, 200, await send(id, to, text, audioUrl ? { url: audioUrl, mimetype: audioMime } : null))
    }
    if (req.method === 'DELETE' && !action) { await stop(id); return reply(res, 200, { status: 'disconnected' }) }
    return reply(res, 404, { error: 'not_found' })
  } catch (err) {
    log.error({ err: err.message }, 'request failed')
    reply(res, err.status ?? 500, { error: err.status ? err.message : 'bridge_error' })
  }
}).listen(Number(process.env.PORT ?? 8080), () => log.info('whatsapp bridge listening'))

// Restore sessions that were paired before a restart.
if (existsSync(AUTH_BASE)) for (const id of readdirSync(AUTH_BASE)) if (ID.test(id)) connect(id).catch(err => log.error({ id, err: err.message }, 'restore failed'))
