# ZCode 已有自定义模型：包内直接请求候选

2026-10-31，新增 `desktop-pet/lib/zcode-direct-chat-rpc.js`。这是球球自己的标准 API 客户端，不读取/执行 ZCode.app 私有代码，不安装 CLI，不开放端口，不依赖本机独立服务。

## 接入契约

`createZcodeDirectChatRpc({directoryAccess, workspaceDir, accountSource:'configured-custom', fetch, onNotification, onDisconnect})` 为同步 factory，提供与聊天组件相同的 start/readAccount/listModels/startThread/resumeThread/startTurn/interruptTurn/close。

调用者必须在用户明确选择“使用已有自定义模型（按原 API 计费）”后传入 `configured-custom`。本模块不接受官方套餐，不允许在官方套餐失败时自动调用。目录必须通过球球授权模块的 `withAccess('zcode', ...)` 提供，撤销后新请求被拒绝。

只读 `v2/provider_config.json`，不读取 credentials.json / 原聊天 / 登录令牌。API key 与自定义请求头只留主进程内存，不进入模型目录、通知、错误、聊天存储或新凭据文件。每次请求前和成功返回前重新核对配置身份，配置变化使旧连接失效。

## 支持边界

只接受已有配置**自包含**的 API key、HTTPS base URL、`openai-chat-completions` 类型及显式模型列表。按所选 base URL 拼接 `/chat/completions`；不猜供应商，不补厂商 endpoint，不从环境读取凭据，不改变原配置。禁止HTTP、URL凭据、查询串和重定向。原配置中禁用的模型不显示。

模板引用中缺失的字段不能通过复制 ZCode 内置规则来补齐。仅支持标准文本 Chat Completions；Anthropic Messages、Responses、官方套餐、加密/托管凭据和不自包含模板暂不支持，返回 `DIRECT_CONFIG_INCOMPLETE`。此结果不证明现有用户的6模型都符合条件，本轮没有读取真实配置或发真实模型消息。

不传工具定义，固定 `tool_choice:'none'`，收到工具调用返回即拒绝。当前不请求流式输出，完成后发布回复。对非标准 reasoning 参数不猜映射，目录只发布 `none`；不能宣称完全复刻 ZCode 的模型参数能力。

球球自己保存会话上下文（不保存密钥），文件600。网络结果不明、取消或异常后保留 pending，拒绝继续同一会话生成，避免自动重发。没有自动重试；后续需由产品提供明确的新会话/未知结果核对入口，不能清标记后悄悄重发。

## 验证

`node --test desktop-pet/tests/zcode-direct-chat-rpc.test.js`：8项合成测试通过，包括权限撤销、账号变化、原文件保持、路径/链接拒绝、标准请求与回复、工具阻断、响应体上限、未知结果不重发。测试用假密钥和 `.invalid` 站点 mock fetch；不代表真实接口或商店沙盒已验收。

标准协议参考：[OpenAI Chat API](https://developers.openai.com/api/reference/resources/chat)、[Kimi Code 官方 providers 文档](https://moonshotai.github.io/kimi-code/en/configuration/providers.html)。这些文档支持标准协议路线，不证明某个用户的自定义地址属于官方厂商，也不替代用户对其既有服务商的授权。

## moonshot-kimi 模板核验与产品用途阻塞

2026-10-31 追加官方资料核验：主 Agent 只读投影确认现有自定义项使用 `moonshot-kimi` 模板，保存项没有独立 API 类型/base URL。公开 ZCode 文档没有给出可固定版本的同名模板映射，不能拿本机私有 release 规则直接当成可再分发的公开契约，也不能凭模型名称猜接入地址。

[Kimi Code 官方概览](https://www.kimi.com/code/docs/en/) 区分 Coding 会员和开放平台：前者供编程工作流，产品集成应走开放平台；二者域名、密钥来源与计费不同。官方还要求客户端保持真实身份，不得伪造 User-Agent。当前官方模型清单与旧宿主6模型名称并不完全一致，因此不把旧列表作为长期静态模板。

[ZCode 官方模型接入说明](https://zcode.z.ai/en/docs/configuration) 给出的 Moonshot 一般接入使用开放平台；其 GLM Coding 端点也注明仅编程用途。这不能证明同名模板的旧会员 key 可用于球球陪聊。

故本轮不补 `moonshot-kimi` 静态模板，不替换原 key 的端点，不伪装 Kimi CLI/Claude Code/ZCode。Direct 模块已拒绝 Kimi 和 GLM 已知 Coding-only 端点，返回 `CODING_PLAN_SCOPE_UNSUPPORTED`；测试覆盖该拒绝行为。需厂商确认球球使用范围，或用户原本已有、明确选择的通用开放平台 API 配置，才继续相应真实聊天验证。没有新增费用/购买/切换账户动作。
