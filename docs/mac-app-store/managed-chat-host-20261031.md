# 用户无需终端的聊天接入

2026-10-31。本轮把“服务由用户启动”改为“受审代码随包、由球球管理”。目录授权、厂商身份、模型执行和原桌面任务状态分别核验，不能用一处成功代表全部完成。

## Codex：包内 stdio helper

- 构建阶段从官方 npm `@openai/codex@0.166.0-darwin-arm64` 取得二进制，不复制已安装 Codex/ChatGPT App 的私有产物。npm 元数据许可为 Apache-2.0；版本对应的官方 LICENSE 和 NOTICE 随包保留。下载归档验证固定 SHA512，许可文件验证 SHA256。
- `desktop-pet/scripts/prepare-mas-codex-helper.js` 仅供构建执行，输出到忽略目录 `desktop-pet/build/qiuqiu-codex/<platform>-<arch>/`。运行时没有下载、安装、shell、端口配置或临时配对发现。
- `createBundledCodexChatRpc({resourcesPath, profileHome, workspaceDir, onNotification, onDisconnect})` 返回现有聊天 RPC。只执行 `Resources/qiuqiu-codex/.../codex`，校验固定版本、平台、架构、摘要与许可文件。缺失或篡改即受阻，绝不退回外部 App/PATH。
- helper 通过 stdio 连接，退出球球关闭其自有进程。`HOME` 和 `CODEX_HOME` 使用球球自有 profile，不读/复制原 `.codex/auth.json`，不改原 Codex 配置；继承环境中的其他模型密钥和路由被清除。首次需要本人在官方网页登录，之后沿用球球自有登录。
- `rpc.startLogin()` 返回 `{authUrl}`，仅允许 HTTPS 官方登录域名，由 main 一次性打开浏览器，不放入公共状态/日志。`account/login/completed` 通知只投影 `{success}`，main 随后重新 `readAccount` 核验身份再连接聊天。`cancelLogin()` 仅取消本连接创建的登录。
- 浏览器认证的 localhost 回调是 helper 生命周期内的实现细节，用户无需启动或配置它。真正 MAS 包仍需验证 `network.client`、`network.server`、包内继承沙盒 helper 签名与登录回调。

打包次序：复制 helper/许可证 → 对 helper 使用继承沙盒 entitlements 签名 → 更新 `manifest.binarySha256`（签名会修改 Mach-O）→ 最后签整个 App。不能把开发时原始摘要当最终签名摘要。

## 已验证范围

本机官方 npm 二进制在球球自有空 profile 中，stdio `initialize` / `config/read` / `account/read` 成功，未登录正确返回 false。官方 `account/login/start` 返回 `auth.openai.com` 的登录地址后立即取消。未打开浏览器、未输入凭据、未读取原登录、未创建模型轮次。

75 项 Codex RPC/包内模块检查通过，包括固定二进制无回退、篡改与软链拒绝、隔离 profile/环境、浏览器登录 URL 限制、登录结果脱敏和取消。此证据不代表本人登录完成、模型聊天或真正 MAS 沙盒已通过。

## ZCode 与 WorkBuddy

ZCode 现有实验聊天依赖已安装 App 中的 `zcode.cjs` 和私有配置；本轮没有确认厂商允许再分发该产物。不能把它复制入商店包或在沙盒中自动执行外部 App 来冒充完成。官方 Hooks 可以提供事件，但需要厂商支持的配置入口与可信事件接收；尚不能等同所有原桌面任务实时同步。

WorkBuddy 后续核对发现官方 npm 包附有 `LICENSE.txt`，是 Tencent Cloud 2023 的标准 MIT 许可，允许分发；此前仅凭 package.json 的 `SEE LICENSE IN README.md` 未找到许可的判断不完整，现已更正。新增受管理包内 CLI 路线，见下节。云端 OAuth/Open API 的企业主体门槛仍单独存在，未绕过。

对于缺少可交付产物的厂商，UI 应说明“聊天接入尚未就绪”，保留已经授权且真实可读的额度/历史任务能力；不能显示手工终端配置说明，更不能假装全部已连接。

官方来源（本轮核对）：

- [Codex app-server：官方浏览器登录和 stdio](https://learn.chatgpt.com/docs/app-server)
- [Codex Apache-2.0 LICENSE](https://github.com/openai/codex/blob/rust-v0.166.0/LICENSE)
- [Codex NOTICE](https://github.com/openai/codex/blob/rust-v0.166.0/NOTICE)
- [CodeBuddy CLI 安装与 SDK 文档入口](https://www.workbuddy.cn/docs/cli/installation)
- [苹果审核规则 2.4.5](https://developer.apple.com/app-store/review/guidelines/#hardware-compatibility)


## WorkBuddy：包内官方 CLI 与本人独立登录

构建脚本 `desktop-pet/scripts/prepare-mas-workbuddy-helper.js` 用提交的 `desktop-pet/vendor/workbuddy-cli/package-lock.json` 执行官方 npm ci，固定 CodeBuddy CLI 2.179.0 与依赖完整性；`--ignore-scripts --omit=optional` 不执行安装脚本、不装可选原生工具。随包保留所有保留依赖的许可证，并删除本模式不需要的 vendor shell/搜索/回收站原生工具、类型声明和文档。最终素材为2506文件，不含用户配置或凭据。

运行时 `startBundledWorkBuddy({resourcesPath,profileHome,workspaceDir,onExit,signal})` 只允许包内经过摘要验证的 JS entry，通过 Electron `utilityProcess.fork` 使用内置 Node；不用外部 node/npm、终端、配对文件或其他 App。自有 HOME/profile/workspace，继承厂商凭据和 NODE_OPTIONS 清除；tools 空、deny */mcp__*、禁 hooks、空 strict MCP。自动更新和后台任务关闭。loopback 端口与随机网关密码由球球私有管理，不让用户配置，不给浏览器打开全权限网关页面。

本轮真实 Electron utilityProcess 测得完整资源摘要校验1786ms；启动、ACP握手、账号查询和发起官方登录到收到URL共6599ms（此数还包含重复一次摘要校验）。空profile `_codebuddy.ai/getUserInfo` 确认 `authenticated:false`；不能把网关口令校验或创建空会话视为厂商已登录。

使用顺序：

1. 启动包内宿主，将私有 endpoint/gatewayPassword/workspaceDir 交 `createWorkBuddyLocalCliClient`。
2. `client.connect()` 完成 ACP initialize，然后 `getVendorAccount()` 只投影 authenticated / liveEntitlementVerified，不暴露原响应中的 token、账户ID或姓名。
3. 如果未登录，显式 `client.authenticate({methodId:'internal',signal,onAuthUrl})`。官方 `_codebuddy.ai/authUrl` 通知只交主进程回调，校验 HTTPS、明确官方域名、无用户名密码/端口/fragment。CLI 的 BROWSER 固定为包内不存在路径，阻止其自行调用外部浏览器；由主进程单独打开验证后的官方登录URL。
4. 本人完成登录后，authenticate 成功必须带官方 `_meta['codebuddy.ai/userinfo'].userId`。再次 getVendorAccount 确认后连接专用会话。已登录profile复用身份，不再次authenticate（该官方方法会强制退出后重登）。

实际无登录探针已收到 `copilot.tencent.com` 的官方 HTTPS 登录URL，随后主动取消；未打开浏览器、未输入凭据、未访问原profile、未发模型。33项WB包内模块/客户端检查通过。当前证明包内托管及登录入口可用，尚不代表本人登录完成、真实模型回复或最终 MAS 沙盒通过。


## WorkBuddy 连续会话契约

客户端新增 `getVendorAccount().accountKey`：仅已登录时返回 `SHA256("codebuddy:" + userInfo.userId)`，不暴露原ID/token。持久会话由上层绑定此账号hash及专用workspace；换账号不能恢复旧会话。

`createWorkBuddyLocalCliClient({...,restorableSessionIds:[savedOwnId]})` 只接受球球自己保存的可恢复ID。`connect()` 必须读到 `initialize.agentCapabilities.loadSession===true` 才允许 `loadSession({sessionId})`。加载前只查询固定 `GET /api/v1/sessions?cwd=<专用workspace>`，要求own ID在索引中；官方2.179.0单项目列表可以省略cwd字段（只有跨项目`cwd=*`才带cwd），如果响应带cwd必须严格匹配。没有跨项目扫描、writer强制接管或默认新建回退。

请求按[官方 ACP session/load 契约](https://agentclientprotocol.com/protocol/v1/session-setup)发送 `sessionId/cwd/mcpServers:[]`；响应必须确认 `modes.currentModeId===dontAsk`，如带sessionId则必须匹配。历史重放不流入当前UI消息，只有验证完成才授予该连接prompt/cancel权限。上层恢复自己保存的消息，不能把读取原WorkBuddy桌面会话作为此恢复入口。

客户端及包内WB模块37项检查通过，覆盖账号投影、所有权、cwd索引、能力位、错误模式、重放不重复、拒绝未知会话且不自动新建。本轮新空profile的真实零模型探针中，账号未登录且session/new正确拒绝；因此尚未实际完成真实账号session/load，需要主Agent在已登录候选中验证重启后原会话和上下文。
