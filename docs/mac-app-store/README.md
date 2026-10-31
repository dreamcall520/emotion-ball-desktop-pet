# 球球 Mac App Store 上架落地

核验日期：2026-10-31。基线：origin/main b7979ae。独立分支 feature/mac-app-store。
当前阶段：准备与差异审计；没有可送审包，未上传、送审或上架。

## 已确认

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

## 首发范围建议（待产品决定，尚未删改功能）

| 能力 | 建议 | 实施与验收 |
| --- | --- | --- |
| 内置宠物、小宇、互动、外观 | 保留 | 签名沙盒实机测试透明窗口、拖动、多屏/Space、睡眠、资源消耗；逐项确认内置素材授权 |
| 番茄钟、本地便笺 | 保留 | 容器内保存、重启恢复、计时与通知 |
| 天气 | 首发手动选城 | 核验网络权限与拒绝/断网回退；自动定位另验公开 API、用途文案与权限 |
| 本地皮肤导入 | 可选 | 系统文件选择器授权后复制到容器；不能自动扫描 ~/.codex/pets；不将 JSON/图片等同可执行插件 |
| Codex / ZCode / WorkBuddy 本机联动、配置发现、相关聊天与额度 | 建议首发暂缓 | 同时处理启动、后台读取、IPC 和入口；不能只隐藏界面，也不能断言所有联动永久不可能 |
| 官网安装包更新 | 商店版移除 | 移除周期检查、下载与安装 IPC；商店负责更新，官网版继续原流程 |
| 开机启动、快捷启动其他 App | 单独验证 | 明确用户同意、支持的沙盒机制；不直接沿用现有实现 |

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

1. 确定商店首发功能范围、个人/组织卖家、定价、地区；不预设免费、年龄分级或隐私标签。
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
