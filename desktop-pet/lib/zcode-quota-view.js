const { formatQuotaDate } = require('./codex-quota-view');
const STATES = new Set(['disabled', 'connecting', 'connected', 'missing', 'unauthenticated', 'unsupported', 'disconnected', 'empty']);
const TEAM_STATUS_CODES = new Set(['ZCODE_TEAM_SELECTION_REQUIRED', 'ZCODE_TEAM_KEY_MISSING', 'ZCODE_TEAM_ACCESS_DENIED']);
const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160) : '';
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const validBucket = row => typeof row?.id === 'string' && row.id.startsWith('zcode:') && row.id.length <= 400
  && Number.isFinite(row.remaining) && row.remaining >= 0 && row.remaining <= 100
  && validTime(row.resetsAt)
  && (Number.isFinite(row.windowMinutes) && row.windowMinutes > 0 && validTime(row.periodStart) && row.resetsAt > row.periodStart
    || row.windowMinutes === null && row.periodStart === null);
function buildPace(row, fresh, now) {
  const duration = row.resetsAt - row.periodStart, remainingTime = row.resetsAt - now;
  if (!fresh || row.periodStart === null || !Number.isFinite(row.windowMinutes)
    || duration <= 0 || remainingTime <= 0 || remainingTime > duration) {
    return { state: 'unknown', remainingTimePercent: null };
  }
  const remainingTimePercent = remainingTime / duration * 100;
  const difference = row.remaining - remainingTimePercent;
  return { state: difference < -10 ? 'fast' : difference > 10 ? 'slow' : 'balanced', remainingTimePercent };
}
function buildForecast(selected, samples, state, now) {
  const unknown = (reason, detail) => ({ state: 'unknown', status: 'unknown', reason,
    exhaustsAt: null, label: '', summary: '暂无法预估额度用完时间', detail });
  if (!selected || selected.periodStart === null || !Number.isFinite(selected.windowMinutes)) {
    return unknown('missing-period', '接口未提供周期起点，暂无法预估');
  }
  if (selected.periodStart > now) return unknown('missing-period', '额度周期尚未开始，暂无法预估');
  if (state !== 'ready') return unknown('stale', '额度尚未更新，稍后再看');
  let recent = samples.filter(sample => sample.at >= now - 1800000);
  if (recent.length < 3 || now - recent.at(-1).at >= 300000) {
    return unknown('insufficient-records', '连续用量记录不足，需至少 3 次新鲜采样并覆盖 10 分钟');
  }
  let interrupted = false;
  for (let index = recent.length - 1; index > 0; index--) {
    const previous = recent[index - 1], current = recent[index];
    if (current.at - previous.at >= 300000 || current.remaining > previous.remaining
      || previous.remaining - current.remaining >= 25) {
      recent = recent.slice(index); interrupted = true; break;
    }
  }
  if (recent.length < 3 || recent.at(-1).at - recent[0].at < 600000) {
    return unknown(interrupted ? 'discontinuity' : 'insufficient-records', interrupted
      ? '记录中断或额度校正后，连续记录不足 10 分钟' : '连续用量记录不足，需至少 3 次新鲜采样并覆盖 10 分钟');
  }
  let first = recent[0];
  const last = recent.at(-1);
  if (last.remaining !== selected.remaining) return unknown('value-mismatch', '额度刚有变化，等待采样同步');
  let recorded = false;
  if (first.remaining <= last.remaining) {
    let start = samples.length - 1;
    while (start > 0) {
      const previous = samples[start - 1], current = samples[start];
      if (current.at - previous.at >= 300000 || current.remaining > previous.remaining
        || previous.remaining - current.remaining >= 25) break;
      start--;
    }
    if (samples[start]?.remaining > last.remaining) { first = samples[start]; recorded = true; }
    else return unknown('no-decline', '当前连续记录中未见额度下降，有消耗后自动更新预估');
  }
  const consumed = first.remaining - last.remaining;
  const rate = consumed / (last.at - first.at);
  const remainingAtEnd = selected.remaining - rate * (selected.resetsAt - now);
  const status = remainingAtEnd < 0 ? 'risk' : remainingAtEnd < 10 ? 'tight' : 'safe';
  const projectedAt = Math.ceil(now + selected.remaining / rate);
  if (!validTime(projectedAt)) return unknown('insufficient-records', '有效用量变化不足，暂无法预估');
  const label = formatQuotaDate(projectedAt, selected.windowMinutes, now);
  const boundary = selected.periodKind === 'daily' || selected.periodKind === 'monthly' ? '刷新'
    : selected.periodKind === 'one_time' ? '到期'
      : ['rolling', 'weekly'].includes(selected.periodKind) ? '重置' : '有效期结束';
  return { state: 'estimate', status, reason: 'estimate', reference: true, exhaustsAt: projectedAt, label,
    summary: status === 'risk' ? selected.remaining <= 0 ? '额度已用完' : `预计约 ${label} 用完`
      : status === 'tight' ? `预计够用到${boundary}` : '额度充裕',
    detail: `按${recorded ? '本周期已记录' : '近期连续'}用量粗估，${status === 'risk' ? `早于 ${formatQuotaDate(selected.resetsAt, selected.windowMinutes, now)} ${boundary}`
      : status === 'tight' ? `刚够用到${boundary}，留意用量` : `预计够用到${boundary}`}` };
}
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
  const customWithoutQuota = source.hasCustomProviders === true && !validTime(source.quota?.updatedAt) &&
    (state === 'unsupported' || ['disconnected', 'unauthenticated'].includes(state) && source.quota?.code);
  const statusCode = customWithoutQuota ? 'ZCODE_CUSTOM_QUOTA_UNAVAILABLE' : TEAM_STATUS_CODES.has(source.quota?.code) ? source.quota.code
    : source.quota?.queryFailed === true && source.quota.code && ['connected', 'disconnected'].includes(state)
      ? validTime(source.quota.updatedAt) ? 'ZCODE_QUOTA_UPDATE_FAILED' : 'ZCODE_QUOTA_QUERY_FAILED' : null;
  const empty = { sourceId: 'zcode', state, items: [], overflow: 0, activity: activity(snapshot), planName: 'ZCode',
    ...(source.enabled === true && statusCode ? { statusCode } : {}) };
  if (source.enabled !== true || state !== 'connected' || !validTime(now)) return empty;
  const stale = source.quota.stale !== false || !validTime(source.quota.updatedAt) || source.quota.updatedAt > now || now - source.quota.updatedAt >= 300000;
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
      pace: buildPace(row, !stale, now) };
  });
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
      forecast: buildForecast(selected, samples, model.state, now) } };
}
module.exports = { buildZcodeQuotaLabelModel, buildZcodeDetailsModel };
