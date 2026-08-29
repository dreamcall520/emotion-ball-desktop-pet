(function renderQuotaLabel() {
  const label = document.getElementById('quota-label');
  const status = document.getElementById('status');
  const items = document.getElementById('items');
  const overflow = document.getElementById('overflow');
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

  function cleanText(value) {
    if (typeof value !== 'string') return '';
    return Array.from(value.replace(directionAndControl, ' ').replace(/\s+/gu, ' ').trim())
      .slice(0, 32).join('');
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

  const unsubscribe = window.petQuotaLabel.onModel(model => {
    const state = states.has(model && model.state) ? model.state : 'disconnected';
    const showsItems = state === 'ready' || state === 'stale';
    status.textContent = states.get(state);
    label.dataset.state = state;
    label.dataset.hasItems = 'false';
    label.dataset.severity = 'normal';
    const rows = [];
    let overallSeverity = 'normal';
    if (showsItems) {
      for (const item of Array.isArray(model.items) ? model.items.slice(0, 2) : []) {
        const itemLabel = cleanText(item && item.label);
        if (!itemLabel || !Number.isSafeInteger(item && item.windowMinutes) || item.windowMinutes <= 0 ||
          !Number.isFinite(item.remaining) || item.remaining < 0 || item.remaining > 100) continue;
        const row = document.createElement('li');
        const severity = severityOf(item.remaining);
        row.dataset.severity = severity;
        row.textContent = `${itemLabel} · ${periodText(item.windowMinutes)} · 剩余 ${Math.round(item.remaining)}%${state === 'stale' ? ' · 已过期' : ''}`;
        rows.push(row);
        if (severity === 'urgent' || (severity === 'low' && overallSeverity === 'normal')) overallSeverity = severity;
      }
    }
    items.replaceChildren(...rows);
    label.dataset.hasItems = rows.length > 0 ? 'true' : 'false';
    label.dataset.severity = rows.length > 0 ? overallSeverity : 'normal';
    const hidden = showsItems && Number.isSafeInteger(model.overflow) && model.overflow > 0
      ? Math.min(model.overflow, 99) : 0;
    overflow.textContent = hidden ? `另有 ${hidden} 项，见菜单` : '';
  });
  window.addEventListener('beforeunload', unsubscribe);
})();
