# ZCode 原工具任务事件插件候选

2026-10-31，固定官方源码 v3.17.1，提交 `a60ba6a7e5a06742270ca605f5d2cc2766afa7e1`。这里只准备已审查源侧过滤脚本和接收器；没有安装、启用或读取原用户目录，没有发送模型消息。不能把合成测试当作原生 ZCode 接入成功。

## 契约与边界

- 官方 `.zcode-plugin/plugin.json`，标准 `hooks/hooks.json` 自动发现，manifest 不重复声明 hooks 文件。市场采用官方文档支持的 `.claude-plugin/marketplace.json`，目录 source 相对市场根目录。这里只生成本机市场，不注册到原工具。
- 固定事件仅 `SessionStart`、`UserPromptSubmit`、`Stop`。该版本没有 `SessionEnd` / `FinalStop` / `StopFailure`，不借用 WorkBuddy 契约。
- stdin 原生字段是 `sessionId`、可选 `turnId`、`hookEventName`；runtime 另有 `session_id` / `hook_event_name` 兼容别名，但没有 `generation_id`。过滤器仅从原生字段提取，导出 version/sessionId/turnId/event/phase。
- `ZCODE_PLUGIN_ROOT` 由官方runtime注入。系统sh/head/plutil/curl执行，无用户Node依赖、终端、端口或服务器配置。Hook输入可能含提示词、回复或工具数据；需本人当次明确同意安装/启用后才可使用。当前授权不扩展到读取原聊天正文。
- 插件本身只在有界内存读取最多256KiB stdin，不读临时transcript，不保存/转发正文、标题、路径、凭据，不把它们放入argv或日志。**官方runtime本身会临时写入transcript并传入路径**；这不是本插件行为，不能声称原工具完全不落正文。插件不读取该文件。
- 默认没有 receiver.json，不发送任何内容。需球球在本人确认后生成 mode600 本机能力配置，安装到插件目录。仅固定127.0.0.1 `/zcode/events`、Bearer鉴权；curl禁用用户配置及环境代理，token在stdin配置中，不入URL/argv。原任务不因观察失败而阻塞。
- 官方Stop Hook执行后仍可要求本轮继续。因此 Stop 只表示“停止候选”，不代表主回复结束/任务完成。桥接不输出completed/failed/interrupted终态，running为null，terminalConfirmed/overallTaskVerified恒false。不能用缓存completed补齐真实终态。

## 接收器

`desktop-pet/lib/zcode-desktop-event-bridge.js` 导出 `createZcodeDesktopEventBridge` / `parseMetadata`。默认不监听，不读写文件；`start()` 返回私有配置，`start({port,token})`用于球球已授权配置恢复；`getState()`只返回安全状态和哈希标识观察；`close()`停止接收。接口兼容WorkBuddy桥接，端点和负载契约独立。

严格白名单解析2KiB元数据，未知key在解释其值前拒绝；拒绝浏览器Origin、未知路由/查询、无效能力；限流、超时、canonical去重、有界观察、状态过期。收到事件只证明事件源存在；无account归属证明、无任务最终态证明。

## 验证

已通过官方creator只读preflight；另一只读排查核对本机公开安装包ZCode3.16.3，相关事件、字段、插件root与Stop续跑语义相同，摘要见来源回执。未加载用户配置。

18项合成检查通过：白名单/字段、源侧过滤到真实127接收器、禁代理/默认关闭、未知event/正文key拒收、鉴权、路由、2KiB/256KiB边界、去重、受控端口恢复、过期/关闭、Stop不冒充完成。只读preflight不替代官方CLI/runtime schema与真实App安装验证。

后续：本人确认插件范围→原ZCode本机市场导入/安装→一条不调用工具测试→球球原生UI回读SessionStart/提交/Stop候选；只有真实回读后记录原工具事件已接通。真正Electron MAS包仍需相同操作再验。

来源与逐文件摘要见 `source-evidence-20261031.json`，其中固定链接直接指向官方源码。

## 后续实际安装

用户随后明确批准后，原ZCode3.16.3安装启用、唯一合成消息及球球提交/Stop候选回读已通过，重启原连接恢复。上文“没有安装”描述初始草稿阶段；最新边界与证据见`../zcode-desktop-live-20261031.md`。
