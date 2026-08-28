# Codex 可选联动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 默认关闭的本机 Codex 额度和任务提醒，保持普通桌宠完全独立。

**Architecture:** 只读传输与白名单字段提取独立于提醒策略；总控制器拥有连接代次和定时器。菜单与气泡通过受控入口复用现有动作，不新增动画时钟。正文不落盘，未知状态不推断完成。

**Tech Stack:** 现有 Electron / CommonJS / node:test；Node 内置 net、child_process、crypto，无新增依赖。

工作树：`/Users/allan/Documents/个人创作/emotion-ball-desktop-pet/.worktrees/light-companion`。基线 217 项通过，分支 `codex/light-companion`。规格见 `../specs/2026-08-28-codex-companion-design.md`。

## Task 1：只读连接及最小状态

文件：新增 `desktop-pet/lib/codex-state.js`（字段白名单）、`codex-rpc.js`（额度子进程）、`codex-stream.js`（桌面状态）、`codex-connection.js`（两路组合）；对应 `desktop-pet/tests/codex-*.test.js`。

- [ ] 先写状态与边界失败测试并执行 `node --test desktop-pet/tests/codex-state.test.js`。新文件不存在时以 `assert.ok(fs.existsSync(modulePath))` 明确失败，之后才加载模块。核心断言：

```js
assert.equal(normalizeQuota({rateLimits:{primary:{usedPercent:85,windowDurationMins:300,resetsAt:2000000000}}}, 100).windows[0].remaining,15);
assert.equal(normalizeTask({threadRuntimeStatus:{type:'notLoaded'}},100).state,'unknown');
assert.equal(JSON.stringify(normalizeTask({title:'标题',turns:[{turnId:'one',status:'inProgress',items:[{text:'SECRET_BODY'}]}]},100)).includes('SECRET_BODY'),false);
```

- [ ] 实现白名单：quota windows 保留 id/label/window/remaining/reset；task 保留 id/title/state/turnId/updatedAt，状态仅 active/waiting/completed/failed/interrupted/idle/unknown。canonical 与 legacy 均找最新轮次；runtime active flags 和明确请求类型决定等待，明确终态决定本轮结束，错误正文不保留。
- [ ] 为真实帧分片、帧过大、错误 JSON、超时、取消和方法白名单写失败测试，再实现连接。导入/构造均不探测。现有 `.codex/ipc/ipc.sock` 校验当前 uid、非符号链接、父目录无其他用户写权限。只发送 initialize、thread-owner-discovery、following changed/status requested；不宣布所有权。
- [ ] stdio 只允许 initialize、account/read、account/rateLimits/read、thread/list。安装仅检查 `/Applications/Codex.app`、`/Applications/ChatGPT.app` 与用户 Applications 的 Resources/codex，不扫描私人文件或自动安装。连接关闭杀死自身 child、移除监听、拒绝 pending；任何错误只提供固定错误码。
- [ ] thread/list 仅元数据（read-only state DB），单轮最多 20 个最近本机非归档非子代理任务，明确 partial。跟随后立即白名单提取并丢弃原始状态包。增量只保留相关标量，版本缺口/owner 切换变 unknown 并限频重新请求 snapshot，绝不请求完整历史。owner 断连不能继续显示处理中。
- [ ] 两路独立：`createCodexConnection({onQuota,onTask,onStatus,onAccount})` 返回 `start()`、`refresh()`、`close()`；账户只提供不可逆内存 identity，切换时先清旧状态。返回状态 `connecting/connected/missing/unauthenticated/unsupported/disconnected`，不泄漏原始错误。
- [ ] 执行对应测试及全量 `npm test`，提交仅本任务文件；规格复核后再质量复核。

## Task 2：总开关、提醒策略与菜单模型

文件：修改 `desktop-pet/lib/settings.js`；新增 `codex-companion.js`、`codex-menu.js` 与对应 tests。

- [ ] 添加失败测试：`assert.equal(normalizeSettings({codexEnabled:'true'}).codexEnabled,false)`；实现仅 boolean 有效，默认 false，保留已有设置。
- [ ] 控制器 `createCodexCompanion({createConnection,onChange,onAlert,onClear,canPresent,now,schedule,cancel})` 返回 `setEnabled()`、`refresh()`、`getSnapshot()`、`dismiss()`、`close()`。先测试默认零 I/O、rapid toggle、晚到回调，然后实现 generation guard 和只在 enable 时创建连接。
- [ ] 先用可控时钟写失败测试，再实现 quota 120 秒、manual 10 秒、stale 5 分钟；暂时连接错误 30/60/120 秒退避，missing/unauthenticated/unsupported 仅手动重试。断路状态分别展示，旧值标过期。
- [ ] 阈值窗口键 `bucket:duration:reset`，剩余 <=20/10 同档去重、跨档仅严重档。任务首次只基线，真正状态转换发事件：active→sway（无气泡），waiting→peek，completed→hop，failed→jelly，中断不庆祝。同一轮终态去重；unknown、notLoaded、断连不生成完成。
- [ ] 提醒规则测试后实现：五秒同类合并、所有提醒共享三十秒、direct input/drag/隐藏/锁屏/睡眠 defer 最长六十秒；最近十条仅内存。off/accountchange 清空所有资源与排队，onClear 只清联动表现。
- [ ] 菜单模型输出纯文本、转义 `&` 加速键、截断标题，缺失字段显示不可用、partial 明确「最近最多20个任务」。可信 UUID 构造 `codex://threads/<uuid>`；回调拒绝旧代次/未知任务，不处理接口提供 URL。
- [ ] 执行测试及全量 `npm test`；提交本任务文件；规格复核通过后质量复核。

## Task 3：接入现有界面与验收

文件：修改 `desktop-pet/main.js`、`lib/dialogue.js`、`bubble-renderer.js`、`preload.js`、`renderer.js`（只增受控联动入口）、`scripts/package-mac.js`；新增联动集成 tests 及必要 smoke 检查。

- [ ] 先写默认关闭与弹窗取消无连接的集成失败测试，再增加菜单 checkbox。`dialog.showMessageBox` 使用「开启联动 / 暂不开启」，defaultId/cancelId 指向取消；完整说明临时接收正文且不存不传。确认之后才保存 true 和连接；每次从 off→on 再确认，重启 saved true 恢复。
- [ ] 为普通气泡优先、联动按钮过期及off清理写失败测试，再扩展 DialogueDirector 受控 `offerCodex` / `dismissCodex` / `respond`，共用 id，联动 duration 8000。只允许 codex-open/codex-list/codex-dismiss，主进程校验发送窗口、当前 id、enabled、generation 和仍有效 task。
- [ ] 为动作不打断用户/睡眠写失败测试，再增加 renderer 的 codex 命令，复用 interaction-motion 和 window-motion。渲染端提供自身是否适合展示的最小状态（不传键盘内容），关闭只取消 owner 为 codex 的动作；用户开始互动立即取消联动所有权。
- [ ] 接主菜单、额度/任务子菜单和最近提醒；单任务用户点击才 shell.openExternal 可信深链，多任务仅 popup 任务菜单。所有失败固定文案，无原始错误写现有 errors.log。
- [ ] 包装脚本 runtimeFiles 明确加入新模块；不携带 Codex binary、账号、快照或诊断输出。测试包文件完整性及旧版动作/气泡行为。
- [ ] `npm test` 和 `npm run smoke`；另只读连接真实当前任务检查额度/运行状态，正常出现的等待/结束/失败按实际记录，未发生的状态不伪称实机通过。不主动创建收费测试任务、不安装替换。
- [ ] 检查 80×80 与其余尺寸、气泡边界、灰白色、旧双击和拖动。最终规格/质量复核；更新 verification 及知识库中本项目少量状态。`git diff --check`，秘密/大文件检查，精确 stage/commit/push 当前分支，回读远端 SHA。

## 交付边界

源码、真实窗口、打包、安装和分享 ZIP 分别报告。未通过全部真实状态门槛时只能称候选版；不合并主分支或发布 Release，不替换安装版，不声称所有状态已实机验证。
