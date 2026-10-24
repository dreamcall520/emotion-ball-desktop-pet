# ZCode Link Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with independent file ownership. User project instructions authorize parallel independent work. Follow test-first for nontrivial behavior.

**Goal:** Add independent ZCode linkage with the existing Codex settings/card/details/trend/tasks/chat interactions and deliver an isolated macOS acceptance package.

**Architecture:** Keep Codex data and RPC behavior unchanged. Add a ZCode account/usage/history/task service and official CLI chat adapter; extend shared presentation with optional source/bucket metadata preserving Codex defaults. Main process owns source routing, sender validation, lifecycle and settings.

**Tech Stack:** Electron 43, CommonJS Node.js, node:test, official installed ZCode CLI stdio protocol, HTTPS read-only quota endpoints. No new runtime dependencies.

## Contracts

- `createZcodeCompanion({filePath,onChange,now,...injections})`: `setEnabled(bool)`, `refresh()`, `getSnapshot()`, `close()`, `markAllRead()`; snapshots contain `state`, `accountKey`, `quotaUpdatedAt`, `buckets`, `tasks`, `activity` and history samples. No secret values in snapshots or logs.
- `buildZcodeQuotaLabelModel(snapshot,{size},now)` and `buildZcodeDetailsModel(snapshot,{action,bucketId,appearance,colorMode},now)`: sourceId `zcode`; items have unique `id`/`bucketId`, `label`, `windowMinutes` (real span), `remaining` percent, `resetsAt`, `resetLabel`, `total`, `remainingUnits`, `unit`, `periodStart`, `periodKind`. Bucket IDs route details without forcing 300/10080.
- `createZcodeChatRpc(options)` follows `createCodexChatRpc` contract so chat-companion owns persistence/cancel/reply validation; notifications translate to its existing item/turn events. Only its own sessions may be sent/resumed/stopped.
- Shared UI optional source metadata defaults to Codex. New ZCode window instances use dedicated IPC and preload selected by query/source option; Codex existing channels stay unchanged. Main validates actual sender window for every action.

## Tasks

- [x] 1. Fetch origin/main, create feature/zcode-link isolated worktree, run full baseline tests. Freeze approved design and commit this plan.
- [x] 2. Account/usage/history (owner: backend agent): add zcode-account, zcode-usage/companion/view/history and tests. Cover encrypted credential read in memory, official host allowlist, device header, timeout/401/429, unknown/empty states, four distinct buckets, expiry/day boundaries, no account mixing, bounded atomic history. Real GET only, no account writes.
- [x] 3. Official protocol/chat/tasks (owner: protocol agent): add zcode-protocol/zcode-chat-rpc/zcode-tasks and tests; optional chat-companion source/model resolver injection keeping Codex defaults. Verify stdio framing/schema, streaming/cancel, disabled tools/MCP/workflows/hooks, model selection, account lifecycle. Existing desktop task monitoring cannot infer live state from default idle list; identify reliable runtime evidence and keep unknown if unavailable. Coordinate account helper with backend owner.
- [x] 4. Shared card/detail presentation (owner: UI agent): source-scoped IPC, optional source metadata, ZCode buckets/detail action and chart selection, source labels, same CSS/layout/click behaviors. Existing Codex default output must pass. Add source/bucket routes and tests. No main.js/settings/chat UI edits here.
- [x] 5. Main integration (owner: primary): independent settings and native/central settings group; independent card/details/service lifecycle with obstacle avoidance. Existing chat window source selector and source-scoped store/RPC. Independent toggles and graceful shutdown, lockscreen/hide/theme behavior. Update explicit package whitelist.
- [x] 6. Review spec compliance then code quality with independent reviewers; fix findings. Full test suite, source and packaged Electron interaction smoke, real balance/tasks/chat checks (only short test chats, own sessions), compare Codex baseline, verify existing settings/App hashes unchanged.
- [x] 7. Build isolated acceptance App with unique name/bundle id/userData/update disabled, produce DMG/ZIP and checksums in project acceptance output. Verify signatures/archive/mount/app contents and real launch. Commit/push feature branch. Do not merge main or publish releases/website or overwrite installed App. Deliver files and honest remaining verification limits.

## Validation

Baseline: `npm test` (1904 passing on origin/main 03b7aac).
Targeted: `node --test desktop-pet/tests/zcode-*.test.js` plus affected shared UI/chat/settings tests.
Full: `npm test`, then existing native smoke/integration scripts for affected surfaces; final package resource consistency, adhoc signature, readonly DMG mount and isolated UI.
Real data: compare exact four native Start Plan buckets; test task lifecycle and a minimal own chat with cancel/resume. Avoid opening, resuming or cancelling unrelated user tasks.
No success claim for unsupported task/live auth paths; document and keep working on required scope rather than silently removing features.


## Verified outcome

- Full suite: 1966 passed. Baseline: 1904 passed.
- Official ZCode 3.16.3 / CLI 0.17.0: real four-bucket balance, model entitlement overlay, streaming chat, session resume, stop and tool-free requests verified.
- Final packaged integration: real settings/card/detail/trend IPC, single-source default, one real GLM-5.3-Flash reply and renderer hop action, independent archives and disable fallback passed.
- Existing Codex packaged regression: 16 cards / 88 panel surfaces / 36 pointer clicks; chat 8 surfaces, 6 connections / 2 threads / 10 turns / 2 interrupts passed. The final two rebuilds changed only the acceptance helper; application resources remain identical.
- Native ZCode shared UI: 6 groups, 10 captures, real quota plus explicitly labeled task fixtures. One/two/four bucket geometry and source isolation passed.
- 265 package files match staged/source files (Electron packager removes the private metadata field). Unique bundle id and ordinary launch with 36 independent-profile open files / zero formal-profile open files verified.
- DMG readonly mount and ZIP native extraction/CRC/signatures/ASAR hashes passed. Formal installed ASAR and settings hashes unchanged before/after final package checks.

## Known boundaries

Task monitoring is partial: real message/turn persistence plus a unique live CLI owner proves individual active rows; the global count stays unknown. No public per-task deep link was verified. The app offers opening ZCode for manual task lookup. Paid/team accounts, real native-desktop task creation, actual tool approval prompts, Intel, broad multiple-display behavior and Apple notarization were not accepted by this run. User visual acceptance remains pending.
