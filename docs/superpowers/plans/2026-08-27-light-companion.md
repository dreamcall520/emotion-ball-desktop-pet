# Light Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现已确认的轻陪伴与可回应短句气泡，并交付已验证的本地应用。

**Architecture:** 主进程提供鼠标坐标与系统空闲时长；可测试的纯规则模块选择状态与气泡；渲染层复用表情。独立非激活气泡窗口负责固定字号和边界避让，不改宠物窗口尺寸。

**Tech Stack:** 现有 Electron 43、原生 JavaScript/SVG、Node test；不增加依赖。

---

### Task 1: 独立规则模块（先红后绿）

文件：`desktop-pet/lib/companion-behavior.js`、`dialogue.js`、`bubble-placement.js`、`settings.js` 及对应 Node tests。

- [ ] 新增失败用例：阈值 300/600/900 秒、手动睡眠优先、工作活动保持清醒、返回只唤醒一次、同屏视线、摸头判定、气泡冷却与无连续重复、过期回复、四角/负坐标避让、旧设置兼容。
- [ ] 执行 `node --test desktop-pet/tests/companion-behavior.test.js desktop-pet/tests/dialogue.test.js desktop-pet/tests/bubble-placement.test.js desktop-pet/tests/settings.test.js`，确认新增断言先失败。
- [ ] 实现 UMD `CompanionBehavior`：`CompanionState.update(sample, now)` 返回 `{mode, emotionId, welcome, gaze}`；公开 `setManualSleep(enabled, now)`、`setKeepAwake(enabled)`、`noteInteraction(now)`；`PettingTracker.update(point, now)` 与 `reset()`。
- [ ] 实现 Node `DialogueDirector.offer(event, now)`、`respond(id, action, now)`、`dismiss()`、`setEnabled(enabled)`；payload 包含 id/text/actions/durationMs。实现 `bubbleBounds(petBounds, workArea, interactive)` 返回窗口 bounds、placement、anchorX。
- [ ] 运行目标测试并检查 diff，提交规则模块。

### Task 2: 桌面接入与气泡 UI

文件：新增 `desktop-pet/lib/activity-monitor.js`、`bubble-window.js`、`bubble.html`、`bubble.css`、`bubble-renderer.js`、`bubble-preload.js`；修改 `main.js`、`preload.js`、`renderer.js`、`index.html`、`pet.css`。

- [ ] 先写集成契约和真实 smoke 失败断言：活动事件/设置事件/对话 IPC、真实气泡 DOM 和非激活窗口、按钮回复关闭并执行动作。
- [ ] 主进程每 125ms 采样鼠标，系统空闲时长每秒更新。锁屏暂停活动、隐藏气泡；解锁恢复。采样失败不错误累计空闲。
- [ ] 渲染层禁用旧局部 idle，使用 CompanionState；把系统活动、人工操作与短时动作分层，主动动作不被采样打断。
- [ ] 复用并注册安静表情变体，关闭自动 antics；保留点击原生跳跃和自旋。加入头顶轻抚和拖动反馈。
- [ ] 对话请求只传事件名；主进程校验来源并生成文案。气泡显示固定 14px、边缘翻转、鼠标穿透或两个按钮，所有回复校验当前气泡 id。
- [ ] 菜单开关保存并广播；销毁/隐藏/退出清理窗口与定时器。运行测试和真实启动检查。

### Task 3: 打包、真实验收和本地交付

文件：`desktop-pet/scripts/package-mac.js`、`scripts/smoke-electron.js`、`tests/package-script.test.js`、README、package 版本信息。

- [ ] 先增加打包包含新增文件、真实行为/气泡检查的失败断言；更新明确的打包清单。
- [ ] 执行 `npm test`、`npm run smoke`；真实截图检查 80×80 眼睛、Zzz、气泡和点击反馈，覆盖四角位置。
- [ ] 执行 `npm run package:mac`；签名核验、打包版 smoke 和 app.asar 文件核对。
- [ ] 保存旧本地应用备份后安装并启动本地新版；不上传、不改公开 Release。回读安装版并提交变更。
- [ ] 需求符合性复核通过后再进行代码质量复核；修复重要问题并复跑所有检查。
