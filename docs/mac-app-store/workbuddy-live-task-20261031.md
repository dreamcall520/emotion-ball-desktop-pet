# WorkBuddy 实时状态的两条范围

2026-10-31。当前新增的是球球自己发起的专用 ACP 回复生命周期，不是原 WorkBuddy Desktop 全部任务的实时接口。

## 已实现

`workbuddy-live-task.js` 被 `workbuddy-cli-connection.js` 使用，公开 `getState().liveTask`，并可注入 `onTaskChange(task)`。开始发起自己的 prompt 后为 active/starting；收到本轮增量才进入 running；收到 `session/prompt` 最终返回，才按 `end_turn / cancelled / refusal` 报告 completed / interrupted / refused。明确 RPC 拒绝为 failed，断线、超时及结果未知为 unknown，running=null。停止请求先进入 cancelling，不抢先声称停止成功。

历史 REST jobs/session 的 pending 等状态不进入此生命周期，不能覆盖本轮已确认终态。恢复上次未确认发送只恢复 unknown，不发出新的开始或完成事件。撤销、断线、退出后迟到的返回不能让已停止的连接复活。正常完成事件按本次 request id 去重，可供球球守护/气泡消费。

51项生命周期、连接和协议客户端检查通过，全部为合成协议，无模型调用；真正账号的实时UI和守护联动由主Agent验证。新增模块需列入打包白名单。

## 原 Desktop 的新路线线索

官方 [WorkBuddy 插件系统](https://www.workbuddy.cn/docs/workbuddy/Plugins) 明确支持 Hook 插件和添加第三方插件市场；[插件功能说明](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Plug-In)也列出自动化规则。[桌面更新日志](https://www.workbuddy.cn/docs/workbuddy/Changelog)的5.3.5版本列出扩展插件Hook。这是不同于企业OpenAPI的可验证接入路线，不能直接断言原Desktop实时任务永远只能企业认证。

但公开Desktop文档未完整展开本地插件导入、各Hook payload及会话事件契约。CLI的 [Hook参考](https://www.workbuddy.cn/docs/cli/hooks)和[创建插件](https://www.workbuddy.cn/docs/cli/plugins)说明插件可含hooks/hooks.json和command/http处理器，UserPromptSubmit/Stop等事件可用于生命周期；不能把CLI契约直接当作Desktop已实测兼容。

若继续，应在原Desktop的插件管理中核验正式安装/启用入口，使用仅导出会话标识、generation及阶段的元数据插件，由本人审阅后启用。不改原账号、不解密登录、不读取transcript。标准Hook输入可能含prompt等私有字段：球球不能接收全量原始Hook JSON，现有缓存元数据授权也不能当作读取原聊天正文的许可。安装前需明确本机过滤及实际导出范围。

官方 [HTTP API](https://www.workbuddy.cn/docs/cli/http-api)还有jobs/events，但其范围是所连接CLI宿主的jobs；不代表原WorkBuddy Desktop任务。当前没有为读取它而创建或执行任何后台工作任务。
