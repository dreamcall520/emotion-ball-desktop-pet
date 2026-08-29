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
    let resetsAt;
    try {
      labelValue = item.label;
      windowMinutes = item.windowMinutes;
      remaining = item.remaining;
      resetsAt = item.resetsAt;
    } catch (_) { return null; }
    const itemLabel = cleanText(labelValue);
    if (!itemLabel || !Number.isSafeInteger(windowMinutes) || windowMinutes <= 0 ||
      typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || remaining > 100) return null;
    return {
      label: itemLabel,
      windowMinutes,
      remaining,
      ...(Number.isSafeInteger(resetsAt) && resetsAt > 0 ? { resetsAt } : {})
    };
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
    if (!source) return { state: 'disconnected', items: [], overflow: 0, size: 'standard', expanded: false };
    let stateValue;
    let sizeValue;
    let expandedValue;
    try {
      stateValue = source.state;
      sizeValue = source.size;
      expandedValue = source.expanded;
    } catch (_) { return { state: 'disconnected', items: [], overflow: 0, size: 'standard', expanded: false }; }
    const state = states.has(stateValue) ? stateValue : 'disconnected';
    const size = sizeValue === 'compact' ? 'compact' : 'standard';
    const expanded = size === 'compact' && expandedValue === true;
    if (!['ready', 'stale'].includes(state)) return { state, items: [], overflow: 0, size, expanded: false };
    let rawItems;
    let overflowValue;
    let resetCreditsAvailable;
    try {
      rawItems = source.items;
      overflowValue = source.overflow;
      resetCreditsAvailable = source.resetCreditsAvailable;
    } catch (_) { return { state, items: [], overflow: 0, size, expanded }; }
    const hidden = Number.isSafeInteger(overflowValue) && overflowValue > 0
      ? Math.min(overflowValue, 99) : 0;
    return {
      state,
      items: copyItems(rawItems),
      overflow: hidden,
      size,
      expanded,
      ...(Number.isSafeInteger(resetCreditsAvailable) && resetCreditsAvailable >= 0
        ? { resetCreditsAvailable } : {})
    };
  }

  function periodText(minutes) {
    if (minutes % 1440 === 0) return `${minutes / 1440}天`;
    if (minutes % 60 === 0) return `${minutes / 60}小时`;
    return `${minutes}分钟`;
  }

  function periodTypeText(minutes) {
    if (minutes === 10080) return '周额度';
    if (minutes === 300) return '5小时';
    return periodText(minutes);
  }

  function severityOf(remaining) {
    if (remaining <= 10) return 'urgent';
    if (remaining <= 20) return 'low';
    return 'normal';
  }

  function resetTimeText(model) {
    if (model.state === 'stale') return '重置时间待额度更新';
    const now = Date.now();
    const resetsAt = model.items.map(item => item.resetsAt)
      .filter(value => Number.isSafeInteger(value) && value > now)
      .sort((left, right) => left - right)[0];
    if (!resetsAt) return '重置时间暂不可用';
    const totalMinutes = Math.max(1, Math.ceil((resetsAt - now) / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const relative = days > 0
      ? `${days}天${hours > 0 ? `${hours}小时` : ''}`
      : hours > 0
        ? `${hours}小时${minutes > 0 ? `${minutes}分钟` : ''}`
        : `${minutes}分钟`;
    const date = new Date(resetsAt);
    const exact = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    return `${relative}后重置 · ${exact}`;
  }

  function resetCreditsText(value) {
    if (!Number.isSafeInteger(value) || value < 0) return '重置机会暂不可用';
    if (value === 0) return '暂无重置机会';
    return `${value > 99 ? '99+' : value} 次重置机会`;
  }

  let label;
  let status;
  let summary;
  let items;
  let overflow;
  let resetTime;
  let resetCredits;
  let bridge;
  try {
    label = document.getElementById('quota-label');
    status = document.getElementById('status');
    summary = document.getElementById('summary');
    items = document.getElementById('items');
    overflow = document.getElementById('overflow');
    resetTime = document.getElementById('reset-time');
    resetCredits = document.getElementById('reset-credits');
    bridge = window.petQuotaLabel;
  } catch (_) { return; }
  if (!label || !label.dataset || !status || !summary || typeof summary.replaceChildren !== 'function' ||
    !items || typeof items.replaceChildren !== 'function' ||
    !overflow || !bridge || typeof bridge.onModel !== 'function' ||
    !document || typeof document.createElement !== 'function') return;

  const render = value => {
    const model = safeModel(value);
    try {
      status.textContent = states.get(model.state);
      label.dataset.state = model.state;
      label.dataset.size = model.size;
      label.dataset.expanded = model.expanded ? 'true' : 'false';
      label.dataset.hasItems = 'false';
      label.dataset.severity = 'normal';
      const rows = [];
      let overallSeverity = 'normal';
      for (const item of model.items) {
        const row = document.createElement('li');
        const nameNode = document.createElement('span');
        const periodNode = document.createElement('span');
        const valueNode = document.createElement('span');
        const progressNode = document.createElement('progress');
        if (!row || !row.dataset || typeof row.replaceChildren !== 'function' ||
          !nameNode || !periodNode || !valueNode || !progressNode) continue;
        const severity = severityOf(item.remaining);
        row.dataset.severity = severity;
        nameNode.className = 'quota-name';
        nameNode.textContent = item.label;
        periodNode.className = 'quota-period';
        periodNode.textContent = `${model.state === 'stale' ? '已过期 ' : ''}${periodText(item.windowMinutes)}`;
        valueNode.className = 'quota-value';
        valueNode.textContent = `${Math.round(item.remaining)}%`;
        progressNode.className = 'quota-progress';
        progressNode.max = 100;
        progressNode.value = item.remaining;
        row.replaceChildren(nameNode, periodNode, valueNode, progressNode);
        rows.push(row);
        if (severity === 'urgent' || (severity === 'low' && overallSeverity === 'normal')) overallSeverity = severity;
      }
      items.replaceChildren(...rows);
      const summaryItem = model.items.reduce((lowest, item) =>
        !lowest || item.remaining < lowest.remaining ? item : lowest, null);
      if (summaryItem) {
        const periodNode = document.createElement('span');
        const valueNode = document.createElement('span');
        periodNode.className = 'summary-period';
        periodNode.textContent = periodTypeText(summaryItem.windowMinutes);
        valueNode.className = 'summary-value';
        valueNode.textContent = `${Math.round(summaryItem.remaining)}%`;
        summary.replaceChildren(periodNode, valueNode);
      } else {
        summary.replaceChildren();
      }
      label.dataset.hasItems = rows.length > 0 ? 'true' : 'false';
      label.dataset.severity = rows.length > 0 ? overallSeverity : 'normal';
      overflow.textContent = '';
      if (resetTime) resetTime.textContent = resetTimeText(model);
      if (resetCredits) resetCredits.textContent = resetCreditsText(model.resetCreditsAvailable);
    } catch (_) {}
  };

  if (typeof label.addEventListener === 'function' && typeof bridge.toggleExpanded === 'function') {
    try {
      label.addEventListener('click', () => {
        if (label.dataset.size !== 'compact' || label.dataset.hasItems !== 'true') return;
        try { bridge.toggleExpanded(); } catch (_) {}
      });
    } catch (_) {}
  }

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
