# 保留 AI 联动：官方路线与实测边界

日期：2026-10-31。用户要求保留完整AI工具联动，不以删除功能换取上架。

## 本轮已确认

`node desktop-pet/scripts/mas-authorization-probe.js` 可重复生成临时原生测试App与包内继承沙盒的辅助程序，使用合成JSON、SQLite、Unix socket与127.0.0.1 TCP服务做对照，结束清理本次临时文件与监听端口。

| 测项 | 无沙盒基准 | App Sandbox | 包内继承沙盒helper |
| --- | --- | --- | --- |
| 外部合成JSON | 可读 | 拒绝 | 拒绝 |
| 外部只读SQLite | 2行 | 拒绝 | 拒绝 |
| 外部Unix socket握手 | 成功 | 拒绝，errno 1 | 拒绝，errno 1 |
| 127.0.0.1 TCP握手 | 成功 | 成功 | 成功 |
| 启动包内helper | 不适用 | 成功，退出0 | 不适用 |

结果在 authorization-probe-result-20261031.json。只证明这些合成路径与调用，不代表任意子进程/目录均可访问；没有真实账号读取、厂商请求、模型调用或Electron MAS验收。

目录选择器/书签验证另有 authorize/resume/revoke 模式：已生成App并尝试原生界面控制，两种启动方式下CUA均返回timeoutReached。未点击授权，因此目录授权、重启与撤销仍未验收。不能用模拟模块测试冒充这部分通过。

## Codex

官方支持app-server的stdio、WebSocket与Unix socket通信，WebSocket支持握手Bearer鉴权。文档明确WebSocket实验性且不受支持，适合localhost技术试验，不直接作为生产承诺。

本机只执行 `--version` 和 `app-server --help`，版本为 `codex-cli 0.165.0-alpha.1.2`，确实列出 `--listen ws://IP:PORT`、`--ws-auth`、`--ws-token-file` 等参数。没有启动真实账号服务，也没有读token/config。

候选方向：球球只连接已有本地服务，减少直接启动外部CLI、访问其home的需要。本轮TCP成功只是前置验证，仍缺真实WebSocket协议、受支持的服务启动方式、鉴权、状态与额度映射、重连、商业适用边界。

官方文档：https://learn.chatgpt.com/docs/app-server （Protocol、Auth endpoints）。身份接入另见 https://developers.openai.com/siwc/quickstart 。不能将独立API计费替代原有订阅/团队额度。

## WorkBuddy

官方开放平台已有 OAuth 2.1 与Open API，覆盖PC本地助理状态、发消息、消息历史，以及云端任务列表/状态、ACP与产物。可作为替代内部Electron binding的候选，尚未接通。

已阅公开接口目录未找到套餐余额/完整消耗统计查询契约。积分兑换是发放积分，不能冒充查询余额；云端任务也不能冒充全部本地桌面任务。

需要创建应用并申请相应权限；用户已有工具登录不等于球球已有开发者接入权限。换token要求client_secret，官方禁止放入客户端，因此正式路线需要服务端换票，尚未创建应用、保存密钥、部署服务或请求OAuth授权。

官方来源：
- https://open.workbuddy.cn/docs/openapi
- https://open.workbuddy.cn/docs/third-party-app

## ZCode

官方Hooks提供会话开始、用户提交、工具前后、失败、Stop等事件，是“ZCode主动推送状态”的候选；Hooks是本地子进程协议，不直接赋予调用模型的内部对象。

Remote Control与Bot Channel有各自现成渠道，不等于球球可直接使用的第三方SDK。当前查阅范围未找到覆盖套餐额度、全部任务与聊天的通用OAuth/SDK契约。不能把已有本地解密实现及内部HTTPS端点称为公开授权API。

官方来源：
- https://zcode.z.ai/cn/docs/hooks
- https://zcode.z.ai/cn/docs/remote-control
- https://zcode.z.ai/cn/docs/bot-channel
- https://zcode.z.ai/cn/docs/usage-stats

## 推进判断

完整AI联动是否可按现有体验上架仍待验证。现在已证明本地TCP和包内helper有技术入口；尚无证据证明三家全部状态/额度/聊天可完整替换。目录授权基础模块只做能力准备，未接入正式App。

下一步分别核验：目录书签实际授权与重启；Codex鉴权WebSocket协议；ZCode官方事件映射；WorkBuddy应用权限与额度能力缺口。会员/签名、厂商授权、技术可用和Apple审核是独立条件。
