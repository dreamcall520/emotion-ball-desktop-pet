const PHRASES = Object.freeze([
  '你忙，我在边边陪着。', '借个角落，安静待一会儿。',
  '慢慢来，我不催你。', '小球在线，偷偷给你打气。',
  '忙完记得伸个懒腰。', '今天也一起加油。'
]);
const GAP_MS = 90000;

// 由已有活动采样推进，不新增定时器，也不积压收起期间的通知。
function createEdgeNotice({ now = () => performance.now(), random = Math.random, onChange = () => {} } = {}) {
  let active = null, key = '', id = 0, lastPhrase = -1, lastShownAt = -Infinity, lastQuotaSource = null;
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
    const enabled = { text: state.bubblesEnabled === true,
      quota: state.quotaEnabled === true || state.zcodeQuotaEnabled === true };
    for (const kind of ['text', 'quota']) {
      if (!enabled[kind]) due[kind] = null;
      else if (due[kind] === null) due[kind] = time + (kind === 'text' ? jitter(60000, 90000) : jitter(30000, 60000));
    }
    const model = state.quotaModel;
    const item = state.quotaEnabled === true && model?.state === 'ready' ? model.items?.[0] : null;
    const validBalance = row => row && Number.isFinite(row.remaining) && row.remaining >= 0 && row.remaining <= 100;
    const codex = validBalance(item) && [300, 10080].includes(item.windowMinutes) ? item : null;
    const zcode = state.zcodeQuotaEnabled === true && state.zcodeQuotaModel?.state === 'ready'
      && Array.isArray(state.zcodeQuotaModel.items)
      ? state.zcodeQuotaModel.items.slice(0, 64).filter(row => validBalance(row)
        && typeof row.bucketId === 'string' && row.bucketId.startsWith('zcode:')) : [];
    const choices = [...(codex ? [{ sourceId: 'codex', item: codex }] : []),
      ...(zcode.length ? [{ sourceId: 'zcode', item: zcode[0] }] : [])];
    const currentQuota = () => active?.sourceId === 'zcode'
      ? zcode.find(row => row.bucketId === active.bucketId) : codex;
    if (p.mode !== 'tucked' || p.dragging) { clear(); return; }
    if (active && (!enabled[active.kind] || time >= active.expiresAt || (active.kind === 'quota' && !currentQuota()))) clear();
    if (!active && time - lastShownAt >= GAP_MS) {
      const ready = ['text', 'quota'].filter(kind => enabled[kind] && due[kind] <= time && (kind !== 'quota' || choices.length))
        .sort((a, b) => due[a] - due[b]);
      const kind = ready[0];
      if (kind) {
        active = { id: ++id, kind, expiresAt: time + (kind === 'text' ? 4500 : 6000) };
        if (kind === 'text') {
          let index = Math.min(PHRASES.length - 1, Math.floor(jitter(0, PHRASES.length)));
          if (index === lastPhrase) index = (index + 1) % PHRASES.length;
          lastPhrase = index;
          active.text = PHRASES[index];
        } else {
          const choice = choices.find(row => row.sourceId !== lastQuotaSource) || choices[0];
          active.sourceId = choice.sourceId;
          if (choice.sourceId === 'zcode') active.bucketId = choice.item.bucketId;
          lastQuotaSource = choice.sourceId;
        }
        due[kind] = time + (kind === 'text' ? jitter(180000, 360000) : jitter(300000, 600000));
        lastShownAt = time;
      }
    }
    if (!active) return;
    const quota = active.kind === 'quota' ? currentQuota() : null;
    const modelName = typeof quota?.model === 'string' ? quota.model.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) : '';
    const shortModel = modelName.replace(/^GLM-/i, '').replace(/-/g, ' ') || '额度';
    publish({ ...active, side: p.side, appearance: state.appearance,
      ...(active.kind === 'quota' ? {
        period: active.sourceId === 'zcode' ? shortModel.length > 14 ? `${shortModel.slice(0, 13)}…` : shortModel
          : quota.windowMinutes === 300 ? '5 小时' : '周额度',
        ...(active.sourceId === 'zcode' ? { model: modelName } : {}), remaining: Math.round(quota.remaining),
        // Match the main card using the original balance, before display rounding.
        statusLabel: quota.remaining === 0 ? '已用尽' : quota.remaining <= 10 ? '紧张' : quota.remaining <= 20 ? '偏低' : ''
      } : {}) });
  }
  return { tick, reset, getCurrent: () => active ? { ...active } : null };
}

module.exports = { createEdgeNotice, PHRASES, GAP_MS };
