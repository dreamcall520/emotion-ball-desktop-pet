# R26 固定 AI 组件数据行为静态核查

核查日期：2026-11-01。范围：球球随包 Codex **0.166.0**、CodeBuddy Code **2.179.0**，球球启动适配器与官方文档。只读组件源码；未读取账号、环境变量实际值、运行日志、登录资料或聊天记录，未启动组件、未发模型请求、未修改任何配置或资源。本文件不是抓包结果、法律意见或 App Store 隐私标签最终结论。以下“当前代码”描述本轮关闭补丁前的审计基线；同日后续源码改动见文末，不能将源码测试当发行包运行验证。

## 结论与尚缺证据

**当前不能据此将整个 App 填成“不收集数据”。** 组件有独立的统计、诊断和可配置内容导出路径；球球当前适配器没有显式关闭下表全部通道。用户主动聊天发送给选定 AI 服务的内容，还必须与后台统计分别说明。

本轮能够证明“开关及数据字段在固定组件中存在”和“球球源码设置了哪些参数”，不能证明具体某次运行实际外发了什么、保留多久、是否关联用户、是否用于跨 App 跟踪。后四项需要具体发行包的有效配置、流量/服务商资料和实际使用范围证据；不从“独立 profile”推导“无遥测”，也不从 SDK 内含字段推导“已经采集”。

## Codex 0.166.0

固定版本的 [config schema](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/config.schema.json) 与 [配置类型及默认值](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/config/src/types.rs#L589) 是本轮版本依据。

| 通道/开关 | 固定版本明确行为 | 球球当前代码 |
| --- | --- | --- |
| `analytics.enabled=false` | 关闭 OpenAI analytics；自定义 OTLP metrics 独立，不因此关闭 | 未发现对应覆盖 |
| `otel.metrics_exporter="none"` | 禁 metrics exporter；未配置的类型默认值是 `Statsig` | 未发现对应覆盖 |
| `otel.exporter="none"`、`otel.trace_exporter="none"` | 日志/trace exporter 默认 `None`，可显式禁用 | 未发现显式固定值 |
| `otel.log_user_prompt=false`、`otel.log_agent_responses=false`、`otel.log_guardian_assessments=false` | 三类内容导出默认 false；响应与评估正文还要求显式 OTLP 日志目的地 | 未发现显式固定值 |
| `feedback.enabled=false` | 禁反馈上传和后台 Guardian review retention；本地显式导出仍可用。默认 true | 未发现对应覆盖；不能据此声称球球已调用反馈 |

`analytics` 未指定时，核心配置保留 `Option<bool>`，默认可因客户端而异；analytics client 的构造逻辑在不是显式 false 时创建队列。静态证据不足以断言球球的每个 app-server 路径都实际发送；也不足以断言默认关闭。见 [核心配置解析](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/config/mod.rs#L1107)、[analytics client](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/analytics/src/client.rs#L312)。

固定版本还含 release Statsig exporter 的网络实现（debug build 的默认处理不同）。端点路径为 `ab.chatgpt.com/otlp/v1/metrics`；analytics events 使用当前 ChatGPT base URL 下的 `/codex/analytics-events/events`。这是静态目的地证据，不是本机实际联网证明。见 [OTel exporter 实现](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/otel/src/config.rs)、上述 analytics client。

可见的数据类型包括：平台/系统与组件版本、客户端标识、模型、会话/轮次标识、操作种类、状态、时长和 token 使用等。具体事件结构见 [固定版本 analytics events](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/analytics/src/events.rs)。这些是可上报字段，不是当前球球已发记录；本轮未把它们直接定为 Apple 的“与身份关联”或“跟踪”。

官方 [高级配置说明](https://developers.openai.com/codex/config-advanced/) 说明 CLI 默认有使用/健康统计、OTel 内容导出另行启用。**该活动网页关于 analytics=false 同时禁自定义 OTLP metrics 的说法，与 0.166.0 固定 schema 的独立开关说明不一致；本轮按固定 tag 保留差异，不照搬活动网页。**

球球源码证据：

- `desktop-pet/lib/mas-bundled-codex.js:11,69-83` 固定版本与独立 `HOME`/`CODEX_HOME`；清理部分厂商配置环境前缀，但没有显式 analytics/feedback/OTel 关闭值。
- `desktop-pet/lib/codex-chat-rpc.js` 中 app-server 启动覆盖主要关闭工具/实验能力、网页搜索和项目指令读取；本轮未发现上述统计开关。通用 `OTEL_` 环境名称未被适配器过滤；是否被该固定版本/路径读取，尚不能仅凭继承推断。
- 没有读取独立 profile 的实际 config 或原用户 config，因此不对现有账户的有效配置下结论。

## CodeBuddy Code 2.179.0（球球 WorkBuddy 官方组件）

官方 [环境变量参考](https://www.codebuddy.cn/docs/cli/env-vars) 列出遥测、错误报告及反馈开关；[Monitoring](https://www.codebuddy.cn/docs/cli/monitoring) 说明 OTel 自定义导出与内容 opt-in。活动文档不是固定版本源码替代品，下表明确区分。

| 开关 | 2.179.0 静态验证 | 默认/边界 |
| --- | --- | --- |
| `DISABLE_TELEMETRY=1` | 本地实现存在；standard/model event service 和 trace lifecycle 等检查此值 | 未设置时该禁用条件不生效；各通道仍有各自配置条件，不能笼统写“默认全开”或“默认全关” |
| `DISABLE_GALILEO=1` | 本地 GalileoService 初始化/重试有独立检查 | 本轮未找到官方文档承诺此开关；仅列为固定组件实现证据。不能假定只设前一开关就覆盖所有 Galileo SDK 初始化路径 |
| `CODEBUDDY_CODE_ENABLE_TELEMETRY=1` / `CLAUDE_CODE_ENABLE_TELEMETRY=1` | 本地读取两种名称，未提供时 env-enable 分支 false | 自定义 OTel 环境启用条件；组件另有 product 配置解析，不能据此证明整体遥测关闭 |
| `OTEL_TRACES_EXPORTER=none` | 本地接受 `otlp`/`console`/`none`，有显式 endpoint/header 读取 | 针对自定义 traces，不等于模型服务和全部厂商后台通信关闭 |
| `OTEL_LOG_USER_PROMPTS` / `OTEL_LOG_TOOL_DETAILS` / `OTEL_LOG_TOOL_CONTENT` | 本地 opt-in 解析存在；未设置时对应 env flag false | 可涉及 prompt/回复、参数、路径、命令、工具内容，是否实际导出还取决于有效导出通道 |
| `OTEL_LOG_RAW_API_BODIES` | 本地支持 inline 与 `file:<dir>` 模式，未设置为 disabled | 可能是请求/响应正文的导出或本地文件记录，不能将本地文件记录直接视为外发 |
| `DISABLE_ERROR_REPORTING=1` / `DISABLE_FEEDBACK_COMMAND=1` | 官方文档列出；本轮对本地包 `.js/.cjs/.json/.md` 全文检索未找到字面实现 | **仅文档支持、固定版本实际生效未证实**，不能将设置它们等同已验证关闭 |

本地源码显示：

- `StandardEventService.getConfiguration()` 读取 product 配置的 `telemetry.report.standard`；model service 读取 `telemetry.report.model`。是否启用要求有效的 `enabled=true` 及目的地。**本轮没有读取远端 product 返回值，因此生产默认开关未知。**
- GalileoService 读取 product 或环境指定配置；产品配置只有 `enable===true` 且 exporter 合法时启用。代码含腾讯 Galileo 公网与内网 collector 配置能力，不代表本次实际用了哪个。
- 本地 event processor 可附加账号 UID、昵称/企业信息；client/event 处理可含 machine/session、平台版本；trace 参数提供器可附加 workspacePath 等。已确认的是“字段与处理链存在”，不是“球球已上报这些字段”。
- 自定义 OTel 默认记录的描述包括会话/工具标识、prompt 长度等；正文/工具敏感内容另有 opt-in。**这类 OTel 内容默认不记录不能代表 standard/model/Galileo 其他通道必然不含敏感字段。**

可复核本地锚点（偏移按本次随包 JS 文本字符计，未修改资源）：

| 文件（相对于 `@tencent-ai/codebuddy-code/`） | 锚点 |
| --- | --- |
| `dist-server/codebuddy.js` | 约 2,665,751：Galileo 初始化；8,254,108：product/env Galileo 配置；8,574,856：standard report 配置；8,578,011：telemetry disable；8,580,418：model report；8,588,731：userinfo processor；8,625,420：env/privacy flags |
| `dist-server/6033.codebuddy.js` | 约 500-1,450：trace metadata 提供器（账号/平台/workspace） |
| `dist-server/2758.codebuddy.js` | 约 1,244：trace lifecycle 的 telemetry disable 检查 |
| `dist-server/9405.codebuddy.js` | 约 1,375：trace privacy/disable 处理 |
| `dist-server/2998.codebuddy.js` | 约 7,199：Galileo collector 域名路由 |

关键文件 SHA256：

- `dist-server/codebuddy.js`: `e52dbfacc3d1f7ec9b81e040a9b212c151b44494d50076afc88494065b94e916`
- `dist-server/6033.codebuddy.js`: `fdb0eb9fb863905e6e599d4687172e2ae0fa977392053772b55e619b0897a816`
- `dist-server/2758.codebuddy.js`: `31105533feaac78ee8692c6087685eaeca78013ef40455e20f9738dffd29dba6`
- `dist-server/9405.codebuddy.js`: `07d8e82e7b5c99d68d849a14da483acdfdbf98500f431c32d5b223dd6782dc81`
- `dist-server/2998.codebuddy.js`: `9d71dfd054995efc863b614680ffd5f132be98a81d6b09c460d0eede4dbc2c3f`

球球 `desktop-pet/lib/mas-bundled-workbuddy.js:40-58` 当前显式设置独立 HOME/config、禁自动更新、定时/后台能力、空工具和空 MCP 等；**没有显式设置 `DISABLE_TELEMETRY`、`DISABLE_GALILEO`、OTel exporter 或内容 opt-in 为关闭**。它过滤 `CODEBUDDY_` 等厂商前缀，但 `OTEL_`、`CLAUDE_CODE_`、`GALILEO_` 和通用 `DISABLE_*` 环境名未统一过滤；本轮未读取其实际值，不能推定当前设备继承结果。

## 对上架资料的直接影响

1. 本轮有充分理由拒绝未经证明的整体“不收集”结论；**没有据此预填任何 Apple 数据类别、关联身份或跟踪答案**。
2. “聊天必需上传内容”“独立账号认证”“后台使用统计/诊断”“本地历史保存”应分别核实，不能用一个用户聊天授权概括全部后台用途。
3. 关闭非必要遥测的方案已有部分官方/固定版本开关依据；是否落地由主线程另行决定，本次没有新增功能、改配置、改组件、启动登录或模型。
4. 即使将来加了关闭值，也需对实际发行包验证生效；登录/模型等必需通信与服务商留存规则仍需独立说明，不能把“关遥测”直接写成“零数据处理”。


## 同日后续：非必要遥测关闭源码候选

主线程明确要求后，源码补充了仅针对球球随包子进程的关闭值，未改原工具配置或父环境：

- Codex 随包 wrapper 强制使用固定布尔隐私模式；子进程启动参数显式关闭 analytics、feedback、OTel log/trace/metrics 三类 exporter 和 prompt/回复/Guardian 评估内容记录。`config/read` 必须证明这些固定值生效，否则拒绝继续初始化。普通 Codex RPC 默认行为保持，未提供任意配置注入接口。
- WorkBuddy 随包 child 环境固定 `DISABLE_TELEMETRY=1`、`DISABLE_GALILEO=1`，过滤冲突的 `OTEL_`、`GALILEO_` 及 `CLAUDE_CODE_ENABLE_TELEMETRY`；Codex child 也不继承 `OTEL_`。网络代理变量保留，父环境不变。
- 没有把未在固定版本中证实的 `DISABLE_ERROR_REPORTING` / `DISABLE_FEEDBACK_COMMAND` 当成有效保证。
- 82 项专项通过，覆盖固定参数、有效配置不匹配拒绝、原 RPC 默认不变、子环境隔离及代理保留；初始化合成测试仅握手/config 或本机网关状态，不建模型会话、不发模型消息。真实最后 MAS 开发候选的 helper 初始化与非必要外发验证仍需主线程完成。

这些源码关闭值不等于服务端不留记录，也不等于聊天/登录必需通信消失；不能直接据此填写整个 App“不收集”。
