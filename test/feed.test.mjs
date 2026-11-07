#!/usr/bin/env node
/**
 * Independent verification suite for the DeepSeek status plugin host half:
 *   - lib/feed.js  (pure parsing + transition state machine)
 *   - index.js     (host wiring: config clamping, fetching, fallback, route contract)
 *
 * Dependency-free: node:assert/strict + node:fs only. No test framework.
 *
 * Run:
 *   "C:\Users\minexixi\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" test/feed.test.mjs
 *
 * The two live documents are fetched from status.deepseek.com and compared with the
 * frozen copies in test/fixtures/ so reruns stay deterministic even when the feed
 * rotates. Set FEED_TEST_OFFLINE=1 to skip the live downloads.
 *
 * This file was written by the independent verifier. It MUST NOT modify plugin
 * sources; suspected plugin defects are asserted here and reported in test/report.md.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { apply } from '../index.js'
import * as feed from '../lib/feed.js'

// ---------------------------------------------------------------------------
// Fixtures and constants
// ---------------------------------------------------------------------------

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const RSS_FIXTURE = fixture('feed.rss')
const ATOM_FIXTURE = fixture('feed.atom')

const LIVE_RSS = 'https://status.deepseek.com/feed.rss'
const LIVE_ATOM = 'https://status.deepseek.com/feed.atom'
const ROUTE_PATH = '/__dsh-deepseek-status/state'
const OUTAGE_TITLE = 'DeepSeek 网页/API 部分中断（DeepSeek Web/API Partially Unavailable）'
const DEGRADED_TITLE = 'DeepSeek API 性能下降（DeepSeek API Degraded Performance）'
const ERROR_TITLE = '搜索服务异常（Search service error）'
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

function skipResult(reason) {
  return { __skipped: reason }
}

async function test(name, fn) {
  try {
    const value = await fn()
    if (value && typeof value === 'object' && typeof value.__skipped === 'string') {
      state.skip += 1
      console.log(`SKIP ${name} (${value.__skipped})`)
      return
    }
    state.pass += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    state.fail += 1
    const label = sectionName === '' ? name : `${sectionName} :: ${name}`
    state.failures.push({ label, error })
    console.log(`FAIL ${name}`)
    const detail = String(error?.stack ?? error).split('\n').slice(0, 8).join('\n')
    console.log(
      detail
        .split('\n')
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
    for (const { label, error } of state.failures) {
      console.log(` - ${label}: ${error?.message ?? error}`)
    }
  }
  console.log('='.repeat(78))
  if (state.fail > 0) process.exitCode = 1
}

// ---------------------------------------------------------------------------
// Synthetic feed document builders
// ---------------------------------------------------------------------------

function escapeXml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function descriptionMarkup({ status = 'resolved', components = [], body = null } = {}) {
  const text =
    body === null
      ? '本次问题已解决，服务已恢复。\nThe incident has been resolved and service has been restored.'
      : body
  const parts = [`<p><strong>Status:</strong> ${status}</p>`]
  if (text !== '') parts.push(`<p>${text}</p>`)
  if (components.length > 0) parts.push(`<p><strong>Affected components:</strong> ${components.join(', ')}</p>`)
  return parts.join('')
}

function rssItem({
  id,
  title,
  link,
  status,
  components = [],
  body = null,
  pubDate = PUB_DATE,
  guid,
  extraDescription = null,
} = {}) {
  const markup = extraDescription ?? descriptionMarkup({ status, components, body })
  const parts = ['<item>']
  if (title !== null) parts.push(`<title>${escapeXml(title ?? '')}</title>`)
  if (link !== null) parts.push(`<link>${escapeXml(link ?? `https://status.deepseek.com/incidents/${id}`)}</link>`)
  parts.push(`<description>${escapeXml(markup)}</description>`)
  if (guid !== null) parts.push(`<guid>${escapeXml(guid ?? `urn:flashduty:change:${id}`)}</guid>`)
  if (pubDate !== null) parts.push(`<pubDate>${pubDate}</pubDate>`)
  parts.push('</item>')
  return parts.join('')
}

function rssDocument(items) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>DeepSeek</title><link>https://status.deepseek.com</link>${items.join('')}</channel></rss>`
}

function atomEntry({
  id,
  title,
  link,
  status,
  components = [],
  body = null,
  updated = '2026-11-07T15:56:50+08:00',
  guid,
} = {}) {
  const markup = descriptionMarkup({ status, components, body })
  return [
    '<entry>',
    `<title>${escapeXml(title ?? '')}</title>`,
    `<updated>${updated}</updated>`,
    `<id>${escapeXml(guid ?? `urn:flashduty:change:${id}`)}</id>`,
    `<link href="${escapeXml(link ?? `https://status.deepseek.com/incidents/${id}`)}" rel="alternate"></link>`,
    `<summary type="html">${escapeXml(markup)}</summary>`,
    '</entry>',
  ].join('')
}

function atomDocument(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>DeepSeek</title><id>https://status.deepseek.com</id>${entries.join('')}</feed>`
}

/**
 * Build a normalized incident for state-machine tests. Severity is supplied
 * explicitly (not derived) so the transition tests stay independent of
 * classifySeverity, which is verified separately.
 */
function makeIncident({
  id = '9001',
  title = OUTAGE_TITLE,
  status = 'investigating',
  severity = 'outage',
  updatedAt = T0,
  link = null,
  guid = null,
  components = [],
  summary = '',
} = {}) {
  return {
    id,
    title,
    link: link ?? `https://status.deepseek.com/incidents/${id}`,
    status,
    severity,
    active: status !== 'resolved',
    updatedAt,
    summary,
    components,
    guid: guid ?? `urn:flashduty:change:${id}`,
  }
}

// ---------------------------------------------------------------------------
// Fetch / host mocks (used by the index.js wiring tests only)
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

/** Capture the warm-up setTimeout without letting it fire during mount. */
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

function mountPlugin(config) {
  const captures = { routes: [], effects: [], services: null, disposers: [], logs: [] }
  const context = {
    logger: {
      warn(message) {
        captures.logs.push(String(message))
      },
    },
    effect(callback, label) {
      captures.effects.push(String(label ?? ''))
      const dispose = callback()
      if (typeof dispose === 'function') captures.disposers.push(dispose)
      return dispose ?? (() => {})
    },
    inject(services, callback) {
      captures.services = services
      const sub = {
        webServer: {
          register(definition) {
            captures.routes.push(definition)
            return () => {}
          },
        },
        effect(callback, label) {
          captures.effects.push(String(label ?? ''))
          const dispose = callback()
          if (typeof dispose === 'function') captures.disposers.push(dispose)
          return dispose ?? (() => {})
        },
      }
      callback(sub)
    },
  }
  const { timers } = captureTimers(() => apply(context, config))
  const route = captures.routes.find(
    (entry) => entry !== null && typeof entry === 'object' && entry.kind === 'exact' && entry.path === ROUTE_PATH,
  )
  assert.ok(route, 'host half must register an exact route at the state path')
  return {
    ...captures,
    route,
    timers,
    dispose() {
      for (const dispose of [...captures.disposers].reverse()) {
        try {
          dispose()
        } catch {
          // cleanup must never fail the test
        }
      }
    },
  }
}

async function callRoute(plugin, { method = 'GET', url = ROUTE_PATH } = {}) {
  const req = { method, url }
  const res = createResponse()
  await plugin.route.handler(req, res)
  return res
}

function parseBody(res) {
  return JSON.parse(res.body)
}

// ===========================================================================
// 1. Live published documents
// ===========================================================================

section('1. Live published documents')

async function fetchLive(url) {
  if (process.env.FEED_TEST_OFFLINE === '1') return skipResult('FEED_TEST_OFFLINE=1')
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(25000) })
    if (!response.ok) return skipResult(`live HTTP ${response.status}`)
    return { response, text: await response.text() }
  } catch (error) {
    return skipResult(`live fetch failed: ${error?.message ?? error}`)
  }
}

function assertParsedDocument(parsed, expectedFormat, label) {
  assert.equal(parsed.format, expectedFormat, `${label}: format detection`)
  assert.ok(parsed.incidents.length >= 1, `${label}: at least one incident`)
  for (const incident of parsed.incidents) {
    assert.ok(typeof incident.id === 'string' && incident.id !== '', `${label}: incident id is non-empty`)
    assert.ok(!incident.id.startsWith('urn:'), `${label}: id is extracted from the guid, not the raw urn`)
    assert.ok(incident.title !== '', `${label}: title is non-empty`)
    assert.match(incident.link, /^https:\/\/status\.deepseek\.com\/incidents\/\d+$/, `${label}: incident link`)
    assert.ok(
      ['resolved', 'investigating', 'identified', 'monitoring', 'unknown'].includes(incident.status),
      `${label}: status vocabulary (${incident.status})`,
    )
    assert.ok(Number.isFinite(incident.updatedAt) && incident.updatedAt > 0, `${label}: timestamp parsed`)
    assert.ok(incident.updatedAt > Date.parse('2025-01-01T00:00:00Z'), `${label}: timestamp is plausible`)
    assert.ok(!incident.summary.includes('<p>') && !incident.summary.includes('&lt;'), `${label}: summary is plain text`)
    assert.ok(Array.isArray(incident.components), `${label}: components is an array`)
    assert.equal(incident.active, incident.status !== 'resolved', `${label}: active flag matches status`)
    assert.equal(
      incident.severity,
      incident.status === 'resolved' ? 'recovery' : incident.severity,
      `${label}: severity is recovery for resolved incidents`,
    )
  }
  const sorted = parsed.incidents.every(
    (incident, index, all) => index === 0 || all[index - 1].updatedAt >= incident.updatedAt,
  )
  assert.ok(sorted, `${label}: incidents are sorted newest first`)
}

await test('live RSS document (fetch + parse)', async () => {
  const live = await fetchLive(LIVE_RSS)
  if (live instanceof Object && live.__skipped) return live
  assert.equal(live.response.status, 200)
  assert.match(String(live.response.headers.get('content-type')), /rss|xml/i)
  const parsed = feed.parseFeed(live.text)
  assertParsedDocument(parsed, 'rss', 'live rss')
  assert.ok(parsed.incidents.some((incident) => incident.components.length > 0), 'live rss: components are populated')
  return null
})

await test('live Atom document (fetch + parse)', async () => {
  const live = await fetchLive(LIVE_ATOM)
  if (live instanceof Object && live.__skipped) return live
  assert.equal(live.response.status, 200)
  assert.match(String(live.response.headers.get('content-type')), /atom|xml/i)
  const parsed = feed.parseFeed(live.text)
  assertParsedDocument(parsed, 'atom', 'live atom')
  return null
})

// ===========================================================================
// 2. Frozen fixture documents (deterministic reruns)
// ===========================================================================

section('2. Frozen fixture documents')

const rssFixture = feed.parseFeed(RSS_FIXTURE)
const atomFixture = feed.parseFeed(ATOM_FIXTURE)

await test('RSS fixture: format, count, top-incident normalization', async () => {
  assert.equal(rssFixture.format, 'rss')
  assert.equal(rssFixture.incidents.length, 26, 'fixture was captured with 26 items')
  const top = rssFixture.incidents[0]
  assert.equal(top.id, '7219383236287')
  assert.equal(top.guid, 'urn:flashduty:change:7219383236287')
  assert.equal(top.title, 'DeepSeek 网页/API 部分中断（DeepSeek Web/API Partially Unavailable）')
  assert.equal(top.link, 'https://status.deepseek.com/incidents/7219383236287')
  assert.equal(top.status, 'resolved')
  assert.equal(top.severity, 'recovery')
  assert.equal(top.active, false)
  assert.equal(top.updatedAt, Date.parse('Sat, 07 Nov 2026 15:11:38 +0800'))
  assert.deepEqual(top.components, [
    'DeepSeek V4 Pro API服务(API Service)',
    'DeepSeek V4.1 Flash API服务(API Service)',
    '对话服务(Chatservice)',
    '搜索服务(Search Service)',
  ])
  assert.equal(
    top.summary,
    'Status: resolved\n本次问题已解决，服务已恢复。\nThe incident has been resolved and service has been restored.\nAffected components: DeepSeek V4 Pro API服务(API Service), DeepSeek V4.1 Flash API服务(API Service), 对话服务(Chatservice), 搜索服务(Search Service)',
  )
  return null
})

await test('Atom fixture: format, count, top-incident normalization', async () => {
  assert.equal(atomFixture.format, 'atom')
  assert.equal(atomFixture.incidents.length, 26, 'fixture was captured with 26 entries')
  const top = atomFixture.incidents[0]
  assert.equal(top.id, '7219383236287')
  assert.equal(top.guid, 'urn:flashduty:change:7219383236287')
  assert.equal(top.title, 'DeepSeek 网页/API 部分中断（DeepSeek Web/API Partially Unavailable）')
  assert.equal(top.link, 'https://status.deepseek.com/incidents/7219383236287')
  assert.equal(top.status, 'resolved')
  assert.equal(top.severity, 'recovery')
  assert.equal(top.active, false)
  assert.equal(top.updatedAt, Date.parse('2026-11-07T15:56:50+08:00'))
  assert.equal(top.components.length, 4)
  assert.equal(top.summary, rssFixture.incidents[0].summary, 'both formats render the same summary text')
  return null
})

await test('fixtures: every RSS incident is fully normalized', async () => {
  for (const incident of rssFixture.incidents) {
    assert.match(incident.id, /^\d+$/)
    assert.match(incident.link, /^https:\/\/status\.deepseek\.com\/incidents\/\d+$/)
    assert.equal(incident.guid, `urn:flashduty:change:${incident.id}`)
    assert.ok(incident.title.length > 0)
    assert.equal(incident.status, 'resolved')
    assert.equal(incident.severity, 'recovery')
    assert.equal(incident.active, false)
    assert.ok(incident.updatedAt > 0)
    assert.ok(incident.summary.length > 0)
    assert.ok(!incident.summary.includes('<'), 'summary contains no HTML tags')
    assert.ok(!/&(?:lt|gt|amp|quot|apos|#x?[0-9a-f]+);/i.test(incident.summary), 'summary has no undecoded entities')
    assert.ok(incident.components.length >= 1, 'every fixture incident lists components')
    for (const component of incident.components) assert.ok(component.length > 0 && !component.includes('<'))
  }
  return null
})

await test('fixtures: same incidents and same normalized fields across RSS and Atom', async () => {
  const rssIds = rssFixture.incidents.map((incident) => incident.id).sort()
  const atomIds = atomFixture.incidents.map((incident) => incident.id).sort()
  assert.deepEqual(rssIds, atomIds, 'both formats publish the same incident ids')
  const atomById = new Map(atomFixture.incidents.map((incident) => [incident.id, incident]))
  for (const rssIncident of rssFixture.incidents) {
    const atomIncident = atomById.get(rssIncident.id)
    assert.equal(atomIncident.title, rssIncident.title)
    assert.equal(atomIncident.link, rssIncident.link)
    assert.equal(atomIncident.guid, rssIncident.guid)
    assert.equal(atomIncident.status, rssIncident.status)
    assert.equal(atomIncident.severity, rssIncident.severity)
    assert.equal(atomIncident.active, rssIncident.active)
    assert.equal(atomIncident.summary, rssIncident.summary)
    assert.deepEqual(atomIncident.components, rssIncident.components)
  }
  return null
})

await test('fixtures: per-incident timestamps differ between the two published formats (feed data observation)', async () => {
  const atomById = new Map(atomFixture.incidents.map((incident) => [incident.id, incident]))
  const differing = rssFixture.incidents.filter(
    (incident) => atomById.get(incident.id).updatedAt !== incident.updatedAt,
  )
  assert.equal(
    differing.length,
    26,
    'RSS pubDate and Atom updated are different instants for all 26 incidents; a format failover changes every updatedAt',
  )
  return null
})

// ===========================================================================
// 3. Entity / CDATA / text edge cases
// ===========================================================================

section('3. Entity, CDATA and text edge cases')

await test('htmlToText decodes named, decimal and hex entities', async () => {
  assert.equal(feed.htmlToText('a &amp; b'), 'a & b')
  assert.equal(feed.htmlToText('&lt;strong&gt;bold&lt;/strong&gt;'), 'bold')
  assert.equal(feed.htmlToText('&#x4E2D;&#25991;'), '中文')
  assert.equal(feed.htmlToText('&quot;quoted&quot; &apos;single&apos;'), `"quoted" 'single'`)
  assert.equal(feed.htmlToText('a&nbsp;&nbsp;b'), 'a b')
  return null
})

await test('htmlToText converts markup to single-line plain text', async () => {
  assert.equal(feed.htmlToText('<p>one</p><p>two</p>'), 'one\ntwo')
  assert.equal(feed.htmlToText('a<br>b<br/>c'), 'a\nb\nc')
  assert.equal(feed.htmlToText('  a   b  '), 'a b')
  assert.equal(feed.htmlToText('x &#x110000; y'), 'x y', 'invalid code point is dropped, not thrown')
  assert.equal(feed.htmlToText('&#xA;&#xA;tail'), 'tail', 'blank lines are collapsed')
  return null
})

await test('parseStatus reads <strong>Status:</strong> explicitly', async () => {
  assert.equal(feed.parseStatus('<p><strong>Status:</strong> resolved</p>', OUTAGE_TITLE), 'resolved')
  assert.equal(feed.parseStatus('<p><strong>Status:</strong> investigating</p>', OUTAGE_TITLE), 'investigating')
  assert.equal(feed.parseStatus('<p><strong>Status:</strong> IDENTIFIED</p>', OUTAGE_TITLE), 'identified')
  assert.equal(feed.parseStatus('<p><strong>Status:</strong>  monitoring  </p>', OUTAGE_TITLE), 'monitoring')
  assert.equal(
    feed.parseStatus('&lt;p&gt;&lt;strong&gt;Status:&lt;/strong&gt; resolved&lt;/p&gt;', OUTAGE_TITLE),
    'resolved',
    'escaped HTML body is decoded before matching',
  )
  return null
})

await test('parseStatus falls back to resolved wording, then title, else unknown', async () => {
  assert.equal(feed.parseStatus('<p>The incident has been resolved and service has been restored.</p>', 'x'), 'resolved')
  assert.equal(feed.parseStatus('<p>本次问题已解决，服务已恢复。</p>', 'x'), 'resolved')
  assert.equal(feed.parseStatus('', '服务已恢复'), 'resolved', 'title-only fallback')
  assert.equal(feed.parseStatus('', 'DeepSeek API 中断'), 'unknown')
  assert.equal(feed.parseStatus('<p>Status: investigating</p>', 'DeepSeek API 中断'), 'unknown', 'no <strong> marker and no resolved wording')
  return null
})

await test('parseComponents splits on comma and ideographic comma', async () => {
  assert.deepEqual(
    feed.parseComponents('<p><strong>Affected components:</strong> A, B、C</p>'),
    ['A', 'B', 'C'],
  )
  assert.deepEqual(
    feed.parseComponents('&lt;p&gt;&lt;strong&gt;Affected components:&lt;/strong&gt; 对话服务(Chatservice), 搜索服务(Search Service)&lt;/p&gt;'),
    ['对话服务(Chatservice)', '搜索服务(Search Service)'],
    'escaped HTML body is decoded',
  )
  assert.deepEqual(feed.parseComponents('<p><strong>Affected components:</strong> A, B, </p>'), ['A', 'B'])
  assert.deepEqual(feed.parseComponents('<p>no component line</p>'), [])
  assert.deepEqual(
    feed.parseComponents('<p><strong>Affected components:</strong> A&amp;B, C</p>'),
    ['A&B', 'C'],
    'component names are entity-decoded',
  )
  return null
})

await test('parseFeed handles CDATA titles and descriptions', async () => {
  const doc = `<rss><channel><item><title><![CDATA[DeepSeek API 中断（DeepSeek API Outage）]]></title><link>https://status.deepseek.com/incidents/42</link><guid>urn:flashduty:change:42</guid><description><![CDATA[<p><strong>Status:</strong> resolved</p><p><strong>Affected components:</strong> 对话服务(Chatservice)</p>]]></description><pubDate>${PUB_DATE}</pubDate></item></channel></rss>`
  const incident = feed.parseFeed(doc).incidents[0]
  assert.equal(incident.title, 'DeepSeek API 中断（DeepSeek API Outage）')
  assert.equal(incident.status, 'resolved')
  assert.equal(incident.severity, 'recovery')
  assert.deepEqual(incident.components, ['对话服务(Chatservice)'])
  assert.equal(incident.summary, 'Status: resolved\nAffected components: 对话服务(Chatservice)')
  return null
})

await test('parseFeed handles an Atom CDATA summary', async () => {
  const doc = `<feed xmlns="http://www.w3.org/2005/Atom"><title>DeepSeek</title><entry><title><![CDATA[DeepSeek API 性能下降（DeepSeek API Degraded Performance）]]></title><updated>2026-11-07T15:00:00+08:00</updated><id>urn:flashduty:change:7</id><link href="https://status.deepseek.com/incidents/7" rel="alternate"/><summary type="html"><![CDATA[<p><strong>Status:</strong> investigating</p>]]></summary></entry></feed>`
  const incident = feed.parseFeed(doc).incidents[0]
  assert.equal(incident.id, '7')
  assert.equal(incident.status, 'investigating')
  assert.equal(incident.severity, 'degraded')
  assert.equal(incident.active, true)
  return null
})

await test('normalizeItem decodes entities in title, link and body', async () => {
  // Raw strings go through rssItem(), which XML-escapes them the way a publisher
  // would; normalizeItem must decode the escaping exactly once.
  const item = rssItem({
    id: '5',
    title: 'DeepSeek API & 网页 性能下降（Degraded Performance & Slowness）',
    status: 'identified',
    components: ['搜索服务(Search Service)'],
    body: '影响 API 与网页，A & B',
  })
  const incident = feed.normalizeItem(item.slice('<item>'.length, -'</item>'.length), 'rss')
  assert.equal(incident.title, 'DeepSeek API & 网页 性能下降（Degraded Performance & Slowness）')
  assert.equal(incident.link, 'https://status.deepseek.com/incidents/5')
  assert.equal(incident.guid, 'urn:flashduty:change:5')
  assert.equal(incident.status, 'identified')
  assert.equal(incident.severity, 'degraded')
  assert.equal(incident.active, true)
  assert.ok(incident.summary.includes('影响 API 与网页，A & B'), 'body text survives decoding')
  assert.ok(!incident.summary.includes('&amp;'), 'summary contains no undecoded entities')
  assert.deepEqual(incident.components, ['搜索服务(Search Service)'])
  return null
})

// ===========================================================================
// 4. Severity classification
// ===========================================================================

section('4. Severity classification')

await test('classifySeverity maps the feed vocabulary (outage)', async () => {
  assert.equal(feed.classifySeverity(OUTAGE_TITLE, 'investigating'), 'outage')
  assert.equal(feed.classifySeverity('DeepSeek Web/API Partially Unavailable', 'monitoring'), 'outage')
  assert.equal(feed.classifySeverity('服务不可用', 'identified'), 'outage')
  assert.equal(feed.classifySeverity('API 宕机', 'investigating'), 'outage')
  assert.equal(feed.classifySeverity('Major outage on API', 'investigating'), 'outage')
  return null
})

await test('classifySeverity maps the feed vocabulary (degraded)', async () => {
  assert.equal(feed.classifySeverity(DEGRADED_TITLE, 'investigating'), 'degraded')
  assert.equal(feed.classifySeverity(ERROR_TITLE, 'investigating'), 'degraded')
  assert.equal(feed.classifySeverity('API error rate elevated', 'identified'), 'degraded')
  assert.equal(feed.classifySeverity('API latency and slow responses', 'monitoring'), 'degraded')
  return null
})

await test('classifySeverity maps maintenance and unknown titles', async () => {
  assert.equal(feed.classifySeverity('计划维护（Scheduled Maintenance）', 'monitoring'), 'maintenance')
  assert.equal(feed.classifySeverity('Planned maintenance window', 'monitoring'), 'maintenance')
  assert.equal(feed.classifySeverity('Service notice', 'monitoring'), 'info')
  assert.equal(feed.classifySeverity('', 'monitoring'), 'info')
  return null
})

await test('classifySeverity returns recovery for any resolved incident', async () => {
  assert.equal(feed.classifySeverity(OUTAGE_TITLE, 'resolved'), 'recovery')
  assert.equal(feed.classifySeverity(DEGRADED_TITLE, 'resolved'), 'recovery')
  assert.equal(feed.classifySeverity('维护', 'resolved'), 'recovery')
  return null
})

await test('isActiveStatus treats every non-resolved status as active', async () => {
  assert.equal(feed.isActiveStatus('resolved'), false)
  assert.equal(feed.isActiveStatus('investigating'), true)
  assert.equal(feed.isActiveStatus('identified'), true)
  assert.equal(feed.isActiveStatus('monitoring'), true)
  assert.equal(feed.isActiveStatus('unknown'), true)
  return null
})

// ===========================================================================
// 5. latestIncidents / activeIncidents / healthOf
// ===========================================================================

section('5. Dedupe, active set and health')

await test('latestIncidents keeps the newest item per id and sorts newest first', async () => {
  const older = makeIncident({ id: '1', status: 'investigating', severity: 'outage', updatedAt: T0 })
  const newer = makeIncident({ id: '1', status: 'resolved', severity: 'recovery', updatedAt: T0 + 60000 })
  const other = makeIncident({ id: '2', status: 'monitoring', severity: 'degraded', updatedAt: T0 + 30000 })
  const input = [older, other, newer]
  const latest = feed.latestIncidents(input)
  assert.deepEqual(latest.map((incident) => incident.id), ['1', '2'])
  assert.equal(latest[0].status, 'resolved', 'newest wins regardless of input order')
  assert.equal(latest[1].id, '2')
  assert.equal(input.length, 3, 'input array is not mutated')
  assert.equal(input[0], older, 'input object identity preserved')
  return null
})

await test('activeIncidents keeps only unresolved incidents', async () => {
  const incidents = [
    makeIncident({ id: '1', status: 'investigating', severity: 'outage' }),
    makeIncident({ id: '2', status: 'resolved', severity: 'recovery' }),
    makeIncident({ id: '3', status: 'unknown', severity: 'info' }),
    makeIncident({ id: '4', status: 'monitoring', severity: 'maintenance' }),
  ]
  const active = feed.activeIncidents(incidents)
  assert.deepEqual(active.map((incident) => incident.id), ['1', '3', '4'])
  assert.deepEqual(feed.activeIncidents([]), [])
  assert.deepEqual(feed.activeIncidents(incidents.filter((incident) => !incident.active)), [])
  return null
})

await test('healthOf: no incidents or all resolved is ok', async () => {
  assert.equal(feed.healthOf([]), 'ok')
  assert.equal(
    feed.healthOf([makeIncident({ id: '1', status: 'resolved', severity: 'recovery' })]),
    'ok',
  )
  return null
})

await test('healthOf: outage > degraded > ok', async () => {
  const degraded = makeIncident({ id: '1', status: 'monitoring', severity: 'degraded' })
  const maintenance = makeIncident({ id: '2', status: 'monitoring', severity: 'maintenance' })
  const outage = makeIncident({ id: '3', status: 'investigating', severity: 'outage' })
  assert.equal(feed.healthOf([degraded]), 'degraded')
  assert.equal(feed.healthOf([maintenance]), 'degraded')
  assert.equal(feed.healthOf([degraded, maintenance]), 'degraded')
  assert.equal(feed.healthOf([degraded, outage]), 'outage')
  assert.equal(feed.healthOf([outage, degraded]), 'outage')
  assert.equal(feed.healthOf([makeIncident({ id: '9', status: 'resolved', severity: 'recovery' }), degraded]), 'degraded')
  return null
})

// ===========================================================================
// 6. seedBaselines + deriveEvents state machine
// ===========================================================================

section('6. Transition state machine (seedBaselines + deriveEvents)')

await test('first observation is silent (history produces no events)', async () => {
  const incidents = [
    makeIncident({ id: 'a', status: 'investigating', severity: 'outage' }),
    makeIncident({ id: 'b', status: 'resolved', severity: 'recovery' }),
  ]
  const baselines = feed.seedBaselines(incidents)
  assert.ok(baselines instanceof Map)
  assert.equal(baselines.size, 2)
  for (const incident of incidents) {
    assert.deepEqual(baselines.get(incident.id), {
      id: incident.id,
      status: incident.status,
      severity: incident.severity,
      updatedAt: incident.updatedAt,
      active: incident.active,
    })
  }
  const derived = feed.deriveEvents(baselines, incidents)
  assert.deepEqual(derived.events, [], 'seeded incidents are history and stay silent')
  assert.equal(derived.baselines.size, 2)
  return null
})

await test('active -> resolved emits one recovery event', async () => {
  const before = feed.seedBaselines([
    makeIncident({ id: 'a', status: 'investigating', severity: 'outage', updatedAt: T0 }),
  ])
  const after = [makeIncident({ id: 'a', status: 'resolved', severity: 'recovery', updatedAt: T0 + 60000 })]
  const { events, baselines } = feed.deriveEvents(before, after)
  assert.equal(events.length, 1)
  const [event] = events
  assert.deepEqual(Object.keys(event).sort(), [
    'at',
    'incidentId',
    'key',
    'kind',
    'link',
    'severity',
    'status',
    'title',
  ])
  assert.equal(event.kind, 'recovery')
  assert.equal(event.incidentId, 'a')
  assert.equal(event.status, 'resolved')
  assert.equal(event.severity, 'recovery')
  assert.equal(event.at, T0 + 60000)
  assert.equal(event.title, OUTAGE_TITLE)
  assert.equal(event.link, 'https://status.deepseek.com/incidents/a')
  assert.equal(event.key, `a:resolved:${T0 + 60000}`)
  assert.equal(baselines.get('a').status, 'resolved')
  return null
})

await test('a brand new active incident emits its severity', async () => {
  const after = [makeIncident({ id: 'new', status: 'investigating', severity: 'outage', updatedAt: T0 + 1 })]
  const { events } = feed.deriveEvents(new Map(), after)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'outage')
  assert.equal(events[0].incidentId, 'new')
  assert.equal(events[0].status, 'investigating')
  return null
})

await test('unchanged poll emits no events and does not mutate the baseline map', async () => {
  const incidents = [
    makeIncident({ id: 'a', status: 'investigating', severity: 'outage' }),
    makeIncident({ id: 'b', status: 'resolved', severity: 'recovery' }),
  ]
  const baselines = feed.seedBaselines(incidents)
  const snapshot = new Map(baselines)
  const first = feed.deriveEvents(baselines, incidents)
  assert.deepEqual(first.events, [])
  const second = feed.deriveEvents(first.baselines, incidents)
  assert.deepEqual(second.events, [])
  assert.equal(baselines.size, snapshot.size)
  for (const [id, baseline] of snapshot) assert.deepEqual(baselines.get(id), baseline, 'previous map is untouched')
  return null
})

await test('severity change while active emits the new severity', async () => {
  const before = feed.seedBaselines([
    makeIncident({ id: 'a', status: 'investigating', severity: 'degraded', updatedAt: T0 }),
  ])
  const after = [
    makeIncident({
      id: 'a',
      status: 'investigating',
      severity: 'outage',
      title: OUTAGE_TITLE,
      updatedAt: T0 + 60000,
    }),
  ]
  const { events } = feed.deriveEvents(before, after)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'outage')
  assert.equal(events[0].severity, 'outage')
  assert.equal(events[0].status, 'investigating')
  return null
})

await test('status-only change while active stays silent (no duplicate notice)', async () => {
  // Product decision (Lead, after review): investigating -> identified ->
  // monitoring is the same service impact, so it must not re-announce the
  // incident. Only a severity change, a reopen or a resolution is a transition.
  const before = feed.seedBaselines([
    makeIncident({ id: 'a', status: 'investigating', severity: 'outage', updatedAt: T0 }),
  ])
  const after = [
    makeIncident({ id: 'a', status: 'identified', severity: 'outage', updatedAt: T0 + 60000 }),
  ]
  const { events } = feed.deriveEvents(before, after)
  assert.deepEqual(events, [], 'a status-text advance with the same severity is not a new notice')
  return null
})

await test('resolved -> active reopen emits the new severity', async () => {
  const before = feed.seedBaselines([
    makeIncident({ id: 'a', status: 'resolved', severity: 'recovery', updatedAt: T0 }),
  ])
  const after = [
    makeIncident({ id: 'a', status: 'investigating', severity: 'outage', updatedAt: T0 + 60000 }),
  ]
  const { events } = feed.deriveEvents(before, after)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'outage')
  assert.equal(events[0].status, 'investigating')
  return null
})

await test('never-seen incident that is already resolved stays silent', async () => {
  const after = [makeIncident({ id: 'old', status: 'resolved', severity: 'recovery', updatedAt: T0 })]
  const { events } = feed.deriveEvents(new Map(), after)
  assert.deepEqual(events, [])
  return null
})

await test('never-seen unknown-status incident is active and emits its severity', async () => {
  const after = [makeIncident({ id: 'odd', status: 'unknown', severity: 'info', updatedAt: T0 })]
  const { events } = feed.deriveEvents(new Map(), after)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'info')
  assert.equal(events[0].status, 'unknown')
  return null
})

await test('mixed batch emits exactly the transitions, in incident order', async () => {
  const before = feed.seedBaselines([
    makeIncident({ id: 'a', status: 'investigating', severity: 'outage', updatedAt: T0 }),
    makeIncident({ id: 'b', status: 'investigating', severity: 'degraded', updatedAt: T0 }),
  ])
  const after = [
    makeIncident({ id: 'a', status: 'resolved', severity: 'recovery', updatedAt: T0 + 1000 }),
    makeIncident({ id: 'b', status: 'monitoring', severity: 'outage', title: OUTAGE_TITLE, updatedAt: T0 + 1000 }),
    makeIncident({ id: 'c', status: 'investigating', severity: 'degraded', updatedAt: T0 + 1000 }),
  ]
  const { events, baselines } = feed.deriveEvents(before, after)
  assert.equal(events.length, 3)
  assert.deepEqual(events.map((event) => event.kind), ['recovery', 'outage', 'degraded'])
  assert.deepEqual(events.map((event) => event.incidentId), ['a', 'b', 'c'])
  assert.equal(baselines.size, 3)
  return null
})

await test('an incident removed from the feed produces no event and leaves the baseline', async () => {
  const before = feed.seedBaselines([makeIncident({ id: 'gone', status: 'investigating', severity: 'outage' })])
  const { events, baselines } = feed.deriveEvents(before, [])
  assert.deepEqual(events, [])
  assert.equal(baselines.size, 0, 'current code drops baselines for incidents missing from the feed')
  return null
})

await test('regression DEFECT-1 - an updatedAt-only change does not re-announce an active incident', async () => {
  // The live feed really produces this: RSS pubDate and Atom updated differ for
  // every incident, so one configured-feed failure switches to the fallback and
  // re-observes the same incidents with new timestamps. A timestamp-only change
  // must not become a duplicate notice (fixed in lib/feed.js sameBaseline +
  // deriveEvents, see test/report.md DEFECT-1).
  const before = feed.seedBaselines([
    makeIncident({ id: 'a', status: 'investigating', severity: 'outage', updatedAt: T0 }),
  ])
  const after = [
    makeIncident({ id: 'a', status: 'investigating', severity: 'outage', updatedAt: T0 + 5_400_000 }),
  ]
  const { events } = feed.deriveEvents(before, after)
  assert.deepEqual(
    events,
    [],
    'same status and severity but a different feed timestamp must not be announced as a transition',
  )
  return null
})

// ===========================================================================
// 7. appendEvents ledger
// ===========================================================================

section('7. Event ledger (appendEvents)')

await test('appendEvents dedupes by key, incoming wins, newest first', async () => {
  const existing = [
    { key: 'k1', at: 10, kind: 'outage' },
    { key: 'k2', at: 20, kind: 'degraded' },
  ]
  const incoming = [
    { key: 'k1', at: 10, kind: 'recovery' },
    { key: 'k3', at: 30, kind: 'outage' },
  ]
  const merged = feed.appendEvents(existing, incoming)
  assert.equal(merged.length, 3)
  assert.deepEqual(merged.map((event) => event.key), ['k3', 'k2', 'k1'])
  assert.equal(merged.find((event) => event.key === 'k1').kind, 'recovery', 'incoming value replaces the old one')
  assert.equal(existing.length, 2, 'existing input is not mutated')
  assert.equal(incoming.length, 2, 'incoming input is not mutated')
  return null
})

await test('appendEvents defaults to a 40-entry cap and honours an explicit limit', async () => {
  const events = Array.from({ length: 50 }, (_unused, index) => ({ key: `k${index}`, at: index }))
  const capped = feed.appendEvents([], events)
  assert.equal(capped.length, 40)
  assert.equal(capped[0].at, 49)
  assert.equal(capped.at(-1).at, 10)
  const limited = feed.appendEvents([], events, 3)
  assert.deepEqual(limited.map((event) => event.at), [49, 48, 47])
  return null
})

// ===========================================================================
// 8. Malformed and empty documents
// ===========================================================================

section('8. Malformed and empty documents')

await test('parseFeed rejects empty documents and documents without items', async () => {
  assert.throws(() => feed.parseFeed(''), /empty feed/)
  assert.throws(() => feed.parseFeed('   \n  '), /empty feed/)
  assert.throws(() => feed.parseFeed(undefined), /empty feed/)
  assert.throws(() => feed.parseFeed('<rss version="2.0"><channel></channel></rss>'), /no items/)
  assert.throws(() => feed.parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'), /no items/)
  assert.throws(() => feed.parseFeed('this is not xml at all'), /no items/)
  assert.throws(() => feed.parseFeed('<rss><channel><item><title>x</title></item>'), /no items/, 'unclosed item is not a match')
  return null
})

await test('parseFeed skips items without id or title but keeps valid ones', async () => {
  const doc = rssDocument([
    rssItem({ id: '77', title: 'DeepSeek API 中断', status: 'resolved' }),
    rssItem({ id: '78', title: '', status: 'resolved' }),
    rssItem({ id: '79', title: 'No guid or link item', link: null, guid: null, status: 'resolved' }),
  ])
  const parsed = feed.parseFeed(doc)
  assert.equal(parsed.incidents.length, 1)
  assert.equal(parsed.incidents[0].id, '77')
  return null
})

await test('parseFeed tolerates unknown elements and uses the dc:date fallback', async () => {
  const doc = `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>DeepSeek</title><item><title>DeepSeek API 中断</title><link>https://status.deepseek.com/incidents/9</link><guid>urn:flashduty:change:9</guid><description>&lt;p&gt;&lt;strong&gt;Status:&lt;/strong&gt; resolved&lt;/p&gt;</description><dc:date>2026-10-01T10:00:00+08:00</dc:date><unknown>ignored</unknown></item></channel></rss>`
  const incident = feed.parseFeed(doc).incidents[0]
  assert.equal(incident.id, '9')
  assert.equal(incident.updatedAt, Date.parse('2026-10-01T10:00:00+08:00'))
  return null
})

await test('parseFeed returns an empty-able TS list shape and stable module constants', async () => {
  assert.deepEqual(feed.DEFAULT_FEEDS, [LIVE_RSS, LIVE_ATOM])
  assert.equal(feed.RESOLVED, 'resolved')
  assert.equal(feed.UNKNOWN, 'unknown')
  return null
})

// ===========================================================================
// 9. index.js host wiring (mock webServer + mock fetch)
// ===========================================================================

section('9. index.js host wiring (mock webServer + mock fetch)')

await test('cold start: route contract, silent seed, interval caching', async () => {
  const net = installFetch(() =>
    fakeResponse(rssDocument([rssItem({ id: '9001', title: OUTAGE_TITLE, status: 'investigating' })]), LIVE_RSS),
  )
  let plugin
  try {
    plugin = mountPlugin(undefined)
    assert.deepEqual(plugin.services, ['webServer'])
    assert.deepEqual(
      plugin.effects,
      ['deepseek-status: state route', 'deepseek-status: warm-up fetch'],
      'route and warm-up effects are registered',
    )
    assert.equal(plugin.timers.length, 1, 'one warm-up timer')
    assert.equal(plugin.timers[0].delay, 250)
    assert.equal(typeof plugin.timers[0].callback, 'function')

    const res = await callRoute(plugin, { url: ROUTE_PATH })
    assert.equal(res.statusCode, 200)
    const body = parseBody(res)
    assert.equal(body.ok, true)
    assert.equal(body.version, 1)
    assert.equal(body.health, 'outage')
    assert.equal(body.format, 'rss')
    assert.equal(body.source, LIVE_RSS)
    assert.equal(body.error, null)
    assert.equal(body.incidents.length, 1)
    assert.equal(body.active.length, 1)
    assert.deepEqual(body.events, [], 'first observation is seeded silently')
    assert.deepEqual(body.defaults, { feedUrl: LIVE_RSS, refreshIntervalSeconds: 60, topOffsetPx: 90 })
    assert.ok(body.fetchedAt > 0 && body.checkedAt > 0 && body.serverTime > 0)
    assert.equal(net.calls.length, 1)

    const cached = await callRoute(plugin, { url: `${ROUTE_PATH}?interval=60` })
    assert.equal(net.calls.length, 1, 'a poll inside the refresh window does not hit the network')
    assert.equal(parseBody(cached).incidents[0].id, '9001')
  } finally {
    plugin?.dispose()
    net.restore()
  }
})

await test('force polling: 1s gap, recovery event, ledger and logger', async () => {
  let currentDoc = rssDocument([rssItem({ id: '9001', title: OUTAGE_TITLE, status: 'investigating' })])
  const net = installFetch(() => fakeResponse(currentDoc, LIVE_RSS))
  const clock = installClock()
  let plugin
  try {
    plugin = mountPlugin(undefined)
    await callRoute(plugin, { url: ROUTE_PATH })
    assert.equal(net.calls.length, 1)

    clock.advance(100)
    await callRoute(plugin, { url: `${ROUTE_PATH}?force=1` })
    assert.equal(net.calls.length, 1, 'MIN_FORCE_GAP_MS blocks a force poll less than 1s after the last attempt')

    currentDoc = rssDocument([
      rssItem({
        id: '9001',
        title: OUTAGE_TITLE,
        status: 'resolved',
        pubDate: 'Sat, 07 Nov 2026 15:30:00 +0800',
      }),
    ])
    clock.advance(1400)
    const afterRecovery = parseBody(await callRoute(plugin, { url: `${ROUTE_PATH}?force=1` }))
    assert.equal(net.calls.length, 2)
    assert.equal(afterRecovery.ok, true)
    assert.equal(afterRecovery.health, 'ok')
    assert.deepEqual(afterRecovery.active, [])
    assert.equal(afterRecovery.events.length, 1)
    assert.equal(afterRecovery.events[0].kind, 'recovery')
    assert.equal(afterRecovery.events[0].incidentId, '9001')
    assert.equal(afterRecovery.events[0].status, 'resolved')
    assert.ok(
      plugin.logs.some((line) => line.includes('status change: recovery 9001')),
      'the host logs the observed transition',
    )

    await callRoute(plugin, { url: ROUTE_PATH })
    assert.equal(net.calls.length, 2, 'normal poll is still cached')

    clock.advance(61000)
    const later = parseBody(await callRoute(plugin, { url: ROUTE_PATH }))
    assert.equal(net.calls.length, 3, 'the refresh window expires after the interval')
    assert.equal(later.events.length, 1, 'an unchanged poll does not duplicate the recovery event')
    assert.deepEqual(later.events.map((event) => event.kind), ['recovery'])
  } finally {
    plugin?.dispose()
    clock.restore()
    net.restore()
  }
})

await test('upstream failure keeps the last snapshot, sets ok=false and the error', async () => {
  const doc = rssDocument([rssItem({ id: '9001', title: OUTAGE_TITLE, status: 'investigating' })])
  const net = installFetch((_url, _init, callNumber) => {
    if (callNumber === 1) return fakeResponse(doc, LIVE_RSS)
    throw new Error('boom')
  })
  const clock = installClock()
  let plugin
  try {
    plugin = mountPlugin(undefined)
    await callRoute(plugin, { url: ROUTE_PATH })
    clock.advance(1500)
    const failed = parseBody(await callRoute(plugin, { url: `${ROUTE_PATH}?force=1` }))
    assert.equal(net.calls.length, 3, 'primary feed + alternate feed are both attempted')
    assert.equal(failed.ok, false)
    assert.match(failed.error, /boom/)
    assert.equal(failed.health, 'outage', 'stale health is preserved during an outage')
    assert.equal(failed.incidents.length, 1, 'stale incidents are preserved')
    assert.equal(failed.active.length, 1)
    assert.deepEqual(failed.events, [])
    assert.equal(failed.format, 'rss')
    assert.equal(failed.source, LIVE_RSS)
    assert.ok(plugin.logs.some((line) => line.includes('feed refresh failed')), 'failure is logged')
  } finally {
    plugin?.dispose()
    clock.restore()
    net.restore()
  }
})

await test('configured RSS feed failure falls back to the Atom feed', async () => {
  const atom = atomDocument([atomEntry({ id: '9001', title: OUTAGE_TITLE, status: 'investigating' })])
  const net = installFetch((url) => {
    if (url === LIVE_RSS) throw new Error('primary down')
    if (url === LIVE_ATOM) return fakeResponse(atom, LIVE_ATOM, { contentType: 'application/atom+xml; charset=utf-8' })
    throw new Error(`unexpected url ${url}`)
  })
  let plugin
  try {
    plugin = mountPlugin(undefined)
    const body = parseBody(await callRoute(plugin, { url: ROUTE_PATH }))
    assert.deepEqual(net.calls, [LIVE_RSS, LIVE_ATOM])
    assert.equal(body.ok, true)
    assert.equal(body.format, 'atom')
    assert.equal(body.source, LIVE_ATOM)
    assert.equal(body.incidents[0].id, '9001')
    assert.equal(body.health, 'outage')
  } finally {
    plugin?.dispose()
    net.restore()
  }
})

await test('config is clamped and defaults are reported', async () => {
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
      noticeTopOffsetPx: -5,
      demo: 'nope',
    })
    const body = parseBody(await callRoute(plugin, { url: ROUTE_PATH }))
    assert.deepEqual(body.defaults, { feedUrl: LIVE_RSS, refreshIntervalSeconds: 15, topOffsetPx: 0 })
    assert.equal(body.demo, false, 'an unknown demo mode is ignored')
    assert.equal(net.calls.length, 1)
    assert.equal(net.calls[0], LIVE_RSS)
    assert.equal(body.incidents.length, 3, 'maxIncidents is clamped up to the minimum of 3')
  } finally {
    plugin?.dispose()
    net.restore()
  }
})

await test('route rejects non-GET methods without fetching and supports HEAD', async () => {
  const net = installFetch(() =>
    fakeResponse(rssDocument([rssItem({ id: '9001', title: OUTAGE_TITLE, status: 'resolved' })]), LIVE_RSS),
  )
  let plugin
  try {
    plugin = mountPlugin(undefined)
    const rejected = await callRoute(plugin, { method: 'POST', url: ROUTE_PATH })
    assert.equal(rejected.statusCode, 405)
    assert.equal(rejected.headers.allow, 'GET, HEAD')
    assert.equal(net.calls.length, 0, 'method rejection happens before the network')

    const head = await callRoute(plugin, { method: 'HEAD', url: ROUTE_PATH })
    assert.equal(head.statusCode, 200)
    assert.equal(head.body, '', 'HEAD returns no body')
    assert.match(String(head.headers['content-type']), /application\/json/)
    assert.equal(net.calls.length, 1, 'HEAD still refreshes the snapshot')

    const get = await callRoute(plugin, { url: ROUTE_PATH })
    assert.equal(net.calls.length, 1, 'subsequent GET is served from the cached snapshot')
    const body = parseBody(get)
    assert.equal(Number(get.headers['content-length']), Buffer.byteLength(get.body))
    assert.equal(get.headers['cache-control'], 'no-store')
    assert.equal(get.headers['x-content-type-options'], 'nosniff')
    assert.equal(body.ok, true)
  } finally {
    plugin?.dispose()
    net.restore()
  }
})

await test('warm-up timer pre-fetches the snapshot before the first browser poll', async () => {
  const net = installFetch(() =>
    fakeResponse(rssDocument([rssItem({ id: '9001', title: 'DeepSeek API 性能下降', status: 'monitoring' })]), LIVE_RSS),
  )
  let plugin
  try {
    plugin = mountPlugin(undefined)
    assert.equal(plugin.timers.length, 1)
    plugin.timers[0].callback()
    await waitFor(() => net.calls.length === 1)
    const body = parseBody(await callRoute(plugin, { url: ROUTE_PATH }))
    assert.equal(body.ok, true)
    assert.ok(body.fetchedAt > 0, 'warm-up populated the snapshot')
    assert.equal(body.health, 'degraded')
    assert.equal(net.calls.length, 1, 'the first poll reuses the warm-up snapshot')
  } finally {
    plugin?.dispose()
    net.restore()
  }
})

// ---------------------------------------------------------------------------

reportSummary()
