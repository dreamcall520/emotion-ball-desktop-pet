'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createWorkBuddyQuota } = require('../lib/workbuddy-quota');
const { createMasWorkBuddyQuotaConnection } = require('../lib/mas-workbuddy-quota-connection');
const { createMasWorkBuddyChatConnection } = require('../lib/mas-workbuddy-chat-connection');
const { createMasWorkBuddyTaskNotifications } = require('../lib/mas-workbuddy-task-notifications');
const { normalizeSettings } = require('../lib/settings');
const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const helper = main.slice(main.indexOf('function currentWorkBuddyAccountKey()'), main.indexOf('function syncWorkBuddyChatConnection()'));
const quotaClear = main.match(/if \(FIRST_RELEASE && \(!state\.enabled \|\| \['ACCOUNT_CHANGED'[^\n]+workbuddyVerifiedAccountKey = null;/)?.[0];
assert.ok(helper.includes('async function completeStoreWorkBuddyConnection(signal)'));
assert.ok(quotaClear, 'use the actual main identity-slot cleanup, not a fixture copy');
const A = 'a'.repeat(64), B = 'b'.repeat(64);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const report = { total: 1, basic: 1, reward: 0, purchased: 0, plan: 'fixture', expires: [], nextRefreshAt: null, updatedAt: 1 };

function fixture(t, options = {}) {
  let localAccount = A, stored = options.saved || null, dataScope = null, saves = 0, modelCalls = 0, disables = 0;
  let reminderStored = options.savedReminder || null, reminderEnables = 0;
  const quotaJobs = [], checks = [], grants = [];
  const sandbox = { FIRST_RELEASE: true, workbuddyVerifiedAccountKey: null, Promise,
    settings: normalizeSettings({ workbuddyNotificationsEnabled: options.notificationsEnabled }), writeError() {} };
  const context = vm.createContext(sandbox);
  const clearSlot = vm.runInContext('(state) => {' + quotaClear + '}', context);
  const quota = createWorkBuddyQuota({ run: () => { const job = deferred(); quotaJobs.push(job); return job.promise; },
    watchAuth: () => () => {}, schedule: () => null, cancel() {}, onChange: clearSlot });
  const quotaConnection = createMasWorkBuddyQuotaConnection({ access: { ensure: async () => ({ status: options.grant || 'stored' }), clearPendingApp() {} },
    quota, usage: { setEnabled() {}, close() {} }, saveEnabled: async () => {} });
  const api = vm.runInContext(helper + ';({currentWorkBuddyAccountKey,completeStoreWorkBuddyConnection})', context);
  const chatConnection = createMasWorkBuddyChatConnection({ getAccountKey: api.currentWorkBuddyAccountKey,
    storage: { load: async () => stored, save: async (_, value) => { saves++; await options.save?.(); stored = structuredClone(value); },
      remove: async () => { stored = null; } }, onDisable: () => { disables++; } });
  const notifications = createMasWorkBuddyTaskNotifications({ getAccountKey: api.currentWorkBuddyAccountKey,
    storage: { load: async () => reminderStored, save: async (_, value) => { reminderStored = structuredClone(value); }, remove: async () => { reminderStored = null; } },
    installer: { ensure: async () => ({ status: options.reminderGrant || 'stored' }), install: async () => ({ status: 'installed' }),
      restore: async () => ({ status: 'installed' }), uninstall: async () => {}, revoke: async () => {}, close() {} },
    createBridge: () => ({ start: async input => ({ endpoint: 'http://127.0.0.1:43121/workbuddy/events', token: input?.token || 't'.repeat(43) }), close: async () => {} }) });
  const enableReminders = notifications.enable;
  notifications.enable = signal => { reminderEnables++; return enableReminders(signal); };
  Object.assign(sandbox, { workbuddyQuota: quota, workbuddyQuotaConnection: quotaConnection, workbuddyChatConnection: chatConnection, workbuddyNotifications: notifications,
    workbuddyRun: async (operation, payload, control) => {
      assert.equal(operation, 'account-check'); checks.push({ ...payload });
      await options.check?.(checks.length);
      if (control.signal.aborted) throw Object.assign(Error('CANCELLED'), { code: 'CANCELLED' });
      if (payload.expectedAccountKey && payload.expectedAccountKey !== localAccount) throw Object.assign(Error('ACCOUNT_CHANGED'), { code: 'ACCOUNT_CHANGED' });
      return { accountKey: localAccount };
    }, storeChatDataConsent: () => ({ grantWorkBuddyLink(key) { grants.push(key); dataScope = key; },
      revoke() { if (options.revokeThrows) throw Error('synthetic consent storage failure'); dataScope = null; } }),
    chat: { async connectSource(provider) {
      assert.equal(provider, 'workbuddy'); assert.equal(chatConnection.getAuthorizedAccountKey(), dataScope);
      modelCalls++; await options.models?.();
    } } });
  t.after(() => { chatConnection.close(); quota.close(); return notifications.close(); });
  return { api, quota, quotaConnection, chatConnection, notifications, sandbox, checks, grants, quotaJobs,
    setAccount(value) { localAccount = value; }, get stored() { return stored; }, get dataScope() { return dataScope; },
    get saves() { return saves; }, get modelCalls() { return modelCalls; }, get disables() { return disables; },
    get reminderEnables() { return reminderEnables; },
    connect(signal = new AbortController().signal) { return api.completeStoreWorkBuddyConnection(signal); } };
}

test('actual combined main connects chat with local identity while the first quota query remains pending', async t => {
  const f = fixture(t), result = await f.connect();
  assert.equal(result.authorized, true); assert.equal(f.quota.getState().busy, true); assert.equal(f.quota.getState().accountKey, null);
  assert.equal(f.api.currentWorkBuddyAccountKey(), A); assert.equal(f.chatConnection.getAuthorizedAccountKey(), A);
  assert.deepEqual(f.checks, [{}, { expectedAccountKey: A }]); assert.deepEqual(f.grants, [A]); assert.equal(f.modelCalls, 1);
});
test('explicit combined connection defaults reminders on and does not report successful real-controller enable as missing authorization', async t => {
  const f = fixture(t), result = await f.connect();
  assert.equal(f.reminderEnables, 1); assert.equal(f.notifications.getState().enabled, true); assert.equal(f.notifications.getState().connected, true);
  assert.equal(result.authorized, true); assert.doesNotMatch(result.message || '', /还需要选择|未能|失败/);
});
test('a persisted explicit reminders-off preference is respected by a subsequent combined connection', async t => {
  const f = fixture(t, { notificationsEnabled: false }), result = await f.connect();
  assert.equal(result.authorized, true); assert.equal(f.reminderEnables, 0); assert.equal(f.notifications.getState().enabled, false);
  assert.equal(f.chatConnection.getAuthorizedAccountKey(), A); assert.equal(f.dataScope, A);
});
test('cancelling the independent reminder directory selection keeps the newly connected chat usable', async t => {
  const f = fixture(t, { reminderGrant: 'cancelled' }), result = await f.connect();
  assert.equal(result.authorized, true); assert.equal(f.notifications.getState().enabled, false); assert.equal(f.chatConnection.getAuthorizedAccountKey(), A);
  assert.equal(f.stored.accountKey, A); assert.equal(f.dataScope, A); assert.equal(f.modelCalls, 1); assert.match(result.message, /动画提醒/);
});
test('actual main restore never reopens old pairing when the explicit persisted preference is off', async t => {
  const f = fixture(t, { notificationsEnabled: false, savedReminder: { version: 1, accountKey: A, port: 43121,
    endpoint: 'http://127.0.0.1:43121/workbuddy/events', token: 't'.repeat(43) } });
  await f.quotaConnection.restore(true); f.sandbox.workbuddyVerifiedAccountKey = A;
  const restore = main.match(/^[ \t]*(?:if \(settings\.workbuddyNotificationsEnabled !== false\) )?void workbuddyNotifications\.restore\(\)\.catch\([^\n]+\);/m)?.[0];
  assert.ok(restore, 'extract the real notifications initialization statement');
  vm.runInContext(restore, vm.createContext(f.sandbox)); await settle();
  assert.equal(f.notifications.getState().enabled, false); assert.equal(f.notifications.getState().connected, false);
});
test('actual combined main does not require a successful balance HTTP response to confirm the local account', async t => {
  const read = deferred(), started = deferred();
  const f = fixture(t, { check: async count => { if (count === 1) { started.resolve(); await read.promise; } } });
  const connecting = f.connect(); await started.promise;
  f.quotaJobs[0].reject(Object.assign(Error('synthetic offline'), { code: 'SERVICE_UNAVAILABLE' })); await settle();
  assert.equal(f.quota.getState().errorCode, 'SERVICE_UNAVAILABLE'); read.resolve();
  assert.equal((await connecting).authorized, true); assert.equal(f.api.currentWorkBuddyAccountKey(), A); assert.equal(f.modelCalls, 1);
});
test('hide cancellation during consent save cleans the newly saved grant and never starts models', async t => {
  const save = deferred(), started = deferred(), f = fixture(t, { save: async () => { started.resolve(); await save.promise; } });
  const abort = new AbortController(), connecting = f.connect(abort.signal); await started.promise; abort.abort(); save.resolve();
  await assert.rejects(connecting, { code: 'CANCELLED' });
  assert.equal(f.stored, null); assert.equal(f.chatConnection.getAuthorizedAccountKey(), null); assert.equal(f.dataScope, null);
  assert.equal(f.sandbox.workbuddyVerifiedAccountKey, null); assert.equal(f.modelCalls, 0);
});
test('a failed data-consent revoke cannot skip chat cleanup or replace the original cancellation', async t => {
  const save = deferred(), started = deferred(), f = fixture(t, { revokeThrows: true, save: async () => { started.resolve(); await save.promise; } });
  const abort = new AbortController(), connecting = f.connect(abort.signal); await started.promise; abort.abort(); save.resolve();
  await assert.rejects(connecting, { code: 'CANCELLED' });
  assert.equal(f.stored, null); assert.equal(f.chatConnection.getAuthorizedAccountKey(), null); assert.equal(f.sandbox.workbuddyVerifiedAccountKey, null);
});
test('hide during the initial model lookup also removes both newly granted consent records', async t => {
  const models = deferred(), started = deferred(), f = fixture(t, { models: async () => { started.resolve(); await models.promise; } });
  const abort = new AbortController(), connecting = f.connect(abort.signal); await started.promise;
  assert.equal(f.dataScope, A); abort.abort(); models.resolve(); await connecting;
  assert.equal(f.stored, null); assert.equal(f.dataScope, null); assert.equal(f.chatConnection.getAuthorizedAccountKey(), null);
});
test('a second local identity check prevents an account switch during grant saving from authorizing chat', async t => {
  const save = deferred(), started = deferred(), f = fixture(t, { save: async () => { started.resolve(); await save.promise; } });
  const connecting = f.connect(); await started.promise; f.setAccount(B); save.resolve();
  await assert.rejects(connecting, { code: 'ACCOUNT_CHANGED' }); assert.equal(f.stored, null); assert.equal(f.dataScope, null); assert.equal(f.modelCalls, 0);
});
test('a later successful quota identity invalidates the prior local chat grant and cannot regress while refreshing', async t => {
  const f = fixture(t); await f.connect(); f.quotaJobs[0].resolve({ accountKey: B, report }); await settle();
  assert.equal(f.api.currentWorkBuddyAccountKey(), B); assert.equal(f.chatConnection.getAuthorizedAccountKey(), null); await settle(); assert.equal(f.stored, null);
  const refreshing = f.quota.refresh(); assert.equal(f.quota.getState().busy, true);
  assert.equal(f.api.currentWorkBuddyAccountKey(), B, 'a prior local A must not override the newer verified quota B');
  f.quotaJobs[1].reject(Object.assign(Error('synthetic offline'), { code: 'SERVICE_UNAVAILABLE' })); await refreshing;
  assert.equal(f.api.currentWorkBuddyAccountKey(), B, 'a transient stale response must not revive an older identity');
});
test('restoring an older quota-only connection or incomplete grants never implicitly creates chat consent', async t => {
  for (const grant of ['stored', 'needs-authorization']) {
    const f = fixture(t, { grant }); await f.chatConnection.restore(); await f.quotaConnection.restore(true); await settle();
    assert.equal(f.saves, 0); assert.equal(f.stored, null); assert.equal(f.dataScope, null); assert.equal(f.modelCalls, 0); assert.equal(f.chatConnection.getState().authorized, false);
  }
});
