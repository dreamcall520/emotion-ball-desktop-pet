# Codex 任务列表与完成提醒 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让球球只列出「处理中、等你确认」的 Codex 任务，移除最近提醒，并通过默认关闭的隐私开关在完成气泡中安全显示任务名称。

**Architecture:** 保留 `codex-companion` 的可信任务快照和完成门槛，仅在菜单层筛选可见任务。共享纯文本清理模块负责菜单与气泡标题；多任务完成使用仅随当前提醒存在的临时结果菜单，不写入历史。设置变化通过控制器更新当前气泡文本，不重播动作。

**Tech Stack:** Electron 43.4.1、Node.js CommonJS、Node 内置测试框架 `node:test`、现有 BrowserWindow 气泡与 macOS `codex://threads/<uuid>` 深链。

---

## 文件结构

- Create: `desktop-pet/lib/codex-text.js` — 统一清理、截断任务名称并生成完成文案。
- Create: `desktop-pet/tests/codex-text.test.js` — 覆盖 Unicode、控制字符、兜底与 80×80 文案长度。
- Modify: `desktop-pet/lib/settings.js` — 保存默认关闭的 `codexTaskNameInAlerts`。
- Modify: `desktop-pet/tests/settings.test.js` — 验证旧配置迁移及不保存任务名称。
- Modify: `desktop-pet/lib/codex-companion.js` — 移除最近提醒历史、刷新任务标题并支持名称开关。
- Modify: `desktop-pet/tests/codex-companion.test.js` — 覆盖单/多任务名称、运行中关闭和无历史快照。
- Modify: `desktop-pet/lib/codex-menu.js` — 筛选任务列表、移除最近提醒、构建临时结果菜单。
- Modify: `desktop-pet/tests/codex-menu.test.js` — 覆盖状态筛选、空状态、20 项上限和安全跳转。
- Modify: `desktop-pet/lib/dialogue.js` — 支持「查看结果」及当前 Codex 气泡原位更新。
- Modify: `desktop-pet/tests/dialogue.test.js` — 验证按钮、更新不续时和过期失效。
- Modify: `desktop-pet/bubble-preload.js`、`desktop-pet/bubble-renderer.js` — 放行限定动作并允许同一气泡只更新文字。
- Modify: `desktop-pet/main.js` — 接入设置菜单、气泡更新和临时结果菜单。
- Modify: `desktop-pet/tests/main-motion.test.js` — 验证设置保存、菜单与动作路由。
- Modify: `desktop-pet/scripts/package-mac.js`、`desktop-pet/tests/package-script.test.js` — 将共享文本模块纳入显式打包清单。

### Task 1: 建立任务名称纯文本边界

**Files:**
- Create: `desktop-pet/lib/codex-text.js`
- Create: `desktop-pet/tests/codex-text.test.js`

- [ ] **Step 1: 写失败测试，锁定清理和文案规则**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { plainText, menuText, alertTaskTitle, completionText } = require('../lib/codex-text');

test('任务名称移除控制字符并按 Unicode 截断', () => {
  assert.equal(plainText(' 任务\n名称\u202e ', 20), '任务 名称');
  assert.equal(alertTaskTitle('😀'.repeat(20)), `${'😀'.repeat(17)}…`);
  assert.equal(alertTaskTitle('未命名任务'), null);
  assert.equal(menuText('A&B', 20), 'A&&B');
});

test('完成文案优先可靠名称且始终适配两行短气泡', () => {
  assert.equal(completionText([], 1, false), '这轮有结果啦，去看看？');
  assert.equal(completionText(['任务A'], 1, true), '《任务A》有结果啦\n去看看？');
  assert.equal(completionText(['任务A', '任务B'], 3, true), '《任务A》《任务B》等 3 个任务有结果啦');
  assert.ok(Array.from(completionText(['长'.repeat(18), '名'.repeat(18)], 3, true)).length <= 48);
});
```

- [ ] **Step 2: 运行定向测试并确认因模块缺失而失败**

Run: `node --test desktop-pet/tests/codex-text.test.js`

Expected: FAIL，错误包含 `Cannot find module '../lib/codex-text'`。

- [ ] **Step 3: 写最小纯函数实现**

```js
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

function plainText(value, maximum, fallback = '') {
  const cleaned = typeof value === 'string' ? value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim() : '';
  const points = Array.from(cleaned || fallback);
  return points.length > maximum ? `${points.slice(0, maximum - 1).join('')}…` : points.join('');
}

function menuText(value, maximum, fallback = '') {
  return plainText(value, maximum, fallback).replace(/&/g, '&&');
}

function alertTaskTitle(value) {
  const title = plainText(value, 18);
  return !title || title === '未命名任务' ? null : title;
}

function completionText(titles, count, showNames) {
  const reliable = [...new Set(titles.map(alertTaskTitle).filter(Boolean))];
  if (!showNames || reliable.length === 0) return count > 1 ? `有 ${count} 轮出结果啦\n去看看？` : '这轮有结果啦，去看看？';
  if (count === 1) return `《${reliable[0]}》有结果啦\n去看看？`;
  const two = `《${reliable[0]}》${reliable[1] ? `《${reliable[1]}》` : ''}等 ${count} 个任务有结果啦`;
  if (Array.from(two).length <= 48) return two;
  const one = `《${reliable[0]}》等 ${count} 个任务有结果啦`;
  return Array.from(one).length <= 48 ? one : `有 ${count} 轮出结果啦\n去看看？`;
}

module.exports = { plainText, menuText, alertTaskTitle, completionText };
```

- [ ] **Step 4: 运行定向测试并确认通过**

Run: `node --test desktop-pet/tests/codex-text.test.js`

Expected: PASS，2 tests，0 failures。

- [ ] **Step 5: 提交纯文本边界**

```bash
git add desktop-pet/lib/codex-text.js desktop-pet/tests/codex-text.test.js
git commit -m "增加 Codex 任务名称清理规则"
```

### Task 2: 增加默认关闭的任务名称设置

**Files:**
- Modify: `desktop-pet/lib/settings.js`
- Modify: `desktop-pet/tests/settings.test.js`

- [ ] **Step 1: 写失败测试，验证旧配置和隐私字段**

```js
test('任务完成名称开关默认关闭且只保存布尔选择', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-pet-task-title-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  assert.equal(normalizeSettings({}).codexTaskNameInAlerts, false);
  assert.equal(normalizeSettings({ codexTaskNameInAlerts: 'true' }).codexTaskNameInAlerts, false);
  const saved = saveSettings(file, { codexTaskNameInAlerts: true, taskTitle: 'PRIVATE_TITLE', taskBody: 'PRIVATE_BODY' });
  assert.equal(saved.codexTaskNameInAlerts, true);
  assert.equal(fs.readFileSync(file, 'utf8').includes('PRIVATE'), false);
});
```

- [ ] **Step 2: 运行测试并确认新字段缺失**

Run: `node --test desktop-pet/tests/settings.test.js`

Expected: FAIL，`codexTaskNameInAlerts` 实际为 `undefined`。

- [ ] **Step 3: 扩展设置白名单**

```js
const DEFAULTS = Object.freeze({
  size: 'medium', x: null, y: null, alwaysOnTop: true,
  keepAwake: false, bubblesEnabled: true, codexEnabled: false,
  codexTaskNameInAlerts: false
});

// normalizeSettings 返回对象中增加：
codexTaskNameInAlerts: typeof raw.codexTaskNameInAlerts === 'boolean'
  ? raw.codexTaskNameInAlerts
  : DEFAULTS.codexTaskNameInAlerts
```

- [ ] **Step 4: 更新旧断言并运行设置测试**

Run: `node --test desktop-pet/tests/settings.test.js`

Expected: PASS，所有保存结果都只包含设置白名单，不出现标题或正文。

- [ ] **Step 5: 提交设置迁移**

```bash
git add desktop-pet/lib/settings.js desktop-pet/tests/settings.test.js
git commit -m "增加任务名称提醒隐私开关"
```

### Task 3: 精简任务控制器并生成可更新的完成文案

**Files:**
- Modify: `desktop-pet/lib/codex-companion.js`
- Modify: `desktop-pet/tests/codex-companion.test.js`

- [ ] **Step 1: 把历史提醒断言改为无历史，并增加名称更新测试**

```js
test('控制器不再暴露最近提醒并可即时切换完成名称', async () => {
  const updates = [];
  const f = fixture({ onAlertUpdate: alert => updates.push(alert) });
  await f.companion.setEnabled(true);
  f.companion.setPreferences({ taskNameInAlerts: true });
  f.task(1, 'active', { baseline: true, title: '额度标签开发' });
  f.task(1, 'completed');
  await f.tick(5000);
  assert.equal(f.alerts[0].text, '《额度标签开发》有结果啦\n去看看？');
  assert.equal('recent' in f.companion.getSnapshot(), false);
  f.companion.setPreferences({ taskNameInAlerts: false });
  assert.equal(updates.at(-1).text, '这轮有结果啦，去看看？');
});
```

- [ ] **Step 2: 运行控制器测试并确认旧历史与通用文案导致失败**

Run: `node --test desktop-pet/tests/codex-companion.test.js`

Expected: FAIL，原因包含 `recent` 仍存在或完成文案仍为通用文本。

- [ ] **Step 3: 移除 `recent/remember`，增加偏好与标题刷新**

```js
const { completionText } = require('./codex-text');

// createCodexCompanion 参数增加 onAlertUpdate = () => {}
let preferences = { taskNameInAlerts: false };

function setPreferences(next = {}) {
  const value = next.taskNameInAlerts === true;
  if (preferences.taskNameInAlerts === value) return false;
  preferences = { taskNameInAlerts: value };
  notify();
  if (eventValid(currentAlert)) onAlertUpdate(publicAlert(currentAlert));
  return true;
}

function publicAlert(event) {
  const refs = validRefs(event);
  const text = event.kind === 'completed'
    ? completionText(refs.map(ref => ref.title), refs.length, preferences.taskNameInAlerts)
    : eventText(event, refs);
  return {
    id: event.id, generation: event.generation, kind: event.kind,
    motion: MOTIONS[event.kind], text,
    taskIds: event.kind === 'quota' ? [] : refs.map(ref => ref.id),
    createdAt: event.createdAt, expiresAt: event.expiresAt
  };
}

// validRefs 的任务分支返回最新标题：
return task?.state === event.kind && task.turnId === ref.turnId
  ? [{ ...ref, title: task.title }]
  : [];

// 返回接口增加 setPreferences；getSnapshot 删除 recent。
return { setEnabled, setPreferences, refresh, getSnapshot, dismiss, close };
```

- [ ] **Step 4: 删除或改写所有 `recent` 测试并覆盖清理边界**

```js
assert.equal('recent' in f.companion.getSnapshot(), false);
assert.equal(JSON.stringify(f.companion.getSnapshot().currentAlert).includes('SECRET_BODY'), false);
assert.equal(JSON.stringify(f.alerts).includes('SECRET_BODY'), false);
```

保留任务快照中的纯标题是菜单功能所需；标题开关关闭时另断言 `currentAlert.text` 与提醒回调不出现 `SECRET_TITLE`，不对 `tasks.items` 作该断言。

将控制器内任务快照上限从 20 调整为 64，仍只保留标量元数据；可见菜单的 20 项限制在 Task 4 处理：

```js
if (!previous && tasks.size === 64) {
  const oldest = tasks.keys().next().value;
  tasks.delete(oldest);
  terminalSeen.delete(oldest);
  idleTransitions.delete(oldest);
}
```

- [ ] **Step 5: 运行控制器测试**

Run: `node --test desktop-pet/tests/codex-companion.test.js`

Expected: PASS，0 failures；关闭、换账号和断连仍清空当前/排队提醒。

- [ ] **Step 6: 提交控制器改动**

```bash
git add desktop-pet/lib/codex-companion.js desktop-pet/tests/codex-companion.test.js
git commit -m "精简 Codex 提醒并支持任务名称"
```

### Task 4: 任务菜单只展示进行中与待确认

**Files:**
- Modify: `desktop-pet/lib/codex-menu.js`
- Modify: `desktop-pet/tests/codex-menu.test.js`

- [ ] **Step 1: 写失败测试，覆盖筛选、空状态和临时结果菜单**

```js
test('任务列表只显示处理中和等你确认', () => {
  const value = snapshot();
  const idAt = index => `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`;
  value.tasks.items = ['active', 'waiting', 'completed', 'failed', 'interrupted', 'idle', 'unknown']
    .map((state, index) => ({ id: idAt(index), title: state, state, turnId: `turn-${index}` }));
  const menu = buildCodexMenu(value, TIME);
  const tasks = menu.find(item => item.id === 'codex-tasks').submenu.map(item => item.label).join('\n');
  assert.match(tasks, /active|waiting/);
  assert.doesNotMatch(tasks, /completed|failed|interrupted|idle|unknown/);
  assert.equal(menu.some(item => item.id === 'codex-recent'), false);
});

test('多任务完成提醒只生成当前提醒的临时结果菜单', () => {
  const value = snapshot();
  value.tasks.items = [
    { id: ID, title: '结果一', state: 'completed', turnId: 'turn-one' },
    { id: ID2, title: '结果二', state: 'completed', turnId: 'turn-two' }
  ];
  value.currentAlert = { ...value.currentAlert, kind: 'completed', taskIds: [ID, ID2] };
  const action = resolveCodexAction(value, alertAction('show-results'), TIME);
  assert.equal(action.type, 'show-results');
  const result = buildCodexResultMenu(value, action.alertId, TIME);
  assert.deepEqual(result.map(item => item.action.taskId), [ID, ID2]);
  assert.deepEqual(buildCodexResultMenu(value, action.alertId, TIME + 8000), []);
});
```

- [ ] **Step 2: 运行菜单测试并确认旧列表/最近提醒导致失败**

Run: `node --test desktop-pet/tests/codex-menu.test.js`

Expected: FAIL，完成状态仍出现在任务列表且 `codex-recent` 仍存在。

- [ ] **Step 3: 分离可信任务行与可见任务行**

```js
const { menuText } = require('./codex-text');
const allRows = snapshot => Array.isArray(snapshot?.tasks?.items)
  ? snapshot.tasks.items.filter(item => isTaskId(item?.id)).slice(0, 64)
  : [];
const visibleRows = snapshot => allRows(snapshot)
  .filter(item => !item.unavailable && ['active', 'waiting'].includes(item.state));

function taskSubmenu(snapshot) {
  const rows = visibleRows(snapshot);
  const items = rows.slice(0, 20).map(task => ({
    label: `${menuText(task.title, 36, '未命名任务')} · ${TASK_LABELS[task.state]}`,
    action: action(snapshot, 'open-task', { taskId: task.id })
  }));
  if (rows.length > 20) items.push({ label: `另有 ${rows.length - 20} 个，请到 Codex 查看`, enabled: false });
  return items;
}
```

当任务通道为 `connected` 且筛选为空时使用「暂无进行中或待确认的任务」；其他连接状态显示对应原因。删除 `recentItems` 与 `codex-recent`。

- [ ] **Step 4: 增加只随当前提醒存在的结果菜单**

```js
function buildCodexResultMenu(snapshot, alertId, now = Date.now()) {
  const alert = snapshot?.currentAlert;
  if (!alert || alert.id !== alertId || now >= alert.expiresAt) return [];
  const trusted = new Map(allRows(snapshot).map(task => [task.id, task]));
  return alert.taskIds.map(id => trusted.get(id)).filter(Boolean).map(task => ({
    label: menuText(task.title, 36, '未命名任务'),
    action: { scope: 'alert', type: 'open-task', generation: snapshot.generation, alertId, taskId: task.id }
  }));
}
```

`resolveCodexAction` 允许 `show-results` 仅在当前提醒包含至少两个可信任务时返回 `{ type: 'show-results', alertId }`；`open-task` 仍用完整可信行校验，不使用可见列表校验。

- [ ] **Step 5: 运行菜单测试**

Run: `node --test desktop-pet/tests/codex-menu.test.js`

Expected: PASS，0 failures；恶意 ID、过期提醒和旧代次继续返回 `null`。

- [ ] **Step 6: 提交菜单改动**

```bash
git add desktop-pet/lib/codex-menu.js desktop-pet/tests/codex-menu.test.js
git commit -m "任务列表仅保留进行中状态"
```

### Task 5: 接通设置、气泡更新与多任务结果入口

**Files:**
- Modify: `desktop-pet/lib/dialogue.js`
- Modify: `desktop-pet/tests/dialogue.test.js`
- Modify: `desktop-pet/bubble-preload.js`
- Modify: `desktop-pet/bubble-renderer.js`
- Modify: `desktop-pet/main.js`
- Modify: `desktop-pet/tests/main-motion.test.js`

- [ ] **Step 1: 写失败测试，锁定气泡更新不重播动作**

```js
test('当前 Codex 气泡可原位更新文案且不延长时限', () => {
  const director = new DialogueDirector({ now: 0 });
  const first = director.offerCodex(codexAlert({ id: 7, text: '《任务A》有结果啦\n去看看？' }), 1000, 8000);
  const updated = director.updateCodex(codexAlert({ id: 7, text: '这轮有结果啦，去看看？' }), 2000);
  assert.equal(updated.id, first.id);
  assert.equal(updated.text, '这轮有结果啦，去看看？');
  assert.equal(updated.durationMs, 7000);
});

test('多任务完成按钮使用查看结果而不是任务列表', () => {
  const director = new DialogueDirector({ now: 0 });
  const payload = director.offerCodex(codexAlert({ taskIds: [ID, ID2] }), 1000, 8000);
  assert.deepEqual(payload.actions.map(item => item.label), ['查看结果', '知道啦']);
  assert.equal(director.respond(payload.id, 'codex-results', 2000).descriptor.type, 'show-results');
});
```

- [ ] **Step 2: 运行对话与主进程测试并确认失败**

Run: `node --test desktop-pet/tests/dialogue.test.js desktop-pet/tests/main-motion.test.js`

Expected: FAIL，`updateCodex` 与 `show-results` 尚不存在。

- [ ] **Step 3: 在 DialogueDirector 中保存来源提醒并原位更新**

```js
// offerCodex 创建当前气泡时保存 sourceAlertId/sourceGeneration。
this._current = {
  id, event: 'codex', sourceAlertId: alert.id, sourceGeneration: alert.generation,
  actions, descriptors, expiresAt: nowMs + durationMs, priority: -1
};

updateCodex(alert, nowMs) {
  this._expire(nowMs);
  if (this._current?.event !== 'codex' || this._current.sourceAlertId !== alert?.id ||
      this._current.sourceGeneration !== alert?.generation) return null;
  return {
    id: this._current.id,
    text: alert.text,
    actions: this._current.actions.map(item => ({ ...item })),
    durationMs: this._current.expiresAt - nowMs
  };
}
```

多任务动作改为 `{ id: 'codex-results', label: '查看结果' }`，描述符类型为 `show-results`。

- [ ] **Step 4: 更新气泡白名单并允许同 ID 更新文字**

```js
// bubble-preload.js
const allowed = ['again', 'rest', 'codex-open', 'codex-results', 'codex-dismiss'];

// bubble-renderer.js 的消息处理顺序
message.textContent = payload.text;
const actionKey = payload.actions.map(item => `${item.id}:${item.label}`).join('|');
if (payload.id === currentId && actionKey === currentActionKey) return;
currentId = payload.id;
currentActionKey = actionKey;
```

- [ ] **Step 5: 在主进程增加安全设置切换和结果菜单路由**

```js
// main-motion.test.js 的 fixture 参数和模拟 loadSettings 同步增加：
// codexTaskNameInAlerts = false，并把该字段放入返回的设置对象。

function setCodexTaskNameInAlerts(enabled) {
  const previous = settings.codexTaskNameInAlerts;
  settings.codexTaskNameInAlerts = Boolean(enabled);
  try { persistSettings(); }
  catch (_) { settings.codexTaskNameInAlerts = previous; return false; }
  codexCompanion.setPreferences({ taskNameInAlerts: settings.codexTaskNameInAlerts });
  refreshTrayMenu();
  return true;
}

// menuTemplate 的 Codex 联动后增加复选项；总开关关闭时不可操作。
{
  id: 'codex-task-names', label: '完成提醒显示任务名称', type: 'checkbox',
  enabled: settings.codexEnabled === true, checked: settings.codexTaskNameInAlerts === true,
  click: item => setCodexTaskNameInAlerts(item.checked)
}

// routeCodexAction
if (action.type === 'show-results') {
  const items = buildCodexResultMenu(snapshot, action.alertId, codexNow());
  if (items.length && petWindow && !petWindow.isDestroyed()) {
    Menu.buildFromTemplate(bindCodexMenu(items)).popup({ window: petWindow });
  }
  return items.length > 0;
}
```

初始化控制器时传入 `onAlertUpdate`：调用 `dialogue.updateCodex`，若返回有效载荷则 `bubble.show(payload)`；不得发送新的 `pet:command` 或重播身体动作。

- [ ] **Step 6: 运行对话与主进程测试**

Run: `node --test desktop-pet/tests/dialogue.test.js desktop-pet/tests/main-motion.test.js desktop-pet/tests/preload-contract.test.js`

Expected: PASS，0 failures；保存失败回滚，关闭总开关后动作失效。

- [ ] **Step 7: 提交界面接线**

```bash
git add desktop-pet/lib/dialogue.js desktop-pet/tests/dialogue.test.js desktop-pet/bubble-preload.js desktop-pet/bubble-renderer.js desktop-pet/main.js desktop-pet/tests/main-motion.test.js desktop-pet/tests/preload-contract.test.js
git commit -m "接通 Codex 任务名称与结果入口"
```

### Task 6: 打包清单与完整回归

**Files:**
- Modify: `desktop-pet/scripts/package-mac.js`
- Modify: `desktop-pet/tests/package-script.test.js`
- Modify: `desktop-pet/scripts/verify-codex-companion.js`
- Modify: `desktop-pet/tests/codex-native-helper.test.js`
- Modify: `desktop-pet/scripts/smoke-electron.js`
- Modify: `desktop-pet/tests/smoke-verification.test.js`
- Modify: `docs/superpowers/verification/2026-08-29-v030-package-install.md`

- [ ] **Step 1: 写失败测试，要求新模块进入打包且原生助手覆盖新菜单**

```js
test('打包暂存区包含任务名称清理模块', () => {
  const root = path.resolve(__dirname, '../..');
  const staging = prepareStaging(root);
  const relative = 'desktop-pet/lib/codex-text.js';
  assert.equal(fs.readFileSync(path.join(staging, relative), 'utf8'), fs.readFileSync(path.join(root, relative), 'utf8'));
});
```

在原生助手测试中要求输出 `PET_CODEX_TASK_MENU_OK` 与 `PET_CODEX_TASK_TITLE_OK`，并确认不存在「最近提醒」；同步把两个标记加入 `smoke-electron.js` 的强制输出检查和 `smoke-verification.test.js` 的完整标记集合。

- [ ] **Step 2: 运行打包与原生助手测试并确认失败**

Run: `node --test desktop-pet/tests/package-script.test.js desktop-pet/tests/codex-native-helper.test.js`

Expected: FAIL，新模块尚未加入 `prepareStaging` 或新检查标记尚未输出。

- [ ] **Step 3: 更新显式打包清单和模拟验收助手**

在 `prepareStaging()` 的 `files` 数组加入：

```js
'desktop-pet/lib/codex-text.js'
```

模拟验收只注入本地合成任务状态，不创建真实 Codex 任务；检查「处理中、等你确认」可见，完成状态隐藏，名称开关关闭/开启时气泡分别为通用/带名称文案。

- [ ] **Step 4: 运行完整自动测试**

Run: `npm test`

Expected: PASS，所有测试完成，0 failures。

- [ ] **Step 5: 运行 Electron 独立设置目录冒烟检查**

Run: `npm run smoke`

Expected: exit 0，包含既有全部 `PET_*_OK` 标记及新增的 `PET_CODEX_TASK_MENU_OK`、`PET_CODEX_TASK_TITLE_OK`。

- [ ] **Step 6: 记录真实边界，不扩大交付状态**

在 `docs/superpowers/verification/2026-08-29-v030-package-install.md` 追加本次源码候选的测试命令、结果和未验项。明确未覆盖本机安装、分享 ZIP、main 合并与公开 Release；不为测试创建新的真实 Codex 任务。

- [ ] **Step 7: 提交验收与打包清单**

```bash
git add desktop-pet/scripts/package-mac.js desktop-pet/tests/package-script.test.js desktop-pet/scripts/verify-codex-companion.js desktop-pet/tests/codex-native-helper.test.js desktop-pet/scripts/smoke-electron.js desktop-pet/tests/smoke-verification.test.js docs/superpowers/verification/2026-08-29-v030-package-install.md
git commit -m "补齐 Codex 任务交互打包验收"
```

- [ ] **Step 8: 回读分支状态**

Run: `git status --short && git log -6 --oneline`

Expected: 工作树为空；最近提交按本计划任务顺序出现。此步骤不生成 DMG、不覆盖 `/Applications/球球桌宠.app`、不更新分享 ZIP。
