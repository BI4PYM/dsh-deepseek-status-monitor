# Independent verification report — DeepSeek status plugin host half

**Verifier:** feed-verifier (independent; not the author)
**Date:** 2026-11-07 (Asia/Shanghai)
**Workspace:** `E:\AI\Deepseek-Status`
**Verified artifacts:** `lib/feed.js`, `index.js`
**Not in scope:** `client.js` (being written by the Lead), locale/icon/README, live Harness profile. No plugin source file was modified by this verification; all writes are under `test\`.

**Environment.** Node: `C:\Users\minexixi\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`.
Live network from that Node: **available** — both `https://status.deepseek.com/feed.rss` and `.../feed.atom` returned HTTP 200 and were parsed in this run. The downloaded documents were frozen to fixtures so reruns are deterministic. At verification time the live feed contained only resolved historical incidents (26 items in both formats), so active/recovery cases were forced synthetically as instructed.

---

## 1. Commands and headline results

| # | Command | Total | Pass | Fail | Skip | Exit |
|---|---------|-------|------|------|------|------|
| 1 | `"C:\Users\minexixi\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" test/feed.test.mjs` | 49 | 48 | **1** | 0 | 1 |
| 2 | `"C:\Users\minexixi\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" test/host-route.test.mjs` | 9 | 9 | 0 | 0 | 0 |
| | **combined** | **58** | **57** | **1** | **0** | — |

The single failure is deliberate: it asserts the correct behavior for **DEFECT-1** below, so it stays red until the Lead fixes `lib/feed.js`. Everything else in both suites passes.

Files:

- `test/feed.test.mjs` — parser + state machine + host-wiring tests (sections 1–9).
- `test/host-route.test.mjs` — focused `index.js` route-handler tests with fake Cordis ctx, fake `fetch`, fake `IncomingMessage`/`ServerResponse`, fake clock (no Cordis packages, no browser, no network).
- `test/fixtures/feed.rss`, `test/fixtures/feed.atom` — frozen copies of the live documents fetched during this run (RSS 17,706 bytes / Atom 17,764 bytes; UTF-8).
- `test/report.md` — this file.

---

## 2. Coverage — what is explicitly passing

### 2.1 Live documents (`feed.test.mjs` §1) — PASS

- Live RSS: HTTP 200, `application/rss+xml`, `parseFeed` detects `format: "rss"`, ≥1 incident, every incident has non-empty id/title/link, ids extracted from the FlashDuty guid (not raw `urn:`), links `https://status.deepseek.com/incidents/<digits>`, status in `{resolved, investigating, identified, monitoring, unknown}`, timestamps parsed and plausible, summary has no HTML/entities, components populated, `active` consistent with status, list sorted newest-first. **PASS**
- Live Atom: same checks; `format: "atom"`, entry `link href` and `<id>` guid handled. **PASS**

### 2.2 Frozen fixtures (`feed.test.mjs` §2) — PASS

- RSS fixture: 26 items; top incident `7219383236287`, exact title/link/guid, `status: resolved`, `severity: recovery`, `active: false`, `updatedAt = Date.parse("Sat, 07 Nov 2026 15:11:38 +0800")`, exact 4 components, exact plain-text summary. **PASS**
- Atom fixture: 26 entries; same top incident; `updatedAt = Date.parse("2026-11-07T15:56:50+08:00")`; same summary. **PASS**
- Every RSS fixture item: numeric id, link/guid consistent, no HTML or undecoded entities in summary, ≥1 component. **PASS**
- Cross-format: identical id set, and identical title/link/guid/status/severity/active/summary/components for every incident. **PASS**
- Observation asserted: per-incident timestamps differ between the two published formats for **26/26** incidents (`RSS pubDate` vs `Atom updated`) — this is feed data, and it is the real-world trigger for DEFECT-1. **PASS**

### 2.3 Entities / CDATA / text (`feed.test.mjs` §3) — PASS

- `htmlToText`: named (`&amp; &lt; &gt; &quot; &apos; &nbsp;`), decimal (`&#25991;`), hex (`&#x4E2D;`) decoding; invalid code point dropped without throwing; tags/`<br>`/block tags converted to collapsed plain text. **PASS**
- `parseStatus`: explicit `<strong>Status:</strong>` in lower/upper case and with padding, escaped-HTML description bodies; fallback to resolved wording in the description; title-only `已解决`; otherwise `unknown`. **PASS**
- `parseComponents`: `,` and `、` splitting, trimming, trailing-empty filtering, entity-decoded component names, missing component line → `[]`. **PASS**
- CDATA: RSS `<![CDATA[...]]>` title/description and Atom CDATA `<summary>` parse correctly (title, status, severity, components, summary). **PASS**
- `normalizeItem`: title/link/guid/body entity decoding exactly once; severity/active derived correctly. **PASS**

### 2.4 Severity classification (`feed.test.mjs` §4) — PASS

- Outage: `中断`, `部分中断/Partially Unavailable`, `不可用`, `宕机`, `Major outage` → `outage`. **PASS**
- Degraded: `性能下降`, `服务异常/Search service error`, `error rate`, `latency/slow` → `degraded`. **PASS**
- Maintenance: `计划维护/Scheduled Maintenance`, `Planned maintenance` → `maintenance`. **PASS**
- Unrecognized title → `info`; any resolved incident → `recovery` regardless of title. **PASS**
- `isActiveStatus`: only `resolved` is inactive; `investigating/identified/monitoring/unknown` are active. **PASS**

### 2.5 Dedupe / active set / health (`feed.test.mjs` §5) — PASS

- `latestIncidents`: newest wins per id regardless of input order, sorted newest-first, input array/objects not mutated. **PASS**
- `activeIncidents`: drops only resolved; includes unknown and maintenance; empty cases. **PASS**
- `healthOf`: `[]` and all-resolved → `ok`; degraded/maintenance → `degraded`; outage beats degraded → `outage`. **PASS**

### 2.6 Transition state machine (`feed.test.mjs` §6) — PASS except DEFECT-1

- Seed first observation: silent, baselines hold `{id,status,severity,updatedAt,active}`. **PASS**
- active → resolved: exactly one `recovery` event, exact shape/`key`/`at`/title/link, baseline updated. **PASS**
- New active incident → its severity event; unknown-with-info active incident → `info` event. **PASS**
- Unchanged poll → zero events; baseline map not mutated. **PASS**
- Severity change while active → new severity; status-only change while active → current severity. **PASS**
- resolved → active reopen → severity event; never-seen already-resolved incident → silent. **PASS**
- Mixed batch → exactly the transitions, in incident order; incident removed from feed → no event, baseline dropped. **PASS**
- **updatedAt-only change on an unchanged active incident → expected no event, actual 1 duplicate severity event. FAIL (DEFECT-1).**

### 2.7 Event ledger (`feed.test.mjs` §7) — PASS

- Key dedupe (incoming wins), newest-first ordering, inputs not mutated. **PASS**
- Default cap 40, explicit limit honoured, oldest dropped. **PASS**

### 2.8 Malformed/empty input (`feed.test.mjs` §8) — PASS

- `''`, whitespace, `undefined` → `empty feed`; item-less RSS/Atom and non-XML → `feed contained no items`; unclosed item not matched. **PASS**
- Items missing id or title skipped while valid items survive. **PASS**
- Unknown elements ignored; `dc:date` fallback used when `pubDate` is absent. **PASS**
- Exported constants `DEFAULT_FEEDS` (RSS then Atom), `RESOLVED`, `UNKNOWN` correct. **PASS**

### 2.9 `index.js` host wiring (`feed.test.mjs` §9, `host-route.test.mjs`) — PASS

Route contract, via fake ctx/webServer/fetch (`host-route.test.mjs` 9/9):

- Cold start GET `/__dsh-deepseek-status/state?interval=15`: HTTP 200, `application/json`, `no-store`, correct `content-length`; body `version: 1`, `ok: true`, `health: "outage"`, `format: "rss"`, `source`, `fetchedAt/checkedAt/serverTime`, `incidents`, `active` contains the unresolved incident, `events: []` (first observation is history — no startup replay), `defaults: { feedUrl: RSS, refreshIntervalSeconds: 15 }`. **PASS**
- Second poll inside the refresh window is served from cache (no second fetch); `interval=15` window expires only after >15 s. **PASS**
- Force poll (`&force=1`): swallowed when <1 s after the last attempt; after >1 s it fetches, an active→resolved change produces **exactly one** `recovery` event, health `ok`, `active: []`, transition logged via `ctx.logger.warn`; an unchanged next poll does not duplicate the event. **PASS**
- Upstream failure: still HTTP 200 with `ok: false`, non-empty `error`, previous `incidents`/`active`/`health` retained, no event; primary RSS + Atom fallback both attempted. First-ever failure: `ok: false`, empty incidents/active, `health: "unknown"`, `format: null`, `fetchedAt: 0`, non-empty error. **PASS**
- RSS endpoint failure silently falls back to the Atom document (`format: "atom"`, `source` = Atom URL). **PASS**
- Config clamping: invalid `feedUrl` → default RSS; `refreshIntervalSeconds: 5` → 15; `maxIncidents: 1` → 3. **PASS**
- Methods: `POST` → 405 + `allow: GET, HEAD` with **no** network call; `HEAD` → 200, empty body, JSON content-type, still refreshes; subsequent GET cached; security headers (`x-content-type-options: nosniff`) present. **PASS**
- Warm-up: exactly one captured 250 ms effect; running it pre-fetches the snapshot so the first poll reuses it. **PASS**

`feed.test.mjs` §9 repeats the same wiring checks in a second harness: 7/7 **PASS**.

---

## 3. Defects

### DEFECT-1 — timestamp-only change re-announces an unchanged active incident

- **Severity:** Low (duplicate notification; no data loss, no wrong health calculation).
- **Status:** OPEN — `test/feed.test.mjs` asserts the correct behavior and fails until fixed.
- **Location:** `lib/feed.js:266-272` (`sameBaseline` compares `updatedAt` in addition to `status` and `severity`); related: `lib/feed.js:255` (event `key` embeds `updatedAt`), `lib/feed.js:285-303` (`deriveEvents`).
- **Contract in the same file:** `lib/feed.js:274-283` says an event is emitted only when "an active incident changes status/severity"; the list of transitions does not include a timestamp-only change.
- **Reproduction:** `test/feed.test.mjs` → test *"DEFECT lib/feed.js:266 - an updatedAt-only change re-announces an unchanged active incident"*. Baseline: id `a`, status `investigating`, severity `outage`, `updatedAt = T0`. Observation: identical status and severity, `updatedAt = T0 + 90 min`.
- **Expected:** `events` = `[]` (no transition).
- **Actual:** one `outage` event, `key: "a:investigating:<newTimestamp>"`.
- **Real-world trigger (verified from the feed itself):** RSS and Atom publish different per-incident timestamps for all 26 current incidents (e.g. top incident `pubDate` 15:11:38 vs Atom `updated` 15:56:50, +08:00) — asserted in `feed.test.mjs` §2. `index.js:88-92` + `index.js:154-167` switch to the alternate format whenever the configured feed request fails. During an active incident, one transient RSS failure switches the source to Atom, every `updatedAt` changes, and `deriveEvents` emits a fresh severity event for every still-active incident — i.e. a duplicate notice/notification for an incident the user is already being warned about. The same happens for a description-only edit while an incident stays active.
- **Suggested direction (Lead's call; verifier does not edit plugin code):** compare only `status`/`severity` in `sameBaseline` (and/or key events by transition rather than timestamp), or explicitly document notify-on-every-update and prevent the format failover from looking like an update. Note the live feed currently contains only resolved incidents, so this is not observable on today's data; it will bite during the next real incident.

No other plugin defect was found. Every other requirement above passed.

---

## 4. Non-blocking observations (not failures)

1. **CDATA bodies are entity-decoded** even though CDATA is literal per XML (`normalizeItem` decodes the extracted CDATA text). Benign for the published feed (descriptions are escaped HTML, not CDATA), verified in `feed.test.mjs` §3.
2. **Chained-entity decoding:** `decodeEntities` applies sequential regex passes, so `&#38;lt;` becomes `<` instead of the literal `&lt;` (one-pass HTML unescape would be correct). Not reproducible with the current publisher; escaped-HTML descriptions decode correctly (verified).
3. **`activeIncidents` doc says "newest first" but only filters** (`lib/feed.js:218-221`); ordering depends on the caller. `index.js` always passes `latestIncidents()` output, so no user-visible effect.
4. **`healthOf` reports `ok` for an active incident whose title classifies as `info`** (title outside the feed's vocabulary, e.g. a neutral "service notice"). The current feed vocabulary never produces this, but such an incident would not raise the health badge.
5. **Cross-format timestamp mismatch is feed data, not a plugin bug**, but it is the trigger for DEFECT-1 and means an RSS→Atom failover can reorder incidents; the unfiltered `updatedAt` also makes dedupe/ordering format-dependent.
6. `normalizeItem` computes `const description = decodeEntities(bodyRaw)` (`lib/feed.js:166`) and never uses it — dead code only.

---

## 5. Honesty notes on what was and was not verified

- The live feed requests were performed and succeeded during this run; the result rows above are from that run. Fixtures let the suite rerun without network (`FEED_TEST_OFFLINE=1` skips the two live tests as SKIP, not failure).
- `host-route.test.mjs` exercises `index.js` through a **mocked** Cordis context and mocked `webServer.register`; it does not boot the real Harness, so the real `webServer` service contract and the browser half (`client.js`) are not verified here. No visual/browser behavior is claimed.
- No plugin source file was edited; `index.js` / `lib/feed.js` mtimes predate this verification and all writes are confined to `test\`.

---

## 6. Lead follow-up (after the review)

Both items below were fixed by the Lead in `lib/feed.js` after this report was written; the report above is kept as the verifier's original finding.

1. **DEFECT-1 fixed.** `sameBaseline` now compares `status`, `severity` and `active` only; `updatedAt` is still recorded in the baseline map (it is part of the event key) but no longer decides whether a transition happened. An RSS↔Atom failover or a description-only edit no longer re-announces an unchanged active incident. The former failing test is now the regression test *"regression DEFECT-1 - an updatedAt-only change does not re-announce an active incident"* and passes.
2. **Status-only progress is intentionally silent.** A deliberate product decision was made while fixing the above: `investigating → identified → monitoring` on an unchanged incident is the same service impact and must not produce a second notice. `deriveEvents` therefore emits only for a severity change, a reopen, a resolution, or a brand-new active incident. The test *"status-only change while active emits the current severity"* was updated to *"status-only change while active stays silent (no duplicate notice)"* with that rationale in the test comment.
3. **Accepted observations:** #1–#5 are accepted as documented; #6 (dead `description` local) was removed from `lib/feed.js`.

Test status after the fixes, same commands as above:

- `test/feed.test.mjs` → **49 total, 49 pass, 0 fail, 0 skip**
- `test/host-route.test.mjs` → **9 total, 9 pass, 0 fail, 0 skip**

