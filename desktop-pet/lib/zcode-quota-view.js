const { formatQuotaDate } = require('./codex-quota-view');
const STATES = new Set(['disabled', 'connecting', 'connected', 'missing', 'unauthenticated', 'unsupported', 'disconnected', 'empty']);
const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160) : '';
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const validBucket = row => typeof row?.id === 'string' && row.id.startsWith('zcode:') && row.id.length <= 400
  && Number.isFinite(row.remaining) && row.remaining >= 0 && row.remaining <= 100
  && validTime(row.resetsAt)
  && (Number.isFinite(row.windowMinutes) && row.windowMinutes > 0 && validTime(row.periodStart) && row.resetsAt > row.periodStart
    || row.windowMinutes === null && row.periodStart === null);
function safeTasks(snapshot) {
  if (snapshot?.enabled !== true) return [];
  return (Array.isArray(snapshot.tasks?.items) ? snapshot.tasks.items.slice(0, 64) : []).flatMap(row => {
    if (!text(row?.id)) return [];
    return [{ id: text(row.id), title: text(row.title) || '未命名任务',
      state: (snapshot.tasks.state === 'connected' || row.liveVerified === true) && ['active', 'waiting', 'completed', 'failed', 'interrupted', 'idle'].includes(row.state) ? row.state : 'unknown',
      turnId: text(row.turnId) || null, updatedAt: validTime(row.updatedAt) ? row.updatedAt : null }];
  });
}
function safeResults(snapshot) {
  if (snapshot?.enabled !== true || snapshot.history?.available !== true) return [];
  return (Array.isArray(snapshot.history.results) ? snapshot.history.results.slice(-64) : []).flatMap(row => {
    if (!text(row?.id) || !text(row.turnId) || !['completed', 'failed', 'interrupted'].includes(row.state) || !validTime(row.updatedAt)) return [];
    return [{ id: text(row.id), turnId: text(row.turnId), title: text(row.title) || '未命名任务', state: row.state,
      updatedAt: row.updatedAt, readAt: validTime(row.readAt) ? row.readAt : null }];
  });
}
function activity(snapshot) {
  return { runningCount: snapshot?.enabled === true && snapshot.tasks?.state === 'connected'
    ? safeTasks(snapshot).filter(row => ['active', 'waiting'].includes(row.state)).length : null,
  unreadCount: snapshot?.enabled === true && snapshot.history?.available === true ? safeResults(snapshot).filter(row => row.readAt === null).length : null };
}
function buildZcodeQuotaLabelModel(snapshot, options = {}, now = Date.now()) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const state = source.enabled === false ? 'disabled' : STATES.has(source.quota?.state) ? source.quota.state : 'disconnected';
  const empty = { sourceId: 'zcode', state, items: [], overflow: 0, activity: activity(snapshot), planName: 'ZCode' };
  if (source.enabled !== true || state !== 'connected' || !validTime(now)) return empty;
  const windows = Array.isArray(source.quota?.windows) ? source.quota.windows : Array.isArray(source.buckets) ? source.buckets : [];
  const items = windows.slice(0, 64).filter(row => validBucket(row) && row.resetsAt > now).map(row => {
    const periodKind = ['one_time', 'daily', 'rolling', 'weekly', 'monthly', 'unknown'].includes(row.periodKind) ? row.periodKind : 'unknown';
    const prefix = periodKind === 'one_time' ? '到期' : periodKind === 'daily' ? '刷新' : periodKind === 'unknown' ? '有效至' : '重置';
    return { sourceId: 'zcode', id: row.id, bucketId: row.id, label: text(row.label) || 'ZCode',
      planName: text(row.planName) || 'ZCode', model: text(row.model), meter: text(row.meter),
      windowMinutes: row.windowMinutes, remaining: row.remaining, resetsAt: row.resetsAt,
      resetLabel: `${prefix} ${formatQuotaDate(row.resetsAt, row.windowMinutes, now)}`,
      total: Number.isFinite(row.total) && row.total >= 0 ? row.total : null,
      remainingUnits: Number.isFinite(row.remainingUnits) && row.remainingUnits >= 0 ? row.remainingUnits : null,
      unit: text(row.unit), periodStart: row.periodStart, periodKind,
      pace: { state: 'unknown', remainingTimePercent: null } };
  });
  const stale = source.quota.stale === true || !validTime(source.quota.updatedAt) || source.quota.updatedAt > now || now - source.quota.updatedAt >= 300000;
  return { ...empty, state: stale ? 'stale' : items.length ? 'ready' : 'empty', items,
    planName: [...new Set(items.map(row => row.planName))].join(' / ') || 'ZCode' };
}
function buildZcodeDetailsModel(snapshot, options = {}, now = Date.now()) {
  const model = buildZcodeQuotaLabelModel(snapshot, options, now);
  const selected = model.items.find(row => row.bucketId === options?.bucketId) || model.items[0];
  const byTime = new Map();
  if (selected && snapshot?.history?.available === true) {
    for (const cycle of Array.isArray(snapshot.history.windows) ? snapshot.history.windows.slice(-32) : []) {
      if (cycle?.id !== selected.id || cycle.periodStart !== selected.periodStart || cycle.resetsAt !== selected.resetsAt) continue;
      for (const sample of Array.isArray(cycle.samples) ? cycle.samples.slice(-1440) : []) {
        if (!validTime(sample?.at) || sample.at < selected.periodStart || sample.at > now || sample.at >= selected.resetsAt
          || !Number.isFinite(sample.remaining) || sample.remaining < 0 || sample.remaining > 100) continue;
        byTime.set(sample.at, { at: sample.at, remaining: sample.remaining });
      }
    }
  }
  const samples = [...byTime.values()].sort((a, b) => a.at - b.at).slice(-1440);
  const observedAt = validTime(now) ? now : null;
  return { ...model, generation: Number.isSafeInteger(snapshot?.generation) ? snapshot.generation : null, action: ['quota', 'trend', 'tasks', 'results'].includes(options?.action) ? options.action : 'quota',
    observedAt, quotaUpdatedAt: snapshot?.enabled === true && validTime(snapshot.quota?.updatedAt) && snapshot.quota.updatedAt <= now ? snapshot.quota.updatedAt : null,
    bucketId: selected?.bucketId || null, buckets: model.items, period: selected?.windowMinutes || null,
    appearance: ['light', 'dark', 'system'].includes(options?.appearance) ? options.appearance : 'system',
    colorMode: text(options?.colorMode), tasks: safeTasks(snapshot), results: safeResults(snapshot).filter(row => row.readAt === null),
    trend: { bucketId: selected?.bucketId || null, period: selected?.windowMinutes || null,
      periodStart: selected?.periodStart || null, windowMinutes: selected?.windowMinutes || null,
      resetsAt: selected?.resetsAt || null, resetLabel: selected?.resetLabel || '', samples,
      forecast: { state: 'unknown', status: 'unknown', exhaustsAt: null, label: '',
        summary: samples.length ? '已记录真实额度变化' : '记录中',
        detail: model.state === 'stale' ? '额度尚未更新，稍后再看' : selected?.windowMinutes === null
          ? '接口未提供周期起点，暂无法绘制趋势' : '仅展示当前额度桶与周期的实际采样' } } };
}
module.exports = { buildZcodeQuotaLabelModel, buildZcodeDetailsModel };
