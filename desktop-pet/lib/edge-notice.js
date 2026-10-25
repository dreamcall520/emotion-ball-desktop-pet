const PHRASES = Object.freeze([
  '你忙，我在边边陪着。', '借个角落，安静待一会儿。',
  '慢慢来，我不催你。', '小球在线，偷偷给你打气。',
  '忙完记得伸个懒腰。', '今天也一起加油。'
]);
const GAP_MS = 90000;

// 由已有活动采样推进，不新增定时器，也不积压收起期间的通知。
function createEdgeNotice({ now = () => performance.now(), wallNow = Date.now, random = Math.random, onChange = () => {} } = {}) {
  let active = null, key = '', id = 0, lastPhrase = -1, lastShownAt = -Infinity;
  let lastQuotaSource = 'workbuddy', lastWorkBuddyDetail = 'expiry';
  const due = { text: null, quota: null };
  const jitter = (min, max) => min + Math.floor(Math.max(0, Math.min(1, random())) * (max - min));
  function publish(value) {
    const nextKey = JSON.stringify(value);
    if (nextKey === key) return;
    key = nextKey;
    onChange(value ? { ...value } : null);
  }
  function clear() { active = null; publish(null); }
  function reset() { clear(); due.text = null; due.quota = null; }
  function tick(state) {
    const time = now();
    const p = state?.presentation;
    if (!state?.visible || state.locked || p?.paused || !p?.side || p.mode === 'hidden') {
      reset(); return;
    }
    const enabled = { text: state.bubblesEnabled === true, quota: state.quotaEnabled === true || state.workbuddyEnabled === true };
    for (const kind of ['text', 'quota']) {
      if (!enabled[kind]) due[kind] = null;
      else if (due[kind] === null) due[kind] = time + (kind === 'text' ? jitter(60000, 90000) : jitter(30000, 60000));
    }
    const model = state.quotaModel;
    const item = model?.state === 'ready' ? model.items?.[0] : null;
    const quota = state.quotaEnabled === true && item && Number.isFinite(item.remaining) && item.remaining >= 0 && item.remaining <= 100 &&
      [300, 10080].includes(item.windowMinutes) ? item : null;
    const wb = state.workbuddyState, report = wb?.report, wall = wallNow();
    const workbuddy = state.workbuddyEnabled === true && wb?.enabled === true && !wb.busy && !wb.stale && !wb.error &&
      Number.isFinite(report?.total) && report.total >= 0 && Number.isFinite(report.updatedAt) &&
      report.updatedAt <= wall && wall - report.updatedAt <= 10 * 60000 ? report : null;
    const expiries = workbuddy && Array.isArray(workbuddy.expires) ? workbuddy.expires.filter(value =>
      Number.isFinite(value?.amount) && value.amount > 0 && Number.isFinite(value.at) && value.at > wall &&
      value.at - wall <= 7 * 86400000).sort((a, b) => a.at - b.at) : [];
    const expiry = expiries.length ? { at: expiries[0].at, amount: expiries.filter(e => e.at === expiries[0].at).reduce((sum, e) => sum + e.amount, 0) } : null;
    if (p.mode !== 'tucked' || p.dragging) { clear(); return; }
    if (active && (!(active.kind === 'workbuddy' ? state.workbuddyEnabled === true : enabled[active.kind]) ||
      time >= active.expiresAt || (active.kind === 'quota' && !quota) ||
      (active.kind === 'workbuddy' && (!workbuddy || active.detail === 'expiry' && !expiry)))) clear();
    if (!active && time - lastShownAt >= GAP_MS) {
      const ready = ['text', 'quota'].filter(kind => enabled[kind] && due[kind] <= time && (kind !== 'quota' || quota || workbuddy))
        .sort((a, b) => due[a] - due[b]);
      const kind = ready[0];
      if (kind) {
        active = { id: ++id, kind, expiresAt: time + (kind === 'text' ? 4500 : 6000) };
        if (kind === 'quota') {
          active.kind = workbuddy && (!quota || lastQuotaSource === 'quota') ? 'workbuddy' : 'quota';
          lastQuotaSource = active.kind;
          if (active.kind === 'workbuddy') {
            active.detail = expiry && lastWorkBuddyDetail === 'balance' ? 'expiry' : 'balance';
            lastWorkBuddyDetail = active.detail;
          }
        }
        if (kind === 'text') {
          let index = Math.min(PHRASES.length - 1, Math.floor(jitter(0, PHRASES.length)));
          if (index === lastPhrase) index = (index + 1) % PHRASES.length;
          lastPhrase = index;
          active.text = PHRASES[index];
        }
        due[kind] = time + (kind === 'text' ? jitter(180000, 360000) : jitter(300000, 600000));
        lastShownAt = time;
      }
    }
    if (!active) return;
    publish({ ...active, side: p.side, appearance: state.appearance,
      ...(active.kind === 'quota' ? {
        period: quota.windowMinutes === 300 ? '5 小时' : '周额度', remaining: Math.round(quota.remaining),
        // Match the main card using the original balance, before display rounding.
        statusLabel: quota.remaining === 0 ? '已用尽' : quota.remaining <= 10 ? '紧张' : quota.remaining <= 20 ? '偏低' : ''
      } : {}), ...(active.kind === 'workbuddy' ? { total: workbuddy.total,
        text: active.detail === 'expiry' ? (() => {
          const date = new Date(expiry.at + 8 * 3600000);
          return `${expiry.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}积分将于${date.getUTCMonth() + 1}/${date.getUTCDate()}到期`;
        })() : `还剩${workbuddy.total.toLocaleString('en-US', { maximumFractionDigits: 2 })}积分` } : {}) });
  }
  return { tick, reset, getCurrent: () => active ? { ...active } : null };
}

module.exports = { createEdgeNotice, PHRASES, GAP_MS };
