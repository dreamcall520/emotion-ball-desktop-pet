(function renderQuotaLabel() {
  const states = new Map([
    ['disabled', 'Codex 联动已关闭'],
    ['connecting', '正在连接 Codex…'],
    ['connected', 'Codex 已连接'],
    ['ready', 'Codex 剩余额度'],
    ['stale', '额度已过期'],
    ['reset-wait', '等待额度更新'],
    ['period-missing', '当前账号未返回所选周期'],
    ['empty', '暂未返回可用额度'],
    ['missing', '未找到 Codex'],
    ['unauthenticated', 'Codex 尚未登录'],
    ['unsupported', '当前 Codex 暂不支持额度读取'],
    ['disconnected', 'Codex 未连接']
  ]);
  const directionAndControl = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

  function record(value) {
    try { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
    catch (_) { return null; }
  }

  function cleanText(value) {
    if (typeof value !== 'string') return '';
    return Array.from(value.replace(directionAndControl, ' ').replace(/\s+/gu, ' ').trim())
      .slice(0, 32).join('');
  }

  function copyItem(value) {
    const item = record(value);
    if (!item) return null;
    let labelValue;
    let windowMinutes;
    let remaining;
    try {
      labelValue = item.label;
      windowMinutes = item.windowMinutes;
      remaining = item.remaining;
    } catch (_) { return null; }
    const itemLabel = cleanText(labelValue);
    if (!itemLabel || !Number.isSafeInteger(windowMinutes) || windowMinutes <= 0 ||
      typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || remaining > 100) return null;
    return { label: itemLabel, windowMinutes, remaining };
  }

  function copyItems(value) {
    try { if (!Array.isArray(value)) return []; } catch (_) { return []; }
    let length;
    try { length = value.length; } catch (_) { return []; }
    const limit = Number.isSafeInteger(length) && length >= 0 ? Math.min(length, 2) : 0;
    const items = [];
    for (let index = 0; index < limit; index += 1) {
      let raw;
      try { raw = value[index]; } catch (_) { continue; }
      const item = copyItem(raw);
      if (item) items.push(item);
    }
    return items;
  }

  function safeModel(value) {
    const source = record(value);
    if (!source) return { state: 'disconnected', items: [], overflow: 0 };
    let stateValue;
    try { stateValue = source.state; } catch (_) { return { state: 'disconnected', items: [], overflow: 0 }; }
    const state = states.has(stateValue) ? stateValue : 'disconnected';
    if (!['ready', 'stale'].includes(state)) return { state, items: [], overflow: 0 };
    let rawItems;
    let overflowValue;
    try {
      rawItems = source.items;
      overflowValue = source.overflow;
    } catch (_) { return { state, items: [], overflow: 0 }; }
    const hidden = Number.isSafeInteger(overflowValue) && overflowValue > 0
      ? Math.min(overflowValue, 99) : 0;
    return { state, items: copyItems(rawItems), overflow: hidden };
  }

  function periodText(minutes) {
    if (minutes === 300) return '5 小时';
    if (minutes === 10080) return '周额度';
    if (minutes % 1440 === 0) return `${minutes / 1440} 天`;
    if (minutes % 60 === 0) return `${minutes / 60} 小时`;
    return `${minutes} 分钟`;
  }

  function severityOf(remaining) {
    if (remaining <= 10) return 'urgent';
    if (remaining <= 20) return 'low';
    return 'normal';
  }

  let label;
  let status;
  let items;
  let overflow;
  let bridge;
  try {
    label = document.getElementById('quota-label');
    status = document.getElementById('status');
    items = document.getElementById('items');
    overflow = document.getElementById('overflow');
    bridge = window.petQuotaLabel;
  } catch (_) { return; }
  if (!label || !label.dataset || !status || !items || typeof items.replaceChildren !== 'function' ||
    !overflow || !bridge || typeof bridge.onModel !== 'function' ||
    !document || typeof document.createElement !== 'function') return;

  const render = value => {
    const model = safeModel(value);
    try {
      status.textContent = states.get(model.state);
      label.dataset.state = model.state;
      label.dataset.hasItems = 'false';
      label.dataset.severity = 'normal';
      const rows = [];
      let overallSeverity = 'normal';
      for (const item of model.items) {
        const row = document.createElement('li');
        const remainingNode = document.createElement('span');
        const detailNode = document.createElement('span');
        if (!row || !row.dataset || typeof row.replaceChildren !== 'function' ||
          !remainingNode || !detailNode) continue;
        const severity = severityOf(item.remaining);
        row.dataset.severity = severity;
        remainingNode.className = 'quota-remaining';
        remainingNode.textContent = `剩余 ${Math.round(item.remaining)}%`;
        detailNode.className = 'quota-detail';
        detailNode.textContent = ` · ${item.label} · ${periodText(item.windowMinutes)}${model.state === 'stale' ? ' · 已过期' : ''}`;
        row.replaceChildren(remainingNode, detailNode);
        rows.push(row);
        if (severity === 'urgent' || (severity === 'low' && overallSeverity === 'normal')) overallSeverity = severity;
      }
      items.replaceChildren(...rows);
      label.dataset.hasItems = rows.length > 0 ? 'true' : 'false';
      label.dataset.severity = rows.length > 0 ? overallSeverity : 'normal';
      overflow.textContent = model.overflow ? `另有 ${model.overflow} 项，见菜单` : '';
    } catch (_) {}
  };

  let unsubscribe = null;
  try {
    const candidate = bridge.onModel(render);
    if (typeof candidate === 'function') unsubscribe = candidate;
  } catch (_) { return; }
  if (unsubscribe && typeof window.addEventListener === 'function') {
    try {
      window.addEventListener('beforeunload', () => {
        try { unsubscribe(); } catch (_) {}
      });
    } catch (_) {}
  }
})();
