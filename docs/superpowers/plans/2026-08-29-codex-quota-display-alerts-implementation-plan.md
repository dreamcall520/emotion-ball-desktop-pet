# Codex 额度常驻与分级提醒 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为球球增加可关闭的剩余额度标签、自动/5 小时/周周期选择，以及按已用 10% 分档并在 80%/90%/100% 强提醒的只读 Codex 额度体验。

**Architecture:** 新建纯函数额度视图模块和有状态档位追踪器，`codex-companion` 只负责把可靠额度快照送入策略并排队提醒。常驻标签使用独立、透明、不可点击的 BrowserWindow，通过明确的定位模块跟随球球并避让气泡；主进程统一管理设置和生命周期。

**Tech Stack:** Electron 43.4.1、Node.js CommonJS、`node:test`、原生 HTML/CSS、现有 Codex 额度连接与 macOS BrowserWindow。

**Prerequisite:** 先完成 `docs/superpowers/plans/2026-08-29-codex-task-alerts-implementation-plan.md`，本计划以已移除 `recent`、已存在 `setPreferences()` 和可更新 Codex 气泡为基础。

---

## 文件结构

- Modify: `desktop-pet/lib/settings.js`、`desktop-pet/tests/settings.test.js` — 保存常驻开关与周期枚举。
- Create: `desktop-pet/lib/codex-quota-view.js`、`desktop-pet/tests/codex-quota-view.test.js` — 筛选周期并生成有限标签模型。
- Create: `desktop-pet/lib/codex-quota-alerts.js`、`desktop-pet/tests/codex-quota-alerts.test.js` — 维护基线、跨档、去重与合并规则。
- Modify: `desktop-pet/lib/codex-companion.js`、`desktop-pet/tests/codex-companion.test.js` — 接入偏好、提醒级别、时长与队列清理。
- Create: `desktop-pet/lib/quota-label-placement.js`、`desktop-pet/tests/quota-label-placement.test.js` — 标签定位和气泡避让。
- Create: `desktop-pet/lib/quota-label-window.js`、`desktop-pet/tests/quota-label-window.test.js` — 标签 BrowserWindow 生命周期。
- Create: `desktop-pet/quota-label.html`、`desktop-pet/quota-label.css`、`desktop-pet/quota-label-preload.js`、`desktop-pet/quota-label-renderer.js` — 安全只读标签页面。
- Modify: `desktop-pet/lib/dialogue.js`、`desktop-pet/bubble-renderer.js`、`desktop-pet/bubble.css` — 消费提醒级别和 6/12 秒时长。
- Modify: `desktop-pet/main.js`、`desktop-pet/tests/main-motion.test.js` — 设置菜单、标签同步、锁屏/隐藏/移动生命周期。
- Modify: `desktop-pet/scripts/package-mac.js`、`desktop-pet/tests/package-script.test.js` — 显式打包新增文件。
- Modify: `desktop-pet/scripts/verify-codex-companion.js`、`desktop-pet/tests/codex-native-helper.test.js`、`desktop-pet/tests/smoke-verification.test.js` — 四档尺寸、双屏、浅深背景与模拟额度验收。

### Task 1: 保存额度常驻与周期选择

**Files:**
- Modify: `desktop-pet/lib/settings.js`
- Modify: `desktop-pet/tests/settings.test.js`

- [ ] **Step 1: 写失败测试，锁定默认值与枚举白名单**

```js
test('额度显示默认关闭且周期只接受三个枚举', () => {
  assert.equal(DEFAULTS.codexQuotaAlwaysVisible, false);
  assert.equal(DEFAULTS.codexQuotaPeriod, 'auto');
  for (const period of ['auto', 'fiveHour', 'weekly']) {
    assert.equal(normalizeSettings({ codexQuotaPeriod: period }).codexQuotaPeriod, period);
  }
  for (const period of ['', 'daily', 300, null, {}]) {
    assert.equal(normalizeSettings({ codexQuotaPeriod: period }).codexQuotaPeriod, 'auto');
  }
  assert.equal(normalizeSettings({ codexQuotaAlwaysVisible: 'true' }).codexQuotaAlwaysVisible, false);
});
```

- [ ] **Step 2: 运行设置测试并确认字段缺失**

Run: `node --test desktop-pet/tests/settings.test.js`

Expected: FAIL，额度字段实际为 `undefined`。

- [ ] **Step 3: 扩展设置白名单**

```js
// DEFAULTS 增加
codexQuotaAlwaysVisible: false,
codexQuotaPeriod: 'auto'

// normalizeSettings 返回对象中增加
codexQuotaAlwaysVisible: typeof raw.codexQuotaAlwaysVisible === 'boolean'
  ? raw.codexQuotaAlwaysVisible
  : DEFAULTS.codexQuotaAlwaysVisible,
codexQuotaPeriod: ['auto', 'fiveHour', 'weekly'].includes(raw.codexQuotaPeriod)
  ? raw.codexQuotaPeriod
  : DEFAULTS.codexQuotaPeriod
```

- [ ] **Step 4: 运行设置测试**

Run: `node --test desktop-pet/tests/settings.test.js`

Expected: PASS；账号、额度快照、提醒档位和任务内容均不会写入设置文件。

- [ ] **Step 5: 提交额度设置**

```bash
git add desktop-pet/lib/settings.js desktop-pet/tests/settings.test.js
git commit -m "增加 Codex 额度显示设置"
```

### Task 2: 建立额度周期筛选与标签模型

**Files:**
- Create: `desktop-pet/lib/codex-quota-view.js`
- Create: `desktop-pet/tests/codex-quota-view.test.js`

- [ ] **Step 1: 写失败测试，覆盖自动、手动、过期与无数据**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectQuotaWindows, buildQuotaLabelModel } = require('../lib/codex-quota-view');
const NOW = 1800000000000;
const quotaWindow = (id, windowMinutes, remaining, resetsAt = NOW + 3600000) => ({
  id: String(id), label: `额度${id}`, windowMinutes, remaining, resetsAt
});
const snapshot = windows => ({ enabled: true, quota: {
  state: 'connected', stale: false, updatedAt: NOW, windows
} });

test('周期严格筛选且自动保留其他有效周期', () => {
  const windows = [quotaWindow(1, 300, 45), quotaWindow(2, 10080, 20), quotaWindow(3, 1440, 60)];
  assert.deepEqual(selectQuotaWindows(windows, 'fiveHour', NOW).map(item => item.id), ['1']);
  assert.deepEqual(selectQuotaWindows(windows, 'weekly', NOW).map(item => item.id), ['2']);
  assert.deepEqual(selectQuotaWindows(windows, 'auto', NOW).map(item => item.id), ['1', '2', '3']);
});

test('标签最多显示最低两项并明确更多数量', () => {
  const model = buildQuotaLabelModel(snapshot([quotaWindow(1, 300, 45), quotaWindow(2, 10080, 20), quotaWindow(3, 1440, 60)]),
    { period: 'auto' }, NOW);
  assert.deepEqual(model.items.map(item => item.remaining), [20, 45]);
  assert.equal(model.overflow, 1);
  assert.equal(model.state, 'ready');
});

test('手动周期缺失、过期和重置等待不伪造额度', () => {
  assert.equal(buildQuotaLabelModel(snapshot([]), { period: 'weekly' }, NOW).state, 'period-missing');
  assert.equal(buildQuotaLabelModel({ ...snapshot([]), quota: { ...snapshot([]).quota, stale: true } }, { period: 'auto' }, NOW).state, 'stale');
  assert.equal(buildQuotaLabelModel(snapshot([quotaWindow(1, 300, 0, NOW)]), { period: 'auto' }, NOW).state, 'reset-wait');
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `node --test desktop-pet/tests/codex-quota-view.test.js`

Expected: FAIL，错误包含 `Cannot find module '../lib/codex-quota-view'`。

- [ ] **Step 3: 实现严格筛选和有限模型**

```js
const PERIOD_MINUTES = Object.freeze({ fiveHour: 300, weekly: 10080 });

function validWindow(item, now) {
  return item && typeof item.id === 'string' && typeof item.label === 'string' &&
    Number.isFinite(item.windowMinutes) && item.windowMinutes > 0 &&
    Number.isFinite(item.remaining) && item.remaining >= 0 && item.remaining <= 100 &&
    Number.isFinite(item.resetsAt) && item.resetsAt > now;
}

function selectQuotaWindows(windows, period, now) {
  const selected = (Array.isArray(windows) ? windows : []).filter(item => validWindow(item, now));
  if (period === 'auto') return selected;
  return selected.filter(item => item.windowMinutes === PERIOD_MINUTES[period]);
}

function buildQuotaLabelModel(snapshot, { period = 'auto' } = {}, now = Date.now()) {
  const quota = snapshot?.quota || {};
  if (quota.state !== 'connected') return { state: quota.state || 'disconnected', items: [], overflow: 0 };
  const all = Array.isArray(quota.windows) ? quota.windows : [];
  const expected = period === 'auto' ? all : all.filter(item => item?.windowMinutes === PERIOD_MINUTES[period]);
  if (quota.stale) return { state: 'stale', items: selectQuotaWindows(expected, 'auto', now).slice(0, 2), overflow: 0 };
  const selected = selectQuotaWindows(all, period, now).sort((a, b) => a.remaining - b.remaining || a.id.localeCompare(b.id));
  if (!selected.length && expected.some(item => Number.isFinite(item?.resetsAt) && item.resetsAt <= now)) {
    return { state: 'reset-wait', items: [], overflow: 0 };
  }
  if (!selected.length) return { state: period === 'auto' ? 'empty' : 'period-missing', items: [], overflow: 0 };
  return { state: 'ready', items: selected.slice(0, 2), overflow: Math.max(0, selected.length - 2) };
}

module.exports = { PERIOD_MINUTES, selectQuotaWindows, buildQuotaLabelModel };
```

- [ ] **Step 4: 运行额度视图测试**

Run: `node --test desktop-pet/tests/codex-quota-view.test.js`

Expected: PASS，0 failures。

- [ ] **Step 5: 提交额度视图模块**

```bash
git add desktop-pet/lib/codex-quota-view.js desktop-pet/tests/codex-quota-view.test.js
git commit -m "增加 Codex 额度标签模型"
```

### Task 3: 建立每 10% 档位和强提醒策略

**Files:**
- Create: `desktop-pet/lib/codex-quota-alerts.js`
- Create: `desktop-pet/tests/codex-quota-alerts.test.js`

- [ ] **Step 1: 写失败测试，覆盖首次基线、跨档和常驻开关**

```js
const { createQuotaAlertTracker, mergeQuotaAlerts } = require('../lib/codex-quota-alerts');
const NOW = 1800000000000;
const quotaWindow = (id, windowMinutes, remaining, resetsAt = NOW + 3600000) => ({
  id: String(id), label: `额度${id}`, windowMinutes, remaining, resetsAt
});

test('首次普通用量只建基线，80以上只报最严重档', () => {
  const tracker = createQuotaAlertTracker();
  assert.deepEqual(tracker.update([quotaWindow(1, 300, 65)], { baseline: true, alwaysVisible: false }), []);
  assert.equal(tracker.update([quotaWindow(2, 300, 8)], { baseline: true, alwaysVisible: false })[0].level, 90);
});

test('一次跨多档只报最高档且同周期不重复', () => {
  const tracker = createQuotaAlertTracker();
  tracker.update([quotaWindow(1, 300, 85)], { baseline: true, alwaysVisible: false });
  assert.equal(tracker.update([quotaWindow(1, 300, 54)], { alwaysVisible: false })[0].level, 40);
  assert.deepEqual(tracker.update([quotaWindow(1, 300, 60)], { alwaysVisible: false }), []);
  assert.deepEqual(tracker.update([quotaWindow(1, 300, 54)], { alwaysVisible: false }), []);
});

test('常驻开启抑制10到70档但保留80到100档', () => {
  const tracker = createQuotaAlertTracker();
  tracker.update([quotaWindow(1, 300, 95)], { baseline: true, alwaysVisible: true });
  assert.deepEqual(tracker.update([quotaWindow(1, 300, 65)], { alwaysVisible: true }), []);
  assert.equal(tracker.update([quotaWindow(1, 300, 19)], { alwaysVisible: true })[0].level, 80);
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `node --test desktop-pet/tests/codex-quota-alerts.test.js`

Expected: FAIL，错误包含 `Cannot find module '../lib/codex-quota-alerts'`。

- [ ] **Step 3: 实现周期身份、档位和已发集合**

```js
const LEVELS = Object.freeze([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
const keyOf = item => JSON.stringify([item.id, item.windowMinutes, item.resetsAt]);
const levelOf = remaining => LEVELS.filter(level => 100 - remaining >= level).at(-1) || 0;

function createQuotaAlertTracker() {
  const state = new Map();
  function reset() { state.clear(); }
  function update(windows, { baseline = false, alwaysVisible = false } = {}) {
    const alerts = [];
    for (const item of windows) {
      const key = keyOf(item);
      const level = levelOf(item.remaining);
      let entry = state.get(key);
      const isBaseline = baseline || !entry;
      if (!entry) {
        if (state.size === 64) state.delete(state.keys().next().value);
        entry = { previous: level, peak: level, emitted: new Set() };
        state.set(key, entry);
      }
      const candidate = isBaseline ? (level >= 80 ? level : 0)
        : level > entry.previous && level > entry.peak ? level : 0;
      entry.previous = level;
      entry.peak = Math.max(entry.peak, level);
      if (!candidate || entry.emitted.has(candidate) || (alwaysVisible && candidate < 80)) continue;
      entry.emitted.add(candidate);
      alerts.push({ key, level: candidate, remaining: item.remaining, id: item.id });
    }
    return alerts;
  }
  return { update, reset };
}

function mergeQuotaAlerts(alerts) {
  return {
    level: Math.max(...alerts.map(item => item.level)),
    remaining: Math.min(...alerts.map(item => item.remaining)),
    count: alerts.length,
    refs: alerts.map(item => ({ ...item }))
  };
}

module.exports = { LEVELS, createQuotaAlertTracker, mergeQuotaAlerts };
```

当状态表超过 64 个周期身份时删除最早一项；周期身份变化自然形成新基线，账号切换、关闭联动和手动周期切换调用 `reset()`。

- [ ] **Step 4: 增加多额度合并、重置、恢复与周期切换测试**

```js
assert.equal(mergeQuotaAlerts([{ level: 80, remaining: 19 }, { level: 90, remaining: 8 }]).level, 90);
assert.equal(mergeQuotaAlerts([{ level: 80, remaining: 19 }, { level: 90, remaining: 8 }]).remaining, 8);
tracker.reset();
const newCycle = quotaWindow(1, 300, 70, NOW + 7200000);
assert.deepEqual(tracker.update([newCycle], { baseline: true, alwaysVisible: false }), []);
```

- [ ] **Step 5: 运行策略测试**

Run: `node --test desktop-pet/tests/codex-quota-alerts.test.js`

Expected: PASS，所有档位、跨档、去重与常驻抑制用例通过。

- [ ] **Step 6: 提交提醒策略**

```bash
git add desktop-pet/lib/codex-quota-alerts.js desktop-pet/tests/codex-quota-alerts.test.js
git commit -m "增加 Codex 额度分档提醒策略"
```

### Task 4: 将额度策略接入 Codex 控制器

**Files:**
- Modify: `desktop-pet/lib/codex-companion.js`
- Modify: `desktop-pet/tests/codex-companion.test.js`

- [ ] **Step 1: 写失败测试，锁定周期切换和提醒表现**

```js
test('额度偏好筛选周期并区分轻重提醒', async () => {
  const f = fixture();
  const quotaWindow = (id, windowMinutes, remaining) => ({
    id, label: id, windowMinutes, remaining, resetsAt: f.time + 86400000
  });
  await f.companion.setEnabled(true);
  f.companion.setPreferences({ quotaPeriod: 'fiveHour', quotaAlwaysVisible: false });
  f.quota(95, { windows: [quotaWindow('five', 300, 95), quotaWindow('week', 10080, 95)] });
  f.quota(59, { windows: [quotaWindow('five', 300, 59), quotaWindow('week', 10080, 5)] });
  await f.tick(5000);
  assert.equal(f.alerts[0].severity, 'normal');
  assert.equal(f.alerts[0].durationMs, 6000);
  f.quota(19, { windows: [quotaWindow('five', 300, 19), quotaWindow('week', 10080, 5)] });
  await f.tick(30000);
  assert.equal(f.alerts[1].severity, 'strong');
  assert.equal(f.alerts[1].motion, 'jelly');
  assert.equal(f.alerts[1].durationMs, 12000);
});
```

- [ ] **Step 2: 运行控制器测试并确认旧 20/10 策略失败**

Run: `node --test desktop-pet/tests/codex-companion.test.js`

Expected: FAIL，当前控制器没有周期偏好、10% 普通档或提醒级别。

- [ ] **Step 3: 在 `setPreferences()` 中加入额度偏好并建立新基线**

```js
let preferences = {
  taskNameInAlerts: false,
  quotaAlwaysVisible: false,
  quotaPeriod: 'auto'
};

function setPreferences(next = {}) {
  const previous = preferences;
  preferences = {
    taskNameInAlerts: typeof next.taskNameInAlerts === 'boolean' ? next.taskNameInAlerts : previous.taskNameInAlerts,
    quotaAlwaysVisible: typeof next.quotaAlwaysVisible === 'boolean' ? next.quotaAlwaysVisible : previous.quotaAlwaysVisible,
    quotaPeriod: ['auto', 'fiveHour', 'weekly'].includes(next.quotaPeriod) ? next.quotaPeriod : previous.quotaPeriod
  };
  if (previous.quotaPeriod !== preferences.quotaPeriod) quotaTracker.reset();
  // 打开常驻时删除普通额度提醒；关闭常驻时以下一次可靠快照建立普通基线。
  prunePreferenceAlerts(previous, preferences);
  notify();
  return true;
}
```

- [ ] **Step 4: 用新策略替换旧 `quotaAlerts()`**

```js
function quotaAlerts({ baseline = false } = {}) {
  if (quotaStale()) return;
  const selected = selectQuotaWindows(quota.windows, preferences.quotaPeriod, now());
  const crossed = quotaTracker.update(selected, {
    baseline,
    alwaysVisible: preferences.quotaAlwaysVisible
  });
  for (const item of crossed) enqueue('quota', {
    key: item.key,
    level: item.level,
    remaining: item.remaining,
    severity: item.level >= 90 ? 'urgent' : item.level >= 80 ? 'strong' : 'normal'
  });
}
```

`publicAlert()` 对普通额度返回 `motion: 'bow'`、`durationMs: 6000`；80/90/100 返回 `motion: 'jelly'`、`durationMs: 12000`，并携带 `severity`。`drain()` 使用提醒自身时长，不再固定 8000。

- [ ] **Step 5: 覆盖切换常驻、账号、过期、恢复和同档去重**

Run: `node --test desktop-pet/tests/codex-companion.test.js`

Expected: PASS；任务提醒不被周期切换清除，额度普通提醒在打开常驻时被取消，强提醒保留。

- [ ] **Step 6: 提交控制器集成**

```bash
git add desktop-pet/lib/codex-companion.js desktop-pet/tests/codex-companion.test.js
git commit -m "接入 Codex 额度周期与分级提醒"
```

### Task 5: 创建只读额度标签窗口与定位模块

**Files:**
- Create: `desktop-pet/lib/quota-label-placement.js`
- Create: `desktop-pet/tests/quota-label-placement.test.js`
- Create: `desktop-pet/lib/quota-label-window.js`
- Create: `desktop-pet/tests/quota-label-window.test.js`
- Create: `desktop-pet/quota-label.html`
- Create: `desktop-pet/quota-label.css`
- Create: `desktop-pet/quota-label-preload.js`
- Create: `desktop-pet/quota-label-renderer.js`

- [ ] **Step 1: 写定位失败测试，覆盖 80×80、屏幕边缘和气泡避让**

```js
const { quotaLabelBounds } = require('../lib/quota-label-placement');
const AREA = { x: 0, y: 0, width: 1440, height: 900 };

test('标签优先在球球下方且不改变球球窗口', () => {
  assert.deepEqual(quotaLabelBounds({ x: 600, y: 400, width: 80, height: 80 }, AREA), {
    x: 552, y: 488, width: 176, height: 54, placement: 'below'
  });
});

test('下方被气泡占用时换到上方并保持屏内', () => {
  const result = quotaLabelBounds({ x: 0, y: 20, width: 80, height: 80 }, AREA,
    { x: 8, y: 108, width: 224, height: 118 });
  assert.equal(result.placement, 'right');
  assert.ok(result.x >= AREA.x && result.y >= AREA.y);
  assert.ok(result.x + result.width <= AREA.x + AREA.width);
});
```

- [ ] **Step 2: 运行定位测试并确认模块缺失**

Run: `node --test desktop-pet/tests/quota-label-placement.test.js`

Expected: FAIL，错误包含 `Cannot find module '../lib/quota-label-placement'`。

- [ ] **Step 3: 实现候选位置、屏内收敛与障碍避让**

```js
const SIZE = Object.freeze({ width: 176, height: 54 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rect = (candidate, size) => ({ x: candidate.x, y: candidate.y, width: size.width, height: size.height });
const inside = (candidate, size, area) => candidate.x >= area.x && candidate.y >= area.y &&
  candidate.x + size.width <= area.x + area.width && candidate.y + size.height <= area.y + area.height;
const overlaps = (candidate, size, obstacle) => Boolean(obstacle &&
  candidate.x < obstacle.x + obstacle.width && candidate.x + size.width > obstacle.x &&
  candidate.y < obstacle.y + obstacle.height && candidate.y + size.height > obstacle.y);
const clampCandidate = (candidate, size, area) => ({
  placement: candidate.placement,
  x: Math.round(clamp(candidate.x, area.x, area.x + area.width - size.width)),
  y: Math.round(clamp(candidate.y, area.y, area.y + area.height - size.height)),
  ...size
});
function quotaLabelBounds(pet, area, obstacle = null) {
  const candidates = [
    { placement: 'below', x: pet.x + (pet.width - SIZE.width) / 2, y: pet.y + pet.height + 8 },
    { placement: 'above', x: pet.x + (pet.width - SIZE.width) / 2, y: pet.y - SIZE.height - 8 },
    { placement: 'right', x: pet.x + pet.width + 8, y: pet.y + (pet.height - SIZE.height) / 2 },
    { placement: 'left', x: pet.x - SIZE.width - 8, y: pet.y + (pet.height - SIZE.height) / 2 }
  ];
  const valid = candidates.find(candidate => inside(candidate, SIZE, area) && !overlaps(candidate, SIZE, obstacle));
  return clampCandidate(valid || candidates[0], SIZE, area);
}
module.exports = { quotaLabelBounds };
```

- [ ] **Step 4: 写窗口生命周期失败测试**

```js
const { EventEmitter } = require('node:events');
const { setImmediate: flush } = require('node:timers/promises');
const { createQuotaLabelWindow } = require('../lib/quota-label-window');

function fixture() {
  let created;
  class NativeWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.visible = false; this.destroyed = false; this.ignoreMouse = false;
      this.webContents = Object.assign(new EventEmitter(), { send() {}, setWindowOpenHandler() {} });
      created = this;
    }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setHiddenInMissionControl() {}
    setBounds() {} loadFile() { return Promise.resolve(); }
    setIgnoreMouseEvents(value) { this.ignoreMouse = value; }
    showInactive() { this.visible = true; } hide() { this.visible = false; }
    isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const pet = { isDestroyed: () => false, isVisible: () => true,
    getBounds: () => ({ x: 300, y: 300, width: 80, height: 80 }) };
  const label = createQuotaLabelWindow({ BrowserWindow: NativeWindow,
    screen: { getDisplayMatching: () => ({ workArea: AREA }) }, getPetWindow: () => pet, getObstacle: () => null,
    onError: error => { throw error; } });
  return { label, get window() { return created; } };
}

test('标签窗口只读、不聚焦并在隐藏后忽略鼠标', async () => {
  const f = fixture();
  f.label.show({ state: 'ready', items: [{ label: 'Codex · 5小时', remaining: 48 }], overflow: 0 });
  await flush();
  assert.equal(f.window.options.focusable, false);
  assert.equal(f.window.options.hasShadow, false);
  assert.equal(f.window.ignoreMouse, true);
  f.label.hide();
  assert.equal(f.window.visible, false);
});
```

- [ ] **Step 5: 实现安全 BrowserWindow 和静态页面**

`quota-label-window.js` 仿照 `bubble-window.js`，但始终 `setIgnoreMouseEvents(true, { forward: true })`，不提供回复接口，不抢焦点。页面配置：

```js
webPreferences: {
  preload: path.join(__dirname, '../quota-label-preload.js'),
  contextIsolation: true, nodeIntegration: false, sandbox: true,
  spellcheck: false, backgroundThrottling: false
}
```

`quota-label-renderer.js` 只使用 `textContent`；最多两条额度和一条「另有 N 项」，状态使用固定中文映射。`quota-label.css` 正文至少 12px，背景为半透明灰白，低额度只改变文字/边框强调，不改变球球身体颜色。

- [ ] **Step 6: 运行窗口与定位测试**

Run: `node --test desktop-pet/tests/quota-label-placement.test.js desktop-pet/tests/quota-label-window.test.js`

Expected: PASS；正负坐标双屏、极小工作区、气泡障碍、加载失败重建和销毁均通过。

- [ ] **Step 7: 提交标签窗口**

```bash
git add desktop-pet/lib/quota-label-placement.js desktop-pet/tests/quota-label-placement.test.js desktop-pet/lib/quota-label-window.js desktop-pet/tests/quota-label-window.test.js desktop-pet/quota-label.html desktop-pet/quota-label.css desktop-pet/quota-label-preload.js desktop-pet/quota-label-renderer.js
git commit -m "增加只读 Codex 额度标签窗口"
```

### Task 6: 接通菜单、生命周期与提醒样式

**Files:**
- Modify: `desktop-pet/main.js`
- Modify: `desktop-pet/tests/main-motion.test.js`
- Modify: `desktop-pet/lib/dialogue.js`
- Modify: `desktop-pet/tests/dialogue.test.js`
- Modify: `desktop-pet/bubble-renderer.js`
- Modify: `desktop-pet/bubble.css`
- Modify: `desktop-pet/tests/bubble-window.test.js`

- [ ] **Step 1: 写失败测试，锁定菜单和标签生命周期**

```js
// 扩展 main-motion.test.js 的 fixture 参数：
// codexQuotaAlwaysVisible = false、codexQuotaPeriod = 'auto'，模拟 loadSettings 返回这两个字段；
// 模拟 createQuotaLabelWindow 返回可记录 show/hide/reposition/destroy 的 quotaLabel 对象。

test('Codex 额度设置只在联动开启时可操作', async () => {
  const f = await fixture({ codexEnabled: true });
  const menu = f.call('menuTemplate()');
  assert.equal(menu.find(item => item.id === 'codex-quota-visible').checked, false);
  assert.equal(menu.find(item => item.id === 'codex-quota-period').submenu.filter(item => item.checked)[0].id, 'codex-quota-auto');
  await f.call("setCodexPreference('codexQuotaAlwaysVisible', true)");
  assert.equal(f.saved.at(-1).codexQuotaAlwaysVisible, true);
});

test('锁屏隐藏标签，解锁后只在可靠设置下恢复', async () => {
  const f = await fixture({ codexEnabled: true, codexQuotaAlwaysVisible: true });
  f.call('syncQuotaLabel(codexCompanion.getSnapshot())');
  assert.equal(f.quotaLabel.visible, true);
  f.powerMonitor.emit('lock-screen');
  assert.equal(f.quotaLabel.visible, false);
});
```

- [ ] **Step 2: 运行主进程和对话测试并确认缺少入口**

Run: `node --test desktop-pet/tests/main-motion.test.js desktop-pet/tests/dialogue.test.js desktop-pet/tests/bubble-window.test.js`

Expected: FAIL，额度菜单、标签同步和提醒样式尚不存在。

- [ ] **Step 3: 增加原子设置切换与周期菜单**

```js
function setCodexPreference(name, value) {
  if (!['codexQuotaAlwaysVisible', 'codexQuotaPeriod'].includes(name)) return false;
  const previous = settings[name];
  settings[name] = name === 'codexQuotaPeriod' && ['auto', 'fiveHour', 'weekly'].includes(value)
    ? value : name === 'codexQuotaAlwaysVisible' ? Boolean(value) : previous;
  try { persistSettings(); }
  catch (_) { settings[name] = previous; return false; }
  codexCompanion.setPreferences({
    taskNameInAlerts: settings.codexTaskNameInAlerts,
    quotaAlwaysVisible: settings.codexQuotaAlwaysVisible,
    quotaPeriod: settings.codexQuotaPeriod
  });
  syncQuotaLabel(codexCompanion.getSnapshot());
  refreshTrayMenu();
  return true;
}
```

菜单增加 `codex-quota-visible` 复选项和 `codex-quota-period` 三项单选；Codex 总开关关闭时均 `enabled: false`。

- [ ] **Step 4: 管理标签窗口完整生命周期**

```js
function syncQuotaLabel(snapshot) {
  const visible = settings.codexEnabled && settings.codexQuotaAlwaysVisible && !screenLocked &&
    petWindow && !petWindow.isDestroyed() && petWindow.isVisible();
  if (!visible) { quotaLabel.hide(); return; }
  quotaLabel.show(buildQuotaLabelModel(snapshot, { period: settings.codexQuotaPeriod }, codexNow()));
}
```

在宠物 `move/resize/hide/closed`、显示器增删/工作区变化、锁屏/睡眠、解锁/恢复、置顶切换和应用退出处同步 `reposition/hide/destroy/setAlwaysOnTop`。气泡 `show/hide/reposition` 后重新计算标签障碍，不能移动或放大宠物窗口。

- [ ] **Step 5: 让气泡消费提醒级别与时长**

```js
// DialogueDirector.offerCodex 不再上限固定 8000，允许 6000 或 12000；返回 tone。
return { id, text: alert.text, tone: alert.severity || 'normal', actions, durationMs };

// bubble-renderer.js
bubble.dataset.tone = ['normal', 'strong', 'urgent'].includes(payload.tone) ? payload.tone : 'normal';
```

`bubble.css` 仅调整气泡边框/文字强调：`strong` 和 `urgent` 不闪烁、不播放声音、不改变球球 `#EEEBE4` 身体色。

- [ ] **Step 6: 运行定向测试**

Run: `node --test desktop-pet/tests/main-motion.test.js desktop-pet/tests/dialogue.test.js desktop-pet/tests/bubble-window.test.js desktop-pet/tests/preload-contract.test.js`

Expected: PASS；保存失败回滚，互动气泡关闭时不弹额度文案，常驻标签仍按独立开关显示。

- [ ] **Step 7: 提交主进程集成**

```bash
git add desktop-pet/main.js desktop-pet/tests/main-motion.test.js desktop-pet/lib/dialogue.js desktop-pet/tests/dialogue.test.js desktop-pet/bubble-renderer.js desktop-pet/bubble.css desktop-pet/tests/bubble-window.test.js desktop-pet/tests/preload-contract.test.js
git commit -m "接通 Codex 额度标签与提醒表现"
```

### Task 7: 打包资源、原生检查与完整回归

**Files:**
- Modify: `desktop-pet/scripts/package-mac.js`
- Modify: `desktop-pet/tests/package-script.test.js`
- Modify: `desktop-pet/scripts/verify-codex-companion.js`
- Modify: `desktop-pet/tests/codex-native-helper.test.js`
- Modify: `desktop-pet/scripts/smoke-electron.js`
- Modify: `desktop-pet/tests/smoke-verification.test.js`
- Modify: `docs/superpowers/verification/2026-08-29-v030-package-install.md`

- [ ] **Step 1: 写失败测试，要求全部额度资源显式进入打包**

```js
test('安装包包含额度策略和标签窗口全部资源', () => {
  const root = path.resolve(__dirname, '../..');
  const staging = prepareStaging(root);
  for (const relative of [
    'desktop-pet/lib/codex-quota-view.js',
    'desktop-pet/lib/codex-quota-alerts.js',
    'desktop-pet/lib/quota-label-placement.js',
    'desktop-pet/lib/quota-label-window.js',
    'desktop-pet/quota-label.html',
    'desktop-pet/quota-label.css',
    'desktop-pet/quota-label-preload.js',
    'desktop-pet/quota-label-renderer.js'
  ]) {
    assert.equal(fs.readFileSync(path.join(staging, relative), 'utf8'), fs.readFileSync(path.join(root, relative), 'utf8'));
  }
});
```

- [ ] **Step 2: 运行打包测试并确认资源尚未列入**

Run: `node --test desktop-pet/tests/package-script.test.js`

Expected: FAIL，至少一个新资源在暂存区不存在。

- [ ] **Step 3: 将八个新文件加入 `prepareStaging()` 显式清单**

严格加入上一步列出的相对路径，不使用宽泛目录复制；继续确保分享包不会夹带设置或日志。

- [ ] **Step 4: 扩展原生模拟验收助手**

将 `verifyCodexCompanion` 参数增加 `quotaLabel`，并由 `main.js` 的冒烟入口传入当前标签控制器。用合成额度快照检查：

```js
const labelWindow = quotaLabel.getWindow();
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x &&
  a.y < b.y + b.height && a.y + a.height > b.y;
assert.equal(labelWindow.isFocusable(), false);
assert.equal(labelWindow.isVisible(), true);
assert.ok(labelBounds.width === 176 && labelBounds.height === 54);
assert.ok(!intersects(labelBounds, pet.getBounds()));
```

四档尺寸分别输出 `PET_CODEX_QUOTA_SIZE_80_OK`、`120`、`180`、`260`；双屏正负坐标、浅色/深色截图、气泡避让、常驻开关、自动/5小时/周、80/90/100 强弱样式均使用合成数据，不创建真实任务或消耗额度。

- [ ] **Step 5: 更新烟测标记测试**

```js
const quotaMarkers = Object.values(SIZES).map(size => `CODEX_QUOTA_SIZE_${size.width}`);
completeMarkers.push(...quotaMarkers, 'CODEX_QUOTA_POLICY', 'CODEX_QUOTA_LABEL');
```

同时在 `smoke-electron.js` 的 Codex 强制标记数组追加同一组标记，缺少任一标记时冒烟必须失败。

- [ ] **Step 6: 运行完整自动测试**

Run: `npm test`

Expected: PASS，全部测试完成，0 failures。

- [ ] **Step 7: 运行 Electron 冒烟和真实窗口模拟验收**

Run:

```bash
quota_artifacts_dir=$(mktemp -d /tmp/emotion-ball-quota.XXXXXX)
printf '%s\n' "$quota_artifacts_dir"
PET_SMOKE_ARTIFACT_DIR="$quota_artifacts_dir" npm run smoke
```

Expected: 第一行输出本轮唯一证据目录；冒烟 exit 0，包含四档 `PET_CODEX_QUOTA_SIZE_*_OK`、`PET_CODEX_QUOTA_POLICY_OK`、`PET_CODEX_QUOTA_LABEL_OK` 和全部既有标记。

- [ ] **Step 8: 查看生成的浅深背景与 80×80 截图**

Run: `find "$quota_artifacts_dir" -type f \( -name '*quota*.png' -o -name '*codex*.png' \) -print`

Expected: 仅输出本轮目录内的新鲜截图；用图像查看工具逐张确认标签文字可读、不遮球球/气泡、身体保持 `#EEEBE4`、窗口没有阴影黑边或屏幕裁切。

- [ ] **Step 9: 记录候选版证据并提交**

在 `docs/superpowers/verification/2026-08-29-v030-package-install.md` 追加测试命令、输出摘要、截图目录和未验边界，随后：

```bash
git add desktop-pet/scripts/package-mac.js desktop-pet/tests/package-script.test.js desktop-pet/scripts/verify-codex-companion.js desktop-pet/tests/codex-native-helper.test.js desktop-pet/scripts/smoke-electron.js desktop-pet/tests/smoke-verification.test.js docs/superpowers/verification/2026-08-29-v030-package-install.md
git commit -m "补齐 Codex 额度功能打包与原生验收"
```

- [ ] **Step 10: 回读分支状态并保持交付边界**

Run: `git status --short && git log -8 --oneline`

Expected: 工作树为空，计划内提交齐全。本计划结束时只称源码候选和模拟额度验收完成；不覆盖本机安装，真实跨额度档位、DMG、分享 ZIP、main 合并及 Release 均需单独授权和证据。
