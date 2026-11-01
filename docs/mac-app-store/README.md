# 球球 Mac App Store 上架落地

核验日期：2026-10-31。基线：origin/main b7979ae。独立分支 feature/mac-app-store。
当前阶段：准备与差异审计；没有可送审包，未上传、送审或上架。

## 当前状态（2026-11-01，R25/R26）

- 个人开发者会员及开发签名、测试App ID/设备/profile已验证；真实Electron MAS沙盒、三家聊天、原ZCode/WorkBuddy任务事件及重启恢复已通过。详细范围见 original-tool-live-r25-20261101.md。
- 尚无正式分发证书/安装器签名或App Store Connect构建验收；不能把开发候选当可提交包。
- R26正在补正式分发链、首次第三方AI发送同意与隐私资料。最新逐项缺口见 submission-readiness-r26-20261101.md。
- 源代码及部分视觉/动画的App Store分发权利证明仍待核清；现有许可保留不能代替独立授权。未提交或上架。

## 历史基线（2026-10-31任务开始时，非当前状态）

- 用户只有普通 Apple ID，尚未开通 Apple Developer Program。
- 本机 Xcode 可用；有效代码签名身份数量为 0。详见 preflight-20261031.json。
- 现有 package-mac.js 使用 darwin Electron 与 ad-hoc 签名，不是 MAS 签名与构建链。
- 官网已有隐私页面源码 https://qiuqiu.pet/privacy/；尚未核验线上内容与最终商店版一致。
- 上架准备隔离于当前正式 App、用户设置和其他开发工作树。

## 先由账号持有人完成

1. 打开 https://developer.apple.com/programs/enroll/ ，或在 Apple Developer App 中进入 Account → Enroll Now。
2. 个人创作可选择个人会员；如果希望以公司名称展示，需走组织会员流程。个人会员在商店展示本人法定姓名。
3. 使用开启双重认证的 Apple Account，按官方流程完成身份核验、协议与付款。官方年费 99 USD，实际金额以本地区付款页为准。
4. 开通成功后，在 Xcode → Settings → Accounts 添加账号。后续核对 Team、Bundle ID、开发及分发证书、描述文件，再创建 App Store Connect 的 macOS 应用记录。

密码、验证码、付款信息由本人在 Apple 界面输入，不写入仓库或对话。当前 Bundle ID local.xiaokun.emotionball.pet 仅为源码现值，尚未注册或确认商店归属；创建记录前确定最终标识。

## 已确认目标：必须保留 AI 工具联动

用户已否决暂缓 AI 联动的首发建议。当前任务是验证完整联动可行性，不得删除 AI 功能后称目标完成。

## 保留 AI 联动的可行性核验

结论：尚未证明完整联动可在 MAS 中运行，也未证明永久不可行。文件授权、执行进程、socket通信和身份授权分别验证，不能互相替代。

| 能力 | 当前依赖与可行路线 | 尚未解决 |
| --- | --- | --- |
| Codex 额度/聊天 | 外部 app-server；目录授权与明确CLI路径作为候选 | 外部CLI启动、子进程授权、默认home约束及官方支持契约 |
| Codex 任务实时状态 | ~/.codex/ipc/ipc.sock | 文件夹可读不等于socket可连，需单独握手实验 |
| Codex 历史 | 本地sessions与ChatGPT后台接口 | 文件授权只覆盖前者；官方域名不等于公开API |
| ZCode 账号/额度 | 目录授权后读取本地配置并发HTTPS | 沙盒home变化可能影响解密；需明确原数据根路径及受支持的登录方式 |
| ZCode 任务 | SQLite索引 + lsof/ps跨进程检查 | 缓存读取与实时执行态分开；只读数据库成功不能声称实时联动成功 |
| ZCode 聊天 | 外部运行时与 zcode.cjs | 目录授权不能直接证明代码执行及账号上下文可用 |
| WorkBuddy 额度/聊天 | 借用其Electron及内部原生存储binding | 核心瓶颈：球球自带Electron没有该binding。验证现有路线，或找厂商支持的授权接口；不能只搬helper |
| WorkBuddy 任务 | 只读SQLite + 账号uid | 可实验目录授权，但uid仍依赖账号链；现有实现也不提供完整实时running态 |

不得用独立付费模型API冒充原工具套餐、订阅额度或团队账号联动。没有删除任何正式AI能力。

### 已完成实验

运行 `node desktop-pet/scripts/mas-sandbox-probe.js`：构建临时原生App，同一合成文件/脚本先无沙盒运行，再签入App Sandbox权限对照；退出后清理本次临时目录。结果见 probe-result-20261031.json。

- 无沙盒：合成文件可读，合成外部脚本执行成功。
- 沙盒：合成外部文件不可读，合成外部脚本无法启动。
- 两种模式均可执行系统 /usr/bin/true；不能断言沙盒禁止所有子进程。
- 仅ad-hoc签名原生诊断，不是Electron MAS运行验收，也不证明Apple审核结果。
- 初次以裸可执行文件试跑在libsecinit沙盒初始化阶段退出133，随后改为完整App bundle后成功；不能把初始化失败当作AI联动失败。
- 未读取真实账号/凭据，未访问厂商服务或调用模型。

### 下一轮实验与阻塞

1. 系统选择器授权合成目录，读假JSON/SQLite，保存security-scoped bookmark后重启再读；撤销时明确失败。Electron已有对应公开API，但当前未实测。
2. 合成目录内假Unix socket握手、包内已签名固定ping helper与外部CLI的分项对照；无账号、无模型调用。
3. 按三家实现分别验证路径/身份上下文，WorkBuddy内部binding单列；不通过合成transport成功冒充真实联动。
4. 会员开通并配置证书/profile后，以真实Electron MAS构建复验；真实账号只读与聊天模型调用分别说明结果。

公开依据：https://www.electronjs.org/docs/latest/api/dialog 、https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox 、https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox 。目录授权是官方支持路径；对完整AI联动的可行性仍属于待验证判断。

## 源码差异证据

审计先读主线 04e8fe1，再核对本分支 b7979ae 中相关路径仍存在；行号随后续修改变化，以函数及路径为准。

- desktop-pet/scripts/package-mac.js：buildPackagerOptions / adhocSign 为现有普通版构建。
- desktop-pet/lib/codex-rpc.js、codex-chat-rpc.js：外部 app-server；codex-stream.js / codex-usage-history.js：容器外 ~/.codex。
- desktop-pet/lib/workbuddy-client.js、workbuddy-helper.cjs、workbuddy-tasks-reader.js：借用外部 App 运行时及其本地登录/数据库文件。审计只读源码，没有读取实际凭据。
- desktop-pet/lib/zcode-protocol.js、zcode-chat-rpc.js、zcode-personal-providers.js、api-balance-account.js：外部运行时与本地配置依赖。
- desktop-pet/main.js：checkForUpdates / scheduleUpdateCheck 与安装包下载 IPC；lib/app-update.js：GitHub Release 更新。
- desktop-pet/lib/codex-pets.js：默认目录扫描与用户主动导入是两条不同路径。
- desktop-pet/native/weather-location.mm：本次检查为公开 CoreLocation，未发现私有 API；不代表整个应用已完成私有 API 审核。

## 实施顺序与完成条件

1. 在必须保留 AI 工具联动的约束下完成可行性实验；同时确定个人/组织卖家、定价、地区；不预设免费、年龄分级或隐私标签。
2. 增加独立 MAS 运行模式，关闭不可用的后台和 IPC，界面同步；官网版回归不变。
3. 新增 MAS Electron 构建、主/子进程沙盒权限、Bundle ID / Team / profile 校验、开发签名和分发 pkg；不可复用 ad-hoc 包。
4. 在签名沙盒 App 验证基础交互、数据保存、授权/拒绝、网络失败、退出/重启、多屏和 CPU/电量；普通 Electron 测试不能替代。
5. 按最终包补齐商店截图、图标、隐私申报、素材许可、支持入口及审核说明；上传后等待 Apple 处理并核验构建状态。
6. App Store Connect 完成元数据及审核提交；审核通过后再按发布方式上线并回读商店页面。

## 已落地预检

运行 `npm run preflight:mas`。只读检查本机 Xcode、签名数量与当前打包方式，不输出证书名称/账号信息。退出码 2 表示存在提交阻塞，不代表脚本崩溃。该工具不验证会员身份、描述文件有效性或整个应用合规，永远不据此宣称可送审。

## 官方依据

- Apple 会员开通：https://developer.apple.com/help/account/membership/program-enrollment/
- Electron MAS 构建与签名：https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide
- Apple 审核规则（尤其 2.4.5）：https://developer.apple.com/app-store/review/guidelines/

## 第二轮进展（2026-10-31）

详见 [三家官方路线与实测边界](ai-supported-routes-20261031.md) 及 [第二轮诊断结果](authorization-probe-result-20261031.json)。

- 新增 `node desktop-pet/scripts/mas-authorization-probe.js`：无沙盒/沙盒/包内helper对照。合成JSON和SQLite、外部Unix socket均被沙盒拒绝，本地TCP和包内helper成功；仅原生ad-hoc诊断。
- 原生目录授权窗口控制超时，未确认书签、重启或撤销成功。
- 新增未接正式App的 `desktop-pet/lib/mas-directory-access.js`，取消保留旧授权、访问期间成对释放、保存失败、失效重授权和并发撤销由13项模拟测试覆盖；不能替代原生验收。
- 官方路线已找到：Codex实验性WebSocket（本机CLI帮助支持）、WorkBuddy OAuth/Open API、ZCode Hooks。各自尚有权限/能力缺口，尤其WorkBuddy余额查询尚未找到公开契约。
- 正式App、账号和设置未改；未请求真实厂商授权、未调用模型、未推送发布。

## 第三轮：同类上架案例与目录授权突破（2026-10-31）

详见 [同类App与GitHub研究](similar-apps-research-20261031.md)。已核AgentDeck、Belay、Tempo的商店页面与源码；CodexBar还提供不依赖WorkBuddy桌面解密的网站会话路线。没有把其当前源码等同已审核二进制。

原生授权窗口生命周期问题已修，合成目录授权/新进程恢复/忘记本地授权后拒绝访问全部通过；外部Unix socket和可执行文件在只读目录授权后仍被拒绝。报告`authorization-interactive-result-20261031.json`。此前“窗口超时”的记录只代表上一轮状态。

目录观察租约与Codex鉴权WebSocket模块已实现，尚未接正式App与真实账号。Codex真实额度只读原生探针已编译签名准备；需用户当次确认后才能让新App读取真实敏感目录，不能自动选择`.codex`。

## 第四轮：用户授权后的Codex真实额度验证（2026-10-31）

用户已明确允许原生测试App只读查询Codex额度，先前“等待授权”已结束。系统目录选择后，原生沙盒App向固定OpenAI额度接口查询得到HTTP200，周额度已用45%，没有主窗口数据时不补0。没有发送聊天、刷新/保存令牌或调整工具设置。

详见 [真实验证说明](codex-live-readonly-20261031.md) 与 [脱敏回执](codex-live-readonly-receipt-20261031.json)。证明的是该次原生沙盒真实额度链路，不是Electron MAS包、完整AI联动或上架结果。
