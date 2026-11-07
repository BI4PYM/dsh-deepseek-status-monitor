#!/usr/bin/env node
/**
 * Independent verification of the DeepSeek status plugin HOST HALF route handler
 * (index.js: apply() -> ctx.inject(['webServer']) handler).
 *
 * Dependency-free: no Cordis/Harness packages, no browser, no real network.
 * The fake ctx exposes exactly the surface index.js touches:
 *   ctx.logger.warn, ctx.effect, ctx.inject(['webServer'], cb)
 *   sub.webServer.register, sub.effect
 * globalThis.fetch is stubbed for every test and restored afterwards.
 *
 * Run:
 *   "C:\Users\minexixi\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" test/host-route.test.mjs
 *
 * Note on the background warm-up: index.js schedules a 250 ms timer that calls
 * refresh({force:true}). To keep each case deterministic the fake ctx records that
 * timer instead of letting it fire during a test; one dedicated test runs the
 * captured callback explicitly. Data and clock are controlled by the stubs, so no
 * test depends on real elapsed time.
 */
import assert from 'node:assert/strict'
import { apply } from '../index.js'

const ROUTE_PATH = '/__dsh-deepseek-status/state'
const LIVE_RSS = 'https://status.deepseek.com/feed.rss'
const LIVE_ATOM = 'https://status.deepseek.com/feed.atom'
const OUTAGE_TITLE = 'DeepSeek 网页/API 部分中断（DeepSeek Web/API Partially Unavailable）'
const PUB_DATE = 'Sat, 07 Nov 2026 15:11:38 +0800'
const T0 = Date.parse('2026-11-07T10:00:00+08:00')

const realDateNow = Date.now
const realSetTimeout = globalThis.setTimeout

// ---------------------------------------------------------------------------
// Minimal test harness
// ---------------------------------------------------------------------------

const state = { pass: 0, fail: 0, skip: 0, failures: [] }
let sectionName = ''

function section(name) {
  sectionName = name
  console.log(`\n## ${name}`)
}

async function test(name, fn) {
  try {
    await fn()
    state.pass += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    state.fail += 1
    state.failures.push({ label: sectionName === '' ? name : `${sectionName} :: ${name}`, error })
    console.log(`FAIL ${name}`)
    console.log(
      String(error?.stack ?? error)
        .split('\n')
        .slice(0, 8)
        .map((line) => `     ${line}`)
        .join('\n'),
    )
  }
}

function reportSummary() {
  const total = state.pass + state.fail + state.skip
  console.log('\n' + '='.repeat(78))
  console.log(`TOTAL ${total}   PASS ${state.pass}   FAIL ${state.fail}   SKIP ${state.skip}`)
  if (state.failures.length > 0) {
    console.log('\nFAILURES')
    for (const { label, error } of state.failures) console.log(` - ${label}: ${error?.message ?? error}`)
  }
  console.log('='.repeat(78))
  if (state.fail > 0) process.exitCode = 1
}

// ---------------------------------------------------------------------------
// Stub feed documents
// ---------------------------------------------------------------------------

function escapeXml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function descriptionMarkup(status, components = []) {
  const parts = [`<p><strong>Status:</strong> ${status}</p>`]
  parts.push('<p>本次问题已解决，服务已恢复。The incident has been resolved and service has been restored.</p>')
  if (components.length > 0) parts.push(`<p><strong>Affected components:</strong> ${components.join(', ')}</p>`)
  return parts.join('')
}

function rssItem({ id, title, status = 'investigating', components = [], pubDate = PUB_DATE }) {
  return [
    '<item>',
    `<title>${escapeXml(title)}</title>`,
    `<link>https://status.deepseek.com/incidents/${id}</link>`,
    `<description>${escapeXml(descriptionMarkup(status, components))}</description>`,
    `<guid>urn:flashduty:change:${id}</guid>`,
    `<pubDate>${pubDate}</pubDate>`,
    '</item>',
  ].join('')
}

function rssDocument(items) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>DeepSeek</title>${items.join('')}</channel></rss>`
}

function atomDocument(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>DeepSeek</title><id>https://status.deepseek.com</id>${entries.join('')}</feed>`
}

function atomEntry({ id, title, status = 'investigating' }) {
  return [
    '<entry>',
    `<title>${escapeXml(title)}</title>`,
    '<updated>2026-11-07T15:56:50+08:00</updated>',
    `<id>urn:flashduty:change:${id}</id>`,
    `<link href="https://status.deepseek.com/incidents/${id}" rel="alternate"></link>`,
    `<summary type="html">${escapeXml(descriptionMarkup(status))}</summary>`,
    '</entry>',
  ].join('')
}

// ---------------------------------------------------------------------------
// Fake ctx / fetch / clock / HTTP objects
// ---------------------------------------------------------------------------

function installFetch(handler) {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    const target = String(url)
    calls.push(target)
    return handler(target, init, calls.length)
  }
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch
    },
  }
}

function fakeResponse(body, url, { status = 200, contentType = 'application/rss+xml; charset=utf-8' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: {
      get(name) {
        const key = String(name).toLowerCase()
        if (key === 'content-length') return String(Buffer.byteLength(body))
        if (key === 'content-type') return contentType
        return null
      },
    },
    async text() {
      return body
    },
  }
}

/** Deterministic Date.now clock for the force-gap and interval-window tests. */
function installClock(start = 1_800_000_000_000) {
  let now = start
  Date.now = () => now
  return {
    now: () => now,
    advance(ms) {
      now += ms
    },
    restore() {
      Date.now = realDateNow
    },
  }
}

async function waitFor(predicate, timeoutMs = 3000) {
  const start = realDateNow()
  while (!predicate()) {
    if (realDateNow() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((resolve) => realSetTimeout(resolve, 5))
  }
}

/** Capture the warm-up setTimeout so it cannot fire in the background mid-test. */
function captureTimers(run) {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const timers = []
  globalThis.setTimeout = (callback, delay, ...args) => {
    const timer = { callback, delay, args, cleared: false, unref() { return timer } }
    timers.push(timer)
    return timer
  }
  globalThis.clearTimeout = (timer) => {
    if (timer !== null && typeof timer === 'object') timer.cleared = true
  }
  try {
    return { timers, value: run() }
  } finally {
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  }
}

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode
      this.headers = headers ?? {}
      return this
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) this.body += String(chunk)
    },
  }
}

/**
 * Fake Cordis context with exactly the API index.js uses. `effect` runs the callback
 * immediately (as a real activation effect would); the warm-up timer is captured by
 * captureTimers instead of firing for real.
 */
function mountPlugin(config) {
  const captures = { routes: [], effects: [], services: null, disposers: [], logs: [] }
  const runEffect = (callback, label) => {
    captures.effects.push(String(label ?? ''))
    const dispose = callback()
    if (typeof dispose === 'function') captures.disposers.push(dispose)
    return dispose ?? (() => {})
  }
  const context = {
    get: () => undefined,
    logger: {
      warn(message) {
        captures.logs.push(String(message))
      },
    },
    effect: runEffect,
    inject(services, callback) {
      captures.services = services
      callback({
        webServer: {
          register(definition) {
            captures.routes.push(definition)
            return () => {}
          },
        },
        effect: runEffect,
      })
    },
  }
  const { timers } = captureTimers(() => apply(context, config))
  const route = captures.routes.find(
    (entry) => entry !== null && typeof entry === 'object' && entry.kind === 'exact' && entry.path === ROUTE_PATH,
  )
  assert.ok(route, 'index.js must register an exact route at the state path')
  return {
    ...captures,
    route,
    timers,
    dispose() {
      for (const dispose of [...captures.disposers].reverse()) {
        try {
          dispose()
        } catch {
          // cleanup must never fail a test
        }
      }
    },
  }
}

async function callRoute(plugin, { method = 'GET', url = ROUTE_PATH, headers = {} } = {}) {
  // A minimal IncomingMessage / ServerResponse pair; only the fields index.js reads.
  const req = { method, url, headers }
  const res = createResponse()
  await plugin.route.handler(req, res)
  return res
}

function parseBody(res) {
  return JSON.parse(res.body)
}

// ===========================================================================
// Tests
// ===========================================================================

section('Route contract')

await test('cold start: 200 JSON snapshot, silent seed, defaults, interval caching', async () => {
  const net = installFetch(() =>
    fakeResponse(
      rssDocument([
        rssItem({ id: '9001', title: OUTAGE_TITLE, status: 'investigating', components: ['对话服务(Chatservice)'] }),
      ]),
      LIVE_RSS,
    ),
  )
  let plugin
  try {
    plugin = mountPlugin({ refreshIntervalSeconds: 15, requestTimeoutMs: 3000 })
    assert.deepEqual(plugin.services, ['webServer'])
    assert.deepEqual(plugin.effects, ['deepseek-status: state route', 'deepseek-status: warm-up fetch'])
    assert.equal(plugin.timers.length, 1)
    assert.equal(plugin.timers[0].delay, 250)

    const res = await callRoute(plugin, { url: `${ROUTE_PATH}?interval=15` })
    assert.equal(res.statusCode, 200)
    assert.match(String(res.headers['content-type']), /application\/json/)
    assert.equal(res.headers['cache-control'], 'no-store')
    assert.equal(Number(res.headers['content-length']), Buffer.byteLength(res.body))
    const body = parseBody(res)
    assert.equal(body.version, 1)
    assert.equal(body.ok, true)
    assert.equal(body.error, null)
    assert.equal(body.health, 'outage')
    assert.equal(body.format, 'rss')
    assert.equal(body.source, LIVE_RSS)
    assert.deepEqual(body.defaults, { feedUrl: LIVE_RSS, refreshIntervalSeconds: 15, topOffsetPx: 90 })
    assert.equal(body.demo, false, 'the appearance demo is off by default')
    assert.ok(Array.isArray(body.incidents) && body.incidents.length === 1)
    assert.ok(Array.isArray(body.active) && body.active.length === 1, 'unresolved incident is active')
    assert.equal(body.active[0].id, '9001')
    assert.deepEqual(body.events, [], 'first observation is history: no startup event')
    assert.ok(body.fetchedAt > 0 && body.checkedAt > 0 && body.serverTime > 0)
    assert.equal(net.calls.length, 1)

    const cached = await callRoute(plugin, { url: `${ROUTE_PATH}?interval=15` })
    assert.equal(net.calls.length, 1, 'a poll inside the refresh window is served from cache')
    assert.deepEqual(parseBody(cached).events, [])
  } finally {
    plugin?.dispose()
    net.restore()
  }
})

await test('forced poll: 1s gap honoured, recovery event emitted exactly once', async () => {
  let current = rssDocument([rssItem({ id: '9001', title: OUTAGE_TITLE, status: 'investigating' })])
  const net = installFetch(() => fakeResponse(current, LIVE_RSS))
  const clock = installClock()
  let plugin
  try {
    plugin = mountPlugin({ refreshIntervalSeconds: 15, requestTimeoutMs: 3000 })
    await callRoute(plugin, { url: `${ROUTE_PATH}?interval=15` })
    assert.equal(net.calls.length, 1)
    assert.deepEqual(parseBody(await callRoute(plugin, { url: ROUTE_PATH })).events, [], 'seeded silently')

    clock.advance(100)
    await callRoute(plugin, { url: `${ROUTE_PATH}?interval=15&force=1` })
    assert.equal(net.calls.length, 1, 'MIN_FORCE_GAP_MS swallows a force poll < 1s after the last attempt')

    current = rssDocument([
      rssItem({ id: '9001', title: OUTAGE_TITLE, status: 'resolved', pubDate: 'Sat, 07 Nov 2026 15:30:00 +0800' }),
    ])
    clock.advance(1400)
    const recovered = parseBody(await callRoute(plugin, { url: `${ROUTE_PATH}?interval=15&force=1` }))
    assert.equal(net.calls.length, 2)
    assert.equal(recovered.ok, true)
    assert.equal(recovered.health, 'ok')
    assert.deepEqual(recovered.active, [])
    assert.equal(recovered.events.length, 1, 'exactly one recovery event')
    assert.equal(recovered.events[0].kind, 'recovery')
    assert.equal(recovered.events[0].incidentId, '9001')
    assert.equal(recovered.events[0].status, 'resolved')
    assert.ok(plugin.logs.some((line) => line.includes('status change: recovery 9001')))

    const unchanged = parseBody(await callRoute(plugin, { url: ROUTE_PATH }))
    assert.equal(net.calls.length, 2, 'normal poll still inside the window')
    assert.equal(unchanged.events.length, 1, 'no duplicate recovery event on an unchanged poll')
  } finally {
    plugin?.dispose()
    clock.restore()
    net.restore()
  }
})

await test('interval query control: poll inside the window is cached, after it re-fetches', async () => {
  const net = installFetch(() =>
    fakeResponse(rssDocument([rssItem({ id: '9001', title: OUTAGE_TITLE, status: 'investigating' })]), LIVE_RSS),
  )
  const clock = installClock()
  let plugin
  try {
    plugin = mountPlugin({ refreshIntervalSeconds: 15 })
    clock.advance(0)
    await callRoute(plugin, { url: `${ROUTE_PATH}?interval=15` })
    assert.equal(net.calls.length, 1)
    clock.advance(14000)
    await callRoute(plugin, { url: `${ROUTE_PATH}?interval=15` })
    assert.equal(net.calls.length, 1, '14s < interval=15s, cached')
    clock.advance(2000)
    await callRoute(plugin, { url: `${ROUTE_PATH}?interval=15` })
    assert.equal(net.calls.length, 2, '16s >= interval=15s, refetched')
  } finally {
    plugin?.dispose()
    clock.restore()
    net.restore()
  }
})

await test('a bare GET uses the configured interval, not the 15 s floor', async () => {
  const net = installFetch(() =>
    fakeResponse(rssDocument([rssItem({ id: '9001', title: OUTAGE_TITLE, status: 'resolved' })]), LIVE_RSS),
  )
  const clock = installClock()
  let plugin
  try {
    plugin = mountPlugin({ refreshIntervalSeconds: 60 })
    clock.advance(0)
    await callRoute(plugin)
    assert.equal(net.calls.length, 1)
    clock.advance(20000)
    await callRoute(plugin)
    assert.equal(net.calls.length, 1, '20s < configured 60s, served from cache')
    clock.advance(41000)
    await callRoute(plugin)
    assert.equal(net.calls.length, 2, '61s >= configured 60s, refetched')
  } finally {
    plugin?.dispose()
    clock.restore()
    net.restore()
  }
})

await test('cross-site force requests are ignored; same-origin force is honoured', async () => {
  const net = installFetch(() =>
    fakeResponse(rssDocument([rssItem({ id: '9001', title: OUTAGE_TITLE, status: 'resolved' })]), LIVE_RSS),
  )
  const clock = installClock()
  let plugin
  try {
    plugin = mountPlugin({ refreshIntervalSeconds: 60 })
    await callRoute(plugin)
    assert.equal(net.calls.length, 1)
    clock.advance(5000)
    await callRoute(plugin, { url: `${ROUTE_PATH}?force=1`, headers: { 'sec-fetch-site': 'cross-site' } })
    assert.equal(net.calls.length, 1, 'a cross-site page cannot drive an outbound fetch')
    clock.advance(5000)
    await callRoute(plugin, { url: `${ROUTE_PATH}?force=1`, headers: { 'sec-fetch-site': 'same-origin' } })
    assert.equal(net.calls.length, 2, 'the page itself may force a refresh')
  } finally {
    plugin?.dispose()
    clock.restore()
    net.restore()
  }
})

await test('a failing custom feed URL does not fall back to the official feed', async () => {
  const custom = 'https://mirror.example/status-feed'
  const net = installFetch(() => {
    throw new Error('mirror down')
  })
  let plugin
  try {
    plugin = mountPlugin({ feedUrl: custom, refreshIntervalSeconds: 15 })
    const res = await callRoute(plugin, { url: `${ROUTE_PATH}?interval=15` })
    const body = parseBody(res)
    assert.equal(body.ok, false)
    assert.deepEqual(net.calls, [custom], 'only the configured URL is attempted')
    assert.equal(body.source, custom)
    assert.match(body.error, /mirror down/)
  } finally {
    plugin?.dispose()
    net.restore()
  }
})

await test('upstream failure: HTTP 200 with ok=false, non-empty error, previous snapshot kept', async () => {
  const doc = rssDocument([rssItem({ id: '9001', title: OUTAGE_TITLE, status: 'investigating' })])
  const net = installFetch((_url, _init, callNumber) => {
    if (callNumber === 1) return fakeResponse(doc, LIVE_RSS)
    throw new Error('network down')
  })
  const clock = installClock()
  let plugin
  try {
    plugin = mountPlugin({ refreshIntervalSeconds: 15 })
    await callRoute(plugin, { url: `${ROUTE_PATH}?interval=15` })
    clock.advance(1500)
    const res = await callRoute(plugin, { url: `${ROUTE_PATH}?interval=15&force=1` })
    assert.equal(res.statusCode, 200, 'a failed poll still answers HTTP 200; the body carries ok=false')
    assert.equal(net.calls.length, 3, 'primary feed + Atom fallback both attempted')
    const body = parseBody(res)
    assert.equal(body.ok, false)
    assert.ok(typeof body.error === 'string' && body.error.length > 0)
    assert.match(body.error, /network down/)
    assert.equal(body.health, 'outage', 'stale health preserved')
    assert.equal(body.incidents.length, 1, 'previous incidents preserved')
    assert.equal(body.active.length, 1)
    assert.equal(body.format, 'rss')
    assert.equal(body.source, LIVE_RSS)
    assert.deepEqual(body.events, [])
  } finally {
    plugin?.dispose()
    clock.restore()
    net.restore()
  }
})

await test('first-ever fetch failure: HTTP 200, ok=false, empty snapshot, non-empty error', async () => {
  const net = installFetch(() => {
    throw new Error('offline')
  })
  let plugin
  try {
    plugin = mountPlugin({ refreshIntervalSeconds: 15 })
    const res = await callRoute(plugin, { url: `${ROUTE_PATH}?interval=15` })
    assert.equal(res.statusCode, 200)
    const body = parseBody(res)
    assert.equal(body.ok, false)
    assert.ok(typeof body.error === 'string' && body.error.length > 0)
    assert.deepEqual(body.incidents, [])
    assert.deepEqual(body.active, [])
    assert.deepEqual(body.events, [])
    assert.equal(body.health, 'unknown')
    assert.equal(body.format, null)
    assert.equal(body.fetchedAt, 0)
    assert.equal(body.source, LIVE_RSS)
    assert.equal(net.calls.length, 2, 'primary + alternate attempted')
  } finally {
    plugin?.dispose()
    net.restore()
  }
})

await test('RSS endpoint failure falls back to Atom', async () => {
  const atom = atomDocument([atomEntry({ id: '9001', title: OUTAGE_TITLE, status: 'investigating' })])
  const net = installFetch((url) => {
    if (url === LIVE_RSS) throw new Error('primary down')
    if (url === LIVE_ATOM) return fakeResponse(atom, LIVE_ATOM, { contentType: 'application/atom+xml; charset=utf-8' })
    throw new Error(`unexpected fetch ${url}`)
  })
  let plugin
  try {
    plugin = mountPlugin({ refreshIntervalSeconds: 15 })
    const body = parseBody(await callRoute(plugin, { url: `${ROUTE_PATH}?interval=15` }))
    assert.deepEqual(net.calls, [LIVE_RSS, LIVE_ATOM])
    assert.equal(body.ok, true)
    assert.equal(body.format, 'atom')
    assert.equal(body.source, LIVE_ATOM)
    assert.equal(body.incidents[0].id, '9001')
    assert.equal(body.health, 'outage')
    assert.deepEqual(body.events, [])
  } finally {
    plugin?.dispose()
    net.restore()
  }
})

await test('config clamping: invalid feedUrl, too-small interval and maxIncidents are clamped', async () => {
  const doc = rssDocument(
    Array.from({ length: 5 }, (_unused, index) =>
      rssItem({
        id: String(100 + index),
        title: OUTAGE_TITLE,
        status: 'resolved',
        pubDate: new Date(T0 + index * 60000).toUTCString(),
      }),
    ),
  )
  const net = installFetch(() => fakeResponse(doc, LIVE_RSS))
  let plugin
  try {
    plugin = mountPlugin({
      feedUrl: 'not a url',
      refreshIntervalSeconds: 5,
      maxIncidents: 1,
      requestTimeoutMs: 1,
      noticeTopOffsetPx: 9999,
      demo: 'bogus',
    })
    const body = parseBody(await callRoute(plugin, { url: ROUTE_PATH }))
    assert.deepEqual(body.defaults, { feedUrl: LIVE_RSS, refreshIntervalSeconds: 15, topOffsetPx: 400 })
    assert.equal(body.demo, false, 'an unknown demo mode is ignored')
    assert.equal(net.calls[0], LIVE_RSS)
    assert.equal(body.incidents.length, 3, 'maxIncidents is clamped up to 3')
  } finally {
    plugin?.dispose()
    net.restore()
  }
})

section('HTTP method handling')

await test('POST is rejected with 405 before any network call; HEAD returns headers only', async () => {
  const net = installFetch(() =>
    fakeResponse(rssDocument([rssItem({ id: '9001', title: OUTAGE_TITLE, status: 'resolved' })]), LIVE_RSS),
  )
  let plugin
  try {
    plugin = mountPlugin({ refreshIntervalSeconds: 15 })
    const rejected = await callRoute(plugin, { method: 'POST', url: ROUTE_PATH })
    assert.equal(rejected.statusCode, 405)
    assert.equal(rejected.headers.allow, 'GET, HEAD')
    assert.equal(rejected.body, '')
    assert.equal(net.calls.length, 0)

    const head = await callRoute(plugin, { method: 'HEAD', url: ROUTE_PATH })
    assert.equal(head.statusCode, 200)
    assert.equal(head.body, '')
    assert.match(String(head.headers['content-type']), /application\/json/)
    assert.equal(net.calls.length, 1, 'HEAD refreshes the snapshot')

    const get = await callRoute(plugin, { url: ROUTE_PATH })
    assert.equal(net.calls.length, 1, 'the following GET is cached')
    assert.equal(get.headers['x-content-type-options'], 'nosniff')
    assert.equal(Number(get.headers['content-length']), Buffer.byteLength(get.body))
    assert.equal(parseBody(get).ok, true)
  } finally {
    plugin?.dispose()
    net.restore()
  }
})

section('Warm-up effect')

await test('the captured 250ms warm-up callback fetches before the first poll', async () => {
  const net = installFetch(() =>
    fakeResponse(rssDocument([rssItem({ id: '9001', title: 'DeepSeek API 性能下降', status: 'monitoring' })]), LIVE_RSS),
  )
  let plugin
  try {
    plugin = mountPlugin({ refreshIntervalSeconds: 15 })
    assert.equal(plugin.timers.length, 1)
    assert.equal(plugin.timers[0].delay, 250)
    plugin.timers[0].callback()
    await waitFor(() => net.calls.length === 1)
    const body = parseBody(await callRoute(plugin, { url: ROUTE_PATH }))
    assert.equal(body.ok, true)
    assert.ok(body.fetchedAt > 0)
    assert.equal(body.health, 'degraded')
    assert.equal(net.calls.length, 1, 'first poll reuses the warm-up snapshot')
  } finally {
    plugin?.dispose()
    net.restore()
  }
})

// ---------------------------------------------------------------------------

reportSummary()
