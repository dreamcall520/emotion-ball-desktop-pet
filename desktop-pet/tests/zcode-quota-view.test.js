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

function forecastFixture({ remaining = 40, kind = 'daily', decline = 10 } = {}) {
  const row = { ...buckets[0], id: 'zcode:forecast:bucket', periodKind: kind,
    periodStart: now - 3600000, resetsAt: now + 3600000, windowMinutes: 120, remaining };
  const samples = Array.from({ length: 6 }, (_, index) => ({ at: now - (5 - index) * 120000,
    remaining: remaining + decline * (5 - index) / 5 }));
  return { ...snapshot, quota: { ...snapshot.quota, windows: [row] },
    history: { available: true, windows: [{ ...row, samples }], results: [] } };
}
const forecastModel = source => buildZcodeDetailsModel(source, { action: 'trend' }, now);
test('ZCode pace uses its actual supplied span and the existing ten-point pace threshold', () => {
  for (const [remaining, state] of [[30, 'fast'], [40, 'balanced'], [50, 'balanced'], [60, 'balanced'], [70, 'slow']]) {
    const item = forecastModel(forecastFixture({ remaining })).items[0];
    assert.equal(item.pace.remainingTimePercent, 50); assert.equal(item.pace.state, state);
  }
  const source = forecastFixture(); source.quota.stale = true;
  assert.deepEqual(forecastModel(source).items[0].pace, { state: 'unknown', remainingTimePercent: null });
  const future = forecastFixture(); Object.assign(future.quota.windows[0], { periodStart: now + 60000, resetsAt: now + 7200000 });
  assert.equal(forecastModel(future).items[0].pace.remainingTimePercent, null);
});
test('fresh continuous real declines estimate risk, tight and safe within the independent ZCode bucket', () => {
  for (const [remaining, status] of [[40, 'risk'], [65, 'tight'], [80, 'safe']]) {
    const source = forecastFixture({ remaining }), before = JSON.stringify(source);
    const forecast = forecastModel(source).trend.forecast;
    assert.equal(forecast.state, 'estimate'); assert.equal(forecast.status, status);
    assert.equal(forecast.reference, true); assert.equal(forecast.exhaustsAt, now + remaining * 60000);
    assert.match(forecast.detail, /刷新/); assert.equal(JSON.stringify(source), before);
  }
  const once = forecastModel(forecastFixture({ kind: 'one_time' })).trend.forecast;
  assert.match(once.detail, /到期/); assert.doesNotMatch(once.summary + once.detail, /重置|刷新/);
  const rolling = forecastModel(forecastFixture({ kind: 'rolling' })).trend.forecast;
  assert.match(rolling.detail, /重置/);
  const unknown = forecastModel(forecastFixture({ kind: 'unknown' })).trend.forecast;
  assert.match(unknown.detail, /有效期/);
});
test('unusable ZCode observations explain why they cannot estimate without inventing a rate', () => {
  const scenarios = [
    ['stale', source => { source.quota.stale = true; }, /未更新/],
    ['stale', source => { source.quota.updatedAt = now - 300000; }, /未更新/],
    ['stale', source => { source.quota.updatedAt = now + 1; }, /未更新/],
    ['insufficient-records', source => { source.history.available = false; }, /记录不足/],
    ['insufficient-records', source => { source.history.windows[0].samples = source.history.windows[0].samples.slice(-2); }, /记录不足/],
    ['insufficient-records', source => { source.history.windows[0].samples.forEach(sample => { sample.at += 120000; }); }, /记录不足/],
    ['insufficient-records', source => { source.history.windows[0].samples.forEach(sample => { sample.at -= 300000; }); }, /记录不足/],
    ['value-mismatch', source => { source.quota.windows[0].remaining = 39; }, /等待采样同步/],
    ['discontinuity', source => { source.history.windows[0].samples.splice(1, 2); }, /连续记录不足/],
    ['discontinuity', source => { source.history.windows[0].samples.at(-2).remaining = 39; }, /连续记录不足/],
    ['discontinuity', source => { source.history.windows[0].samples.at(-2).remaining = 70; }, /连续记录不足/],
    ['insufficient-records', source => { source.history.windows[0].id += ':other'; }, /记录不足/],
    ['insufficient-records', source => { source.history.windows[0].periodStart -= 86400000; }, /记录不足/],
    ['insufficient-records', source => { source.history.windows[0].resetsAt += 86400000; }, /记录不足/]
  ];
  for (const [reason, change, detail] of scenarios) {
    const source = forecastFixture(); change(source); const forecast = forecastModel(source).trend.forecast;
    assert.equal(forecast.state, 'unknown', String(change)); assert.equal(forecast.reason, reason, String(change));
    assert.equal(forecast.exhaustsAt, null); assert.match(forecast.detail, detail);
  }
  const unchanged = forecastModel(forecastFixture({ remaining: 100, decline: 0 })).trend.forecast;
  assert.equal(unchanged.state, 'unknown'); assert.equal(unchanged.reason, 'no-decline');
  assert.match(unchanged.detail, /当前连续记录中未见额度下降/);
  const noPeriod = forecastFixture(); Object.assign(noPeriod.quota.windows[0], { periodStart: null, windowMinutes: null });
  const missing = forecastModel(noPeriod);
  assert.equal(missing.trend.forecast.reason, 'missing-period'); assert.equal(missing.items[0].pace.remainingTimePercent, null);
  assert.match(missing.trend.forecast.detail, /未提供周期起点/);
});
test('a sufficient fresh segment after correction may estimate without using older or future samples', () => {
  const source = forecastFixture(); const cycle = source.history.windows[0];
  cycle.samples.unshift({ at: now - 1200000, remaining: 40 }, { at: now - 1100000, remaining: 30 });
  cycle.samples.push({ at: now + 1, remaining: 1 });
  assert.equal(forecastModel(source).trend.forecast.state, 'estimate');
  assert.equal(forecastModel(source).trend.forecast.exhaustsAt, now + 2400000);
});


test('quiet recent usage falls back only to the current continuous recorded segment', () => {
  const source = forecastFixture({ remaining: 80, decline: 0 });
  const samples = Array.from({ length: 31 }, (_, i) => ({ at: now - (30-i)*120000,
    remaining: i < 10 ? 90-i : 80 }));
  source.history.windows[0].samples = samples;
  let forecast = forecastModel(source).trend.forecast;
  assert.equal(forecast.state, 'estimate');
  assert.match(forecast.detail, /按本周期已记录用量粗估/);
  assert.equal(forecast.exhaustsAt, now + 80 / (10/3600000));
  // A new real decline takes precedence over the longer recorded average.
  samples.at(-1).remaining = 79; source.quota.windows[0].remaining = 79;
  forecast = forecastModel(source).trend.forecast;
  assert.match(forecast.detail, /按近期连续用量粗估/);
  assert.equal(forecast.exhaustsAt, now + 79 * 1800000);
});

test('recorded fallback never crosses gaps, increases, corrections or identity boundaries', () => {
  for (const boundary of ['gap','increase','large-drop','other-bucket','other-period']) {
    const source = forecastFixture({ remaining: 80, decline: 0 });
    const older = Array.from({ length: 6 }, (_, i) => ({ at: now-(25-i)*120000, remaining: 90-i*2 }));
    const flat = Array.from({ length: 20 }, (_, i) => ({ at: now-(19-i)*120000, remaining: 80 }));
    if (boundary === 'gap') older.forEach(sample => sample.at -= 300000);
    if (boundary === 'increase') older.at(-1).remaining = 79;
    if (boundary === 'large-drop') { older.at(-1).remaining = 100; flat.forEach(sample=>{sample.remaining=75;}); source.quota.windows[0].remaining=75; }
    if (boundary === 'other-bucket' || boundary === 'other-period') {
      source.history.windows.push({ ...source.history.windows[0],
        ...(boundary === 'other-bucket' ? {id:'zcode:other:bucket'} : {periodStart:now-7200000}), samples:older });
      source.history.windows[0].samples = flat;
    } else source.history.windows[0].samples = [...older,...flat];
    const forecast = forecastModel(source).trend.forecast;
    assert.equal(forecast.state, 'unknown', boundary); assert.equal(forecast.reason, 'no-decline', boundary);
  }
  for (const change of [source=>{source.quota.stale=true;},source=>{source.quota.windows[0].remaining=79;},source=>{source.history.windows[0].samples=source.history.windows[0].samples.slice(-2);}]) {
    const source=forecastFixture({remaining:80,decline:0});
    source.history.windows[0].samples.unshift({at:now-1800000,remaining:90});change(source);
    assert.equal(forecastModel(source).trend.forecast.state,'unknown');
  }
});


test('recorded fallback uses only retained observations and keeps extreme projections valid', () => {
  for (const [remaining, earlier, state] of [[0,10,'estimate'],[80,80+1e-10,'unknown']]) {
    const source=forecastFixture({remaining,decline:0});
    source.history.windows[0].samples=Array.from({length:31},(_,i)=>({at:now-(30-i)*120000,remaining:i===0?earlier:remaining}));
    const forecast=forecastModel(source).trend.forecast;
    assert.equal(forecast.state,state);
    if(remaining===0)assert.equal(forecast.exhaustsAt,now);
    else assert.equal(forecast.exhaustsAt,null);
  }
});
