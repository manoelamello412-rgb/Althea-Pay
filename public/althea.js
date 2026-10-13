/*! Althea Pay page snippet v1
 * <script async src="https://<app>/althea.js" data-funnel-id="<funnel_id>" data-api="https://<project>.supabase.co"></script>
 * window.althea.track(eventType, data?) · window.althea.identify({ name, email, phone, customer_id })
 * The page must be served from the domain saved as the funnel's "Link da Página".
 */
(function () {
  'use strict'
  var script = document.currentScript
  var funnelId = script && script.getAttribute('data-funnel-id')
  var api = script && (script.getAttribute('data-api') || '').replace(/\/$/, '')
  if (!funnelId || !api || window.althea) return

  var SESSION_IDLE_MS = 30 * 60 * 1000
  var ATTRIBUTION = { utm_source: 'source', utm_medium: 'medium', utm_campaign: 'campaign', utm_content: 'content', utm_term: 'term', gclid: 'click_id', fbclid: 'click_id' }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 3) | 8).toString(16)
    })
  }
  function read(store, key) { try { return JSON.parse(window[store].getItem('althea:' + key)) } catch (e) { return null } }
  function write(store, key, value) { try { window[store].setItem('althea:' + key, JSON.stringify(value)) } catch (e) {} }

  var visitorId = read('localStorage', 'visitor_id') || uuid()
  write('localStorage', 'visitor_id', visitorId)

  function sessionId() {
    var now = Date.now()
    var session = read('localStorage', 'session')
    if (!session || now - session.at > SESSION_IDLE_MS) session = { id: uuid(), at: now }
    session.at = now
    write('localStorage', 'session', session)
    return session.id
  }

  // UTMs from the landing URL stick for the session, so later events keep the source.
  var attribution = read('sessionStorage', 'attribution') || {}
  var params = new URLSearchParams(location.search)
  for (var param in ATTRIBUTION) if (params.get(param)) attribution[ATTRIBUTION[param]] = params.get(param).slice(0, 255)
  write('sessionStorage', 'attribution', attribution)

  var customer = read('sessionStorage', 'customer')
  var token = null
  var tokenRequest = null

  function clientToken() {
    if (token && token.expiresAt - Date.now() > 30000) return Promise.resolve(token.value)
    if (!tokenRequest) {
      tokenRequest = fetch(api + '/functions/v1/funnel-client-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ funnel_id: funnelId }),
      }).then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok || !body.token) throw new Error(body.error || 'althea_token_failed')
          token = { value: body.token, expiresAt: Date.now() + body.expires_in * 1000 }
          return token.value
        })
      }).finally(function () { tokenRequest = null })
    }
    return tokenRequest
  }

  function track(eventType, data) {
    var event = Object.assign({}, attribution, data || {}, {
      event_type: eventType,
      funnel_id: funnelId,
      event_id: (data && data.event_id) || uuid(),
      visitor_id: visitorId,
      session_id: sessionId(),
      page_url: location.href,
      occurred_at: new Date().toISOString(),
    })
    if (customer && !event.customer) event.customer = customer
    return clientToken().then(function (value) {
      return fetch(api + '/functions/v1/funnel-events', {
        method: 'POST',
        keepalive: true,
        headers: { 'content-type': 'application/json', 'x-funnel-client-token': value },
        body: JSON.stringify(event),
      })
    }).then(function (response) { return response.json() }).catch(function (error) {
      if (window.console) console.warn('[althea]', error && error.message)
      return null
    })
  }

  function identify(data) {
    customer = Object.assign({}, customer || {}, data || {})
    write('sessionStorage', 'customer', customer)
  }

  window.althea = { track: track, identify: identify, visitorId: visitorId }
  track('page_view', { referrer: document.referrer || undefined })
})()
