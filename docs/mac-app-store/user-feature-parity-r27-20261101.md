# R27 用户功能保留与授权路径审计

2026-11-01。只读审计；本报告没有修改 App 源码、切换分支、调用第三方账号或读取用户对话。用户明确要求送审前先梳理使用路径，保证现有功能保留、操作授权成本最小，本轮不送审。

## 结论

**当前商店分支还不满足“现有功能都在”。** AI 聊天、沙盒目录授权和两家原软件任务事件已有真实 MAS 开发包证据，但商店分支没有同步最新主干的 14 个提交；另外开机自启、API 余额账号发现、WorkBuddy 用量明细存在明确关闭或缺失，不能因界面仍有入口或显示“暂不可用”就算保留。

审计基线：当前 `feature/mac-app-store@96d934d`；本地 `main` 与本地缓存 `origin/main` 都为 `eb3c1f4`。没有联网 fetch，因此不宣称远端此刻一定未变化。`git log HEAD..main` 有 14 条；`git diff main HEAD` 直接比较两棵当前树，共 389 个文件不同。差异不全是缺失，包含大量 MAS 新能力，但不能用商店分支自身测试通过替代主干功能对齐。

源码存在只证明入口/逻辑没有被移除；“真 MAS 已验”仅引用对应脱敏回执，不扩大到新用户、Intel 或未覆盖的日常功能。`R25` 是对 `R24/a0d64fb` 包的真人授权测试；不把它自动覆盖之后 R26 源码改动。

## 功能矩阵

| 用户功能／入口 | 当前商店树状态 | 与最新主干的差异／真实边界 | 依据与验证要求 |
| --- | --- | --- | --- |
| 启动桌宠、拖动、移动、大小、始终置顶、恢复位置 | 基础逻辑保留；真 MAS 完整日常验收待做 | 没有要求先登录 AI；真实 MAS 打开不等于全部窗口交互验收 | `main.js:menuTemplate/registerDisplayRecovery`、`renderer.js`、`lib/window-motion.js`；需拖动、多屏、锁屏恢复复验 |
| 基础球球、柔光团、星轨球、小宇、咩咩、楚哥 | 相关定制/播放逻辑与资源保留；等价仍待验 | 当前 `customize.html` 有小宇等既有入口；主干后续互动/气泡/贴边修复尚未全部同步 | `customize.html/customize-renderer.js`、`lib/soft-orb-model.js`、`lib/sheep-skin.js`、`lib/codex-pet-player.js` |
| 小白官方内置皮肤 | **缺失** | 主干 #35 已把小白作为固定内置卡，商店树无 `lib/builtin-pets.js`、`assets/pets/xiaobai/pet.json` 和 12 张图集；不能要求用户导入来冒充“官方内置保留” | `git diff main HEAD` 中上述文件为 D；主干 `56e5523`，需对齐内置排序、保存/重启、头像、三庆祝 |
| 小白专属互动／庆祝 | **缺失** | 跳跃/开心/转圈与相关骨头、梳毛、睡姿等随小白缺失；商店通用动作不能替代角色专属动作 | 主干 `b254312`、`56e5523` 与 `lib/codex-pet-player.js` 差异 |
| 外形实时预览、保存、启动默认形象、我的形象收藏 | 基础逻辑保留；真 MAS 待验 | 不是仅静态预览；但主干首帧/配色/快捷面板恢复等后续修复未同步，不能宣称观感等价 | `main.js:openCustomization/saveCustomization/importCodexAppearance`、`customize-renderer.js`、`lib/settings.js`；验收保存、取消、重启与收藏复用 |
| 主题色／色弱友好 | **部分保留** | 商店 `settings.js` 只接受 green/blue，主干额外接受 purple；当前导入紫色设置会归一化为默认，暮光紫未保留 | 两树 `lib/settings.js` 的 `uiTheme`，`main.js:menuTemplate` |
| 单击互动、动作气泡、聊天入口、待机/睡眠 | 基础逻辑保留；主干一致性未达 | 主干 #29–#31 等小宇互动、气泡布局、成对按钮改进未同步；不能仅因“可点击”算全部原行为保留 | `main.js`、`renderer.js`、`lib/bubble-placement.js`、`lib/thought-window.js` 与主干差异 |
| 左右贴边、探头与恢复原形 | 基础贴边保留；**缺主干新行为/修复** | 主干 #32 的 `lib/edge-peek.js` 不在商店树；小白专属 ink/tuck 参数与可配置 tuck delay 缺失 | `lib/edge-tuck.js`、`lib/sprite-edge-ink.js`；主干 `785b2f2`，需不同皮肤双侧/跨屏/恢复验收 |
| 快捷面板、全局快捷键、快捷键设置与冲突提示 | 代码保留；真 MAS 待验 | 商店额外工具连接快捷键 `⌘⇧K`；主干快捷面板恢复修复 #37 未同步；“有快捷键配置”不等于系统注册已生效 | `lib/shortcuts.js`、`lib/shortcut-window.js`、`main.js:initializeShortcuts/openShortcutAction`、`global-settings-shortcuts.js` |
| 设置中心、额度卡顺序/固定、常规配置 | 基础保留，AI 启用入口替代为统一引导 | 商店点击三家启用项会打开工具连接，而非静默读取外部目录；主干新增反馈/定制相关设置缺失 | `main.js:registerIpc` 中 `pet:global-settings-action`、`global-settings.*` |
| 便签与待办：创建编辑、分类、完成、筛选、桌面置顶、回收站 | 代码保留；真 MAS 全路径待验 | `notes-*` 主体无商店功能关闭；不能把 AI 聊天成功当本地笔记持久化/提醒/拖拽已验 | `notes.html/notes-renderer.js`、`lib/notes-store.js`、`lib/notes-companion.js` |
| 便签复制、JSON 导出、重置 | 代码保留；真 MAS 文件操作待验 | 复制走剪贴板；导出是本人系统保存框；没有必要申请 AI 或全盘权限 | `lib/notes-companion.js` 的 `notes:copy/notes:export/notes:reset`；需真 MAS 保存后读回、自有文件路径验证 |
| 便签智能整理 | 独立 AI 能力保留并新增专用途同意；最终 MAS 待验 | 不可用聊天的数据同意代替便签正文发送许可；当前 R26 接入 `requestOrganizeConsent`，整理结果仍需本人替换 | `main.js:requestStoreNotesConsent`、`createNotesCompanion`，`lib/notes-companion.js`、`lib/notes-organizer.js` |
| 待办截止日期与提醒 | 代码保留；时间/睡眠恢复待验 | UI 明确提醒需要球球运行；开机自启当前被关闭，会使“重启后自动继续提醒”更麻烦，不能默认等价 | `notes.html` 的提醒说明、`lib/notes-store.js`、`lib/notes-companion.js` |
| 番茄钟：专注/休息、暂停、重置、小卡、鼓励和完成互动 | 代码保留；完整真 MAS 待验 | 主体未被商店分支关闭；需跨休眠、窗口抑制、完成提醒和宠物动作联动复验 | `lib/pomodoro*.js`、`main.js:openPomodoro`、`pomodoro*.html` |
| 天气：手动城市、定位、当前/预报卡、显示/隐藏 | 基础能力保留；完整真 MAS 待验 | 手动选城市不应被定位授权阻塞；定位是可选系统权限，MAS 已声明定位权利不等于首次授权/拒绝恢复已验 | `lib/weather-window.js` 的 `weather:search/city/location`、`lib/weather-location.js`、`lib/weather-service.js` |
| 天气展开/连续收拢/拥挤避让 | **缺主干后续修复** | 商店 `weather-window.js` 相比主干少连续收拢 overlay 及 `weatherExpandedBounds` 逻辑；不能称与 #36 结果等价 | 主干 `cca61eb`，两树 `lib/weather-window.js` 直接 diff |
| 额度趣味游戏与其他卡片的互斥/恢复 | 基础游戏存在；**缺主干后续协调修复** | `lib/popup-quota-visibility.js` 在当前树缺失；主干 #38/#39 的游戏隐藏 API/天气卡与其他弹窗协调未同步 | 主干 `c7564ec/adaf9f2`，`main.js`、额度/天气窗口差异；需真实组合操作 |
| 本地伙伴素材文件夹导入、列表、删除 | 代码保留；真 MAS 原始素材选择/复制/重启待验 | 系统选择器只让本人选一次文件夹，导入后拷贝到容器复用；只支持声明的 pet.json+静态 PNG/WebP 图集，不是普通照片/GIF 自动生成动画 | `main.js:pet:local-pets-import/delete`、`lib/codex-pets.js:importDirectory`、`customize.html` |
| 自动发现原 Codex 皮肤 | **被关闭，手工导入是替代路径，非完全等价** | 商店把 `sourceRoot` 从原 `.codex/pets` 改为自有容器 `codex-pets`，不会自动读取原 Codex 皮肤目录；当前旧入口可能空白 | `main.js:createCodexPetStore` 的 `IS_STORE_BUILD` 分支；需明确引导“导入素材文件夹”，不能宣称原列表自动保留 |
| 云端上传／普通图片转皮肤 | 当前两树均未发现可归作通用能力的实现 | 本地素材导入不等于上传生成；专属定制咨询也不等于自动上传/生成。不要无依据新增此功能承诺 | `customize.html`、导入 handler 及主干 promotion 路径；需要具体已有入口时另对照 |
| 专属皮肤定制案例、动态宣传、微信咨询入口 | **缺失** | 主干 #40/#41 已加入，当前无 promotion 模块/素材、菜单 `custom-skin-promotion` 与详情入口 | 主干 `6291c46/eb3c1f4`；`promotion-*`、`lib/promotion-player.js`、`assets/promotion` 当前树缺失 |
| Codex 额度与部分日志任务 | 接入替代且有真 MAS 证据；范围有限 | 由显式目录授权/官方 API 适配替代默认外部扫描；仅部分日志任务，不代表所有 Codex 桌面任务/最终状态 | `lib/mas-codex-connection.js/mas-codex-tasks.js`、`main.js:initializeCodexCompanion`；R23 回执 |
| Codex 聊天 | 真实 MAS 独立登录及一条回复通过；R26 新同意门禁另验 | 聊天账号与原额度目录账号可能不同，不自动保证归属一致；无需用户终端/服务配置 | `lib/mas-bundled-codex.js`、`chat-data-consent.js`、`main.js:storeChatSendWithConsent`；R23、R26 脱敏记录 |
| ZCode 官方套餐额度／官方聊天 | **当前不可用／未打通真实可用套餐** | 官方套餐仍空；读取成功或自定义模型回复成功都不能当官方套餐聊天通过；R26 无接收 origin 的官方 RPC 还会安全拒发 | `lib/mas-zcode-provider.js`、`lib/zcode-chat-rpc.js`、`main.js:storeChatSendWithConsent`；R23/R25 限制 |
| ZCode 已有自定义模型聊天 | 替代通道且真 MAS 一条回复通过 | 使用原有明确选择的通用 API 配置，按原 API 计费；与官方套餐分别连接，不自动切来源 | `lib/zcode-direct-chat-rpc.js`、`lib/zcode-public-templates.js`；R23 实测、R26 同意 scope |
| ZCode 原软件实时任务 | 真 MAS UserPromptSubmit/Stop 已通过；**不提供最终完成确认** | 插件安装/配对需单独写用途和原软件退出；已有授权/插件正常重启不重复安装，首次新任务事件确认 | `lib/zcode-desktop-integration.js/zcode-desktop-event-bridge.js`、`managed-plugin-installer.js`；R25 |
| WorkBuddy 专用聊天 | 替代通道且真 MAS 一条回复通过 | 官方 CodeBuddy 组件独立登录、球球专用会话；不接管/导出原桌面聊天 | `lib/mas-bundled-workbuddy.js`、`workbuddy-cli-connection.js`；R23、R26 同意门禁 |
| WorkBuddy 原软件实时任务 | 真 MAS 主回复 FinalStop 已通过；整体任务完成未确认 | Stop 不是最终完成；FinalStop 只确认主回复，后台团队可能继续工作 | `lib/workbuddy-desktop-event-bridge.js`、R25 实测/重启恢复回执 |
| WorkBuddy 网站剩余积分 | 可选独立网页登录；**本次全链未完成** | CLI 聊天登录不能自动恢复官网 Cookie；当前公开 CLI 接口未找到账户余额读取契约，额外登录成本仍在 | `lib/mas-workbuddy-provider.js/workbuddy-web-quota.js`、统一卡模型；R25 限制，不能写“同次授权三项全部就绪” |
| WorkBuddy 用量明细／旧详情任务列表 | **旧能力被明确替换为 unavailable，无完整等价替代** | `workbuddyUsage` 与旧 `workbuddyTasks` 在商店分支直接变 `unavailableObservation`；新工具卡事件只补主回复阶段，不能替代用量分类和旧任务列表 | `main.js` 初始化两处 `IS_STORE_BUILD` 分支；旧详情提示“原桌面实时任务尚未接入”与新卡已接入还可能冲突 |
| API 余额监控（原 ZCode 配置中的 API 账号） | **明确关闭账号发现，缺等价适配** | 商店强制 `readAccounts:()=>[]`、`watchAccounts:()=>()=>{}`，虽然入口/卡片还在，实际没有账号来源；新 ZCode 自定义聊天不等于恢复 API 余额 | `main.js:initializeApiBalance`；应列为必须补齐或明确用户决策的功能缺口 |
| OpenAI API 费用与用量、本月费用卡 | 代码保留；独立配置和真 MAS 待验 | 需要本人提供有读取权限的 Platform Admin API Key，不能复用 ChatGPT/Codex 登录；safeStorage 的真 MAS 保存/恢复和实际只读费用请求尚无本轮证据 | `main.js:createApiUsage`、`lib/api-usage.js:normalizeConnection`、`api-usage.html`；不代用户配置或调用真实 key |
| 意见反馈、异常自动上报、开关与本地导出 | **缺失** | 主干 #34 的模块、设置页、主进程 capture/submit handlers 都未在商店树；隐私页写到反馈不代表 App 具备此入口 | 主干 `28984df`；缺 `lib/feedback-reporting.js`、`global-settings-feedback.js`，`main.js` 无主干相应 handlers |
| 开机自动启动 | **商店分支明确禁用，无替代实现** | `loginItemEnabled` 返回 false，`setOpenAtLogin` 直接返回，设置项 disabled；不能当“由商店自动实现” | `main.js:loginItemEnabled/setOpenAtLogin/menuTemplate`；需决定实现 MAS 合规启动项再验，不能默认删功能 |
| 检查更新／下载安装包／自动提醒 | **渠道替代，部分 UI 还需收敛** | 商店不走自更新，安装包下载和替代下载入口直接拒绝，改走 Mac App Store。当前提示已替代，但开发包还不能验证真实商店更新；有灰掉的自动提醒项 | `main.js:checkForUpdates`、`pet:about-release/about-download-alternative`；这是合理渠道差异，不是原下载安装功能已保留 |
| 老用户设置、便签、皮肤与登录迁移 | **自动迁移未证实／未见相应入口** | MAS 使用独立容器，开发候选又有独立 bundle/userData；当前没有把官网版用户数据自动导入的已验路径。便签可导出不等于商店版可完整导入/恢复全部设置 | `main.js` 的 userData/各数据文件路径、`package-mas.js` 的发布标记；需专门老用户迁移设计与自有fixture验收 |

## 用户实际路径与最小成本判断

1. **只用桌宠/本地工具**：打开 App → 选形象/互动 → 便签/待办/番茄钟。不能要求先启用三家 AI。上述基础功能应保持零第三方登录、零原工具目录授权；天气定位可跳过，手动城市不受影响。
2. **只连一家 AI**：勾选该工具 → 启用所选 → 官方登录或读取已有明确选择的自定义配置。额度、聊天、任务分别报告，能用先开放；缺套餐不能循环登录。现有源码满足串行、已有授权跳过与本轮单次尝试原则，但仍需全新用户从空资料完整验收。
3. **多家/全部**：用户选择工具数量，球球逐家引导。每家官方登录不能凭空合成一次跨厂商 OAuth；必要系统目录选择、插件写用途、聊天发送数据同意用途独立，但同一工具已核实账号/来源可以复用，不应每条普通聊天重问。
4. **原软件任务**：允许写固定插件或只重新配对 → 原软件运行时本人保存并退出 → 自动安装/配对 → 新会话正常使用确认。当前真 MAS R25 路径通过；仍有“退出原软件”的真实成本，不能承诺没有任何用户动作。等待期间聊天应继续开放。
5. **WorkBuddy 积分**：属于可选补充，当前额外官网登录没有被消除。不要把它强塞进“必要连接未完成”；也不要把会话消耗、模型倍率或接口存在冒充账户剩余积分。
6. **本地伙伴导入**：本人选择素材文件夹一次，复制进容器后重启复用。当前通用图片上传、云端生成、原 Codex 皮肤自动发现与完整旧数据迁移，都不是同一能力，必须分别说明。
7. **老用户换商店版**：现有功能和资料必须先可对照。当前小白、反馈、专属定制、紫色主题等主干功能缺失，API 余额、自启被关闭，不能直接让用户换装然后说全部保留。

## 送审前应先完成的顺序

- 先在隔离候选对齐本地最新主干已确认功能，保护 MAS 授权/接入改造，不在本报告审计时自动 merge/cherry-pick。
- 明确补齐 API 余额适配、开机自启、WorkBuddy 用量明细，或者由用户明确决定范围；本次“功能都在”的要求下不能默认删减。
- 将旧详情与新工具卡的状态口径统一，消除“已收到事件”与“原任务尚未接入”的矛盾文案。
- 在最终合成后的真正 MAS 包逐项验收桌宠/皮肤/互动/贴边/便签/提醒/番茄钟/天气/导入/快捷键/多窗互斥；R23/R25 AI 实测不替代这些功能。
- 新用户空资料与老用户迁移各跑一条完整路径，记录实际登录、系统选择器、插件退出和发送同意次数；失败后重启不得再次无目的弹授权。
- 功能/路径验收完成后再处理送审。本轮用户明确“先不送审”。

证据入口：`original-tool-live-r25-20261101.md/json`、`real-mas-sandbox-r23-20261031.md/json`、`submission-readiness-r26-20261101.md`。报告仅表示源码/证据审计，不是新一轮真实用户使用验收。


## 审计后主线进展（不关闭原始缺口）

主 Agent 已将原商店树 R26 检查点保存为 `472edee`，另建隔离工作树 `mac-app-store-v0410`，正在整合本地 `main@eb3c1f4`。该合并尚未完成提交或验收；main.js 的商店逻辑、completionMotions、promotion、feedback 等正在处理冲突。**本报告上面的原始缺口发现继续保留；不得因文件已合并或冲突已标记解决就改为功能已保留。** 后续应逐行补上新树源码/最终包/真正 MAS 路径的验证结果，再关闭对应缺口。

用户所说“4.0.10”已由主线历史记录对应为 `0.4.10` 候选基线；当前公开下载版本仍为 `0.4.09`。此处区分候选基线与公开发布，不将整合中的版本当已经上线或用户验收通过。
