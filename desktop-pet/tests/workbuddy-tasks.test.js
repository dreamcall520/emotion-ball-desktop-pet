const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkBuddyTasks } = require('../lib/workbuddy-tasks');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const report = accountKey => ({ accountKey, source: 'local-session-cache', scope: 'current-account', observedAt: 100,
  pendingReview: 1, total: 1, items: [{ id: 'task1', title: '示例任务', unread: true, status: 'completed', updatedAt: 90, token: 'secret' }] });
test('task cache is opt-in, account-bound, sanitized, refreshed and cleared on disable', async () => {
  let account = 'a'.repeat(64), calls = 0;
  const tasks = createWorkBuddyTasks({ run: async () => { calls++; return report(account); }, getAccountKey: () => account, now: () => 100 });
  await tasks.refresh(); assert.equal(calls, 0);
  tasks.setEnabled(true); await tasks.refresh(); assert.equal(calls, 1);
  assert.equal(tasks.getState().report.pendingReview, 1); assert.equal(tasks.getState().report.running, null);
  assert.equal(JSON.stringify(tasks.getState()).includes('secret'), false);
  await tasks.refresh(false); assert.equal(calls, 1);
  account = 'b'.repeat(64); tasks.setEnabled(true); assert.equal(tasks.getState().report, null);
  await tasks.refresh(); assert.equal(calls, 2);
  tasks.setEnabled(false); assert.equal(tasks.getState().report, null); tasks.close();
});
test('late or wrong-account results cannot leak across logout or account switches', async () => {
  let finish, account = 'a'.repeat(64);
  const tasks = createWorkBuddyTasks({ run: () => new Promise(resolve => { finish = resolve; }), getAccountKey: () => account });
  tasks.setEnabled(true); const pending = tasks.refresh(); tasks.setEnabled(false); finish(report(account)); await pending;
  assert.equal(tasks.getState().report, null);
  tasks.setEnabled(true); const another = tasks.refresh(); account = 'b'.repeat(64); finish(report('a'.repeat(64))); await another;
  assert.equal(tasks.getState().report, null); tasks.close();
});
test('unread cache failures do not turn an unknown result into a zero count', async () => {
  const tasks = createWorkBuddyTasks({ run: async () => { throw Error('private'); }, getAccountKey: () => 'a'.repeat(64) });
  tasks.setEnabled(true); await tasks.refresh(); assert.equal(tasks.getState().report, null);
  assert.equal(tasks.getState().error.includes('private'), false); tasks.close();
});
test('Qiuqiu review dismissals persist by account, session and revision; new activity returns', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-wb-review-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, 'workbuddy-task-state.json'); let account = 'a'.repeat(64), revision = 90;
  const options = { stateFile, getAccountKey: () => account, run: async () => {
    const value = report(account); value.items[0].updatedAt = revision;
    value.items.push({ id: 'already-read', title: '历史记录不冒充待查看', status: 'completed', updatedAt: 80, unread: false });
    return value;
  } };
  let tasks = createWorkBuddyTasks(options); tasks.setEnabled(true); await tasks.refresh();
  assert.equal(tasks.getState().report.items.length, 1); assert.equal(tasks.dismiss('task1').accepted, true);
  assert.equal(tasks.getState().report.pendingReview, 0); assert.equal(tasks.getState().report.cachedUnreadTotal, 1);
  assert.equal(tasks.getState().report.pendingReviewSource, 'qiuqiu-local-review');
  tasks.setEnabled(false); tasks.setEnabled(true); await tasks.refresh(); assert.equal(tasks.getState().report.pendingReview, 0); tasks.close();
  tasks = createWorkBuddyTasks(options); tasks.setEnabled(true); await tasks.refresh(); assert.equal(tasks.getState().report.pendingReview, 0);
  revision++; await tasks.refresh(); assert.equal(tasks.getState().report.pendingReview, 1);
  account = 'b'.repeat(64); tasks.setEnabled(true); await tasks.refresh(); assert.equal(tasks.getState().report.pendingReview, 1);
  assert.equal(tasks.dismissAll().accepted, true); assert.equal(tasks.getState().report.pendingReview, 0);
  account = 'a'.repeat(64); tasks.setEnabled(true); await tasks.refresh(); assert.equal(tasks.getState().report.pendingReview, 1);
  assert(!fs.readFileSync(stateFile, 'utf8').includes('示例任务')); tasks.close();
});
test('corrupt review persistence is preserved and does not fake a successful clear', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-wb-review-bad-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, 'workbuddy-task-state.json'); fs.writeFileSync(stateFile, 'invalid');
  const tasks = createWorkBuddyTasks({ stateFile, getAccountKey: () => 'a'.repeat(64), run: async () => report('a'.repeat(64)) });
  tasks.setEnabled(true); await tasks.refresh(); assert.equal(tasks.dismissAll().accepted, false);
  assert.equal(tasks.getState().report.pendingReview, 1); assert.equal(fs.readFileSync(stateFile, 'utf8'), 'invalid'); tasks.close();
});
