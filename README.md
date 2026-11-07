# DeepSeek 状态监控通知插件

[![ci](https://github.com/BI4PYM/dsh-deepseek-status-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/BI4PYM/dsh-deepseek-status-monitor/actions/workflows/ci.yml)

**中文** | [English](README.en.md)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）插件：定期读取 DeepSeek 官方服务状态源（[RSS](https://status.deepseek.com/feed.rss) / [Atom](https://status.deepseek.com/feed.atom)），在 DSH 网页里显示可配置的**服务中断、性能下降、服务恢复**通知；点击通知可展开详情，也可以让一个常驻状态胶囊一直显示当前健康度。

- 仓库：<https://github.com/BI4PYM/dsh-deepseek-status-monitor>
- 安装：`dsh plugin --profile <profile> add dsh-deepseek-status-monitor`（npm 发布后；也可安装本地目录或 `.tgz`）

## 功能

- **通知形式**：气泡、横幅、胶囊；六种位置、三种大小可调，也可以各自单独设置常驻胶囊的位置。
- **通知内容**：彩色状态点 + 类型（服务中断 / 性能下降 / 服务恢复）+ 事件标题 + 相对时间；进行中事件会持续显示。
- **点击详情**：当前健康度、进行中事件、最近变化、最近事件记录（含影响组件与摘要）、状态页链接、最后检查时间。
- **常驻状态提示**：可选开启，始终显示当前状态（绿 = 正常，黄 = 性能下降/维护，红 = 中断，琥珀 = 状态检查失败）；关闭通知弹窗后它仍保留，位置与通知位置互相独立。
- **刷新控制**：按配置的间隔读取状态源；页面每 10 秒同步一次 Host 缓存，不重复冲击上游。
- **中英双语**：跟随 DSH 界面语言，也可以在插件设置里单独强制中文或 English。
- **容错**：RSS 失败自动尝试 Atom；两者都失败时保留上次快照，持续失败超过 10 分钟弹出「状态检查失败」并让常驻胶囊显示琥珀色，绝不把故障说成正常。

## 通知触发规则

| 状态源中的变化 | 通知 |
| --- | --- |
| 新出现（或重新打开）未解决事件，标题含 中断 / 不可用 / unavailable / outage | 服务中断（红色） |
| 新出现（或重新打开）未解决事件，标题含 性能下降 / 异常 / error / degraded | 性能下降（黄色） |
| 事件状态变为 `resolved` | 服务已恢复（绿色） |
| 状态源或 Host 路由持续失败超过 10 分钟 | 状态检查失败（琥珀色） |

启动时 feed 里已有的历史事件不会补弹通知；如果最新事件仍未解决，会以「进行中」通知持续显示。仅状态文字推进（investigating → identified → monitoring）或仅时间戳变化不会重复弹窗。

## 配置

在 bundle 行（`cordis.patch.yml`）中可以覆盖：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `feedUrl` | `https://status.deepseek.com/feed.rss` | 状态源地址。使用 RSS/Atom 官方地址时会自动互相回退；自定义镜像地址失败时不会回退到官方源。 |
| `refreshIntervalSeconds` | `60` | 默认检查间隔（15–3600 秒）。 |
| `requestTimeoutMs` | `10000` | 单次请求超时。 |
| `maxIncidents` | `20` | 返回给浏览器的事件条数上限。 |
| `noticeTopOffsetPx` | `90` | 顶部通知距窗口顶部的距离，通常正好在会话标题栏下方（0–400）。未来 DSH 布局变化时可调。 |
| `demo` | `false` | 外观演示：`positions` 轮播所有形式×位置，`sizes` 轮播三种大小。仅用于开发/预览，不影响真实状态与已保存设置。 |

## 应用内设置

设置 → **内置插件** → **DeepSeek 状态** 标签页，或通知详情里的「通知设置」：

- **显示语言**：自动（跟随 DSH 界面）/ 中文 / English
- 通知形式：气泡 / 横幅 / 胶囊
- 显示位置：气泡与胶囊六角可选，横幅可选顶部/底部；位置对齐在对话内容区内（自动避开左侧栏和停靠的右侧栏），顶部通知从会话标题栏下方开始
- 通知大小：小 / 中 / 大（气泡、横幅、胶囊与常驻胶囊都生效）
- 检查间隔（15–3600 秒）
- 自动消失秒数（0 = 不自动消失；进行中事件、常驻胶囊与状态检查失败通知永不自动关闭）
- 通知类型开关：服务中断 / 性能下降与维护 / 服务恢复 / 状态检查失败
- 常驻状态提示开关及其独立位置
- 测试通知、恢复默认

界面偏好保存在当前浏览器的 `localStorage`（`dsh.deepseek-status.settings.v1`），已读通知记录在 `dsh.deepseek-status.dismissed.v1`；插件不会为了这些偏好改写 profile 补丁文件。

## 安装

npm 发布后：

```sh
dsh plugin --profile <profile> add dsh-deepseek-status-monitor
```

或把本目录 / 打包好的 `.tgz` 作为 bundle 装入当前 profile：

```text
plugin_manager  action: install_bundle  target: <本目录或 .tgz 的绝对路径>
```

bundle 补丁会插入 `deepseek-status` 行，默认配置如上。

## 目录结构

| 文件 | 作用 |
| --- | --- |
| `package.json` | Bundle 清单、`dsh.bundle.patch`、`dsh.client`、locale/icon 导出 |
| `cordis.patch.yml` | 插入 Host 行的 Loader 补丁 |
| `index.js` | Host 端：轮询、同源路由、事件状态机 |
| `lib/feed.js` | 零依赖 RSS/Atom 解析、严重度分类、状态机 |
| `client.js` | 浏览器端：悬浮通知、详情面板、设置页 |
| `locale/en.json`、`locale/zh.json` | 插件管理器里的标题/描述 |
| `icon.svg` | 原创图标 |
| `test/` | 独立测试（解析、状态机、路由、语言字典），不随 npm 包发布 |
| `LICENSE` | MIT 许可证 |

## 发布

包名与发布标识已就绪：`dsh-deepseek-status-monitor`，无 `private` 标记，带 `repository` / `homepage` / `bugs` / `author` / `publishConfig.access: "public"`；`package.json` 的 `name`、`client.js` 里模块加载器的 `id`、`cordis.patch.yml` 的行名三处保持一致。

```sh
pnpm check                       # 三个入口的 node --check
node test/feed.test.mjs          # 49 项解析/状态机检查
node test/host-route.test.mjs    # 12 项路由检查
node test/locale-audit.mjs       # 88/88 语言键对称
pnpm pack                        # 检查打包文件列表（10 个文件）
pnpm publish                     # 需要已登录的 npm 账号
```

随后在 GitHub 建 release（可选），并向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提交市场收录 PR（分类 `notify`，仓库需满 1 天并带 `dsh-plugin` topic）。

## 已知限制

- 网络请求发生在 Host 进程（使用全局 `fetch`）。没有 `fetch` 的 Host 会在响应里报告失败；浏览器保留上次快照，超过宽限期后常驻胶囊会变成琥珀色「状态检查失败」，而不是假装健康。
- 通知位置对齐到对话内容列（已排除左侧栏与停靠的右侧栏）。**浮动**或**全屏**的右侧面板不参与测量，这种模式下通知可能与其重叠。
- 顶部通知使用 `noticeTopOffsetPx`（默认 90）定位，这是按当前 Harness 布局标定的常量；布局变化时可通过配置微调。
- 事件转移历史保存在内存：Host 重启会重建基线，停机期间发生的变化不会补报。
- 公共 GET 路由只提供只读状态数据，不写配置；界面偏好保存在浏览器。
- 本会话环境没有浏览器自动化，因此渲染外观未做截图级自动化验证；逻辑与契约由测试和独立审计覆盖。

## 许可证

[MIT](LICENSE)
