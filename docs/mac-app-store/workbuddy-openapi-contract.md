# WorkBuddy 官方任务与聊天接入契约

核验日期：2026-10-31。只读公开文档，未登录开放平台、创建/提交应用，未读取任何 Cookie/Token，未调用真实任务或模型。

## 结论与当前缺口

网站积分登录不等于 OpenAPI 授权。本地助理和云任务都有官方接口；仍需平台应用获批、对应权限和保管应用密钥的服务端，不能凭现有网页会话直接启用。以下均为官方文档契约，尚未经球球真实账号 API 验收。

## 本人需要办理的应用配置

[第三方应用官方指引](https://open.workbuddy.cn/docs/third-party-app)当前入口是开放平台「硬件接入」：填写基本信息、权限管理、OAuth 回调地址，提交审核；审核启用后才能调用。申请权限时还需填写使用场景及必要性。该类型明确面向硬件厂商/合作伙伴，球球作为纯桌面软件是否符合准入，必须由平台确认。「其他 > 积分兑换」不提供本地助理/任务权限，不能以此替代。

公开文档没有列出硬件接入全部基础信息表单字段，不能把另一个“分享应用”的名称/logo/官网/Team ID表单当作此表单已核实。OpenAPI总览同时提到 Buddy 应用，但第三方应用操作文档仅明确硬件接入可申请全部权限；不要推断 Buddy 应用必然向球球开放同样权限。

按实际能力申请：本地聊天需 `user.localassistant.readable`、`user.localassistant.invokable`；云端任务需 `user.task.readable`、`user.task.invokable`。不必为聊天申请手机号或积分兑换。创建后取得 client_id；client_secret 仅首次明文展示一次，本人应放入服务端密钥管理，不发到聊天、不写入仓库或安装包。

## 授权与服务端要求

[认证授权官方契约](https://open.workbuddy.cn/docs/openapi#认证授权-api)：浏览器访问 `https://www.workbuddy.cn/openapi/v2/authorize`，携带 response_type=code、client_id、redirect_uri、空格分隔的scope及随机state。scope必须属于应用已配置集合；不传会请求全部配置权限，应显式最小化。

回调地址必须预登记；授权回调返回一次性code和state，code有效10分钟。服务端验证state绑定本人发起的会话，再向同域 `/openapi/v2/token` POST表单，提交grant_type=authorization_code、code、client_id、client_secret、字节级完全一致的redirect_uri。刷新也调用该端点，grant_type=refresh_token并提交refresh_token和应用凭据。后续API使用Bearer access_token。

官方要求client_secret不可暴露于桌面客户端，refresh_token安全存储于服务端。球球应通过自己的HTTPS服务完成回调、换票与续期，客户端只持有球球自己的受限会话。公开文档未给出免secret的原生客户端PKCE流程，也未确认loopback/custom scheme回调准入，不能据OAuth2.1名称自行假定可用。

文档存在有效期差异：第三方指南称access_token 24小时、refresh_token 60天；接口示例expires_in=3600。实现按真实响应expires_in管理，不写死24小时；续期旋转按返回的新refresh_token处理。

## 本地助理：用户PC端

以 `https://www.workbuddy.cn/openapi/v2` 为基址：

| 方法/路径 | 用途及关键字段 |
|---|---|
| GET /localassistant | data.online；读取权限 |
| POST /localassistant/message | content字符串、msg_type=text；调用权限；返回data.message_id |
| GET /localassistant/message | 读取权限；limit默认20上限100、offset默认0；message_id模式只取指定消息之后的增量 |

返回历史的content恒为数组，attachments恒为数组，metadata恒为对象，不能按发送时字符串直接渲染。普通结果需检查HTTP和业务code；发送响应仅表示消息已接收，不代表任务完成。

隔离限制：公开参数没有选择设备、独立conversation/session、目录、模型或球球专用聊天的字段，也未保证仅返回本应用发送的历史。因此不能宣称创建了球球专用会话，或把已有PC聊天全量自动带入。先查在线状态，再由本人明确发送；增量从本次message_id开始，仍需实测并发消息归属。

工具审批走msg_type=permission_response，content仍是序列化JSON，requestId必须对应真实下行审批；公开示例给问卷outcome=selected和answers的q_0等键。工具允许/拒绝完整枚举及下行形状未完整展开，不能根据问卷例子自造“同意全部”。未识别审批要保持待用户处理，绝不能自动批准。

## 云端任务与流式聊天

| 方法/路径 | 契约 |
|---|---|
| POST /tasks | 调用权限；prompt必填、name可选；201返回task_id/status，link/token/expire_at可暂缺 |
| GET /tasks | 读取权限；page默认1，size默认20上限100；返回tasks及pagination/total，必须分页，不含token |
| GET /tasks/{task_id} | 读取权限；查询状态与新ACP票据；创建后连接信息缺失时可有限轮询 |

云任务不是本地PC工作区任务。ACP使用返回link：GET SSE接收通道带任务Bearer票据及Accept:text/event-stream；取得Acp-Connection-Id后，POST同link携带该ID发送JSON-RPC。依序initialize、session/load、session/prompt，sessionId为task_id；追问复用该ID。任务票据401时通过任务详情换新，不拿网站Cookie替代。

session/update是增量通知；session/request_permission是必须由客户端回应的用户交互。session/prompt最终response及stopReason才是本轮结束依据。公开例子关闭客户端文件读写能力；球球不能因此获得本机任意文件权限。任务、消息、SSE票据不可进入日志或UI。任务link须验证可信官方目标，不能将Bearer发送到任意返回URL。

## 尚需实测/官方确认

1. 纯桌面产品可申请的应用类型、审核材料与权限准入。
2. 已登记回调的允许协议、开发/生产回调规则、真实令牌响应及撤销方式。
3. 本地助理的PC版本、多设备选择、会话归属、并发聊天隔离、完整审批协议与轮询限速。
4. 云任务分页、ACP重连/票据续期、失败/取消与工具审批实际行为。不要把任务创建成功算作回复和任务完成。

来源：[OpenAPI](https://open.workbuddy.cn/docs/openapi)、[第三方应用](https://open.workbuddy.cn/docs/third-party-app)。本记录是实现前契约核验，不表示平台已受理球球或已有可用凭据。
