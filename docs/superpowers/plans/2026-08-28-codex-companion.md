# Codex 可选联动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 默认关闭的本机 Codex 额度和任务提醒，保持普通桌宠完全独立。

**Architecture:** 只读传输与白名单字段提取独立于提醒策略；总控制器拥有连接代次和定时器。菜单与气泡通过受控入口复用现有动作，不新增动画时钟。正文不落盘，未知状态不推断完成。

**Tech Stack:** 现有 Electron / CommonJS / node:test；Node 内置 net、child_process、crypto，无新增依赖。

工作树：`/Users/allan/Documents/个人创作/emotion-ball-desktop-pet/.worktrees/light-companion`。基线 217 项通过，分支 `codex/light-companion`。规格见 `../specs/2026-08-28-codex-companion-design.md`。

当前交付门槛（2026-08-29）：用户打开原 A/B 后已完成对照并修复三处兼容问题；491 项检查、真实运行/完成、并发合并气泡、完整跳跃及关闭清理通过。未打开后台新任务此前失败，尚未重新证明可靠；等待/失败/中断与实际跳转仍待验。只复用了原两条专用任务，没有创建第三条；不再自行追加测试轮次，不安装、不发布。详见验收记录最新章节。

## Task 1：只读连接及最小状态

状态：已完成，规格及质量复核通过（`6d94382`）；全量 350 项通过。真实额度、处理中与大包隔离已回验，其余真实状态仍按交付门槛单独记录。

文件：新增 `desktop-pet/lib/codex-state.js`（字段白名单）、`codex-rpc.js`（额度子进程）、`codex-frame.js`（有界帧与协议头读取）、`codex-stream.js`（桌面状态）、`codex-connection.js`（两路组合）；对应 `desktop-pet/tests/codex-*.test.js`。

- [x] 先写状态与边界失败测试并执行 `node --test desktop-pet/tests/codex-state.test.js`。新文件不存在时以 `assert.ok(fs.existsSync(modulePath))` 明确失败，之后才加载模块。核心断言：

```js
assert.equal(normalizeQuota({rateLimits:{primary:{usedPercent:85,windowDurationMins:300,resetsAt:2000000000}}}, 100).windows[0].remaining,15);
assert.equal(normalizeTask({threadRuntimeStatus:{type:'notLoaded'}},100).state,'unknown');
assert.equal(JSON.stringify(normalizeTask({title:'标题',turns:[{turnId:'one',status:'inProgress',items:[{text:'SECRET_BODY'}]}]},100)).includes('SECRET_BODY'),false);
```

- [x] 实现白名单：quota windows 保留 id/label/window/remaining/reset；task 保留 id/title/state/turnId/updatedAt，状态仅 active/waiting/completed/failed/interrupted/idle/unknown。canonical 与 legacy 均找最新轮次；runtime active flags 和明确请求类型决定等待，明确终态决定本轮结束，错误正文不保留。
- [x] 为真实帧分片、帧过大、错误 JSON、超时、取消和方法白名单写失败测试，再实现连接。导入/构造均不探测。现有 `.codex/ipc/ipc.sock` 校验当前 uid、非符号链接、父目录无其他用户写权限。只发送 initialize、thread-owner-discovery、following changed/status requested；不宣布所有权。实測大包采用 16MiB 解析上限、8KiB 协议头、256MiB 硬上限；超解析上限但可安全路由时流式丢弃并隔离对应任务，标记 `unavailable: STATE_TOO_LARGE`，不自动反复请求。
- [x] stdio 只允许 initialize、account/read、account/rateLimits/read、thread/list。安装仅检查 `/Applications/Codex.app`、`/Applications/ChatGPT.app` 与用户 Applications 的 Resources/codex，不扫描私人文件或自动安装。连接关闭杀死自身 child、移除监听、拒绝 pending；任何错误只提供固定错误码。
- [x] thread/list 仅元数据（read-only state DB），单轮最多 20 个最近本机非归档非子代理任务，明确 partial。跟随后立即白名单提取并丢弃原始状态包。增量只保留相关标量，版本缺口/owner 切换变 unknown 并限频重新请求 snapshot，绝不请求完整历史。owner 断连不能继续显示处理中。
- [x] 两路独立：`createCodexConnection({onQuota,onTask,onStatus,onAccount})` 返回 `start()`、`refresh()`、`retry({quota,tasks})`、`close()`；自动重试仅重建失败通道，手动整体刷新可重试被隔离状态。账户只提供不可逆内存 identity，切换时先清旧状态。返回状态 `connecting/connected/missing/unauthenticated/unsupported/disconnected`，不泄漏原始错误。
- [x] 执行对应测试及全量 `npm test`，提交仅本任务文件；规格复核后再质量复核。

## Task 2：总开关、提醒策略与菜单模型

状态：已完成，规格及质量复核通过（`4891359`），当时全量 424 项通过；后续界面接入见 Task 3。

文件：修改 `desktop-pet/lib/settings.js`；新增 `codex-companion.js`、`codex-menu.js` 与对应 tests。

- [x] 添加失败测试：`assert.equal(normalizeSettings({codexEnabled:'true'}).codexEnabled,false)`；实现仅 boolean 有效，默认 false，保留已有设置（`74d1ce3`，7 项设置测试通过）。
- [x] 控制器 `createCodexCompanion({createConnection,onChange,onAlert,onClear,canPresent,now,schedule,cancel})` 返回 `setEnabled()`、`refresh()`、`getSnapshot()`、`dismiss()`、`close()`。先测试默认零 I/O、rapid toggle、晚到回调，然后实现 generation guard 和只在 enable 时创建连接。
- [x] 先用可控时钟写失败测试，再实现 quota 120 秒、manual 10 秒、stale 5 分钟；暂时连接错误 30/60/120 秒退避，missing/unauthenticated/unsupported 仅手动重试。断路状态分别展示，旧值标过期。
- [x] 阈值窗口键 `bucket:duration:reset`，剩余 <=20/10 同档去重、跨档仅严重档。任务首次只基线，真正状态转换发事件：active→sway（无气泡），waiting→peek，completed→hop，failed→jelly，中断不庆祝。同一轮终态去重；unknown、notLoaded、断连不生成完成。
- [x] 提醒规则测试后实现：五秒同类合并、所有提醒共享三十秒、direct input/drag/隐藏/锁屏/睡眠 defer 最长六十秒；最近十条仅内存。off/accountchange 清空所有资源与排队，onClear 只清联动表现。
- [x] 菜单模型输出纯文本、转义 `&` 加速键、截断标题，缺失字段显示不可用、partial 明确「最近最多20个任务」。可信 UUID 构造 `codex://threads/<uuid>`；回调拒绝旧代次/未知任务，不处理接口提供 URL。
- [x] 执行测试及全量 `npm test`；提交本任务文件；规格复核通过后质量复核。

## Task 3：接入现有界面与验收

状态：源码候选已完成，早期规格复核至 `cfa5536`、质量复核至 `c4bba9b` 通过。2026-08-29 补修来源、轮次与短暂空闲过渡兼容，独立复核发现的清理回调重入误报已先红后绿修正；全量 491 项通过。已打开的两条真实任务完成、合并气泡与跳跃已回验，未打开后台任务及其余真实状态仍按上方门槛记录；此前偶发失败根因未定位，未安装或更新分享 ZIP。

文件：修改 `desktop-pet/main.js`、`lib/dialogue.js`、`bubble-preload.js`、`bubble-renderer.js`、`preload.js`、`renderer.js`（只增受控联动入口）、`scripts/package-mac.js`；新增联动集成 tests 及必要 smoke 检查。

- [x] 先写默认关闭与弹窗取消无连接的集成失败测试，再增加菜单 checkbox。`dialog.showMessageBox` 使用「开启联动 / 暂不开启」，defaultId/cancelId 指向取消；完整说明临时接收正文且不存不传。确认之后才保存 true 和连接；每次从 off→on 再确认，重启 saved true 恢复。
- [x] 为普通气泡优先、联动按钮过期及off清理写失败测试，再扩展 DialogueDirector 受控 `offerCodex` / `dismissCodex` / `respond`，共用 id，联动 duration 8000。只允许 codex-open/codex-list/codex-dismiss，主进程校验发送窗口、当前 id、enabled、generation 和仍有效 task。
- [x] 为动作不打断用户/睡眠写失败测试，再增加 renderer 的 codex 命令，复用 interaction-motion 和 window-motion。渲染端提供自身是否适合展示的最小状态（不传键盘内容），关闭只取消 owner 为 codex 的动作；用户开始互动立即取消联动所有权。
- [x] 接主菜单、额度/任务子菜单和最近提醒；单任务用户点击才 shell.openExternal 可信深链，多任务仅 popup 任务菜单。所有失败固定文案，无原始错误写现有 errors.log。
- [x] 包装脚本 runtimeFiles 明确加入新模块；不携带 Codex binary、账号、快照或诊断输出。测试包文件完整性及旧版动作/气泡行为。
- [x] `npm test` 和 `npm run smoke`；另只读连接真实当前任务检查额度/运行状态，正常出现的等待/结束/失败按实际记录，未发生的状态不伪称实机通过。不主动创建收费测试任务、不安装替换。
- [x] 检查 80×80 与其余尺寸、气泡边界、灰白色、旧双击和拖动；完成最终规格/质量复核、verification、`git diff --check` 及秘密/大文件检查。按既有授权精确提交/推送当前分支并回读远端 SHA，知识库只追加本项目状态；不合并或发布。

## 交付边界

源码、真实窗口、打包、安装和分享 ZIP 分别报告。未通过全部真实状态门槛时只能称候选版；不合并主分支或发布 Release，不替换安装版，不声称所有状态已实机验证。
