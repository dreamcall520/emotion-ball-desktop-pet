# Unified Connection Guide Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for isolated implementation and review tasks.

**Goal:** 三家工具统一引导与能力卡，保留真实权限边界和部分成功。

**Architecture:** 新增无副作用的共享状态投影模块，复用既有经过校验的IPC命令与授权存储；renderer负责单一引导导航，主进程继续拥有权限/账号/文件操作。

**Tech Stack:** Electron43、Node、browser JavaScript、原生系统授权、node:test和Chromium DOM。

- [x] 1. `lib/provider-connection-guide.js`+tests：按既有状态投影步骤与三能力，覆盖缺项、取消、空套餐、缓存/实时、过期事件及账号未知。
- [x] 2. `store-connections.html/css/renderer.js`+UI tests：一入口、同卡三行、向导分步执行与部分成功、恢复、ZCode来源明确选择、重复表单折叠。
- [x] 3. `main.js`+packager：补共享模块白名单，核对聊天可用门禁、已有授权不重复弹窗、数据恢复与撤销；不增加任意文件/URI执行入口。
- [x] 4. 官方源码/资料排查ZCode官方聊天/任务及WorkBuddy插件简化路线。可落地部分继续；无法验证的写明阻塞，不改用户身份或订阅。
- [x] 5. 定向tests、全量一次、独立审查、打包源码/摘要/签名核验。原生候选逐家检查卡片、向导恢复和统一聊天；真实权限缺口再通知用户。
- [x] 6. 保存脱敏回执、项目交接/知识页最小增量、本地提交。正式包/送审另行推进。
