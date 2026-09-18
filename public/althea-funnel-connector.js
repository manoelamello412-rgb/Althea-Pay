;(function (global) {
  'use strict'

  var VERSION = '1.0.0'
  var PROTOCOL_VERSION = '1'
  var FORBIDDEN_KEYS = new Set(['pan', 'card_number', 'cardnumber', 'cvv', 'cvc'])

  function uuid(prefix) {
    var value = global.crypto && typeof global.crypto.randomUUID === 'function'
      ? global.crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(16).slice(2)
    return prefix + value
  }

  function storageGet(storage, key) {
    try { return storage.getItem(key) } catch (_) { return null }
  }

  function storageSet(storage, key, value) {
    try { storage.setItem(key, value) } catch (_) {}
  }

  function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
  }

  function containsForbidden(value) {
    if (Array.isArray(value)) return value.some(containsForbidden)
    if (!isObject(value)) return false
    return Object.keys(value).some(function (key) {
      return FORBIDDEN_KEYS.has(String(key).toLowerCase()) || containsForbidden(value[key])
    })
  }

  function attribution() {
    var params = new URLSearchParams(global.location.search)
    var pick = function (name) { return params.get(name) || null }
    return {
      source: pick('utm_source'),
      medium: pick('utm_medium'),
      campaign: pick('utm_campaign'),
      content: pick('utm_content'),
      term: pick('utm_term'),
      click_id: pick('click_id') || pick('gclid') || pick('fbclid'),
      landing_url: global.location.href,
      referrer: global.document.referrer || null,
    }
  }

  function device() {
    var screen = global.screen || {}
    return {
      language: global.navigator.language || null,
      platform: global.navigator.platform || null,
      user_agent: global.navigator.userAgent || null,
      viewport: { width: global.innerWidth || null, height: global.innerHeight || null },
      screen: { width: screen.width || null, height: screen.height || null },
    }
  }

  function Connector(config) {
    if (!config || !config.funnelId) throw new Error('Althea Connector: funnelId is required')
    if (typeof config.tokenProvider !== 'function') throw new Error('Althea Connector: tokenProvider must be a function')

    this.funnelId = String(config.funnelId)
    this.tokenProvider = config.tokenProvider
    this.eventEndpoint = config.eventEndpoint || ''
    this.debug = config.debug === true
    this.customer = null
    this.token = ''
    this.tokenExpiresAt = 0
    this.flushing = false
    this.queueKey = 'althea:event-queue:' + this.funnelId

    var visitorKey = 'althea:visitor:' + this.funnelId
    this.visitorId = storageGet(global.localStorage, visitorKey) || uuid('visitor_')
    storageSet(global.localStorage, visitorKey, this.visitorId)

    var sessionKey = 'althea:session:' + this.funnelId
    this.sessionId = storageGet(global.sessionStorage, sessionKey) || uuid('session_')
    storageSet(global.sessionStorage, sessionKey, this.sessionId)

    this.boundOnline = this.flush.bind(this)
  }

  Connector.prototype.log = function () {
    if (this.debug && global.console) global.console.debug.apply(global.console, ['[Althea Connector]'].concat([].slice.call(arguments)))
  }

  Connector.prototype.credentials = async function (force) {
    if (!force && this.token && Date.now() < this.tokenExpiresAt - 30000) return
    var result = await this.tokenProvider()
    var payload = typeof result === 'string' ? { token: result } : (result || {})
    if (!payload.token) throw new Error('Althea Connector: tokenProvider returned no token')
    this.token = String(payload.token)
    this.eventEndpoint = String(payload.event_endpoint || payload.eventEndpoint || this.eventEndpoint || '')
    if (!this.eventEndpoint) throw new Error('Althea Connector: event endpoint is missing')
    var expiresAt = payload.expires_at ? Date.parse(payload.expires_at) : NaN
    this.tokenExpiresAt = Number.isFinite(expiresAt) ? expiresAt : Date.now() + 8 * 60 * 1000
  }

  Connector.prototype.readQueue = function () {
    try {
      var parsed = JSON.parse(storageGet(global.sessionStorage, this.queueKey) || '[]')
      return Array.isArray(parsed) ? parsed.slice(-100) : []
    } catch (_) { return [] }
  }

  Connector.prototype.writeQueue = function (items) {
    storageSet(global.sessionStorage, this.queueKey, JSON.stringify(items.slice(-100)))
  }

  Connector.prototype.enqueue = function (event) {
    var items = this.readQueue()
    if (!items.some(function (item) { return item.event_id === event.event_id })) items.push(event)
    this.writeQueue(items)
  }

  Connector.prototype.envelope = function (eventType, payload) {
    if (!/^[a-z][a-z0-9_.:-]{1,79}$/.test(eventType)) throw new Error('Althea Connector: invalid event type')
    if (containsForbidden(payload)) throw new Error('Althea Connector: raw card data is forbidden')
    return {
      version: PROTOCOL_VERSION,
      event_id: uuid('evt_'),
      event_type: eventType,
      funnel_id: this.funnelId,
      session_id: this.sessionId,
      visitor_id: this.visitorId,
      occurred_at: new Date().toISOString(),
      page_url: global.location.href,
      attribution: attribution(),
      device: device(),
      customer: this.customer || undefined,
      payload: payload || {},
    }
  }

  Connector.prototype.deliver = async function (event, retryAuth) {
    await this.credentials(false)
    var response
    try {
      response = await global.fetch(this.eventEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.token },
        body: JSON.stringify(event),
        keepalive: true,
      })
    } catch (_) {
      return { delivered: false, retry: true }
    }

    if (response.status === 401 && retryAuth !== false) {
      await this.credentials(true)
      return this.deliver(event, false)
    }
    if (response.status === 429 || response.status >= 500) return { delivered: false, retry: true }
    if (!response.ok) {
      this.log('event rejected', event.event_type, response.status)
      return { delivered: false, retry: false }
    }
    return { delivered: true, retry: false }
  }

  Connector.prototype.track = async function (eventType, payload) {
    var event = this.envelope(String(eventType).toLowerCase(), payload || {})
    var result = await this.deliver(event, true)
    if (!result.delivered && result.retry) this.enqueue(event)
    return { eventId: event.event_id, accepted: result.delivered, queued: !result.delivered && result.retry }
  }

  Connector.prototype.identify = async function (customer, payload) {
    if (!isObject(customer)) throw new Error('Althea Connector: customer must be an object')
    if (containsForbidden(customer)) throw new Error('Althea Connector: raw card data is forbidden')
    this.customer = customer
    return this.track('lead_created', Object.assign({}, payload || {}, { identity_updated: true }))
  }

  Connector.prototype.step = function (step, payload) {
    return this.track('step_viewed', Object.assign({}, payload || {}, { current_step: String(step) }))
  }

  Connector.prototype.end = function (payload) {
    return this.track('session_ended', payload || {})
  }

  Connector.prototype.flush = async function () {
    if (this.flushing || !global.navigator.onLine) return
    this.flushing = true
    try {
      var queue = this.readQueue()
      var remaining = []
      for (var i = 0; i < queue.length; i += 1) {
        var result = await this.deliver(queue[i], true)
        if (!result.delivered && result.retry) {
          remaining = queue.slice(i)
          break
        }
      }
      this.writeQueue(remaining)
    } finally {
      this.flushing = false
    }
  }

  Connector.prototype.init = async function () {
    await this.credentials(false)
    global.addEventListener('online', this.boundOnline)
    var startedKey = 'althea:session-started:' + this.funnelId + ':' + this.sessionId
    if (!storageGet(global.sessionStorage, startedKey)) {
      await this.track('session_started', {})
      storageSet(global.sessionStorage, startedKey, '1')
    }
    await this.track('page_viewed', {})
    await this.flush()
    return this
  }

  Connector.prototype.destroy = function () {
    global.removeEventListener('online', this.boundOnline)
  }

  global.AltheaFunnelConnector = {
    version: VERSION,
    protocolVersion: PROTOCOL_VERSION,
    Connector: Connector,
    create: async function (config) {
      var instance = new Connector(config)
      return instance.init()
    },
  }
})(window)
