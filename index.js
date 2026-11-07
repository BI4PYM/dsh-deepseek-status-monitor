/**
 * DeepSeek status monitor — Host half.
 *
 * Polls the DeepSeek status feed (RSS by default, Atom as fallback), keeps the
 * latest normalized snapshot in memory, and answers the browser half's requests
 * on a same-origin route. The browser half renders the notice and the settings
 * page; this half owns the network, the parsing, and the transition detection.
 *
 * `demo: 'positions' | 'sizes'` in the row config is a development aid: the
 * browser half cycles through every notice form/position (or every size) with
 * sample content instead of the real snapshot. It is off by default and only
 * affects the browser rendering.
 *
 * Wire contract (GET /__dsh-deepseek-status/state?interval=<seconds>[&force=1]):
 *
 *   {
 *     ok: boolean, version: 1,
 *     health: 'ok' | 'degraded' | 'outage' | 'unknown',
 *     source: string, format: 'rss' | 'atom' | null,
 *     fetchedAt: number, checkedAt: number, error: string | null,
 *     incidents: Incident[],       // latest item per incident, newest first
 *     active: Incident[],          // unresolved subset
 *     events: StatusEvent[],       // transitions observed while running
 *     defaults: { feedUrl, refreshIntervalSeconds, topOffsetPx },
 *     demo: false | 'positions' | 'sizes',
 *     serverTime: number,
 *   }
 *
 * Where Incident is
 *   { id, title, link, status, severity, active, updatedAt, summary, components }
 * and StatusEvent is
 *   { key, kind: 'outage'|'degraded'|'maintenance'|'recovery'|'info', incidentId,
 *     title, status, severity, at, link }.
 *
 * The route serves public status data only and never mutates configuration, so
 * it needs no authentication; every UI preference lives in the browser half.
 */
import {
  DEFAULT_FEEDS,
  activeIncidents,
  appendEvents,
  deriveEvents,
  healthOf,
  latestIncidents,
  parseFeed,
  seedBaselines,
} from './lib/feed.js'

const ROUTE_PATH = '/__dsh-deepseek-status/state'
const PLUGIN_ID = 'deepseek-status'
const VERSION = 1
const DEFAULTS = {
  feedUrl: DEFAULT_FEEDS[0],
  refreshIntervalSeconds: 60,
  requestTimeoutMs: 10000,
  maxIncidents: 20,
  noticeTopOffsetPx: 90,
}
const MIN_INTERVAL_SECONDS = 15
const MAX_INTERVAL_SECONDS = 3600
const MIN_TOP_OFFSET_PX = 0
const MAX_TOP_OFFSET_PX = 400
const MIN_FORCE_GAP_MS = 1000
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024

function positiveInt(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const rounded = Math.round(parsed)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

function feedUrlOf(value) {
  if (typeof value !== 'string') return DEFAULTS.feedUrl
  const trimmed = value.trim()
  return /^https?:\/\/[^\s]+$/i.test(trimmed) ? trimmed : DEFAULTS.feedUrl
}

function readConfig(config) {
  const source = config !== null && typeof config === 'object' ? config : {}
  return {
    feedUrl: feedUrlOf(source.feedUrl),
    refreshIntervalSeconds: positiveInt(
      source.refreshIntervalSeconds,
      DEFAULTS.refreshIntervalSeconds,
      MIN_INTERVAL_SECONDS,
      MAX_INTERVAL_SECONDS,
    ),
    requestTimeoutMs: positiveInt(source.requestTimeoutMs, DEFAULTS.requestTimeoutMs, 1000, 60000),
    maxIncidents: positiveInt(source.maxIncidents, DEFAULTS.maxIncidents, 3, 100),
    // Top positions start this far below the frame top, normally just below the
    // session header (85px in the shipped layout). Configurable so a layout
    // change can be tuned without patching the plugin.
    noticeTopOffsetPx: positiveInt(
      source.noticeTopOffsetPx,
      DEFAULTS.noticeTopOffsetPx,
      MIN_TOP_OFFSET_PX,
      MAX_TOP_OFFSET_PX,
    ),
    // false | true (= 'positions') | 'positions' | 'sizes'
    demo:
      source.demo === true
        ? 'positions'
        : source.demo === 'positions' || source.demo === 'sizes'
          ? source.demo
          : false,
  }
}

/** The sibling published format of a DeepSeek-style feed URL, if derivable. */
function alternateFeed(feedUrl) {
  if (/feed\.rss$/i.test(feedUrl)) return feedUrl.replace(/feed\.rss$/i, 'feed.atom')
  if (/feed\.atom$/i.test(feedUrl)) return feedUrl.replace(/feed\.atom$/i, 'feed.rss')
  // A custom mirror/proxy URL has no known sibling: do not silently fall back
  // to the official DeepSeek feed (that would report a different service).
  return null
}

function fetchSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  return controller.signal
}

async function fetchText(url, timeoutMs) {
  if (typeof fetch !== 'function') throw new Error('this Host has no fetch implementation')
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: fetchSignal(timeoutMs),
    headers: {
      accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
      'user-agent': 'dsh-deepseek-status/1.0 (DeepSeek Harness plugin)',
    },
  })
  if (!response.ok) throw new Error(`feed responded HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(length) && length > MAX_DOCUMENT_BYTES) throw new Error('feed document is too large')
  const text = await response.text()
  if (text.length > MAX_DOCUMENT_BYTES) throw new Error('feed document is too large')
  return { text, url: response.url || url }
}

function jsonResponse(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(text)
}

function warn(ctx, message) {
  try {
    ctx.logger?.warn?.(`[${PLUGIN_ID}] ${message}`)
  } catch {
    // logging must never break the poll loop
  }
}

export function apply(ctx, config) {
  const settings = readConfig(config)

  /** Latest published snapshot; `null` until the first attempt settles. */
  let snapshot = null
  let baselines = new Map()
  let seeded = false
  let lastAttemptAt = 0
  let inFlight = null
  let consecutiveFailures = 0

  async function fetchOnce() {
    const candidates = [settings.feedUrl]
    const alternate = alternateFeed(settings.feedUrl)
    if (alternate !== null && alternate !== settings.feedUrl) candidates.push(alternate)
    let lastError = null
    for (const url of candidates) {
      try {
        const { text, url: finalUrl } = await fetchText(url, settings.requestTimeoutMs)
        const parsed = parseFeed(text)
        return { ...parsed, source: finalUrl }
      } catch (error) {
        lastError = error
      }
    }
    throw lastError ?? new Error('feed request failed')
  }

  async function refresh({ force = false, maxAgeMs = 0 } = {}) {
    const now = Date.now()
    if (inFlight !== null) return inFlight
    if (!force && maxAgeMs > 0 && snapshot !== null && now - lastAttemptAt < maxAgeMs) return snapshot
    if (force && now - lastAttemptAt < MIN_FORCE_GAP_MS) return snapshot
    inFlight = (async () => {
      lastAttemptAt = now
      try {
        const result = await fetchOnce()
        const incidents = latestIncidents(result.incidents).slice(0, settings.maxIncidents)
        if (!seeded) {
          baselines = seedBaselines(incidents)
          seeded = true
          snapshot = {
            ok: true,
            health: healthOf(incidents),
            source: result.source,
            format: result.format,
            fetchedAt: Date.now(),
            checkedAt: Date.now(),
            error: null,
            incidents,
            active: activeIncidents(incidents),
            events: snapshot?.events ?? [],
          }
        } else {
          const derived = deriveEvents(baselines, incidents)
          baselines = derived.baselines
          snapshot = {
            ok: true,
            health: healthOf(incidents),
            source: result.source,
            format: result.format,
            fetchedAt: Date.now(),
            checkedAt: Date.now(),
            error: null,
            incidents,
            active: activeIncidents(incidents),
            events: appendEvents(snapshot?.events ?? [], derived.events),
          }
          if (derived.events.length > 0) {
            for (const event of derived.events) {
              warn(ctx, `status change: ${event.kind} ${event.incidentId} (${event.title})`)
            }
          }
        }
        consecutiveFailures = 0
      } catch (error) {
        consecutiveFailures += 1
        const message = String(error?.message ?? error)
        warn(ctx, `feed refresh failed (${consecutiveFailures}x): ${message}`)
        snapshot = {
          ok: false,
          health: snapshot?.health ?? 'unknown',
          source: snapshot?.source ?? settings.feedUrl,
          format: snapshot?.format ?? null,
          fetchedAt: snapshot?.fetchedAt ?? 0,
          checkedAt: Date.now(),
          error: message,
          incidents: snapshot?.incidents ?? [],
          active: snapshot?.active ?? [],
          events: snapshot?.events ?? [],
        }
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  function stateBody() {
    const now = Date.now()
    return {
      ok: snapshot?.ok ?? false,
      version: VERSION,
      health: snapshot?.health ?? 'unknown',
      source: snapshot?.source ?? settings.feedUrl,
      format: snapshot?.format ?? null,
      fetchedAt: snapshot?.fetchedAt ?? 0,
      checkedAt: snapshot?.checkedAt ?? 0,
      error: snapshot?.error ?? null,
      incidents: snapshot?.incidents ?? [],
      active: snapshot?.active ?? [],
      events: snapshot?.events ?? [],
      defaults: {
        feedUrl: settings.feedUrl,
        refreshIntervalSeconds: settings.refreshIntervalSeconds,
        topOffsetPx: settings.noticeTopOffsetPx,
      },
      demo: settings.demo,
      serverTime: now,
    }
  }

  // The route is the polling trigger: the browser half asks with its configured
  // refresh interval, and the Host only hits the network when that window has
  // elapsed. Concurrent requests share one in-flight refresh.
  ctx.inject(['webServer'], (sub) => {
    const webServer = sub.webServer
    sub.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: ROUTE_PATH,
          handler: async (req, res) => {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              res.writeHead(405, { allow: 'GET, HEAD' })
              res.end()
              return
            }
            let interval = settings.refreshIntervalSeconds
            let force = false
            try {
              const url = new URL(req.url ?? ROUTE_PATH, 'http://localhost')
              const rawInterval = url.searchParams.get('interval')
              interval =
                rawInterval === null
                  ? settings.refreshIntervalSeconds
                  : positiveInt(
                      rawInterval,
                      settings.refreshIntervalSeconds,
                      MIN_INTERVAL_SECONDS,
                      MAX_INTERVAL_SECONDS,
                    )
              force = url.searchParams.get('force') === '1'
              if (force) {
                // A cross-site page must not be able to drive forced upstream
                // fetches through a bare <img>/<a> request. Browsers label their
                // requests; same-origin fetch sends "same-origin", a top-level
                // navigation "none", and a cross-site embedding "cross-site".
                const site = req.headers?.['sec-fetch-site']
                if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') force = false
              }
            } catch {
              // malformed query string: fall back to the configured interval
            }
            await refresh({ force, maxAgeMs: interval * 1000 })
            if (req.method === 'HEAD') {
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
              res.end()
              return
            }
            jsonResponse(res, 200, stateBody())
          },
        }),
      `${PLUGIN_ID}: state route`,
    )
  })

  // Warm the cache as soon as the plugin activates, so the first page poll has
  // data instead of waiting for a network round trip and its refresh window.
  ctx.effect(() => {
    const timer = setTimeout(() => {
      refresh({ force: true }).catch(() => {})
    }, 250)
    timer.unref?.()
    return () => clearTimeout(timer)
  }, `${PLUGIN_ID}: warm-up fetch`)
}
