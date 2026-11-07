/**
 * DeepSeek status feed parsing.
 *
 * Pure, dependency-free functions: the Host fetches the RSS/Atom document, and
 * this module turns it into a small normalized snapshot plus the events the UI
 * announces. No network, no timers, no Host services are touched here, so the
 * whole state machine can be tested with plain Node.
 *
 * The published feed (status.deepseek.com, FlashDuty-backed) has this shape:
 *
 *   RSS : <item><title/><link/><description/><guid/><pubDate/></item>
 *   Atom: <entry><title/><updated/><id/><link href/><summary type="html"/></entry>
 *
 * The description/summary is escaped HTML whose useful parts are
 * `<strong>Status:</strong> resolved` and
 * `<strong>Affected components:</strong> 对话服务(Chatservice), ...`.
 * Title carries the incident type ("部分中断", "性能下降", "搜索服务异常", ...).
 */

/** Incident statuses the feed may publish, lower-cased. */
const RESOLVED = 'resolved'

/** Default status when the feed carries no explicit `Status:` line. */
const UNKNOWN = 'unknown'

const OUTAGE_RE =
  /(中断|不可用|无法访问|无法使用|停止服务|宕机|unavailable|outage|interruption|service down|major outage|partially unavailable|down for)/i
const DEGRADED_RE =
  /(性能下降|降级|变慢|缓慢|延迟|异常|故障|报错|错误|degraded|performance|slow|latency|error|partial|elevated)/i
const MAINTENANCE_RE = /(维护|维修|planned work|maintenance|scheduled)/i

const DEFAULT_FEEDS = [
  'https://status.deepseek.com/feed.rss',
  'https://status.deepseek.com/feed.atom',
]

/** Escape-decoded text of one XML tag's inline content (CDATA aware). */
function tagContent(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const match = re.exec(xml)
  if (match === null) return ''
  const raw = match[1].trim()
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(raw)
  return cdata === null ? raw : cdata[1]
}

/** The raw inner markup of a tag, still entity-escaped (description bodies). */
function tagInner(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const match = re.exec(xml)
  if (match === null) return ''
  const raw = match[1]
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(raw.trim())
  return (cdata === null ? raw : cdata[1]).trim()
}

function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => safeCodePoint(Number(dec)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
}

function safeCodePoint(value) {
  try {
    return String.fromCodePoint(value)
  } catch {
    return ''
  }
}

/** HTML -> single-line plain text. */
export function htmlToText(html) {
  return decodeEntities(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

function firstMatch(text, re) {
  const match = re.exec(text)
  return match === null ? '' : (match[1] ?? '').trim()
}

/** `resolved | investigating | identified | monitoring | ...` in lower case. */
export function parseStatus(descriptionHtml, title) {
  const html = decodeEntities(descriptionHtml)
  const explicit = firstMatch(html, /<strong>\s*Status:\s*<\/strong>\s*([^<]*)/i)
  if (explicit !== '') return explicit.replace(/\s+/g, ' ').toLowerCase()
  const plain = htmlToText(html).toLowerCase()
  if (/\bresolved\b|已解决|已恢复|服务已恢复|service has been restored/.test(plain)) return RESOLVED
  if (/\bresolved\b|已解决|恢复/.test(String(title ?? ''))) return RESOLVED
  return UNKNOWN
}

/** Affected components, split on the feed's comma separators. */
export function parseComponents(descriptionHtml) {
  const html = decodeEntities(descriptionHtml)
  const raw = firstMatch(html, /<strong>\s*Affected components:\s*<\/strong>\s*([^<]*)/i)
  if (raw === '') return []
  return raw
    .split(/[,、]\s*/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/**
 * Incident type from its bilingual title, in the feed's own vocabulary:
 * 中断/unavailable -> outage, 性能下降/degraded -> degraded,
 * 异常/error -> degraded, 维护/maintenance -> maintenance, else info.
 */
export function classifySeverity(title, status) {
  if (status === RESOLVED) return 'recovery'
  const text = String(title ?? '')
  if (OUTAGE_RE.test(text)) return 'outage'
  if (DEGRADED_RE.test(text)) return 'degraded'
  if (MAINTENANCE_RE.test(text)) return 'maintenance'
  return 'info'
}

/** A status is "active" while it is not resolved. Unknown stays active. */
export function isActiveStatus(status) {
  return status !== RESOLVED
}

function parseDate(value) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function atomLink(entryXml) {
  const links = [...entryXml.matchAll(/<link\b([^>]*)\/?>/gi)]
  if (links.length === 0) return ''
  const alternate = links.find((match) => /rel\s*=\s*["']alternate["']/i.test(match[1]))
  const chosen = alternate ?? links[0]
  const href = /href\s*=\s*["']([^"']*)["']/i.exec(chosen[1])
  return href === null ? '' : decodeEntities(href[1])
}

/** Incident id: the FlashDuty guid (`urn:flashduty:change:<id>`) or the id/link. */
function incidentKey(guid, link) {
  const fromGuid = /urn:[^:]+:[^:]+:(\d+)/i.exec(guid)
  if (fromGuid !== null) return fromGuid[1]
  const fromLink = /\/incidents\/([^/?#]+)/i.exec(link)
  if (fromLink !== null) return fromLink[1]
  return guid !== '' ? guid : link
}

/** Normalize one feed item/entry. */
export function normalizeItem(xml, format) {
  const isAtom = format === 'atom'
  const title = decodeEntities(tagContent(xml, 'title')).replace(/\s+/g, ' ').trim()
  const link = isAtom ? atomLink(xml) : decodeEntities(tagContent(xml, 'link'))
  const guid = isAtom ? decodeEntities(tagContent(xml, 'id')) : decodeEntities(tagContent(xml, 'guid'))
  const bodyRaw = isAtom
    ? tagInner(xml, 'summary') || tagInner(xml, 'content')
    : tagInner(xml, 'description')
  const status = parseStatus(bodyRaw, title)
  const updatedAt = isAtom
    ? parseDate(tagContent(xml, 'updated') || tagContent(xml, 'published'))
    : parseDate(tagContent(xml, 'pubDate') || tagContent(xml, 'dc:date'))
  const summary = htmlToText(bodyRaw)
  return {
    id: incidentKey(guid, link),
    title,
    link,
    status,
    severity: classifySeverity(title, status),
    active: isActiveStatus(status),
    updatedAt,
    summary,
    components: parseComponents(bodyRaw),
    guid,
  }
}

/**
 * Parse an RSS or Atom document into normalized incidents, newest first.
 * Returns `{ format, incidents }`; throws only for a document with no items.
 */
export function parseFeed(xml) {
  const text = String(xml ?? '')
  if (text.trim() === '') throw new Error('empty feed')
  const isAtom = /<feed[\s>]/i.test(text)
  const itemRe = isAtom
    ? /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi
    : /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi
  const incidents = []
  for (const match of text.matchAll(itemRe)) {
    const item = normalizeItem(match[1], isAtom ? 'atom' : 'rss')
    if (item.id === '' || item.title === '') continue
    incidents.push(item)
  }
  if (incidents.length === 0) throw new Error('feed contained no items')
  incidents.sort((left, right) => right.updatedAt - left.updatedAt)
  return { format: isAtom ? 'atom' : 'rss', incidents }
}

/** Latest item per incident id, newest first. */
export function latestIncidents(incidents) {
  const byId = new Map()
  for (const incident of incidents) {
    const known = byId.get(incident.id)
    if (known === undefined || incident.updatedAt > known.updatedAt) byId.set(incident.id, incident)
  }
  return [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt)
}

/** incidents with an unresolved status, newest first. */
export function activeIncidents(incidents) {
  return incidents.filter((incident) => incident.active)
}

/** Feed-wide service health from the active incidents. */
export function healthOf(incidents) {
  let health = 'ok'
  for (const incident of activeIncidents(incidents)) {
    if (incident.severity === 'outage') return 'outage'
    if (incident.severity === 'degraded' || incident.severity === 'maintenance') health = 'degraded'
  }
  return health
}

function baselineOf(incident) {
  return {
    id: incident.id,
    status: incident.status,
    severity: incident.severity,
    updatedAt: incident.updatedAt,
    active: incident.active,
  }
}

/**
 * Create the baseline map for the first observation: known incidents produce no
 * notification, because everything already in the feed is history.
 */
export function seedBaselines(incidents) {
  const map = new Map()
  for (const incident of incidents) map.set(incident.id, baselineOf(incident))
  return map
}

function eventOf(incident, kind) {
  return {
    key: `${incident.id}:${incident.status}:${incident.updatedAt}`,
    kind,
    incidentId: incident.id,
    title: incident.title,
    status: incident.status,
    severity: incident.severity,
    at: incident.updatedAt,
    link: incident.link,
  }
}

function sameBaseline(left, right) {
  // An updatedAt-only change (the RSS and Atom documents publish different
  // timestamps for the same incident update, and a description edit moves it
  // too) is not a status transition: it must not re-announce an incident.
  return left.status === right.status && left.severity === right.severity && left.active === right.active
}

/**
 * Compare a fresh observation against the previous baselines.
 *
 * Emits an event only for a transition that changed the service impact after
 * the previous poll:
 *  - an incident becomes resolved                     -> `recovery`
 *  - a new (or reopened) incident becomes active      -> its severity
 *  - an active incident's severity changes            -> the new severity
 * An active incident whose status text advances (investigating -> identified)
 * without changing severity, and any timestamp-only change, stay silent. An
 * unknown incident that is already resolved is history and stays silent too.
 *
 * Returns `{ events, baselines }` where `baselines` is the next comparison map.
 */
export function deriveEvents(previousBaselines, incidents) {
  const events = []
  const next = new Map()
  for (const incident of incidents) {
    const current = baselineOf(incident)
    next.set(incident.id, current)
    const before = previousBaselines.get(incident.id)
    if (before === undefined) {
      if (incident.active) events.push(eventOf(incident, incident.severity))
      continue
    }
    if (sameBaseline(before, current)) continue
    if (!incident.active) {
      if (before.active) events.push(eventOf(incident, 'recovery'))
      continue
    }
    if (before.severity !== incident.severity || before.active !== true) {
      events.push(eventOf(incident, incident.severity))
    }
  }
  return { events, baselines: next }
}

/** Stable dedupe + cap for the event ledger the UI reads. */
export function appendEvents(existing, incoming, limit = 40) {
  const byKey = new Map()
  for (const event of existing) byKey.set(event.key, event)
  for (const event of incoming) byKey.set(event.key, event)
  return [...byKey.values()]
    .sort((left, right) => right.at - left.at)
    .slice(0, limit)
}

export { DEFAULT_FEEDS, RESOLVED, UNKNOWN }
