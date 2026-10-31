# WorkBuddy Desktop 元数据 Hook 审查草稿

**未安装、未启用、没有接收端口或服务凭据。** 默认不发送任何事件。不要把草稿或合成测试当作原桌面任务已接通。

## 用户需要确认的具体权限

启用后，WorkBuddy 会在本机运行此插件的过滤脚本。标准Hook输入可能包含本轮提示词及上次回复；过滤脚本只在本机有限内存中提取 `session_id`、可选 `generation_id`、`hook_event_name`、FinalStop的四种白名单原因，其余不保存、不打印、不发送。球球收到的只有固定会话标识、事件与阶段，没有原聊天正文、标题、路径、工具参数或登录信息。

这与既有“读取任务缓存元数据”的授权不同，需要本人在安装/启用插件时明确确认。安装前应让本人审阅此说明和脚本，并说明接收方仅为本机球球。App服务的临时连接凭据由球球生成，不能让用户填写终端、端口或密钥。

## 状态含义

| Hook | 出站phase | 可证明的事实 |
|---|---|---|
| SessionStart | session-opened | 会话启动/恢复事件已发生 |
| UserPromptSubmit | submitted | 新输入已提交；不能等同模型已开始运行 |
| Stop | stop-observed | 收到结束候选事件；其他Hook仍可能阻止停止并继续 |
| StopFailure | failure-observed | 观察到失败事件；不擅自推断整个桌面任务最终状态 |
| SessionEnd | session-ended | 会话结束事件已发生，不擅自推断业务成功 |
| FinalStop（已核5.9.3） | final-stop-observed | 全部Stop继续决策之后的主回复终态；只出站completed/cancelled/interrupted/failed四种原因 |

没有 `generation_id` 的事件不能强行与某一轮对话关联。**Stop不会产生完成。** 已核WorkBuddy Desktop5.9.3的FinalStop在所有Stop继续决策之后触发，只在generation关联且原因属于四种白名单时确认主回复完成/中断/失败；缺失或未知原因、截断恢复均保持未知。主回复完成不代表后台团队任务全部结束，不能据此宣称整个桌面任务队列完成。0.2.0新增此版本化路径，未来Desktop版本变更需重新验证。

## 接入入口证据

2026-10-31只读核对安装的WorkBuddy Desktop **5.9.3** 的公开程序资源，没有访问用户消息或凭据，也没有调用其私有管理接口：

- 官方[插件系统](https://www.workbuddy.cn/docs/workbuddy/Plugins)允许在插件页点“+”添加第三方市场。
- Desktop真实renderer的 `AddMarketplaceModal` 提示支持 `owner/repo, git@..., https://.../*.zip, or ./path`，输入只要求非空。
- 主进程公开打包代码的 `parseSource` 对已存在的本地目录识别为 Directory；ZIP/TGZ也可作为本地来源。
- Desktop内置CLI确实加载插件 `hooks/hooks.json`，支持command/http。直接HTTP Hook把完整输入（仅去掉内部session对象）序列化，**没有自定义body/字段选择参数**，因此这里不能使用直接HTTP Hook。
- 元数据草稿市场根目录为本README所在目录；正式UI导入路径是“插件→市场＋→本地市场目录→提交→审阅插件→安装/启用”。此为静态资源核验，仍需真实UI回读，不代表已安装成功。

## 接收配置

过滤脚本使用macOS自带 `/bin/sh`、`head`、`plutil`、`curl`，无需安装Node/Python或打开终端。完整输入最多256KiB，只经stdin和本机内存处理；没有完整输入的临时文件或日志。非法事件/标识、超限输入、缺配置均直接退出0，不阻止原任务。

后续球球应在本人同意后，为已确认的插件安装位置生成mode600的 `receiver.json`：version=1、enabled=true、固定127.0.0.1地址与随机本机能力令牌。脚本只允许127.0.0.1的1024–65535端口及 `/workbuddy/events` 固定路径；认证通过curl的stdin配置传递，不在命令行或URL。curl忽略用户curlrc并显式禁用代理，避免本机元数据/能力令牌被环境代理转发。网络失败不会阻止原任务。关闭/撤销时球球应撤销能力令牌并停用接收，不能自动修改其他插件或原工具账号。

本草稿故意不包含receiver.json，也不包含可公开使用的令牌。正式实现还需完成接收器的身份校验、关联、重放防护、重启恢复、卸载和真正MAS沙盒验证。

## 合成验证

`desktop-pet/tests/workbuddy-desktop-hook-draft.test.js`：6项macOS合成输入检查，涵盖正文/路径/token丢弃、Stop非完成、无generation、非法/超限输入、默认禁用，以及鉴权loopback仅收到元数据、FinalStop白名单/恢复保护。所有输入均测试数据，未调用模型或读取原桌面聊天。
