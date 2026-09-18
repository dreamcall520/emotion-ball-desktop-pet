const PHRASES = Object.freeze([
  '你忙，我在边边陪着。', '借个角落，安静待一会儿。',
  '慢慢来，我不催你。', '小球在线，偷偷给你打气。',
  '忙完记得伸个懒腰。', '今天也一起加油。'
]);
const GAP_MS = 90000;

// 由已有活动采样推进，不新增定时器，也不积压收起期间的通知。
function createEdgeNotice({ now = () => performance.now(), random = Math.random, onChange = () => {} } = {}) {
  let active = null, key = '', id = 0, lastPhrase = -1, lastShownAt = -Infinity;
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
    const enabled = { text: state.bubblesEnabled === true, quota: state.quotaEnabled === true };
    for (const kind of ['text', 'quota']) {
      if (!enabled[kind]) due[kind] = null;
      else if (due[kind] === null) due[kind] = time + (kind === 'text' ? jitter(60000, 90000) : jitter(30000, 60000));
    }
    const model = state.quotaModel;
    const item = model?.state === 'ready' ? model.items?.[0] : null;
    const quota = item && Number.isFinite(item.remaining) && item.remaining >= 0 && item.remaining <= 100 &&
      [300, 10080].includes(item.windowMinutes) ? item : null;
    if (p.mode !== 'tucked' || p.dragging) { clear(); return; }
    if (active && (!enabled[active.kind] || time >= active.expiresAt || (active.kind === 'quota' && !quota))) clear();
    if (!active && time - lastShownAt >= GAP_MS) {
      const ready = ['text', 'quota'].filter(kind => enabled[kind] && due[kind] <= time && (kind !== 'quota' || quota))
        .sort((a, b) => due[a] - due[b]);
      const kind = ready[0];
      if (kind) {
        active = { id: ++id, kind, expiresAt: time + (kind === 'text' ? 4500 : 6000) };
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
        period: quota.windowMinutes === 300 ? '5 小时' : '周额度', remaining: Math.round(quota.remaining)
      } : {}) });
  }
  return { tick, reset, getCurrent: () => active ? { ...active } : null };
}

module.exports = { createEdgeNotice, PHRASES, GAP_MS };
