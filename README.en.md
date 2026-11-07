# DeepSeek status monitor

[![ci](https://github.com/BI4PYM/dsh-deepseek-status-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/BI4PYM/dsh-deepseek-status-monitor/actions/workflows/ci.yml)

[中文](README.md) | **English**

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) plugin that periodically reads the DeepSeek official service status feed ([RSS](https://status.deepseek.com/feed.rss) / [Atom](https://status.deepseek.com/feed.atom)) and shows configurable **outage, degradation and recovery** notices in the DSH Web UI. Click a notice for details, or keep a small persistent status pill that always shows the current health.

- Repository: <https://github.com/BI4PYM/dsh-deepseek-status-monitor>
- Install: `dsh plugin --profile <profile> add dsh-deepseek-status-monitor` (after the npm release; a local directory or `.tgz` also works)

## What it does

- **Notice forms**: bubble, banner or pill; six positions and three sizes, plus an independently positioned persistent status pill.
- **Notice content**: colored status dot + kind (outage / degraded / recovered) + incident title + relative time; ongoing incidents stay visible.
- **Click for details**: current health, ongoing incidents, recent changes, recent incident history (affected components and summary), status page link, last check time.
- **Persistent status indicator**: optional; always shows the current state (green = healthy, amber = degraded/maintenance, red = outage, amber "check failed" = cannot verify). It stays after a notice popup is dismissed, and its position is a separate setting.
- **Refresh control**: the Host reads the feed at the configured interval; the page syncs the Host cache every 10 seconds without hammering upstream.
- **Bilingual**: follows the DSH UI language and can be forced to Chinese or English in the plugin settings.
- **Resilience**: RSS falls back to Atom; when both fail the last snapshot is kept, a "status check failed" notice appears after 10 minutes and the pill turns amber instead of claiming the service is healthy.

## Notification triggers

| Change in the feed | Notice |
| --- | --- |
| A new (or reopened) unresolved incident whose title says 中断 / unavailable / outage / interruption | Service outage (red) |
| A new (or reopened) unresolved incident whose title says 性能下降 / degraded / 异常 / error | Degraded performance (amber) |
| An incident status changes to `resolved` | Service recovered (green) |
| The feed or the Host route fails for more than 10 minutes | Status check failed (amber) |

Historical incidents already in the feed at startup do not raise a notice; an incident that is still unresolved at startup shows as an ongoing notice. A status-text advance (investigating → identified → monitoring) or a timestamp-only change does not re-announce the incident.

## Configuration

The bundle row in `cordis.patch.yml` accepts:

| Key | Default | Meaning |
| --- | --- | --- |
| `feedUrl` | `https://status.deepseek.com/feed.rss` | Feed to read. The official RSS/Atom URLs fall back to their sibling; a custom mirror URL never silently falls back to the official DeepSeek feed. |
| `refreshIntervalSeconds` | `60` | Default minimum interval between network checks (15–3600). |
| `requestTimeoutMs` | `10000` | Per-request timeout. |
| `maxIncidents` | `20` | Incidents kept in the response. |
| `noticeTopOffsetPx` | `90` | How far below the frame top the top-anchored notices start (normally just below the session header, 0–400). Tune it if a future Harness layout changes the header height. |
| `demo` | `false` | Appearance demo: `positions` cycles every form and position, `sizes` cycles small/medium/large for bubble, banner and pill. Development aid; does not touch real status or saved settings. |

## In-app settings

Settings → **Built-in plugins** → **DeepSeek status** tab, or the settings section inside a notice's detail panel:

- **Display language**: Auto (follow DSH) / 中文 / English
- form: bubble / banner / pill
- position: six corners for bubble and pill, top/bottom for banner; positions are anchored to the conversation content column (sidebar and a docked right panel are excluded), top positions start below the session header
- size: small / medium / large (applies to bubble, banner, pill and the persistent pill)
- check interval in seconds (15–3600)
- auto-hide after N seconds (`0` = keep until dismissed; ongoing incidents, the persistent pill and failed-check notices never auto-hide)
- which event kinds notify (outage, degradation/maintenance, recovery, failed checks)
- persistent status pill toggle and its independent position
- "Test notice" preview and "Restore defaults"

Preferences live in the current browser's `localStorage` (`dsh.deepseek-status.settings.v1`); dismissed notices are remembered in `dsh.deepseek-status.dismissed.v1`. They are presentation preferences, so the plugin does not rewrite the profile patch file for them.

## Install

From npm (after the release):

```sh
dsh plugin --profile <profile> add dsh-deepseek-status-monitor
```

Or install this directory / a packed tarball as a bundle in the active profile:

```text
plugin_manager  action: install_bundle  target: <absolute path to this directory or .tgz>
```

The bundle patch inserts the `deepseek-status` row with the default config above.

## Layout

| File | Role |
| --- | --- |
| `package.json` | Bundle manifest, `dsh.bundle.patch`, `dsh.client`, locale/icon exports |
| `cordis.patch.yml` | Loader patch that inserts the Host row |
| `index.js` | Host half: polling, route, transition ledger |
| `lib/feed.js` | Dependency-free RSS/Atom parser, severity classifier, state machine |
| `client.js` | Browser half: overlay notice, detail panel, settings page |
| `locale/en.json`, `locale/zh.json` | Plugin Manager title/description |
| `icon.svg` | Original icon |
| `test/` | Independent tests (parser, state machine, route, locale dictionaries); not shipped to npm |
| `LICENSE` | MIT license |

## Releasing

The publish identity is **`dsh-deepseek-status-monitor`**: `package.json` has no `private` flag, carries `repository` / `homepage` / `bugs` / `author` / `publishConfig.access: "public"`, and the three coupled identities — `package.json` `name`, the `window.__ModuleLoader__.load({ id })` in `client.js`, and the row `name` in `cordis.patch.yml` — match.

```sh
pnpm check                       # node --check on the three entry points
node test/feed.test.mjs          # 49 parser/state-machine checks
node test/host-route.test.mjs    # 12 route tests
node test/locale-audit.mjs       # 88/88 symmetric keys
pnpm pack                        # inspect the packed file list (10 files)
pnpm publish                     # requires an authenticated npm account
```

Then create a GitHub release (optional) and open the awesome-dsh-plugin market PR that adds the entry (category `notify`; the repo must be at least one day old and carry the `dsh-plugin` topic).

## Limitations

- Network access happens in the Host process with the global `fetch`. A Host build without `fetch` reports the failure in the payload; the browser keeps the last snapshot and, after the grace period, switches the indicator to the amber "status check failed" state instead of claiming a healthy service.
- Notice positions are anchored to the conversation content column (sidebar and the docked right panel are excluded). A *floating* or *fullscreen* right panel is not measured, so a notice can overlap it in that mode.
- Top-anchored notices start below the session header using `noticeTopOffsetPx` (default 90). It is a constant tuned to the current Harness layout; adjust the config if a future layout changes the header height.
- Transition history is in memory: restarting the Host re-seeds the baseline, so changes that occurred while it was stopped are not re-announced.
- The route serves public status data read-only and accepts no configuration writes; preferences stay in the browser.
- This session's environment has no browser automation, so the rendered appearance was not verified by screenshots; logic and contracts are covered by tests and an independent audit.

## License

[MIT](LICENSE)
