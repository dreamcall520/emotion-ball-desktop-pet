const test = require('node:test');
const assert = require('node:assert/strict');
const { createMasWorkBuddyDetailsState: project, safeDeviceTasks, safeWebsiteUsage } = require('../lib/mas-workbuddy-details');
test('missing snapshots are unavailable, not zero or successful empty reports', () => {
  const value = project(); assert.equal(value.report, null); assert.equal(value.tasks.report, null);
  assert.equal(value.tasks.deviceHistory, null); assert.equal(value.usage.report, null);
});
test('device cache stays device scoped, bounded and unlinked to live events', () => {
  const result = project({ desktopTasks: { report: { source: 'workbuddy-session-cache', scope: 'authorized-device-cache', accountAttributionVerified: true,
    total: 1, pendingReview: 1, observedAt: 100, items: [{ id: 'cache_1', title: 'hello', state: 'last-completed', unread: true, body: 'SECRET', token: 'SECRET' }] } } });
  assert.equal(result.tasks.report, null); assert.equal(result.tasks.deviceHistory.accountAttributionVerified, false);
  assert.equal(result.tasks.deviceHistory.items[0].state, 'last-completed');
  assert.equal(result.tasks.liveObservations.observations.length, 0); assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('Stop cannot become terminal, FinalStop only proves main reply', () => {
  const observation = { id: 'a'.repeat(32), phase: 'stop-observed', state: 'completed', terminalConfirmed: true,
    terminalKind: 'main-reply', correlated: true, evidence: 'versioned-final-stop-hook', observedAt: 100, realtime: true };
  const input = { liveObservations: { source: 'workbuddy-desktop-hook', scope: 'authorized-original-workbuddy-hook-metadata', enabled: true, observations: [observation] } };
  assert.equal(safeDeviceTasks(input).liveObservations.observations[0].terminalConfirmed, false);
  observation.phase = 'final-stop-observed'; const value = safeDeviceTasks(input).liveObservations.observations[0];
  assert.equal(value.terminalConfirmed, true); assert.equal(value.overallTaskVerified, false);
});
test('unknown sources, invalid counts and credential properties are excluded', () => {
  assert.equal(safeDeviceTasks({ report: { source: 'foreign', scope: 'authorized-device-cache', items: [] } }).deviceHistory, null);
  assert.equal(safeWebsiteUsage({ report: { source: 'website-usage', scope: 'website-summary', updatedAt: 100, totalCredits: -1 } }).report, null);
  const value = project({ quota: { summary: { scope: 'website-summary', credits: { remaining: 0 }, updatedAt: 100, token: 'SECRET' } } });
  assert.equal(value.report.total, 0); assert.ok(!JSON.stringify(value).includes('SECRET'));
});
function aggregate() {
  const days = Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${i + 1}`, credits: i === 6 ? 2 : 0 }));
  const at = Date.parse('2026-11-07T12:00:00+08:00');
  return { source: 'website-usage', scope: 'website-request-usage', timezone: 'Asia/Shanghai', complete: true,
    startDate: days[0].date, endDate: days.at(-1).date, days, todayRecords: [{ at, credits: 2 }],
    updatedAt: at + 1, todayCredits: 2, totalCredits: 2, requestCount: 1, token: 'SECRET' };
}
test('website aggregate retains accurate source and curve, never legacy delay claims', () => {
  const value = safeWebsiteUsage({ report: aggregate() });
  assert.equal(value.report.source, 'website-usage'); assert.equal(value.report.days.length, 7);
  assert.equal(value.report.todayCredits, 2); assert.equal(value.report.delayHours, undefined);
  assert.ok(!JSON.stringify(value).includes('SECRET'));
  const broken = aggregate(); broken.totalCredits = 3;
  assert.equal(safeWebsiteUsage({ report: broken }).report, null);
});
test('website loading/error without report remains explicit unavailable state', () => {
  const value = safeWebsiteUsage({ status: 'error', busy: false, error: 'SECRET' });
  assert.equal(value.report, null); assert.equal(value.error, '网站消耗记录暂不可用。');
});
