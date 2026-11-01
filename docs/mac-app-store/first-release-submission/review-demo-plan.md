# 首发联网功能：审核演示安排

2026-11-01。状态：方案待执行，未增加演示模式、创建／切换账号、发送模型消息或联系审核方。本页按当前源码只读核对，并引用主会话确认的正式构建 `1793528828`；不把开发机已登录状态当成审核员可用状态。

## 结论与推荐

**首选保留当前正式包的真实 Codex 登录与联网路径，先落实 Apple 接受且符合服务方规则的审核使用身份；不要为了“有演示”立刻重包一个离线假数据模式。**

球球没有自己的用户账号体系，Codex 官方 OAuth 是可选第三方能力。正式包没有免登录演示入口，也不能把开发机的独立登录 profile、令牌或聊天文件复制到审核机器。当前“本人已登录＋本机实测回复”只能证明开发包路径通，不解决审核员的真实访问条件。

普通个人 OpenAI 账号不可共享。即使账号是新建、仅用于测试，把用户名和密码交给多人审核也不能因此自动成为允许的做法。**“专用受限真实账号”只有在服务方明确允许该审核使用身份／授权安排、且实际模型与额度可用时才可选；目前没有此项证据，不标记为已准备。**

最小成本的下一步是先向 Apple 核实第三方 OAuth 的审核安排：审核员可否使用其自己被允许使用的 Codex 身份，或可接受哪一种服务方授权的审核身份／完整演示安排。不能要求审核员自行付费开通套餐，也不能假定他们已有所需模型额度。若无法提供被接受的真实访问条件，就保留未解决状态，不把视频或离线样例写成已覆盖全部联网功能。

## 已确认的实现边界

| 能力 | 当前路径 | 演示安排要求 |
|---|---|---|
| 桌宠、完整定制、便签待办、番茄钟 | 本地能力，无 Codex 登录前置 | 审核员可直接操作，不需要演示账号 |
| 天气 | 真实天气服务；可手动选城，定位可选 | 手动选城应真实获取、显示来源与更新时间；不能用固定天气图冒充在线查询 |
| Codex 登录 | `mas-provider-runtime.prepareChat()` 启动官方组件并打开官方 OAuth；自有 profile 位于球球容器 | 本人完成服务方允许的身份登录；不嵌入账号、密码、令牌或复用个人登录文件 |
| Codex 同账号额度 | `readManagedCodexQuota()` 使用同一球球聊天 profile | 额度与聊天共用同次官方登录；官方未返回的窗口保持未知，不编造余额 |
| 额度两形态 | 原额度小卡与展开卡 | 两种都可操作、切换与刷新，显示当前真实账号数据，不把合成数据算实际余额 |
| 球球聊天 | 仅 Codex 模型列表；随包官方组件，禁止执行聊天工具 | 选择该身份实际可用模型，由审核员明确发送；至少一次真实请求／真实回复，不能替换成预录文本 |
| 发送前同意 | 主进程 `chat-data-consent`，首发仅聊天披露 | 先拒绝应不发、草稿保留；再次明确发送再同意。同账号／来源／有效同意恢复不重问；不能绕过提示 |
| 可选原 Codex 任务日志 | 明确系统 `.codex` 目录许可；有界读取部分日志元数据 | 可用标明合成的夹具验证权限与状态解析，但不算真实原软件任务端到端证据；取消不挡额度／聊天 |
| Codex 宠物素材库 | 单独选择 `pets` 目录，验证后复制到容器 | 用明确合成、可分发的示例素材验导入；与任务目录及官方登录用途分别确认 |

只读入口：`desktop-pet/lib/mas-provider-runtime.js`、`mas-bundled-codex.js`、`managed-codex-quota-reader.js`、`codex-chat-rpc.js`、`chat-data-consent.js`、`store-connections-first.html`／renderer、`mas-first-release.js`；另参考本目录 `development-acceptance-20261101.md`。源码存在不代表正式分发包全部实测通过。

## 两种方案比较

| 方案 | 可体验范围 | 代码／重包成本 | 当前判定 |
|---|---|---|---|
| A．服务方允许的专用受限真实身份，或 Apple 接受的审核员本人真实身份 | 官方登录、同账号真实额度、小卡／展开卡、真实模型、发送同意、真实聊天、重启恢复；天气亦真实联网 | 沿现有路径不必新增产品代码；若只更新审核资料，可继续使用当前包 | **推荐方向，但尚未具备可直接提交的身份安排。** 普通新建个人账号共享密码不属于此方案，个人／企业账号也不能默认转给多名审核员共享 |
| B．明确标注的离线样例模式 | 本地功能、样例额度两形态、合成任务、模型选择与回复状态的说明性演练 | 必须新增模式选择、持久化隔离、样例来源标签、禁发网络约束、回归及新签名构建；当前包不能凭文案启用 | 仅可作为补充。它不验证官方登录、真实模型、额度权限、数据发送或网络错误，不能当完整联网演示模式直接替代账号；若要替代，须先取得 Apple 对具体方案的批准且满足完整功能要求 |

不推荐当前新增服务端“审核专用模型代理”：这会引入开发方凭据、服务成本、新数据接收方与隐私／同意变更；普通 API 余额也不等于 Codex 套餐额度，不满足“同次 Codex 登录、同账号额度”原契约。没有服务方支持前，不静默换成其他服务来凑通联网演示。

## 方案 A 的具体执行顺序

1. **先确认身份可用安排。** 本人说明是否已有服务方明确允许第三方审核使用的测试身份／授权依据；没有则不新建个人共享账号。向 Apple 核实第三方 OAuth 的可接受审核方式，使用下方草稿，本轮未发送。
2. **审核方接受后再落实真实权限。** 使用其允许的身份与实际可用套餐／模型，不要求审核员购买。仅保留测试用途资料，不带个人聊天、组织私有数据、仓库或支付管理权限；限制能力必须以服务方现有支持为准，不能承诺可自设 Codex 日额度或免二次验证。不得为了审核关闭安全验证或共享验证码种子。
3. **全新数据下走同一条路径。** 在可安装的对应最终构建／允许的测试分发上，从未登录状态检查菜单连接、官方登录、真实额度两形态、模型列表与聊天。官方回调成功后同一登录即可读取额度并聊天，不额外选择任务目录。此步骤若需新真实模型请求，由本人明确允许后再执行，当前方案阶段不执行。
4. **检查同意与拒绝。** 输入一句无私人内容的测试消息，如“你好，请用一句话介绍你能做什么”；先拒绝、确认未发送与草稿保留，再主动发送并同意，保存无凭据的结果证据。视频只是辅助，审核员应具备实际触发服务能力。
5. **验证恢复与可选权限。** 正常退出重启，确认无需再登录且同账号额度／会话恢复；任务目录先取消验证不阻塞，再用明确合成夹具观察状态。素材库用独立示例目录验证。不能将夹具状态当真实原软件任务结果。
6. **提交资料准确回填。** App Review Information 的登录条件、操作入口、模型／套餐依赖、帮助联系方式与必要演示资源必须完整。只有实际具备、允许提供的资料才填写；敏感登录信息只由本人在允许的安全字段操作，不写入 Git／截图／本文，也不把个人令牌交给审核员。
7. **审核期间保持真实可用。** 若身份失效／额度用尽及时安排被允许的恢复，不能让审核方等本人临时扫码才能继续；若服务机制无法满足无人值守审核，事先与 Apple 协商，不把“本人随时可协助”当账号可用证明。

### 本人当前需要的最少操作

1. 确认：是否已有“服务方允许第三方审核使用”的真实身份安排。若没有，直接说明没有，不需要交出个人账号密码、登录文件或验证码。
2. 由本人确认下方审核询问内容后，通过可用官方审核沟通渠道核实方案。已有“执行上架”的授权不代表当前文档已经发出；本阶段不发消息。
3. 方案得到接受后，仅完成必要的官方身份准备与一次从新资料开始的操作配合。当前已验证的本人登录不反复登录、不自动追加模型测试。

如果没有可用身份、Apple 也未接受替代方式，**当前构建的联网审核访问条件仍未解决**。这不应被标记为已完成，也不能通过取消登录必填或填“无需登录”掩盖。

## 方案 B 的最小产品定义（仅在另行决定开发时）

公开可见“试用样例”入口，不侦测审核人员、不隐藏真实能力、不在审核后切换行为。进入后常驻“离线样例 · 不连接 Codex，不代表真实账号额度”。单独临时资料空间，只使用完整合成内容。

- 额度演示同时覆盖小卡和展开卡，每个数据区域都保留“样例”标志，无账号头像或真实身份暗示。
- 模型选择列表与回复必须标明“样例模型／预设回复”，发送按钮称“查看样例回复”，不得显示真实服务已连接。
- 样例可讲解数据同意，但不能保存真实 Codex 的聊天同意 scope；也不能把样例确认当正式同意。
- 退出样例模式不把便签、聊天或任务写入真实资料；不能自动导入用户内容。真实登录仍走官方路径，额度与聊天共用同次登录。
- 真实天气、实际 Codex 网络请求必须另外保持可审核。完全离线样例无法弥补这部分；任何替代方案应先经 Apple 确认。
- 新模式必须重包、重测并递增构建号，不能把 `1793528828` 写成已含该功能。

本阶段不制作伪造 OAuth、假登录页或模仿真实实时回复的素材。

## 可复用的合成演示材料

已存在本项目 `验收记录/商店首发完整保留-20261101/fixtures/`，不含网络凭据：

- `.codex/sessions/rollout-synthetic-qiuqiu-mas-task.jsonl`：明确合成任务，固定合成 UUID；通过 `set-synthetic-task.cjs` 改阶段，120秒活动时效不得忽略。
- `pets/首发验收伙伴/`：仅用于素材库选择、合法包复制、预览、保存与恢复；不是服务账号或AI生成入口。
- 自然本地便签可使用新建的“周末的小计划／去公园走走，记得带水和相机”示例，明确由审核员新建，不修改本人现有笔记。

上述材料当前是本地验收资产，未自动作为审核附件上传。若准备附件，先验证其仅含以上合成文件、无授权书签、用户容器、登录文件或真实记录；不要打包整个验收目录。

## 给审核方的询问草稿（尚未发送）

> Qiuqiu is a macOS desktop companion with fully available local features and optional Codex integration. Build 1793528828 uses the official Codex sign-in flow; one sign-in supplies both the same-account quota views (compact and expanded) and Codex model chat. Sending a message requires explicit data-sharing consent. There is no Qiuqiu account, embedded credential, or demo bypass in this build.
>
> We cannot provide a shared personal OpenAI account because the service restricts account sharing. Before relying on an alternative review arrangement, could you confirm an acceptable way for App Review to exercise the actual online sign-in, quota, and chat features using a service-permitted identity? We can provide a complete walkthrough and clearly labelled synthetic fixtures for optional local task logs and pet imports, but these are supplementary and do not replace live service access. If a built-in demo mode is required or acceptable instead, please confirm the expected full-feature coverage and approval process before we change the build. We do not ask reviewers to purchase a subscription.

该草稿不声称审核员已有账号、不保证 Apple 接受视频替代，也不提供私人凭据。发送前应再次核对实际构建是否已上传／处理完成及可用联系渠道；本方案没有核实这些当前后台状态。

## 依据与不确定性

- Apple《审核指南》Before You Submit、2.1(a)：账号功能需要可用演示账号／完整演示方式；因法律或安全原因不能提供账号时，内置演示替代需要 Apple 事先批准且覆盖完整功能。https://developer.apple.com/app-store/review/guidelines/
- Apple《提供完整审核所需信息》：准备审核所需登录及资源。https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review
- OpenAI《Account Sharing Policy》与《Terms of Use》：个人账号由本人使用，不能共享个人凭据。没有找到“App审核专用个人共享账号”的一般豁免。https://help.openai.com/en/articles/10471989-openai-account-sharing-policy 、 https://openai.com/policies/terms-of-use/

以上是基于当前官方公开规则和源码的执行建议，不是 Apple 或服务方对球球的批准。本页只新增审核安排方案，不改 App、账号、用户数据或现有送审状态。
