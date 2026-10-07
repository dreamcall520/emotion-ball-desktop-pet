# 便签与待办真实界面演示

来源：公开 `main@7f5c291d34512f629c17275c93bed472f421e8b9`，正式版本 `0.4.00`。`notes.css`、`color-mode.css`、`notes-renderer.js` 与 `lib/notes-model.js` 逐字节保持官方内容，SHA-256 见 `source-manifest.json`。三个 HTML 基于原 `notes.html`：仅在 renderer 前插入 `demo-bridge.js`，并将整理账户说明精简为保留原意、确认后替换的实用提示；布局、控件、字号和原生 dialog 不变。

推荐嵌入片段为 `embed-fragment.html`（同时交付 `/tmp/qiuqiu-notes-native-fragment.html`）。父页在该 markup 后加载 `demos/notes/embed.js`，使用已有通用 `demo-embed.js` 向 `data-app-demo` iframe 发送主题。

- 主窗口：380 × 520；桌面便签：300 × 220；体验提醒时第二窗口切换为原始提醒页 360 × 190。
- 父页只需使 iframe 宽度为 `min(100%, 原始宽度)`、手机单列；不使用 transform 缩放。320px 页宽已验证，两窗口实际宽与 scrollWidth 均为 288px。
- 只使用合成记录和本页内存，不读写用户文件、账号或 localStorage。刷新/重置演示会重新建立内存状态。复制控件只在用户点击后使用浏览器 Clipboard API；整理为本地分行示例，不连接模型；提醒只展示网页卡片，不发送系统通知。

## 消息协议

两个 iframe 和父页必须同源。父页使用 `embed.js`，为本页建立随机 `demoScope` 并写入两个 iframe URL。主窗口是唯一内存数据源，桌面窗口通过父页转发 RPC；保存会校验 revision，拒绝覆盖另一窗口的新内容。

- 主题（已有通用父页发送）：`{type:'qiuqiu-demo-theme', appearance:'light'|'dark', colorMode:'standard'|'accessible', uiTheme:'green'|'blue'}`。子页同时检查 `event.origin === location.origin` 和 `event.source === parent`；新增蓝色样式覆盖来自公开 0.4.03，旧版 renderer 保持不变。
- 便签消息公共字段：`{type:'qiuqiu-notes-demo', scope, from:'panel'|'desktop', kind, ...}`。父页再检查来源是对应的实际 iframe、scope 和 from 一致。
- `request`：桌面 → 父页 → 主窗口，携带 `method, args, requestId`；`response`：主窗口 → 父页 → 桌面，携带 `requestId, result` 或 `error`。
- `state` / `reminder`：主窗口 → 父页 → 桌面，携带内存快照。父页只转发，不保存业务状态。
- `view`：主窗口通知父页显示/关闭桌面区域，或切为原始提醒页，携带 `view:'note'|'reminder', open, id`；`panel-visibility` 用于主窗口关闭/找回。
- `show-reminder` / `reopen-note`：父页外围体验/找回控件 → 主窗口；`notice` 只显示已发生操作的结果。

## 验证

从官网目录运行：`node demos/notes/check.cjs`。检查官方资产哈希、内存更新与旧 revision 拒绝、恢复/打开、仅预览整理、可信主题消息、提醒 occurrence 和稍后处理。

浏览器复跑：先 `node demos/notes/check.cjs --serve`，再使用独立 Playwright CLI session 打开 `http://127.0.0.1:9062/__notes-check`，运行 `run-code --filename demos/notes/browser-check.cjs`。该 fixture 仅用于核验，不是官网另一个展示入口。

原始 iframe 浏览器闭环已通过，结果见 `browser-verification.json`：收藏、双窗自动保存、整理预览/确认/撤销、搜索、分类与便签新建、关闭找回、回收站恢复、日期/提醒独立、真实提醒卡与稍后、完成/归档恢复、深色/色弱、320px 无横向溢出、主面板关闭重开。没有页面错误，外部请求为 0。
