function validUsage(value) {
  if (value?.source !== 'official-request-usage' || value.timezone !== 'Asia/Shanghai' || value.complete !== true ||
      !Array.isArray(value.days) || value.days.length !== 7 || !Number.isFinite(value.updatedAt) || value.updatedAt < 0 ||
      !Number.isSafeInteger(value.requestCount) || value.requestCount < 0 || !Number.isFinite(value.todayCredits) || value.todayCredits < 0 ||
      !Number.isFinite(value.totalCredits) || value.totalCredits < 0 || value.delayHours !== 3) return null;
  const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + 'T00:00:00Z')) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
  if (!validDate(value.startDate) || !validDate(value.endDate)) return null;
  let sum = 0;
  const days = [];
  for (const day of value.days) {
    if (!validDate(day?.date) || !Number.isFinite(day.credits) || day.credits < 0 ||
        days.length && Date.parse(day.date) - Date.parse(days.at(-1).date) !== 86400000) return null;
    sum += day.credits; days.push({ date: day.date, credits: day.credits });
  }
  if (days[0].date !== value.startDate || days.at(-1).date !== value.endDate || Math.abs(sum - value.totalCredits) > .000001 ||
      Math.abs(days.at(-1).credits - value.todayCredits) > .000001) return null;
  if (!Array.isArray(value.todayRecords) || value.todayRecords.length > 10000) return null;
  const start = Date.parse(value.endDate + 'T00:00:00+08:00'), records = [];
  let units = 0;
  for (const record of value.todayRecords) {
    if (!Number.isSafeInteger(record?.at) || record.at < start || record.at >= start + 86400000 || record.at > value.updatedAt ||
        !Number.isFinite(record.credits) || record.credits < 0 || !Number.isSafeInteger(Math.round(record.credits * 1e8)) ||
        records.length && record.at <= records.at(-1).at) return null;
    units += Math.round(record.credits * 1e8); records.push({ at: record.at, credits: record.credits });
  }
  if (!Number.isSafeInteger(units) || units !== Math.round(value.todayCredits * 1e8)) return null;
  return { source: value.source, timezone: value.timezone, startDate: value.startDate, endDate: value.endDate, days,
    todayRecords: records, todayCredits: value.todayCredits, totalCredits: value.totalCredits, requestCount: value.requestCount, updatedAt: value.updatedAt, delayHours: 3, complete: true };
}
function safeUsageState(value) {
  return { busy: value?.busy === true, error: value?.error ? '消耗统计暂不可用，请稍后重试。' : null, report: validUsage(value?.report) };
}
function createWorkBuddyUsage({ run, getAccountKey, onChange = () => {}, now = Date.now } = {}) {
  let enabled = false, closed = false, generation = 0, controller = null, owner = null, fetchedAt = null;
  let state = { busy: false, error: null, report: null };
  function reset() { generation++; controller?.abort(); controller = null; owner = null; fetchedAt = null; state = { busy: false, error: null, report: null }; }
  function account() { const key = getAccountKey?.(); return /^[a-f0-9]{64}$/.test(key || '') ? key : null; }
  const getState = () => { if (owner && owner !== account()) reset(); return structuredClone(state); };
  const emit = () => onChange(getState());
  const today = () => new Date(now() + 8 * 3600000).toISOString().slice(0, 10);
  async function refresh(force = false) {
    const key = account();
    if (owner && owner !== key) reset();
    if (!enabled || closed || !key || state.busy) return getState();
    if (!force && state.report?.endDate === today() && fetchedAt !== null && now() >= fetchedAt && now() - fetchedAt < 5 * 60000) return getState();
    const current = ++generation; owner = key;
    const request = new AbortController(); controller = request; state.busy = true; state.error = null; emit();
    try {
      const result = await run('usage', { expectedAccountKey: key }, { signal: request.signal });
      if (current !== generation) return getState();
      if (account() !== key) { reset(); emit(); return getState(); }
      const report = result?.accountKey === key ? validUsage(result.usage) : null;
      if (!report || report.endDate !== today()) throw Error('invalid usage');
      fetchedAt = now(); state = { busy: false, error: null, report };
    } catch (_) {
      if (current !== generation) return getState();
      fetchedAt = null; state = { busy: false, error: '消耗统计暂不可用，请稍后重试。', report: null };
    } finally { if (current === generation) { controller = null; state.busy = false; emit(); } }
    return getState();
  }
  return { getState, refresh,
    setEnabled(value) { enabled = value === true; if (!enabled || owner && owner !== account()) { reset(); emit(); } },
    close() { closed = true; enabled = false; reset(); } };
}
module.exports = { createWorkBuddyUsage, validUsage, safeUsageState };
