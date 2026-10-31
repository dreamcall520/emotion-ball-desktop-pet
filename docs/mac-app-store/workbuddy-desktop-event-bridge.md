# 原 WorkBuddy Desktop 元数据接收器

`desktop-pet/lib/workbuddy-desktop-event-bridge.js` 是独立、默认关闭的本机元数据接收器。它不读原Desktop文件、消息、凭据或插件配置，也不安装或启用插件。

```js
const bridge = createWorkBuddyDesktopEventBridge({ onEvent, onChange });
const receiver = await bridge.start();
// private only: {version:1,enabled:true,endpoint,token}
// App可将其保存到自身userData的600文件；不能进入renderer/日志。
// 普通重启以新实例恢复：
await anotherBridge.start({port: savedPort, token: savedToken});
bridge.getState(); // safe snapshot, no token
await bridge.close();
```

默认随机端口。受控恢复仅接受1024..65535端口和32..128字符base64url格式令牌，host始终127.0.0.1；端口冲突返回 `BRIDGE_PORT_UNAVAILABLE`，不悄悄换端点。关闭只停止本次监听、撤销本实例内存能力；主App在用户明确撤销时删除自己保存的私有配置，之后重新启用应生成新的令牌。

固定接收路径 `/workbuddy/events`，只接受无Origin的POST application/json与Bearer鉴权。2KiB限额、60次/10秒限频、短请求超时和16连接上限；无CORS授权。受限元数据parser不是通用JSON反序列化器：未知属性名在读取其值之前即被拒绝，因此prompt/reply/path/tool字段不进入解析结果或发布事件。令牌、原输入和原始错误均不日志。所有错误响应只有安全布尔结果。

固定payload（FinalStop可额外包含白名单finalStopReason）：

```json
{"version":1,"sessionId":"opaque-id","generationId":"optional-opaque-id","event":"Stop","phase":"stop-observed"}
```

允许的event/phase：SessionStart/session-opened、UserPromptSubmit/submitted、Stop/stop-observed、StopFailure/failure-observed、SessionEnd/session-ended、FinalStop/final-stop-observed。标识仅允许1..160字符ASCII字母、数字、下划线、连字符；唯一额外允许的元数据是FinalStop的finalStopReason（completed/cancelled/interrupted/failed）；其他字段、转义字段、重复字段或嵌套对象均拒绝。

`onEvent` 只向主进程发布已批准的标识和阶段，并明确 `scope: authorized-original-workbuddy-hook-metadata`。Stop或未关联事件始终terminalConfirmed=false；版本化FinalStop且generation存在、reason白名单有效时才terminalConfirmed=true，terminalKind=main-reply，overallTaskVerified=false。安全快照仅含hash观察ID和阶段，不暴露原标识/令牌。事件canonical去重，最多保留32个观察；缺generation不关联轮次。超过60秒或关闭后realtime=false；未确认事件变unknown，已确认的历史主回复终态保留，不冒充当前实时状态。

**Stop永远不等于completed。** 已核Desktop5.9.3源码：executeStopHooks收集全部Stop决策后，completed且有继续请求时不会FinalStop；否则调用executeFinalStopHooks，携带final_stop_reason。正常主/非default-main回复为completed，中断interrupted，错误分支cancelled/failed。FinalStop+generation+白名单reason可确认本轮主回复终态；不能证明后台团队任务全部结束或账号归属。`desktopRealtimeVerified` 与 `terminalTaskStateVerified` 仍保持false（它们指整体任务），终态新增terminalKind=main-reply。与球球专用CLI liveTask分开消费。未知reason或截断恢复不能当完成，迟到Stop不覆盖已确认的同轮主回复终态。

13项模块测试通过，包括端口恢复/冲突、鉴权/Origin、2KiB、限频、去重、未知字段、关闭/过期及源端草稿脚本→真实loopback接收器演示。演示完全使用合成输入，不涉及原Desktop安装或聊天。工具页实时UI和草稿过滤另8项检查，合计21项通过。

真实Desktop的插件安装/启用、源端临时接触原Hook输入，需要本人当次确认。草稿位于 `workbuddy-desktop-hook-draft/`，未安装、未启用。官方安装深链/自动预填导入URL目前没有可核实证据；已核静态原生UI支持本地目录来源，但生产接入仍需一次明确的插件安装，不能声称用户只点球球按钮即已获得原Desktop事件。

静态追踪补充：SQLite正常prompt路径在后端最终返回后派生并持久化状态，但completed也可来自取消归一化或显式手动更新；updatedAt还会受重命名/配置修改影响，数据库未持有Hook generation关联，团队可能再激活终态。因此“Stop+同sessionId+updatedAt变新”不能独占证明自然成功。FinalStop白名单原因可确认主回复终态，整体后台任务仍需额外依据。公开资源位置（已核5.9.3）为main/server.js的SessionManager.prompt/persistDerivedTaskStatus/applyExplicitTaskStatus及main/task-status.js的normalizeTaskStatus/applyManualTaskStatus。
