// DeepSeek status monitor — Client half (browser module-loader package).
//
// One root-scoped `shell.overlay` occupant renders the notice and its detail
// panel; one `settings.plugins.tab` occupant renders the settings page. Both
// read the same module-local stores:
//
//   status store  - polls the Host route, shared by every mounted entry
//   settings      - presentation + notification preferences, localStorage
//   dismissed     - event keys the user closed, localStorage
//
// The Host half owns the feed network access and the transition detection; this
// file only renders. No Harness Client package is imported: React comes from
// the browser module table and every color is a `--dsw-alias-*` token.
window.__ModuleLoader__.load({
  id: 'dsh-deepseek-status-monitor',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'deepseek-status'
    const ROUTE = '/__dsh-deepseek-status/state'
    const STORAGE_KEY = 'dsh.deepseek-status.settings.v1'
    const DISMISSED_KEY = 'dsh.deepseek-status.dismissed.v1'
    const VERSION = 1
    const POLL_MS = 10000
    const PREVIEW_MS = 8000
    const CONNECTION_GRACE_MS = 10 * 60 * 1000
    const STATUS_PAGE = 'https://status.deepseek.com'

    // --- copy -----------------------------------------------------------------

    const zh = {
      'tab.label': 'DeepSeek 状态',
      'brand': 'DeepSeek 服务状态',
      'status.ok': '服务正常',
      'status.degraded': '性能下降',
      'status.outage': '服务中断',
      'status.maintenance': '服务维护中',
      'status.unknown': '状态未知',
      'kind.outage': '服务中断',
      'kind.degraded': '性能下降',
      'kind.recovery': '服务已恢复',
      'kind.maintenance': '服务维护',
      'kind.info': '服务通知',
      'kind.connection': '状态检查失败',
      'kind.idle': '服务正常',
      'kind.ok': '服务正常',
      'notice.details': '详情',
      'notice.dismiss': '关闭通知',
      'notice.open': '查看 DeepSeek 服务状态',
      'notice.ongoing': '进行中的事件',
      'notice.never': '尚未获取',
      'notice.connectionFailed': '无法获取 DeepSeek 服务状态',
      'notice.healthy': 'DeepSeek 服务正常',
      'detail.title': 'DeepSeek 服务状态',
      'detail.lastChecked': '最后检查 {time}',
      'detail.changes': '最近变化',
      'detail.active': '进行中的事件',
      'detail.recent': '最近事件记录',
      'detail.openStatus': '打开状态页',
      'detail.refresh': '立即刷新',
      'detail.settings': '通知设置',
      'detail.hideSettings': '收起设置',
      'detail.error': '上次检查失败：{error}',
      'detail.empty': '暂无服务事件记录',
      'detail.close': '收起详情',
      'detail.link': '查看详情',
      'detail.source': '数据源：{url}',
      'settings.title': '通知设置',
      'settings.description': '服务中断、性能下降或恢复时，在页面上显示一条通知。所有设置保存在当前浏览器。',
      'settings.form': '通知形式',
      'settings.form.bubble': '气泡',
      'settings.form.banner': '横幅',
      'settings.form.pill': '胶囊',
      'settings.position': '显示位置',
      'settings.position.top-left': '左上角',
      'settings.position.top-center': '顶部居中',
      'settings.position.top-right': '右上角',
      'settings.position.bottom-left': '左下角',
      'settings.position.bottom-center': '底部居中',
      'settings.position.bottom-right': '右下角',
      'settings.position.top': '顶部',
      'settings.position.bottom': '底部',
      'settings.size': '通知大小',
      'settings.size.small': '小',
      'settings.size.medium': '中',
      'settings.size.large': '大',
      'settings.refresh': '检查间隔（秒）',
      'settings.refreshHint': '每隔多少秒读取一次状态源，范围 15–3600 秒。',
      'settings.autoHide': '自动消失（秒）',
      'settings.autoHideHint': '0 表示不自动消失。进行中的事件、常驻胶囊和状态检查失败通知不会被自动关闭。',
      'settings.notify': '通知类型',
      'settings.notifyOutage': '服务中断',
      'settings.notifyDegraded': '性能下降 / 维护',
      'settings.notifyRecovery': '服务恢复',
      'settings.notifyConnection': '状态检查失败',
      'settings.showStatusPill': '常驻状态提示',
      'settings.showStatusPillHint': '始终在角落显示当前状态胶囊（绿=正常、黄=性能下降、红=中断）；关闭通知弹窗后它仍会保留。',
      'settings.statusPosition': '常驻提示位置',
      'settings.statusPositionHint': '常驻胶囊单独使用这个位置，与上面通知的位置互不影响。',
      'settings.preview': '测试通知',
      'settings.reset': '恢复默认',
      'settings.saved': '设置保存在当前浏览器，仅影响本机界面。',
      'settings.feed': '状态源：{url}',
      'settings.lastCheck': '最后检查：{time}',
      'settings.activeCount': '{count} 个进行中的事件',
      'settings.error': '检查失败：{error}',
      'preview.title': 'DeepSeek API 性能下降（示例通知）',
      'preview.summary': '这是通知样式预览，不会影响真实状态。',
      'demo.outage': 'DeepSeek 网页/API 部分中断（外观演示）',
      'demo.degraded': 'DeepSeek API 性能下降（外观演示）',
      'demo.recovery': 'DeepSeek 服务已恢复（外观演示）',
      'time.justNow': '刚刚',
      'time.minutes': '{count} 分钟前',
      'time.hours': '{count} 小时前',
      'time.days': '{count} 天前',
      'badge.active': '进行中',
      'badge.resolved': '已恢复',
      'aria.notification': 'DeepSeek 服务状态通知',
      'aria.settings': 'DeepSeek 状态通知设置',
    }

    const en = {
      'tab.label': 'DeepSeek status',
      'brand': 'DeepSeek service status',
      'status.ok': 'Operational',
      'status.degraded': 'Degraded performance',
      'status.outage': 'Service outage',
      'status.maintenance': 'Under maintenance',
      'status.unknown': 'Status unknown',
      'kind.outage': 'Service outage',
      'kind.degraded': 'Degraded performance',
      'kind.recovery': 'Service recovered',
      'kind.maintenance': 'Service maintenance',
      'kind.info': 'Service notice',
      'kind.connection': 'Status check failed',
      'kind.idle': 'Operational',
      'kind.ok': 'Operational',
      'notice.details': 'Details',
      'notice.dismiss': 'Dismiss notification',
      'notice.open': 'View DeepSeek service status',
      'notice.ongoing': 'Ongoing incident',
      'notice.never': 'not yet',
      'notice.connectionFailed': 'Cannot read the DeepSeek service status',
      'notice.healthy': 'DeepSeek service is operational',
      'detail.title': 'DeepSeek service status',
      'detail.lastChecked': 'Last checked {time}',
      'detail.changes': 'Recent changes',
      'detail.active': 'Ongoing incidents',
      'detail.recent': 'Recent incident history',
      'detail.openStatus': 'Open status page',
      'detail.refresh': 'Refresh now',
      'detail.settings': 'Notification settings',
      'detail.hideSettings': 'Hide settings',
      'detail.error': 'Last check failed: {error}',
      'detail.empty': 'No service incidents reported',
      'detail.close': 'Collapse details',
      'detail.link': 'View details',
      'detail.source': 'Source: {url}',
      'settings.title': 'Notification settings',
      'settings.description': 'Shows a notice in the page when the DeepSeek service is interrupted, degraded or recovered. Settings are stored in this browser.',
      'settings.form': 'Notice form',
      'settings.form.bubble': 'Bubble',
      'settings.form.banner': 'Banner',
      'settings.form.pill': 'Pill',
      'settings.position': 'Position',
      'settings.position.top-left': 'Top left',
      'settings.position.top-center': 'Top center',
      'settings.position.top-right': 'Top right',
      'settings.position.bottom-left': 'Bottom left',
      'settings.position.bottom-center': 'Bottom center',
      'settings.position.bottom-right': 'Bottom right',
      'settings.position.top': 'Top',
      'settings.position.bottom': 'Bottom',
      'settings.size': 'Size',
      'settings.size.small': 'Small',
      'settings.size.medium': 'Medium',
      'settings.size.large': 'Large',
      'settings.refresh': 'Check interval (seconds)',
      'settings.refreshHint': 'How often the status feed is read, between 15 and 3600 seconds.',
      'settings.autoHide': 'Auto-hide after (seconds)',
      'settings.autoHideHint': '0 keeps the notice until dismissed. Ongoing incidents, the status pill and failed-check notices never auto-hide.',
      'settings.notify': 'Notify me about',
      'settings.notifyOutage': 'Service outages',
      'settings.notifyDegraded': 'Degraded performance / maintenance',
      'settings.notifyRecovery': 'Service recovery',
      'settings.notifyConnection': 'Failed status checks',
      'settings.showStatusPill': 'Persistent status indicator',
      'settings.showStatusPillHint': 'Always shows the current state as a small pill (green = healthy, amber = degraded, red = outage). It stays after a notice popup is dismissed.',
      'settings.statusPosition': 'Indicator position',
      'settings.statusPositionHint': 'The persistent pill uses this position; it is independent from the notice position above.',
      'settings.preview': 'Test notice',
      'settings.reset': 'Restore defaults',
      'settings.saved': 'Settings are stored in this browser and only affect this machine.',
      'settings.feed': 'Feed: {url}',
      'settings.lastCheck': 'Last checked: {time}',
      'settings.activeCount': '{count} ongoing incident(s)',
      'settings.error': 'Check failed: {error}',
      'preview.title': 'DeepSeek API degraded performance (sample notice)',
      'preview.summary': 'This is a style preview and does not reflect the real service status.',
      'demo.outage': 'DeepSeek Web/API partially unavailable (appearance demo)',
      'demo.degraded': 'DeepSeek API degraded performance (appearance demo)',
      'demo.recovery': 'DeepSeek service recovered (appearance demo)',
      'time.justNow': 'just now',
      'time.minutes': '{count} min ago',
      'time.hours': '{count} h ago',
      'time.days': '{count} d ago',
      'badge.active': 'Ongoing',
      'badge.resolved': 'Resolved',
      'aria.notification': 'DeepSeek service status notification',
      'aria.settings': 'DeepSeek status notification settings',
    }

    // --- locale ---------------------------------------------------------------

    let localeService = null

    function builtinLang() {
      if (typeof navigator === 'undefined') return 'en'
      const tags = [].concat(navigator.languages || [], [navigator.language])
      for (const tag of tags) {
        const primary = String(tag || '').toLowerCase().split('-')[0]
        if (primary === 'zh') return 'zh'
        if (primary === 'en') return 'en'
      }
      return 'en'
    }

    function activeLang() {
      try {
        const snapshot = localeService?.getSnapshot?.()
        const active = snapshot?.active
        const primary = String(active || '').toLowerCase().split('-')[0]
        if (primary === 'zh' || primary === 'en') return primary
        // The Harness locale runtime falls back to English; match it instead of
        // showing Chinese to a de/es/fr/ja/pt/ru user.
        if (typeof active === 'string' && active !== '') return 'en'
      } catch {
        // fall through to the browser language
      }
      return builtinLang()
    }

    function translate(lang, key, values) {
      const dict = String(lang).toLowerCase().startsWith('zh') ? zh : en
      let template = dict[key] ?? en[key] ?? key
      if (values !== undefined && values !== null) {
        template = template.replace(/\{(\w+)\}/g, (whole, name) =>
          values[name] !== undefined && values[name] !== null ? String(values[name]) : whole,
        )
      }
      return template
    }

    function tNow(key, values) {
      return translate(activeLang(), key, values)
    }

    /** Translate function that re-renders its component when the locale changes. */
    function useT() {
      const [, setTick] = useState(0)
      const service = localeService
      useEffect(() => {
        if (service === null || typeof service.subscribe !== 'function') return undefined
        return service.subscribe(() => setTick((value) => value + 1))
      }, [service])
      const lang = activeLang()
      return useCallback((key, values) => translate(lang, key, values), [lang])
    }

    /** Feed-provided links are rendered as anchors: only allow http(s). */
    function safeHref(value) {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return /^https?:\/\//i.test(trimmed) ? trimmed : null
    }

    function formatAbsolute(timestamp, lang) {
      if (!Number.isFinite(timestamp) || timestamp <= 0) return tNow('notice.never')
      try {
        return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(timestamp))
      } catch {
        return new Date(timestamp).toLocaleString()
      }
    }

    function formatRelative(timestamp, lang) {
      if (!Number.isFinite(timestamp) || timestamp <= 0) return tNow('notice.never')
      const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
      if (seconds < 60) return tNow('time.justNow')
      const minutes = Math.round(seconds / 60)
      if (minutes < 60) return tNow('time.minutes', { count: minutes })
      const hours = Math.round(minutes / 60)
      if (hours < 24) return tNow('time.hours', { count: hours })
      return tNow('time.days', { count: Math.round(hours / 24) })
    }

    // --- settings store -------------------------------------------------------

    const CORNER_POSITIONS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']
    const BANNER_POSITIONS = ['top', 'bottom']

    // Appearance demo (row config `demo: 'positions' | 'sizes'`): each step
    // carries its own form/size/position so the saved user settings stay
    // untouched.
    const DEMO_MS = 4500
    const DEMO_KINDS = ['outage', 'degraded', 'recovery']

    function buildDemoSteps(mode) {
      const steps = []
      if (mode === 'sizes') {
        for (const form of ['bubble', 'banner', 'pill']) {
          for (const size of ['small', 'medium', 'large']) {
            steps.push({
              form,
              size,
              position: form === 'banner' ? 'top' : 'top-right',
              kind: DEMO_KINDS[steps.length % DEMO_KINDS.length],
            })
          }
        }
        return steps
      }
      for (const form of ['bubble', 'pill']) {
        CORNER_POSITIONS.forEach((position, index) => {
          steps.push({ form, position, kind: DEMO_KINDS[index % DEMO_KINDS.length] })
        })
      }
      steps.push({ form: 'banner', position: 'top', kind: 'outage' })
      steps.push({ form: 'banner', position: 'bottom', kind: 'degraded' })
      return steps
    }

    let demoIndex = 0
    const DEFAULT_SETTINGS = Object.freeze({
      form: 'bubble',
      position: 'top-right',
      size: 'medium',
      statusPosition: 'top-right',
      refreshSeconds: 0,
      autoHideSeconds: 0,
      showStatusPill: false,
      notifyOutage: true,
      notifyDegraded: true,
      notifyRecovery: true,
      notifyConnection: true,
    })

    function clampNumber(value, min, max, fallback) {
      const number = Number(value)
      if (!Number.isFinite(number)) return fallback
      return Math.min(max, Math.max(min, Math.round(number)))
    }

    function sanitizeSettings(input) {
      const source = input !== null && typeof input === 'object' ? input : {}
      const form = ['bubble', 'banner', 'pill'].includes(source.form) ? source.form : DEFAULT_SETTINGS.form
      const allowedPositions = form === 'banner' ? BANNER_POSITIONS : CORNER_POSITIONS
      let position = allowedPositions.includes(source.position) ? source.position : DEFAULT_SETTINGS.position
      if (!allowedPositions.includes(position)) position = form === 'banner' ? 'top' : 'top-right'
      const size = ['small', 'medium', 'large'].includes(source.size) ? source.size : DEFAULT_SETTINGS.size
      // 1–14 s would be ignored by effectiveRefreshSeconds(); normalise it to
      // "follow the Host default" instead of showing an unused value.
      const rawRefresh = clampNumber(source.refreshSeconds, 0, 3600, 0)
      const refreshSeconds = rawRefresh > 0 && rawRefresh < 15 ? 0 : rawRefresh
      // The persistent indicator has its own position; an upgraded profile
      // inherits the notice position once, then keeps them independent.
      const statusPosition = CORNER_POSITIONS.includes(source.statusPosition)
        ? source.statusPosition
        : CORNER_POSITIONS.includes(source.position)
          ? source.position
          : DEFAULT_SETTINGS.statusPosition
      return {
        form,
        position,
        size,
        statusPosition,
        refreshSeconds,
        autoHideSeconds: clampNumber(source.autoHideSeconds, 0, 600, 0),
        showStatusPill: source.showStatusPill === true || source.showIdlePill === true,
        notifyOutage: source.notifyOutage !== false,
        notifyDegraded: source.notifyDegraded !== false,
        notifyRecovery: source.notifyRecovery !== false,
        notifyConnection: source.notifyConnection !== false,
      }
    }

    function loadSettings() {
      let saved = {}
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw !== null) {
          const parsed = JSON.parse(raw)
          if (parsed !== null && typeof parsed === 'object' && parsed.version === VERSION) saved = parsed.settings ?? {}
        }
      } catch {
        // a blocked or corrupt localStorage keeps the defaults
      }
      return sanitizeSettings({ ...DEFAULT_SETTINGS, ...saved })
    }

    let settings = loadSettings()

    function persistSettings() {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, settings }))
      } catch {
        // storage may be unavailable; the in-memory value still applies
      }
    }

    function updateSettings(patch) {
      const previous = settings
      settings = sanitizeSettings({ ...settings, ...patch })
      persistSettings()
      if (settings.refreshSeconds !== previous.refreshSeconds) void fetchState(true)
      bump()
    }

    function positionFor(form, position) {
      if (form === 'banner') {
        if (position === 'top' || position === 'bottom') return position
        return String(position).startsWith('bottom') ? 'bottom' : 'top'
      }
      if (position === 'top') return 'top-right'
      if (position === 'bottom') return 'bottom-right'
      return position
    }

    /**
     * Left/right insets of the conversation content column inside the frame.
     *
     * The overlay slot is frame-wide (it also covers the sidebar and the right
     * panel), so a corner notice anchored to the window edge would land on the
     * sidebar. The frame publishes its three column widths only as an inline
     * grid-template (no theme variable), so this reads the frame's resolved
     * grid columns once per layout change: read-only, no DOM writes, and a
     * 0px fallback whenever the frame cannot be found.
     */
    function measureFrameInsets() {
      try {
        const overlay = document.querySelector('[data-shell-overlay]')
        const frame = overlay?.parentElement ?? null
        if (frame === null) return { left: 0, right: 0 }
        const columns = getComputedStyle(frame)
          .gridTemplateColumns.split(/\s+/)
          .filter((value) => value !== '')
          .map((value) => Number.parseFloat(value))
        const drawer = frame.hasAttribute('data-sidebar-drawer')
        const left = drawer ? 0 : Number.isFinite(columns[0]) ? columns[0] : 0
        const right = Number.isFinite(columns[2]) ? columns[2] : 0
        return { left: Math.max(0, Math.round(left)), right: Math.max(0, Math.round(right)) }
      } catch {
        return { left: 0, right: 0 }
      }
    }

    // --- shared store plumbing ------------------------------------------------

    const listeners = new Set()
    let revision = 0

    function bump() {
      revision += 1
      for (const listener of [...listeners]) {
        try {
          listener(revision)
        } catch {
          // a crashing subscriber must not break the others
        }
      }
    }

    let status = null
    let lastError = null
    let lastResponseAt = 0
    // When the current failure streak started (feed fetch or transport); used
    // to distinguish a transient blip from a sustained outage.
    let firstFailureAt = null
    let inflight = null
    let pollTimer = null
    let retained = 0
    let visibilityBound = false

    function effectiveRefreshSeconds() {
      if (Number.isFinite(settings.refreshSeconds) && settings.refreshSeconds >= 15) return settings.refreshSeconds
      const fromHost = Number(status?.defaults?.refreshIntervalSeconds)
      if (Number.isFinite(fromHost) && fromHost >= 15) return Math.round(fromHost)
      return 60
    }

    /** A request that never settles must not freeze polling forever. */
    function requestSignal(timeoutMs) {
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(timeoutMs)
      }
      const controller = new AbortController()
      window.setTimeout(() => controller.abort(), timeoutMs)
      return controller.signal
    }

    async function fetchState(force) {
      if (inflight !== null) return inflight
      const interval = effectiveRefreshSeconds()
      const url = `${ROUTE}?interval=${interval}${force ? '&force=1' : ''}`
      inflight = (async () => {
        try {
          const response = await fetch(url, {
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: requestSignal(30000),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          if (data === null || typeof data !== 'object' || data.version !== VERSION) {
            throw new Error('unexpected status response')
          }
          status = data
          lastResponseAt = Date.now()
          if (data.ok === false) {
            if (firstFailureAt === null) firstFailureAt = Date.now()
            lastError = String(data.error || 'status check failed')
          } else {
            firstFailureAt = null
            lastError = null
          }
        } catch (error) {
          if (firstFailureAt === null) firstFailureAt = Date.now()
          lastError = String(error?.message ?? error)
        } finally {
          inflight = null
          bump()
        }
      })()
      return inflight
    }

    function tick(force) {
      void fetchState(force === true)
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') tick(false)
    }

    function startPolling() {
      if (pollTimer !== null) return
      tick(false)
      pollTimer = window.setInterval(() => tick(false), POLL_MS)
      if (!visibilityBound && typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibilityChange)
        visibilityBound = true
      }
    }

    function stopPolling() {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer)
        pollTimer = null
      }
      if (visibilityBound && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
        visibilityBound = false
      }
    }

    function retainPolling() {
      retained += 1
      if (retained === 1) startPolling()
    }

    function releasePolling() {
      retained = Math.max(0, retained - 1)
      if (retained === 0) stopPolling()
    }

    /**
     * Subscribe this component to every store change and keep the status poller
     * alive while at least one entry is mounted.
     */
    function useStore() {
      const [version, setVersion] = useState(0)
      useEffect(() => {
        const listener = () => setVersion((value) => value + 1)
        listeners.add(listener)
        retainPolling()
        return () => {
          listeners.delete(listener)
          releasePolling()
        }
      }, [])
      return version
    }

    // --- dismissed notices ----------------------------------------------------

    function loadDismissed() {
      try {
        const raw = window.localStorage.getItem(DISMISSED_KEY)
        if (raw === null) return new Set()
        const parsed = JSON.parse(raw)
        return new Set(Array.isArray(parsed) ? parsed.slice(-200) : [])
      } catch {
        return new Set()
      }
    }

    let dismissed = loadDismissed()

    function persistDismissed() {
      try {
        window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed].slice(-200)))
      } catch {
        // ignore storage failures
      }
    }

    function activeKey(incident) {
      // Keyed without the timestamp: a dismissal must survive a timestamp-only
      // change (RSS↔Atom failover, description edit) that the Host deliberately
      // does not treat as a transition.
      return `active:${incident.id}`
    }

    function dismiss(key, linkedKey) {
      if (typeof key === 'string' && key !== '') dismissed.add(key)
      if (typeof linkedKey === 'string' && linkedKey !== '') dismissed.add(linkedKey)
      persistDismissed()
      if (preview !== null && preview.key === key) {
        preview = null
        clearPreviewTimer()
      }
      bump()
    }

    // --- preview notice -------------------------------------------------------

    let preview = null
    let previewTimer = null

    function clearPreviewTimer() {
      if (previewTimer !== null) {
        window.clearTimeout(previewTimer)
        previewTimer = null
      }
    }

    function showPreview() {
      clearPreviewTimer()
      preview = {
        key: `preview:${Date.now()}`,
        kind: 'degraded',
        title: tNow('preview.title'),
        at: Date.now(),
      }
      previewTimer = window.setTimeout(() => {
        preview = null
        previewTimer = null
        bump()
      }, PREVIEW_MS)
      bump()
    }

    function resetSettings() {
      settings = sanitizeSettings({ ...DEFAULT_SETTINGS })
      persistSettings()
      dismissed = new Set()
      persistDismissed()
      void fetchState(true)
      bump()
    }

    // --- notice selection -----------------------------------------------------

    function kindEnabled(kind) {
      if (kind === 'outage') return settings.notifyOutage !== false
      if (kind === 'degraded' || kind === 'maintenance') return settings.notifyDegraded !== false
      if (kind === 'recovery') return settings.notifyRecovery !== false
      return true
    }

    function healthKind(health) {
      if (health === 'outage') return 'outage'
      if (health === 'degraded' || health === 'maintenance') return 'degraded'
      if (health === 'ok') return 'ok'
      return 'idle'
    }

    function findActiveForEvent(event) {
      const active = Array.isArray(status?.active) ? status.active : []
      return active.find((incident) => incident.id === event.incidentId) ?? null
    }

    function computeNotice() {
      if (preview !== null) {
        return { key: preview.key, type: 'preview', kind: preview.kind, title: preview.title, at: preview.at }
      }
      const now = Date.now()
      const fetchedAt = Number(status?.fetchedAt) || 0
      const checkedAt = Number(status?.checkedAt) || 0
      const feedFailing = status !== null && status.ok === false
      const failureAge = firstFailureAt === null ? Infinity : now - firstFailureAt
      // `lastResponseAt` advances on every parsed response, including an
      // HTTP 200 whose payload says the upstream feed failed. A transport
      // staleness check alone therefore hides a feed outage while the Host is
      // alive; feed failures are measured from the first failing response.
      const transportStale = lastResponseAt === 0 || now - lastResponseAt > CONNECTION_GRACE_MS
      const connectionProblem =
        lastError === null
          ? false
          : status === null
            ? true
            : feedFailing
              ? failureAge > CONNECTION_GRACE_MS
              : transportStale
      const connectionKey = `connection:${fetchedAt}`
      if (connectionProblem && settings.notifyConnection !== false && !dismissed.has(connectionKey)) {
        return {
          key: connectionKey,
          type: 'connection',
          kind: 'connection',
          title: tNow('notice.connectionFailed'),
          at: checkedAt,
        }
      }
      if (status === null) {
        if (settings.showStatusPill === true && lastError !== null) {
          return {
            key: 'status:connection:none',
            type: 'status',
            kind: 'connection',
            title: tNow('notice.connectionFailed'),
            at: checkedAt,
          }
        }
        return null
      }
      const events = Array.isArray(status.events) ? status.events : []
      const pending = events
        .filter((event) => kindEnabled(event.kind) && !dismissed.has(event.key))
        .sort((left, right) => right.at - left.at)
      if (pending.length > 0) {
        const newest = pending[0]
        return {
          key: newest.key,
          type: 'event',
          kind: newest.kind,
          title: newest.title,
          at: newest.at,
          event: newest,
          count: pending.length,
        }
      }
      const active = Array.isArray(status.active) ? status.active : []
      const visibleActive = active
        .filter((incident) => {
          const kind = incident.severity === 'outage' ? 'outage' : 'degraded'
          return kindEnabled(kind) && !dismissed.has(activeKey(incident))
        })
        .sort((left, right) => right.updatedAt - left.updatedAt)
      if (visibleActive.length > 0 && !feedFailing) {
        const incident = visibleActive[0]
        return {
          key: activeKey(incident),
          type: 'ongoing',
          kind: incident.severity === 'outage' ? 'outage' : 'degraded',
          title: incident.title,
          at: incident.updatedAt,
          incident,
        }
      }
      // Persistent status indicator: it also appears when every notice was
      // dismissed, so closing the popup never leaves the user without the
      // current service state (green / amber / red pill).
      if (settings.showStatusPill === true) {
        // Never claim a healthy service while checks are failing.
        const indicatorFailing = feedFailing || (lastError !== null && transportStale)
        if (indicatorFailing) {
          return {
            key: `status:connection:${feedFailing ? fetchedAt : 0}`,
            type: 'status',
            kind: 'connection',
            title: tNow('notice.connectionFailed'),
            at: checkedAt,
          }
        }
        const health = status.health
        if (health === 'ok') {
          return {
            key: 'status:ok',
            type: 'idle',
            kind: 'ok',
            title: tNow('notice.healthy'),
            at: fetchedAt,
          }
        }
        if (health === 'outage' || health === 'degraded' || health === 'maintenance') {
          const newest = Array.isArray(status.active) && status.active.length > 0 ? status.active[0] : null
          return {
            key: `status:${health}`,
            type: 'status',
            kind: health === 'outage' ? 'outage' : 'degraded',
            title: healthLabel(tNow, health),
            at: Number(newest?.updatedAt) || checkedAt || 0,
          }
        }
      }
      return null
    }

    // --- shared render pieces -------------------------------------------------

    const CSS = `
.dsh-ds-layer{position:fixed;inset:0;pointer-events:none;
  --dsh-ds-inset-left:0px;--dsh-ds-inset-right:0px;--dsh-ds-top-extra:90px;
  --dsh-ds-content-top:calc(var(--dsh-frame-top-clearance,0px) + var(--dsh-ds-top-extra));
  --dsh-ds-center-left:calc(var(--dsh-ds-inset-left) + (100% - var(--dsh-ds-inset-left) - var(--dsh-ds-inset-right)) / 2)}
html[data-platform="darwin"] .dsh-ds-layer{--dsh-ds-content-top:var(--dsh-ds-top-extra)}
.dsh-ds-card{position:fixed;pointer-events:auto;display:flex;flex-direction:column;box-sizing:border-box;
  background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);
  border:1px solid var(--dsw-alias-border-l1);border-radius:12px;
  box-shadow:0 10px 30px rgba(0,0,0,.18);font-size:13px;line-height:1.45;
  animation:dsh-ds-in .18s ease-out;overflow:hidden;--dsh-ds-accent:var(--dsw-alias-state-idle-primary)}
.dsh-ds-card[data-kind="outage"]{--dsh-ds-accent:var(--dsw-alias-state-error-primary)}
.dsh-ds-card[data-kind="degraded"]{--dsh-ds-accent:var(--dsw-alias-state-warn-primary)}
.dsh-ds-card[data-kind="connection"]{--dsh-ds-accent:var(--dsw-alias-state-warn-primary)}
.dsh-ds-card[data-kind="recovery"]{--dsh-ds-accent:var(--dsw-alias-state-success-primary)}
.dsh-ds-card[data-kind="ok"]{--dsh-ds-accent:var(--dsw-alias-state-success-primary)}
.dsh-ds-card[data-kind="idle"]{--dsh-ds-accent:var(--dsw-alias-state-idle-primary)}
.dsh-ds-card[data-size="small"][data-form="bubble"]{width:min(300px,calc(100vw - var(--dsh-ds-inset-left) - var(--dsh-ds-inset-right) - 24px))}
.dsh-ds-card[data-size="medium"][data-form="bubble"]{width:min(360px,calc(100vw - var(--dsh-ds-inset-left) - var(--dsh-ds-inset-right) - 24px))}
.dsh-ds-card[data-size="large"][data-form="bubble"]{width:min(460px,calc(100vw - var(--dsh-ds-inset-left) - var(--dsh-ds-inset-right) - 24px))}
.dsh-ds-main{display:flex;align-items:flex-start;gap:10px;padding:12px 12px 12px 14px}
.dsh-ds-card[data-size="small"] .dsh-ds-main{padding:9px 9px 9px 11px;gap:8px}
.dsh-ds-card[data-size="large"] .dsh-ds-main{padding:15px 15px 15px 17px;gap:12px}
.dsh-ds-glyph{display:inline-flex;flex:none;align-items:center;justify-content:center;
  width:22px;height:22px;border-radius:50%;color:var(--dsh-ds-accent);
  background:transparent;background:color-mix(in srgb,var(--dsh-ds-accent) 14%,transparent);margin-top:1px}
.dsh-ds-text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
.dsh-ds-head{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-ds-kind{font-size:11px;font-weight:600;letter-spacing:.2px;color:var(--dsh-ds-accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-ds-count{font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary);
  border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 5px;line-height:15px;flex:none}
.dsh-ds-title{font-size:13px;font-weight:600;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
.dsh-ds-card[data-form="banner"] .dsh-ds-title{-webkit-line-clamp:1}
.dsh-ds-meta{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
.dsh-ds-actions{display:inline-flex;align-items:center;gap:2px;flex:none;margin-left:2px}
.dsh-ds-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-brand-primary);
  font:inherit;font-size:12px;font-weight:600;padding:4px 7px;border-radius:7px;cursor:pointer;white-space:nowrap;
  text-decoration:none;display:inline-flex;align-items:center;gap:4px}
.dsh-ds-btn:hover{background:transparent;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
.dsh-ds-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-ds-icon-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);
  font:inherit;font-size:16px;line-height:1;width:26px;height:26px;border-radius:7px;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;flex:none;padding:0}
.dsh-ds-icon-btn:hover{background:transparent;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.dsh-ds-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-ds-layer[data-position="top-left"] .dsh-ds-card{top:var(--dsh-ds-content-top);left:calc(var(--dsh-ds-inset-left) + 12px)}
.dsh-ds-layer[data-position="top-center"] .dsh-ds-card{top:var(--dsh-ds-content-top);left:var(--dsh-ds-center-left);transform:translateX(-50%)}
.dsh-ds-layer[data-position="top-right"] .dsh-ds-card{top:var(--dsh-ds-content-top);right:calc(var(--dsh-ds-inset-right) + 12px)}
.dsh-ds-layer[data-position="bottom-left"] .dsh-ds-card{bottom:calc(12px + env(safe-area-inset-bottom,0px));left:calc(var(--dsh-ds-inset-left) + 12px)}
.dsh-ds-layer[data-position="bottom-center"] .dsh-ds-card{bottom:calc(12px + env(safe-area-inset-bottom,0px));left:var(--dsh-ds-center-left);transform:translateX(-50%)}
.dsh-ds-layer[data-position="bottom-right"] .dsh-ds-card{bottom:calc(12px + env(safe-area-inset-bottom,0px));right:calc(var(--dsh-ds-inset-right) + 12px)}
.dsh-ds-layer[data-form="banner"][data-position="top"] .dsh-ds-card{top:var(--dsh-ds-content-top);left:var(--dsh-ds-inset-left);right:var(--dsh-ds-inset-right);border-radius:0;border-left:0;border-right:0;border-top:0}
.dsh-ds-layer[data-form="banner"][data-position="bottom"] .dsh-ds-card{bottom:0;left:var(--dsh-ds-inset-left);right:var(--dsh-ds-inset-right);border-radius:0;border-left:0;border-right:0;border-bottom:0}
.dsh-ds-card[data-form="banner"] .dsh-ds-main{align-items:center;padding:9px 14px}
.dsh-ds-card[data-form="banner"] .dsh-ds-text{flex-direction:row;align-items:baseline;gap:8px;flex-wrap:wrap}
.dsh-ds-card[data-form="banner"] .dsh-ds-meta{flex:1 1 auto}
.dsh-ds-pill{pointer-events:auto;appearance:none;display:inline-flex;align-items:center;gap:8px;
  border:1px solid var(--dsw-alias-border-l1);border-radius:999px;cursor:pointer;
  background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);
  box-shadow:0 6px 18px rgba(0,0,0,.16);font:inherit;font-size:12px;font-weight:600;
  padding:6px 12px;--dsh-ds-accent:var(--dsw-alias-state-idle-primary)}
.dsh-ds-pill[data-kind="outage"]{--dsh-ds-accent:var(--dsw-alias-state-error-primary)}
.dsh-ds-pill[data-kind="degraded"]{--dsh-ds-accent:var(--dsw-alias-state-warn-primary)}
.dsh-ds-pill[data-kind="connection"]{--dsh-ds-accent:var(--dsw-alias-state-warn-primary)}
.dsh-ds-pill[data-kind="recovery"]{--dsh-ds-accent:var(--dsw-alias-state-success-primary)}
.dsh-ds-pill[data-kind="ok"]{--dsh-ds-accent:var(--dsw-alias-state-success-primary)}
.dsh-ds-pill[data-size="small"]{font-size:11px;padding:4px 10px;gap:6px}
.dsh-ds-pill[data-size="small"] .dsh-ds-dot{width:6px;height:6px;box-shadow:0 0 0 2px color-mix(in srgb,var(--dsh-ds-accent) 18%,transparent)}
.dsh-ds-pill[data-size="large"]{font-size:14px;padding:9px 16px;gap:10px}
.dsh-ds-pill[data-size="large"] .dsh-ds-dot{width:10px;height:10px;box-shadow:0 0 0 4px color-mix(in srgb,var(--dsh-ds-accent) 18%,transparent)}
.dsh-ds-pill-meta{font-size:10px;font-weight:500;color:var(--dsw-alias-label-secondary);
  border-left:1px solid var(--dsw-alias-border-l1);padding-left:8px;margin-left:2px}
.dsh-ds-card[data-size="small"] .dsh-ds-title{font-size:12px}
.dsh-ds-card[data-size="large"] .dsh-ds-title{font-size:15px}
.dsh-ds-card[data-size="small"] .dsh-ds-kind{font-size:10px}
.dsh-ds-card[data-size="large"] .dsh-ds-kind{font-size:12px}
.dsh-ds-card[data-size="small"] .dsh-ds-meta{font-size:10px}
.dsh-ds-card[data-size="large"] .dsh-ds-meta{font-size:12px}
.dsh-ds-card[data-form="banner"][data-size="small"] .dsh-ds-main{padding:6px 12px;gap:8px}
.dsh-ds-card[data-form="banner"][data-size="large"] .dsh-ds-main{padding:13px 18px;gap:12px}
.dsh-ds-card[data-form="banner"][data-size="small"] .dsh-ds-title{font-size:12px}
.dsh-ds-card[data-form="banner"][data-size="large"] .dsh-ds-title{font-size:15px}
.dsh-ds-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-ds-layer[data-form="pill"] .dsh-ds-pill{position:fixed;animation:dsh-ds-in .18s ease-out}
.dsh-ds-layer[data-form="pill"][data-position="top-left"] .dsh-ds-pill{top:var(--dsh-ds-content-top);left:calc(var(--dsh-ds-inset-left) + 12px)}
.dsh-ds-layer[data-form="pill"][data-position="top-center"] .dsh-ds-pill{top:var(--dsh-ds-content-top);left:var(--dsh-ds-center-left);transform:translateX(-50%)}
.dsh-ds-layer[data-form="pill"][data-position="top-right"] .dsh-ds-pill{top:var(--dsh-ds-content-top);right:calc(var(--dsh-ds-inset-right) + 12px)}
.dsh-ds-layer[data-form="pill"][data-position="bottom-left"] .dsh-ds-pill{bottom:calc(12px + env(safe-area-inset-bottom,0px));left:calc(var(--dsh-ds-inset-left) + 12px)}
.dsh-ds-layer[data-form="pill"][data-position="bottom-center"] .dsh-ds-pill{bottom:calc(12px + env(safe-area-inset-bottom,0px));left:var(--dsh-ds-center-left);transform:translateX(-50%)}
.dsh-ds-layer[data-form="pill"][data-position="bottom-right"] .dsh-ds-pill{bottom:calc(12px + env(safe-area-inset-bottom,0px));right:calc(var(--dsh-ds-inset-right) + 12px)}
.dsh-ds-dot{width:8px;height:8px;border-radius:50%;background:var(--dsh-ds-accent);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--dsh-ds-accent) 18%,transparent)}
.dsh-ds-card[data-kind="outage"] .dsh-ds-glyph,.dsh-ds-card[data-kind="connection"] .dsh-ds-glyph{animation:dsh-ds-pulse 2s ease-in-out infinite}
.dsh-ds-detail{max-height:min(640px,calc(100vh - 72px));display:flex;flex-direction:column}
.dsh-ds-card[data-size="small"].dsh-ds-detail,.dsh-ds-card[data-size="medium"].dsh-ds-detail{width:min(420px,calc(100vw - var(--dsh-ds-inset-left) - var(--dsh-ds-inset-right) - 24px))}
.dsh-ds-card[data-size="large"].dsh-ds-detail{width:min(520px,calc(100vw - var(--dsh-ds-inset-left) - var(--dsh-ds-inset-right) - 24px))}
.dsh-ds-detail[data-form="banner"]{width:auto;max-height:min(70vh,620px)}
.dsh-ds-detail-head{display:flex;align-items:flex-start;gap:10px;padding:14px 12px 10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-ds-detail-heading{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0}
.dsh-ds-detail-title{font-size:14px;font-weight:650}
.dsh-ds-detail-body{overflow-y:auto;padding:4px 16px 12px;display:flex;flex-direction:column;gap:2px;overscroll-behavior:contain;flex:1 1 auto;min-height:0}
.dsh-ds-section{margin-top:10px;display:flex;flex-direction:column;gap:2px}
.dsh-ds-h2{font-size:14px;font-weight:650;margin:0}
.dsh-ds-h3{font-size:11px;font-weight:650;letter-spacing:.4px;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin:8px 0 2px}
.dsh-ds-hint{font-size:12px;color:var(--dsw-alias-label-secondary);margin:2px 0;line-height:1.5;overflow-wrap:anywhere}
.dsh-ds-row{padding:9px 0;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:3px;--dsh-ds-accent:var(--dsw-alias-state-idle-primary)}
.dsh-ds-row[data-kind="outage"]{--dsh-ds-accent:var(--dsw-alias-state-error-primary)}
.dsh-ds-row[data-kind="degraded"]{--dsh-ds-accent:var(--dsw-alias-state-warn-primary)}
.dsh-ds-row[data-kind="recovery"]{--dsh-ds-accent:var(--dsw-alias-state-success-primary)}
.dsh-ds-row-head{display:flex;align-items:flex-start;gap:8px;min-width:0}
.dsh-ds-row-title{font-size:12.5px;font-weight:600;word-break:break-word;min-width:0}
.dsh-ds-badge{flex:none;font-size:10px;font-weight:650;border-radius:999px;padding:1px 7px;line-height:16px;
  color:var(--dsh-ds-accent);background:transparent;background:color-mix(in srgb,var(--dsh-ds-accent) 14%,transparent)}
.dsh-ds-summary{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;word-break:break-word}
.dsh-ds-link{font-size:12px;color:var(--dsw-alias-brand-primary);text-decoration:none;width:fit-content;border-radius:4px}
.dsh-ds-link:hover{text-decoration:underline}
.dsh-ds-link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-ds-error{font-size:12px;color:var(--dsw-alias-state-error-primary);background:transparent;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent);
  border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;margin:8px 0;word-break:break-word}
.dsh-ds-detail-foot{display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:9px 12px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.dsh-ds-form{display:flex;flex-direction:column;gap:12px;padding:10px 0 4px}
.dsh-ds-field{display:flex;flex-direction:column;gap:5px}
.dsh-ds-field-label{font-size:12px;font-weight:600}
.dsh-ds-input,.dsh-ds-select{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);
  border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:5px 8px;font:inherit;font-size:12px;min-height:29px}
.dsh-ds-input:focus-visible,.dsh-ds-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-ds-input{width:96px}
.dsh-ds-seg{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);width:fit-content;flex-wrap:wrap}
.dsh-ds-seg-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;
  padding:4px 10px;border-radius:6px;cursor:pointer}
.dsh-ds-seg-btn[aria-pressed="true"]{background:transparent;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary);font-weight:600}
.dsh-ds-seg-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-ds-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:3px 0}
.dsh-ds-toggle-label{font-size:12px}
.dsh-ds-switch{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);
  width:34px;height:20px;border-radius:999px;padding:0;cursor:pointer;position:relative;flex:none;transition:background .15s ease,border-color .15s ease}
.dsh-ds-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dsh-ds-switch-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
  background:var(--dsw-alias-bg-base);box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s ease;display:block}
.dsh-ds-switch[aria-checked="true"] .dsh-ds-switch-knob{transform:translateX(14px)}
.dsh-ds-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-ds-page{display:flex;flex-direction:column;gap:16px;max-width:720px;padding:2px 2px 28px}
.dsh-ds-page-head{display:flex;flex-direction:column;gap:4px}
.dsh-ds-statusline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px}
.dsh-ds-status-badge{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--dsw-alias-border-l1);
  border-radius:999px;padding:4px 11px;font-size:12px;font-weight:600;--dsh-ds-accent:var(--dsw-alias-state-idle-primary)}
.dsh-ds-status-badge[data-kind="outage"]{--dsh-ds-accent:var(--dsw-alias-state-error-primary)}
.dsh-ds-status-badge[data-kind="degraded"]{--dsh-ds-accent:var(--dsw-alias-state-warn-primary)}
.dsh-ds-status-badge[data-kind="recovery"]{--dsh-ds-accent:var(--dsw-alias-state-success-primary)}
.dsh-ds-status-badge[data-kind="ok"]{--dsh-ds-accent:var(--dsw-alias-state-success-primary)}
.dsh-ds-status-badge[data-kind="idle"]{--dsh-ds-accent:var(--dsw-alias-state-idle-primary)}
.dsh-ds-divider{height:1px;background:var(--dsw-alias-border-l1);border:0;margin:2px 0;width:100%}
.dsh-ds-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.dsh-ds-inline-preview{margin-top:4px;padding:4px 0;display:flex;flex-direction:column;gap:6px}
.dsh-ds-inline-preview .dsh-ds-card{position:static;left:auto;right:auto;top:auto;bottom:auto;transform:none;width:100%;max-width:420px;animation:none;box-shadow:none}
.dsh-ds-inline-preview .dsh-ds-pill{position:static;animation:none;box-shadow:none}
@keyframes dsh-ds-in{from{opacity:0}to{opacity:1}}
@keyframes dsh-ds-pulse{0%,100%{opacity:1}50%{opacity:.55}}
@media (prefers-reduced-motion:reduce){.dsh-ds-card,.dsh-ds-glyph{animation:none!important;transition:none!important}}
`

    function Glyph(props) {
      const size = props.size ?? 14
      const common = {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        'aria-hidden': 'true',
        focusable: 'false',
        style: { display: 'block', flex: 'none' },
      }
      switch (props.kind) {
        case 'outage':
          return h(
            'svg',
            { ...common, fill: 'currentColor' },
            h('path', {
              d: 'M8 1.2 1.1 13.3c-.3.6.1 1.2.8 1.2h12.2c.7 0 1.1-.7.8-1.2L8 1.2Zm0 3.4c.4 0 .7.3.7.7v3.8a.7.7 0 0 1-1.4 0V5.3c0-.4.3-.7.7-.7Zm0 6.2a.95.95 0 1 1 0 1.9.95.95 0 0 1 0-1.9Z',
            }),
          )
        case 'recovery':
          return h(
            'svg',
            { ...common, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
            h('circle', { cx: 8, cy: 8, r: 6.4 }),
            h('path', { d: 'm5.2 8.2 1.9 1.9 3.7-4' }),
          )
        case 'idle':
          return h('svg', { ...common, fill: 'currentColor' }, h('circle', { cx: 8, cy: 8, r: 3 }))
        case 'degraded':
        default:
          return h(
            'svg',
            { ...common, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
            h('circle', { cx: 8, cy: 8, r: 6.4 }),
            h('path', { d: 'M8 4.6v3.8' }),
            h('circle', { cx: 8, cy: 11.2, r: 0.2, fill: 'currentColor', stroke: 'none' }),
          )
      }
    }

    function Segmented(props) {
      return h(
        'div',
        { className: 'dsh-ds-seg', role: 'group', 'aria-label': props.ariaLabel },
        props.options.map((option) =>
          h(
            'button',
            {
              key: option.value,
              type: 'button',
              className: 'dsh-ds-seg-btn',
              'aria-pressed': props.value === option.value,
              onClick: () => props.onChange(option.value),
            },
            option.label,
          ),
        ),
      )
    }

    function Switch(props) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': props.checked === true,
          'aria-label': props.label,
          className: 'dsh-ds-switch',
          onClick: () => props.onChange(props.checked !== true),
        },
        h('span', { className: 'dsh-ds-switch-knob' }),
      )
    }

    function NumberField(props) {
      const [draft, setDraft] = useState(String(props.value))
      useEffect(() => {
        setDraft(String(props.value))
      }, [props.value])
      const commit = () => {
        const parsed = Number(draft)
        if (!Number.isFinite(parsed)) {
          setDraft(String(props.value))
          return
        }
        const clamped = Math.min(props.max, Math.max(props.min, Math.round(parsed)))
        setDraft(String(clamped))
        // Blurring without editing must not turn a host-provided default into an
        // explicit browser override (and must not force a fetch).
        if (String(clamped) !== String(props.value)) props.onCommit(clamped)
      }
      return h('input', {
        className: 'dsh-ds-input',
        type: 'number',
        inputMode: 'numeric',
        min: props.min,
        max: props.max,
        step: props.step ?? 1,
        value: draft,
        'aria-label': props.label,
        onChange: (event) => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: (event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        },
      })
    }

    // --- settings form --------------------------------------------------------

    function SettingsForm(props) {
      const ownT = useT()
      const t = props.t ?? ownT
      const [inlineNotice, setInlineNotice] = useState(null)
      const form = settings.form
      const positions = form === 'banner' ? BANNER_POSITIONS : CORNER_POSITIONS
      const refreshValue = settings.refreshSeconds > 0 ? settings.refreshSeconds : effectiveRefreshSeconds()
      useEffect(() => {
        if (inlineNotice === null) return undefined
        const timer = window.setTimeout(() => setInlineNotice(null), PREVIEW_MS)
        return () => window.clearTimeout(timer)
      }, [inlineNotice])
      // The Settings panel is body-portaled above the frame's overlay layer, so
      // an overlay preview would be painted under its mask. On the settings page
      // the sample notice therefore renders inline; the detail panel keeps the
      // real overlay preview.
      const startPreview = () => {
        if (props.inlinePreview !== true) {
          showPreview()
          return
        }
        setInlineNotice({
          key: `inline:${Date.now()}`,
          type: 'preview',
          kind: 'degraded',
          title: tNow('preview.title'),
          at: Date.now(),
        })
      }
      return h(
        'div',
        { className: 'dsh-ds-form' },
        h(
          'div',
          { className: 'dsh-ds-field' },
          h('span', { className: 'dsh-ds-field-label' }, t('settings.form')),
          h(Segmented, {
            value: form,
            ariaLabel: t('settings.form'),
            options: [
              { value: 'bubble', label: t('settings.form.bubble') },
              { value: 'banner', label: t('settings.form.banner') },
              { value: 'pill', label: t('settings.form.pill') },
            ],
            onChange: (value) => {
              const nextPosition = value === 'banner' ? positionFor('banner', settings.position) : positionFor(value, settings.position)
              updateSettings({ form: value, position: nextPosition })
            },
          }),
        ),
        h(
          'div',
          { className: 'dsh-ds-field' },
          h('span', { className: 'dsh-ds-field-label' }, t('settings.position')),
          h(
            'select',
            {
              className: 'dsh-ds-select',
              value: positionFor(form, settings.position),
              'aria-label': t('settings.position'),
              onChange: (event) => updateSettings({ position: event.target.value }),
            },
            positions.map((position) => h('option', { key: position, value: position }, t(`settings.position.${position}`))),
          ),
        ),
        h(
          'div',
          { className: 'dsh-ds-field' },
          h('span', { className: 'dsh-ds-field-label' }, t('settings.size')),
          h(Segmented, {
            value: settings.size,
            ariaLabel: t('settings.size'),
            options: [
              { value: 'small', label: t('settings.size.small') },
              { value: 'medium', label: t('settings.size.medium') },
              { value: 'large', label: t('settings.size.large') },
            ],
            onChange: (value) => updateSettings({ size: value }),
          }),
        ),
        h(
          'div',
          { className: 'dsh-ds-field' },
          h('span', { className: 'dsh-ds-field-label' }, t('settings.refresh')),
          h(NumberField, {
            value: refreshValue,
            min: 15,
            max: 3600,
            step: 15,
            label: t('settings.refresh'),
            onCommit: (value) => updateSettings({ refreshSeconds: value }),
          }),
          h('span', { className: 'dsh-ds-hint' }, t('settings.refreshHint')),
        ),
        h(
          'div',
          { className: 'dsh-ds-field' },
          h('span', { className: 'dsh-ds-field-label' }, t('settings.notify')),
          [
            ['notifyOutage', 'settings.notifyOutage'],
            ['notifyDegraded', 'settings.notifyDegraded'],
            ['notifyRecovery', 'settings.notifyRecovery'],
            ['notifyConnection', 'settings.notifyConnection'],
            ['showStatusPill', 'settings.showStatusPill'],
          ].map(([key, copyKey]) =>
            h(
              'div',
              { key, className: 'dsh-ds-toggle-row' },
              h('span', { className: 'dsh-ds-toggle-label' }, t(copyKey)),
              h(Switch, {
                checked: settings[key] === true,
                label: t(copyKey),
                onChange: (value) => updateSettings({ [key]: value }),
              }),
            ),
          ),
          h('span', { className: 'dsh-ds-hint' }, t('settings.showStatusPillHint')),
        ),
        settings.showStatusPill === true
          ? h(
              'div',
              { className: 'dsh-ds-field' },
              h('span', { className: 'dsh-ds-field-label' }, t('settings.statusPosition')),
              h(
                'select',
                {
                  className: 'dsh-ds-select',
                  value: settings.statusPosition,
                  'aria-label': t('settings.statusPosition'),
                  onChange: (event) => updateSettings({ statusPosition: event.target.value }),
                },
                CORNER_POSITIONS.map((position) =>
                  h('option', { key: position, value: position }, t(`settings.position.${position}`)),
                ),
              ),
              h('span', { className: 'dsh-ds-hint' }, t('settings.statusPositionHint')),
            )
          : null,
        h(
          'div',
          { className: 'dsh-ds-field' },
          h('span', { className: 'dsh-ds-field-label' }, t('settings.autoHide')),
          h(NumberField, {
            value: settings.autoHideSeconds,
            min: 0,
            max: 600,
            step: 5,
            label: t('settings.autoHide'),
            onCommit: (value) => updateSettings({ autoHideSeconds: value }),
          }),
          h('span', { className: 'dsh-ds-hint' }, t('settings.autoHideHint')),
        ),
        h(
          'div',
          { className: 'dsh-ds-statusline' },
          h(
            'button',
            { type: 'button', className: 'dsh-ds-btn', onClick: () => startPreview() },
            t('settings.preview'),
          ),
          h(
            'button',
            { type: 'button', className: 'dsh-ds-btn', onClick: () => resetSettings() },
            t('settings.reset'),
          ),
          h('span', { className: 'dsh-ds-hint' }, t('settings.saved')),
        ),
        inlineNotice !== null
          ? h(
              'div',
              { className: 'dsh-ds-inline-preview', 'data-testid': 'deepseek-status-preview' },
              h(NoticeCard, {
                notice: inlineNotice,
                t,
                onOpen: () => {},
                onDismiss: () => setInlineNotice(null),
              }),
            )
          : null,
      )
    }

    // --- notice card ----------------------------------------------------------

    function kindLabel(t, kind) {
      const key = `kind.${kind}`
      const label = t(key)
      return label === key ? t('kind.info') : label
    }

    function NoticeCard(props) {
      const t = props.t
      const notice = props.notice
      const lang = activeLang()
      const form = typeof props.form === 'string' ? props.form : settings.form
      const size = typeof props.size === 'string' ? props.size : settings.size
      const asPill = form === 'pill' || notice.type === 'idle' || notice.type === 'status'
      const meta =
        typeof notice.meta === 'string'
          ? notice.meta
          : notice.type === 'event'
            ? formatRelative(notice.at, lang)
            : notice.type === 'ongoing'
              ? t('notice.ongoing')
              : notice.type === 'preview'
                ? t('preview.summary')
                : ''
      if (asPill) {
        return h(
          'button',
          {
            type: 'button',
            className: 'dsh-ds-pill',
            'data-kind': notice.kind,
            'data-size': size,
            title: t('notice.open'),
            onClick: props.onOpen,
          },
          h('span', { className: 'dsh-ds-dot' }),
          h('span', null, kindLabel(t, notice.kind)),
          notice.type === 'demo' && typeof notice.meta === 'string'
            ? h('span', { className: 'dsh-ds-pill-meta' }, notice.meta)
            : null,
        )
      }
      const canDismiss = notice.type !== 'idle' && notice.type !== 'status' && notice.type !== 'demo'
      return h(
        'div',
        {
          className: 'dsh-ds-card',
          'data-form': form,
          'data-kind': notice.kind,
          'data-size': size,
          role: 'button',
          tabIndex: 0,
          'aria-label': t('notice.open'),
          onClick: props.onOpen,
          onKeyDown: (event) => {
            if (event.target !== event.currentTarget) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              props.onOpen()
            }
          },
        },
        h(
          'div',
          { className: 'dsh-ds-main' },
          h('span', { className: 'dsh-ds-glyph' }, h(Glyph, { kind: notice.kind, size: 14 })),
          h(
            'span',
            { className: 'dsh-ds-text' },
            h(
              'span',
              { className: 'dsh-ds-head' },
              h('span', { className: 'dsh-ds-kind' }, kindLabel(t, notice.kind)),
              notice.count > 1 ? h('span', { className: 'dsh-ds-count' }, `+${notice.count - 1}`) : null,
            ),
            h('span', { className: 'dsh-ds-title' }, notice.title),
            meta !== '' ? h('span', { className: 'dsh-ds-meta' }, meta) : null,
          ),
          h(
            'span',
            { className: 'dsh-ds-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-ds-btn',
                onClick: (event) => {
                  event.stopPropagation()
                  props.onOpen()
                },
              },
              t('notice.details'),
            ),
            canDismiss
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-ds-icon-btn',
                    'aria-label': t('notice.dismiss'),
                    onClick: (event) => {
                      event.stopPropagation()
                      props.onDismiss()
                    },
                  },
                  '\u00d7',
                )
              : null,
          ),
        ),
      )
    }

    // --- detail panel ---------------------------------------------------------

    function IncidentRow(props) {
      const t = props.t
      const incident = props.incident
      const lang = activeLang()
      const resolved = incident.active !== true && incident.status === 'resolved'
      const kind = resolved ? 'recovery' : incident.severity === 'outage' ? 'outage' : 'degraded'
      const components = Array.isArray(incident.components) ? incident.components : []
      const href = safeHref(incident.link)
      return h(
        'div',
        { className: 'dsh-ds-row', 'data-kind': kind },
        h(
          'div',
          { className: 'dsh-ds-row-head' },
          h('span', { className: 'dsh-ds-badge' }, t(resolved ? 'badge.resolved' : 'badge.active')),
          h('span', { className: 'dsh-ds-row-title' }, incident.title),
        ),
        h(
          'div',
          { className: 'dsh-ds-hint' },
          `${formatAbsolute(incident.updatedAt, lang)}${components.length > 0 ? ' \u00b7 ' + components.join(' / ') : ''}`,
        ),
        incident.summary !== undefined && typeof incident.summary === 'string' && incident.summary !== ''
          ? h('div', { className: 'dsh-ds-summary' }, incident.summary)
          : null,
        href !== null
          ? h(
              'a',
              {
                className: 'dsh-ds-link',
                href,
                target: '_blank',
                rel: 'noopener noreferrer',
              },
              t('detail.link') + ' \u2197',
            )
          : null,
      )
    }

    function EventRow(props) {
      const t = props.t
      const event = props.event
      const lang = activeLang()
      return h(
        'div',
        { className: 'dsh-ds-row', 'data-kind': event.kind },
        h(
          'div',
          { className: 'dsh-ds-row-head' },
          h('span', { className: 'dsh-ds-badge' }, kindLabel(t, event.kind)),
          h('span', { className: 'dsh-ds-row-title' }, event.title),
        ),
        h('div', { className: 'dsh-ds-hint' }, formatRelative(event.at, lang)),
      )
    }

    function DetailPanel(props) {
      const t = props.t
      const lang = activeLang()
      const notice = props.notice
      const form = typeof props.form === 'string' ? props.form : settings.form
      const size = typeof props.size === 'string' ? props.size : settings.size
      const [showSettings, setShowSettings] = useState(false)
      const closeRef = useRef(null)
      const health = status?.health ?? 'unknown'
      const active = Array.isArray(status?.active) ? status.active : []
      const events = Array.isArray(status?.events) ? status.events : []
      const incidents = Array.isArray(status?.incidents) ? status.incidents : []
      const checkedAt = Number(status?.checkedAt) || 0
      const error = lastError
      const feedUrl = status?.source ?? status?.defaults?.feedUrl ?? ''
      useEffect(() => {
        closeRef.current?.focus?.()
      }, [])
      return h(
        'div',
        {
          className: 'dsh-ds-card dsh-ds-detail',
          'data-form': form,
          'data-kind': notice.kind,
          'data-size': size,
          role: 'region',
          'aria-label': t('aria.notification'),
          onKeyDown: (event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              props.onCollapse()
            }
          },
        },
        h(
          'div',
          { className: 'dsh-ds-detail-head' },
          h('span', { className: 'dsh-ds-glyph' }, h(Glyph, { kind: notice.kind, size: 16 })),
          h(
            'div',
            { className: 'dsh-ds-detail-heading' },
            h('div', { className: 'dsh-ds-detail-title' }, t('detail.title')),
            h(
              'div',
              { className: 'dsh-ds-hint' },
              `${healthLabel(t, health)} \u00b7 ${t('detail.lastChecked', { time: checkedAt > 0 ? formatRelative(checkedAt, lang) : t('notice.never') })}`,
            ),
          ),
          h(
            'button',
            {
              ref: closeRef,
              type: 'button',
              className: 'dsh-ds-icon-btn',
              'aria-label': t('detail.close'),
              onClick: props.onCollapse,
            },
            '\u00d7',
          ),
        ),
        h(
          'div',
          { className: 'dsh-ds-detail-body' },
          error !== null ? h('div', { className: 'dsh-ds-error' }, t('detail.error', { error })) : null,
          active.length > 0
            ? h(
                'div',
                { className: 'dsh-ds-section' },
                h('div', { className: 'dsh-ds-h3' }, t('detail.active')),
                active.map((incident) => h(IncidentRow, { key: `active-${incident.id}`, t, incident })),
              )
            : null,
          events.length > 0
            ? h(
                'div',
                { className: 'dsh-ds-section' },
                h('div', { className: 'dsh-ds-h3' }, t('detail.changes')),
                events.slice(0, 6).map((event) => h(EventRow, { key: event.key, t, event })),
              )
            : null,
          incidents.length > 0
            ? h(
                'div',
                { className: 'dsh-ds-section' },
                h('div', { className: 'dsh-ds-h3' }, t('detail.recent')),
                incidents.slice(0, 5).map((incident) => h(IncidentRow, { key: `recent-${incident.id}`, t, incident })),
              )
            : null,
          active.length === 0 && events.length === 0 && incidents.length === 0
            ? h('div', { className: 'dsh-ds-section' }, h('div', { className: 'dsh-ds-hint' }, t('detail.empty')))
            : null,
          feedUrl !== '' ? h('div', { className: 'dsh-ds-hint' }, t('detail.source', { url: feedUrl })) : null,
          showSettings ? h(SettingsForm, { t, inlinePreview: true }) : null,
        ),
        h(
          'div',
          { className: 'dsh-ds-detail-foot' },
          h('button', { type: 'button', className: 'dsh-ds-btn', onClick: () => void fetchState(true) }, t('detail.refresh')),
          h(
            'button',
            { type: 'button', className: 'dsh-ds-btn', onClick: () => setShowSettings((value) => !value) },
            showSettings ? t('detail.hideSettings') : t('detail.settings'),
          ),
          h(
            'a',
            {
              className: 'dsh-ds-btn',
              href: STATUS_PAGE,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            t('detail.openStatus') + ' \u2197',
          ),
          typeof props.onDismiss === 'function' && notice.type !== 'idle' && notice.type !== 'status'
            ? h(
                'button',
                { type: 'button', className: 'dsh-ds-btn', onClick: props.onDismiss },
                t('notice.dismiss'),
              )
            : null,
        ),
      )
    }

    function healthLabel(t, health) {
      switch (health) {
        case 'outage':
          return t('status.outage')
        case 'degraded':
          return t('status.degraded')
        case 'maintenance':
          return t('status.maintenance')
        case 'ok':
          return t('status.ok')
        default:
          return t('status.unknown')
      }
    }

    // --- overlay entry --------------------------------------------------------

    function OverlayEntry() {
      const t = useT()
      useStore()
      const [expanded, setExpanded] = useState(false)
      const [insets, setInsets] = useState(() => measureFrameInsets())
      const notice = computeNotice()
      const noticeKey = notice?.key ?? null

      // Keep the content-column insets in sync with sidebar/right-panel changes.
      useEffect(() => {
        let raf = null
        let settleTimer = null
        const measure = () => {
          if (raf !== null) return
          raf = window.requestAnimationFrame(() => {
            raf = null
            setInsets(measureFrameInsets())
          })
        }
        // The shell animates grid-template-columns, so a measurement taken when
        // the toggle starts is stale. Re-measure after the transition settles,
        // with a fallback timer for shells that do not fire transitionend.
        const settle = () => {
          if (settleTimer !== null) window.clearTimeout(settleTimer)
          settleTimer = window.setTimeout(() => {
            settleTimer = null
            measure()
          }, 700)
        }
        const update = () => {
          measure()
          settle()
        }
        window.addEventListener('resize', update)
        const overlay = document.querySelector('[data-shell-overlay]')
        const frame = overlay?.parentElement ?? null
        const onTransitionEnd = (event) => {
          if (event.propertyName === 'grid-template-columns') measure()
        }
        frame?.addEventListener('transitionend', onTransitionEnd)
        const observer =
          frame !== null && typeof window.MutationObserver === 'function'
            ? new window.MutationObserver(update)
            : null
        observer?.observe(frame, {
          attributes: true,
          attributeFilter: [
            'style',
            'data-sidebar-collapsed',
            'data-sidebar-drawer',
            'data-rightbar-collapsed',
            'data-rightbar-fullscreen',
            'data-animating',
          ],
        })
        update()
        return () => {
          window.removeEventListener('resize', update)
          frame?.removeEventListener('transitionend', onTransitionEnd)
          observer?.disconnect()
          if (raf !== null) window.cancelAnimationFrame(raf)
          if (settleTimer !== null) window.clearTimeout(settleTimer)
        }
      }, [])

      // Appearance demo: while the Host reports `demo` ('positions' | 'sizes'),
      // cycle through the requested matrix with sample content (saved settings
      // untouched).
      const demoMode = status?.demo === 'positions' || status?.demo === 'sizes' ? status.demo : null
      const demoSteps = demoMode !== null ? buildDemoSteps(demoMode) : null
      useEffect(() => {
        if (demoMode === null) return undefined
        demoIndex = 0
        bump()
        const steps = buildDemoSteps(demoMode)
        const timer = window.setInterval(() => {
          demoIndex = (demoIndex + 1) % Math.max(1, steps.length)
          bump()
        }, DEMO_MS)
        return () => window.clearInterval(timer)
      }, [demoMode])
      const demoStep =
        demoSteps !== null && demoSteps.length > 0 ? demoSteps[demoIndex % demoSteps.length] ?? null : null

      useEffect(() => {
        if (notice === null) return undefined
        if (
          notice.type === 'ongoing' ||
          notice.type === 'idle' ||
          notice.type === 'status' ||
          notice.type === 'connection'
        ) {
          return undefined
        }
        const seconds = Number(settings.autoHideSeconds)
        if (!Number.isFinite(seconds) || seconds <= 0) return undefined
        const timer = window.setTimeout(() => dismiss(notice.key), seconds * 1000)
        return () => window.clearTimeout(timer)
      }, [noticeKey, settings.autoHideSeconds])

      useEffect(() => {
        if (notice === null && expanded) setExpanded(false)
      }, [noticeKey, expanded])

      if (notice === null && demoStep === null) return null

      const demo = demoStep !== null
      const demoMeta = demo
        ? [t(`settings.form.${demoStep.form}`), demoStep.size ? t(`settings.size.${demoStep.size}`) : null, t(`settings.position.${demoStep.position}`)]
            .filter((part) => part !== null)
            .join(' · ')
        : ''
      const activeNotice = demo
        ? {
            key: 'demo',
            type: 'demo',
            kind: demoStep.kind,
            title: t(`demo.${demoStep.kind}`),
            at: Date.now(),
            meta: demoMeta,
          }
        : notice

      // The persistent indicator is always a pill with its own position setting,
      // independent from the notice position.
      const statusPill = activeNotice.type === 'idle' || activeNotice.type === 'status'
      const form = demo ? demoStep.form : statusPill ? 'pill' : settings.form
      const position = demo
        ? demoStep.position
        : statusPill
          ? positionFor('pill', settings.statusPosition)
          : positionFor(form, settings.position)
      const size = demo ? demoStep.size ?? settings.size : settings.size
      const topExtra = (() => {
        const value = Number(status?.defaults?.topOffsetPx)
        if (Number.isFinite(value)) return Math.min(400, Math.max(0, Math.round(value)))
        return 90
      })()
      const handleDismiss = () => {
        if (activeNotice.type === 'event') {
          const active = findActiveForEvent(activeNotice.event)
          dismiss(activeNotice.key, active !== null ? activeKey(active) : null)
        } else {
          dismiss(activeNotice.key)
        }
      }
      const content = demo
        ? h(NoticeCard, { notice: activeNotice, t, form, size, onOpen: () => {}, onDismiss: () => {} })
        : expanded
          ? h(DetailPanel, {
              notice: activeNotice,
              t,
              form,
              size,
              onCollapse: () => setExpanded(false),
              onDismiss: handleDismiss,
            })
          : h(NoticeCard, {
              notice: activeNotice,
              t,
              size,
              onOpen: () => setExpanded(true),
              onDismiss: handleDismiss,
            })

      return h(
        React.Fragment,
        null,
        h('style', null, CSS),
        h(
          'div',
          {
            className: 'dsh-ds-layer',
            'data-form': form,
            'data-position': position,
            'data-size': size,
            style: {
              '--dsh-ds-inset-left': `${insets.left}px`,
              '--dsh-ds-inset-right': `${insets.right}px`,
              '--dsh-ds-top-extra': `${topExtra}px`,
            },
          },
          h(
            'span',
            { className: 'dsh-ds-sr', role: 'status', 'aria-live': 'polite' },
            `${kindLabel(t, activeNotice.kind)}: ${activeNotice.title}`,
          ),
          content,
        ),
      )
    }

    // --- settings page --------------------------------------------------------

    function SettingsPage() {
      const t = useT()
      useStore()
      const lang = activeLang()
      const health = status?.health ?? 'unknown'
      const kind = healthKind(health)
      const checkedAt = Number(status?.checkedAt) || 0
      const active = Array.isArray(status?.active) ? status.active : []
      const feedUrl = status?.defaults?.feedUrl ?? ''
      const error = lastError
      return h(
        'div',
        { className: 'dsh-ds-page', 'aria-label': t('aria.settings') },
        h('style', null, CSS),
        h(
          'div',
          { className: 'dsh-ds-page-head' },
          h('h2', { className: 'dsh-ds-h2' }, t('brand')),
          h('p', { className: 'dsh-ds-hint' }, t('settings.description')),
          h(
            'div',
            { className: 'dsh-ds-statusline' },
            h(
              'span',
              { className: 'dsh-ds-status-badge', 'data-kind': kind },
              h('span', { className: 'dsh-ds-dot' }),
              healthLabel(t, health),
            ),
            h(
              'span',
              { className: 'dsh-ds-hint' },
              checkedAt > 0 ? t('settings.lastCheck', { time: formatRelative(checkedAt, lang) }) : t('notice.never'),
            ),
            h(
              'button',
              { type: 'button', className: 'dsh-ds-btn', onClick: () => void fetchState(true) },
              t('detail.refresh'),
            ),
          ),
          active.length > 0
            ? h('p', { className: 'dsh-ds-hint' }, t('settings.activeCount', { count: active.length }))
            : null,
          error !== null ? h('div', { className: 'dsh-ds-error' }, t('settings.error', { error })) : null,
          feedUrl !== '' ? h('p', { className: 'dsh-ds-hint' }, t('settings.feed', { url: feedUrl })) : null,
        ),
        h('hr', { className: 'dsh-ds-divider' }),
        h('h3', { className: 'dsh-ds-h3' }, t('settings.title')),
        h(SettingsForm, { t, inlinePreview: true }),
      )
    }

    // --- apply ----------------------------------------------------------------

    function apply(ctx) {
      const adoptLocale = (locale) => {
        if (locale === null || locale === undefined) return
        localeService = locale
        if (typeof locale.register !== 'function') return
        ctx.effect(() => {
          const disposers = []
          try {
            disposers.push(locale.register(NS, 'zh', zh))
            disposers.push(locale.register(NS, 'en', en))
          } catch {
            // a duplicate registration from a previous generation is harmless
          }
          bump()
          return () => {
            for (const dispose of disposers) {
              try {
                dispose()
              } catch {
                // already disposed
              }
            }
          }
        }, `${NS}: dictionaries`)
      }

      adoptLocale(ctx.get('locale'))
      if (localeService === null) ctx.inject(['locale'], (sub) => adoptLocale(sub.locale))

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'deepseek-status.notice',
            // Below every shipped overlay entry (menus, toasts, dialogs) so an
            // open header dropdown is never covered by the notice.
            order: -100,
            label: () => tNow('tab.label'),
          },
          OverlayEntry,
        ),
      )

      ctx.slots.inject('settings.plugins.tab', () =>
        ctx.slots.register(
          {
            name: 'settings.plugins.tab',
            id: 'deepseek-status',
            order: 60,
            label: () => tNow('tab.label'),
          },
          SettingsPage,
        ),
      )
    }

    // `slots` is the hard dependency; `locale` is optional because the built-in
    // dictionaries already cover a composition without it.
    return { apply, inject: ['slots'] }
  },
})
