const test = require('node:test'); const assert = require('node:assert/strict');
const { buildZcodeQuotaLabelModel, buildZcodeDetailsModel } = require('../lib/zcode-quota-view');
const { normalizeZcodeBalance } = require('../lib/zcode-usage');
const fixture = require('./fixtures/zcode-balance.json'); const now = fixture.server_time * 1000;
const buckets = normalizeZcodeBalance(fixture, now);
const snapshot = { enabled: true, quota: { state: 'connected', stale: false, updatedAt: now, windows: buckets },
 tasks: { state: 'unknown', items: [] }, history: { available: true, windows: [], results: [] } };
test('label and details preserve independent buckets, deadlines and actual units', () => {
  const label = buildZcodeQuotaLabelModel(snapshot, {}, now); assert.equal(label.sourceId, 'zcode'); assert.equal(label.state, 'ready');
  assert.equal(label.items.length, 4); assert.equal(new Set(label.items.map(row => row.bucketId)).size, 4);
  assert.match(label.items.find(row => row.periodKind === 'one_time').resetLabel, /到期/);
  assert.match(label.items.find(row => row.periodKind === 'daily').resetLabel, /刷新/);
  const details = buildZcodeDetailsModel(snapshot, { action: 'quota', bucketId: buckets[2].id }, now);
  assert.equal(details.bucketId, buckets[2].id); assert.equal(details.buckets.length, 4); assert.equal(details.quotaUpdatedAt, now);
  assert.equal(details.activity.runningCount, null); assert.equal(details.trend.samples.length, 0); assert.equal(details.trend.forecast.state, 'unknown');
});
test('trend never merges other bucket or another cycle, stale samples cannot become fresh estimates', () => {
  const window = buckets[0];
  const history = { available: true, results: [], windows: [
    { ...window, samples: [{ at: now - 120000, remaining: 100 }, { at: now, remaining: 98 }] },
    { ...buckets[1], samples: [{ at: now, remaining: 50 }] },
    { ...window, periodStart: window.periodStart - 86400000, resetsAt: window.resetsAt - 86400000, samples: [{ at: now, remaining: 60 }] }
  ] };
  const details = buildZcodeDetailsModel({ ...snapshot, history }, { action: 'trend', bucketId: window.id }, now);
  assert.deepEqual(details.trend.samples.map(row => row.remaining), [100, 98]);
  assert.equal(details.trend.forecast.state, 'unknown');
  assert.equal(buildZcodeQuotaLabelModel({ ...snapshot, enabled: false }, {}, now).state, 'disabled');
  assert.equal(buildZcodeQuotaLabelModel({ ...snapshot, quota: { ...snapshot.quota, stale: true } }, {}, now).state, 'stale');
});
test('monthly tool quotas without a supplied period start remain visible but never receive invented trend periods', () => {
  const row = { id: 'zcode:paid:TIME_LIMIT:5:1', label: 'MCP 工具', remaining: 90, resetsAt: now + 86400000,
    windowMinutes: null, periodStart: null, periodKind: 'monthly', total: 100, remainingUnits: 90, unit: 'calls' };
  const model = buildZcodeDetailsModel({ ...snapshot, generation: 9, quota: { ...snapshot.quota, windows: [row] } }, { action: 'trend' }, now);
  assert.equal(model.items.length, 1); assert.equal(model.items[0].windowMinutes, null); assert.equal(model.generation, 9);
  assert.match(model.trend.forecast.detail, /未提供周期起点/); assert.deepEqual(model.trend.samples, []);
});
test('partial live task evidence remains visible while the overall task count stays unknown', () => {
  const model = buildZcodeDetailsModel({ ...snapshot, tasks: { state: 'unknown', items: [
    { id: 'verified', title: '已确认进行中', state: 'active', liveVerified: true, updatedAt: now },
    { id: 'unverified', title: '仅有历史索引', state: 'active', liveVerified: false, updatedAt: now }
  ] } }, { action: 'tasks' }, now);
  assert.equal(model.tasks[0].state, 'active'); assert.equal(model.tasks[1].state, 'unknown'); assert.equal(model.activity.runningCount, null);
});
