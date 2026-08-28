# Codex 只读联动：开发前接入核验

日期：2026-08-28

结论：额度读取已有成功证据。发现桌面订阅附带已加载会话内容后曾暂停；用户现已同意临时接收并丢弃正文。获授权后的探测已读取当前任务的真实处理中状态及增量更新，尚未完成所有状态及产品验收。

## 已确认

- 工作树为现有 `codex/light-companion`，开始时干净，未在主分支开发。
- `npm test -- --test-reporter=dot` 实际仍输出默认报告，退出码 0：217 项通过、0 失败；这是原有功能基线，不是新功能验收。
- 本机 Codex CLI 版本为 `0.150.0-alpha.8`。
- `codex app-server daemon version` 返回默认 `app-server-control/app-server-control.sock` 不存在。未启动、重启或修改共享服务。
- 系统打开文件清单显示，桌面应用使用已有的 `.codex/ipc/ipc.sock`。探测先检查 socket 及父目录属于当前用户、非符号链接且不可被其他用户写入，再连接；没有创建 socket、目录或修改权限。
- 使用独立的 `emotion-ball-desktop-pet` 客户端标识，只发送 `initialize`。收到成功响应；不冒用已有窗口、任务或执行器身份，不声明任务所有权。
- 十五秒被动监听只收到一次 `thread-stream-following-changed`，包含会话标识、主机标识、是否跟随等元数据；没有收到可用于判断处理中、等待或完成的状态。输出仅记录字段类型和事件计数，不记录会话标识值、标题或正文。
- 结束时主动断开探测连接，探测进程退出码 0；没有留下监听服务。

## 代码侧证据与限制

只读检查了本机安装包，不修改安装资源。当前构建中的相关位置：

- `.vite/build/src-LXsvCZ9X.js`：IPC 使用长度前缀帧；`initialize` 分配独立客户端标识；`thread-stream-state-changed` 当前版本为 11，跟随通知版本为 1。
- `webview/assets/app-initial-CpK4W6kT.js`：`sendConversationSnapshot` 从 `threadStore.getConversation` 取会话状态，`sendSnapshot` 将整个状态对象作为 `conversationState` 发送。
- 同一状态模型包含已加载的轮次/条目历史，而非仅运行标志。现有发送方法没有「只发送状态字段」参数。
- 应用工具插件要求执行器提供当前任务元数据；不能把任务内工具当作任意独立桌宠都能长期调用的接口，也不伪造执行器元数据绕过其边界。

构建文件名只是本次定位证据，不能硬编码成跨版本产品接口。上述代码说明了传输范围；未实际请求、接收或保存完整会话快照，不能据此宣称实时任务提醒已经验证。

## 未执行的操作

- 未发送 `thread-stream-following-changed: following=true`，未请求完整快照/完整历史。
- 未调用恢复任务、开始轮次、发送消息、审批、归档、打断或额度重置。
- 未读取凭据文件，未修改 Codex 配置、数据库或安装包；未增加后台服务。
- 未安装桌宠候选版，未改变正式版设置，未更新分享 ZIP。

## 获授权后的补充核验

用户已同意：开启后本机临时接收状态包，只提取进展，正文不落盘、不上传；分享用户开启前同样说明并确认。

- 在本次正在进行的用户任务上发送只读跟随通知，收到版本 11 的 snapshot，`threadRuntimeStatus.type = active`。
- `turns` 可为空；本机使用 `turnHistory.history.entitiesByKey`，当前轮次 `status = inProgress`。不能只检查旧版 turns 数组。
- 收到连续版本的 patches；没有打印/写入标题、正文、凭据。输出仅为类型、状态、字段名与计数。
- 结束时发送 following=false 并断开；两次短暂探测均已正常退出，无残留监听。
- 仍未主动创建、恢复、审批、发送或中断任务。此前「未执行」清单描述授权前的探测，不代表此后的跟随请求未发送。
- 本轮重新读取 `account/read` 和 `account/rateLimits/read` 成功；额度仍返回真实窗口、已用比例和重置时间。诊断仅打印字段名，没有打印账户或额度数值。
- `thread/list` 使用 `limit:20, sortKey:updated_at, archived:false, sourceKinds:[], useStateDbOnly:true` 成功；返回二十条并有后续游标，因此只能表述为最近任务的局部视图。标题字段是 `name`，不能以 `preview` 代替。
- 独立 stdio 探测进程已终止；未启动默认共享 daemon。
