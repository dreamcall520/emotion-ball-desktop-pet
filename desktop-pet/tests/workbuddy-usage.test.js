const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkBuddyUsage, validUsage, safeUsageState } = require('../lib/workbuddy-usage');
const key = 'a'.repeat(64), other = 'b'.repeat(64), now = Date.parse('2026-10-25T10:00:00+08:00');
const usage = () => ({ source: 'official-request-usage', timezone: 'Asia/Shanghai', startDate: '2026-10-19', endDate: '2026-10-25', days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${19 + i}`, credits: i === 6 ? .09 : 0 })), todayRecords: [{ at: now - 300000, credits: .09 }], todayCredits: .09, totalCredits: .09, requestCount: 2, updatedAt: now, delayHours: 3, complete: true });
test('usage checks official complete dates, totals, precision and allowlisted public fields', () => {
  assert.equal(validUsage(usage()).todayCredits, .09);
  for (const altered of [{ totalCredits: 100 }, { complete: false }, { days: usage().days.slice(1) }, { startDate: '2026-99-99' }]) assert.equal(validUsage({ ...usage(), ...altered }), null);
  const safe = safeUsageState({ busy: true, error: 'secret', accountKey: key, report: { ...usage(), input: 'secret', days: usage().days.map(d => ({ ...d, prompt: 'secret' })) } });
  assert.equal(JSON.stringify(safe).includes('secret'), false); assert.equal(JSON.stringify(safe).includes(key), false);
});
test('usage default disabled/account gate, cache expiration and forced refresh', async () => {
  let account = null, time = now, calls = 0;
  const manager = createWorkBuddyUsage({ getAccountKey: () => account, now: () => time, run: async (op, payload) => { assert.equal(op, 'usage'); assert.equal(payload.expectedAccountKey, key); calls++; return { accountKey: key, usage: usage() }; } });
  await manager.refresh(); manager.setEnabled(true); await manager.refresh(); assert.equal(calls, 0);
  account = key; await manager.refresh(); assert.equal(calls, 1); assert.equal(manager.getState().report.todayCredits, .09);
  await manager.refresh(); assert.equal(calls, 1); await manager.refresh(true); assert.equal(calls, 2);
  time += 300000; await manager.refresh(); assert.equal(calls, 3);
  account = other; assert.equal(manager.getState().report, null); manager.setEnabled(false); assert.equal(manager.getState().report, null); manager.close();
});
test('disable aborts pending usage and ignores late success', async () => {
  let resolve, signal;
  const manager = createWorkBuddyUsage({ getAccountKey: () => key, now: () => now, run: (_, __, options) => { signal = options.signal; return new Promise(done => { resolve = done; }); } });
  manager.setEnabled(true); const pending = manager.refresh(); manager.setEnabled(false); assert.equal(signal.aborted, true);
  resolve({ accountKey: key, usage: usage() }); await pending; assert.equal(manager.getState().report, null); assert.equal(manager.getState().busy, false);
});
test('wrong account, incomplete data and failures never become zero consumption', async () => {
  let result = { accountKey: other, usage: usage() };
  const manager = createWorkBuddyUsage({ getAccountKey: () => key, now: () => now, run: async () => { if (result instanceof Error) throw result; return result; } });
  manager.setEnabled(true); await manager.refresh(); assert.equal(manager.getState().report, null); assert.ok(manager.getState().error);
  result = { accountKey: key, usage: { ...usage(), complete: false } }; await manager.refresh(); assert.equal(manager.getState().report, null);
  result = Error('sensitive diagnostics'); await manager.refresh(); assert.equal(JSON.stringify(manager.getState()).includes('sensitive'), false);
});
test('account switch aborts old request and late result cannot replace new successful zero usage', async () => {
  let account = key; const jobs = [];
  const manager = createWorkBuddyUsage({ getAccountKey: () => account, now: () => now, run: (_, __, options) => new Promise(resolve => jobs.push({ resolve, signal: options.signal })) });
  manager.setEnabled(true); const first = manager.refresh(); account = other; const second = manager.refresh(); assert.equal(jobs[0].signal.aborted, true);
  const zero = { ...usage(), days: usage().days.map(d => ({ ...d, credits: 0 })), todayRecords: [], todayCredits: 0, totalCredits: 0 };
  jobs[1].resolve({ accountKey: other, usage: zero }); await second; jobs[0].resolve({ accountKey: key, usage: usage() }); await first;
  assert.equal(manager.getState().report.todayCredits, 0); manager.close(); assert.equal(manager.getState().report, null);
});
test('Shanghai midnight invalidates fresh cache', async () => {
  let time = Date.parse('2026-10-25T23:59:00+08:00'), calls = 0;
  const manager = createWorkBuddyUsage({ getAccountKey: () => key, now: () => time, run: async () => { calls++; return { accountKey: key, usage: usage() }; } });
  manager.setEnabled(true); await manager.refresh(); assert.equal(calls, 1); time += 120000; await manager.refresh(); assert.equal(calls, 2); assert.equal(manager.getState().report, null);
});
test('today records must match official date, ascending time and exact 8-decimal total', () => {
  const source = usage(), record = source.todayRecords[0];
  for (const records of [undefined, [{ ...record, at: Date.parse('2026-10-24T23:59:59+08:00') }], [{ ...record, at: now + 1 }], [record, record], [{ ...record, credits: .08 }]]) {
    assert.equal(validUsage({ ...source, todayRecords: records }), null);
  }
  const precise = { ...source, todayCredits: .74999999, totalCredits: .74999999, days: source.days.map((d, i) => ({ ...d, credits: i === 6 ? .74999999 : 0 })), todayRecords: [{ at: record.at, credits: .74999999, requestId: 'private' }] };
  const safe = safeUsageState({ report: precise }); assert.equal(safe.report.todayRecords[0].credits, .74999999); assert.equal(JSON.stringify(safe).includes('private'), false);
});
