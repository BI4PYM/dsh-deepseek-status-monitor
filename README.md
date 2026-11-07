# DeepSeek status — a DeepSeek Harness plugin

Periodically reads the DeepSeek service status feed
([RSS](https://status.deepseek.com/feed.rss) or
[Atom](https://status.deepseek.com/feed.atom)) and shows a short, configurable
notice in the Harness Web UI when the service is interrupted, degraded, or has
recovered. Clicking the notice opens the details: current health, ongoing
incidents, recent changes, affected components, links to the status page, and
the notification settings.

## What it does

- **Host half** (`index.js`, `lib/feed.js`) polls the feed over the network,
  parses RSS/Atom without dependencies, and keeps a normalized snapshot and a
  small transition ledger in memory. It serves the snapshot on a same-origin
  route (`GET /__dsh-deepseek-status/state`) and triggers a network check only
  when the browser asks for it and the configured interval has elapsed.
- **Browser half** (`client.js`) renders the notice in the frame-wide
  `shell.overlay` slot and a settings page in the Settings → Plugins tabs. No
  Harness Client package is imported, and every color is a `--dsw-alias-*`
  theme token.

Notification triggers:

| Transition | Notice |
| --- | --- |
| New/reopened incident, title says 中断 / unavailable / outage | Service outage (red) |
| New/reopened incident, title says 性能下降 / degraded / 异常 / error | Degraded performance (amber) |
| Incident status changes to `resolved` | Service recovered (green) |
| Feed (or the Host route) unreachable for more than 10 minutes | Status check failed (amber) |

Historical incidents already in the feed at startup are treated as history and
do not raise a notice; an incident that is still unresolved at startup shows as
an ongoing notice until it resolves.

## Configuration

The bundle row in `cordis.patch.yml` accepts:

| Key | Default | Meaning |
| --- | --- | --- |
| `feedUrl` | `https://status.deepseek.com/feed.rss` | Feed to read. When it fails, the matching Atom/RSS URL is tried automatically. |
| `refreshIntervalSeconds` | `60` | Default minimum interval between network checks (15–3600). |
| `requestTimeoutMs` | `10000` | Per-request timeout. |
| `maxIncidents` | `20` | Incidents kept in the response. |
| `noticeTopOffsetPx` | `90` | How far below the frame top the top-anchored notices start (normally just below the session header, 0–400). Tune it if a future Harness layout changes the header height. |
| `demo` | `false` | Appearance demo: `positions` cycles every form and position, `sizes` cycles small/medium/large for bubble, banner and pill. Development aid; does not touch real status or saved settings. |

### In-app settings

Settings → **Built-in plugins (内置插件)** → **DeepSeek 状态 / DeepSeek status**
tab, or the settings section inside the notice's detail panel:

- form: bubble / banner / pill (气泡、横幅、胶囊)
- position: six corners for bubble and pill, top/bottom for banner. Positions are
  anchored to the conversation content column (the sidebar width and an open
  right panel are excluded), top positions start below the session header, and
  the notice is painted below the header dropdown menus and dialogs
- size: small / medium / large (applies to bubble, banner and pill, including
  the persistent status pill)
- check interval in seconds
- auto-hide after N seconds (`0` = keep until dismissed; ongoing incidents, the
  persistent pill and failed-check notices never auto-hide)
- which event kinds notify (outage, degradation/maintenance, recovery, failed checks)
- persistent status pill: always shows the current state (green = healthy,
  amber = degraded, red = outage) and stays visible after a notice is dismissed;
  its position is a separate setting, independent from the notice position
- "Test notice" preview and "Restore defaults"

Preferences live in the current browser's `localStorage`
(`dsh.deepseek-status.settings.v1`); dismissed notices are remembered in
`dsh.deepseek-status.dismissed.v1`. They are presentation preferences, so the
plugin does not rewrite the profile patch file for them.

## Install

From npm (once published):

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
| `test/` | Independent parser/state-machine tests (not shipped) |
| `LICENSE` | MIT license |

## Releasing

Identity is set to the npm/GitHub name **`dsh-deepseek-status-monitor`**:
`package.json` has no `private` flag, carries `repository`/`homepage`/`bugs`/
`author`/`publishConfig.access: "public"`, and the three coupled identities —
`package.json` `name`, the `window.__ModuleLoader__.load({ id })` in `client.js`,
and the row `name` in `cordis.patch.yml` — match.

Release steps:

```sh
pnpm check                       # node --check on the three entry points
node test/feed.test.mjs          # 49 parser/state-machine checks
node test/host-route.test.mjs    # 12 route tests
node test/locale-audit.mjs       # 88/88 symmetric keys
pnpm pack                        # inspect the packed file list (10 files)
pnpm publish                     # requires an authenticated npm account
```

Then create `BI4PYM/dsh-deepseek-status-monitor` on GitHub, push `main` and the
`v1.0.0` tag, and open the awesome-dsh-plugin market PR that adds the entry
(category: Notifications & Integrations) once the npm version is visible.

## Limitations

- Network access happens in the Host process with the global `fetch`. A Host
  build without `fetch` reports the failure in the payload; the browser keeps the
  last snapshot and, after the grace period, switches the indicator to the amber
  "status check failed" state instead of claiming a healthy service.
- Notice positions are anchored to the conversation content column (sidebar and
  the docked right panel are excluded). A *floating* or *fullscreen* right panel
  is not measured, so a notice can overlap it in that mode.
- Top-anchored notices start below the session header using
  `noticeTopOffsetPx` (default 90). It is a constant tuned to the current Harness
  layout; adjust the config if a future layout changes the header height.
- Transition history is in memory: restarting the Host re-seeds the baseline, so
  changes that occurred while it was stopped are not re-announced.
- The route serves public status data read-only and accepts no configuration
  writes; preferences stay in the browser.
