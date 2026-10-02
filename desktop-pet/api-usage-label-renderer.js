(() => {
  'use strict';
  const bridge = window.qiuqiuApiUsageLabel;
  const $ = id => document.getElementById(id);
  const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  let current = { connected: false, busy: false, error: null, report: null, expanded: false, appearance: 'system' };

  function costs(entries) {
    return Array.isArray(entries) ? entries.filter(entry => entry && typeof entry.currency === 'string' && /^[a-z]{3}$/i.test(entry.currency) && typeof entry.value === 'number' && Number.isFinite(entry.value)) : [];
  }

  function symbol(currency) {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), currencyDisplay: 'narrowSymbol' }).formatToParts(0).find(part => part.type === 'currency').value; }
    catch (_) { return currency.toUpperCase(); }
  }

  function amount(value) {
    return value !== 0 && Math.abs(value) < 0.000001 ? value.toExponential(2) : money.format(value);
  }

  function exact(entries) {
    return entries.map(entry => `${entry.currency.toUpperCase()} ${String(entry.value)}`).join(' · ');
  }

  function shortCost(entries, hasReport) {
    if (!hasReport || entries.length === 0) return '—';
    if (entries.length > 1) return '多币种';
    const entry = entries[0];
    const currency = symbol(entry.currency);
    if (entry.value > 0 && entry.value < 0.01) return `<${currency}0.01`;
    if (entry.value < 0 && Math.abs(entry.value) < 0.01) return `${currency}${entry.value.toExponential(1)}`;
    const value = Math.abs(entry.value) >= 1000 ? compact.format(entry.value) : money.format(entry.value);
    const text = `${currency}${value}`;
    return text.length > 8 ? `${currency}${compact.format(entry.value)}` : text;
  }

  function renderMonth(entries, hasReport) {
    const node = $('api-month-cost');
    node.replaceChildren();
    node.dataset.multiple = String(entries.length > 1);
    node.dataset.empty = String(!hasReport || entries.length === 0);
    node.dataset.long = String(entries.length === 1 && amount(entries[0].value).length > 13);
    node.title = hasReport && entries.length ? exact(entries) : hasReport ? '官方报告未返回费用记录' : '尚未获取费用报告';
    if (!hasReport || entries.length === 0) { node.textContent = hasReport ? '暂无费用记录' : '—'; return; }
    for (const entry of entries) {
      const row = document.createElement('span');
      row.className = 'api-currency-row';
      row.append(document.createTextNode(amount(entry.value)));
      const unit = document.createElement('span');
      unit.className = 'api-currency-unit';
      unit.textContent = entry.currency.toUpperCase();
      row.append(unit);
      node.append(row);
    }
  }

  function updatedText(report) {
    const updated = report?.updatedAt;
    if (typeof updated !== 'number' || !Number.isFinite(updated) || Number.isNaN(new Date(updated).getTime())) return { short: '尚未成功查询', exact: '' };
    const date = new Date(updated);
    const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }).format(date);
    return { short: `上次查询 ${time} UTC`, exact: `上次成功查询 ${date.toISOString()}` };
  }

  function render(payload) {
    if (payload && typeof payload === 'object' && typeof payload.connected === 'boolean') current = payload;
    const connected = current.connected === true;
    const report = connected && current.report && typeof current.report === 'object' ? current.report : null;
    const month = costs(report?.costs?.month);
    const today = costs(report?.costs?.today);
    const expanded = current.expanded === true;
    const queryState = current.busy ? 'busy' : current.error ? 'error' : connected ? 'ready' : 'disconnected';
    const label = $('quota-label');
    document.documentElement.dataset.appearance = ['light', 'dark'].includes(current.appearance) ? current.appearance : 'system';
    label.dataset.expanded = String(expanded);
    label.dataset.queryState = queryState;
    label.setAttribute('aria-expanded', String(expanded));
    const compactCost = connected ? shortCost(month, Boolean(report)) : '↗';
    $('api-compact-cost').textContent = compactCost;
    $('api-compact-cost').dataset.long = String(compactCost.length >= 7);
    const period = !connected ? '未连接' : current.busy ? '查询中' : current.error ? '未更新' : !report ? '待查询' : '本月';
    $('api-period').textContent = period;
    const reportMonth = typeof report?.month === 'string' && /^\d{4}-\d{2}$/.test(report.month) ? report.month : '本月';
    const monthTitle = report && month.length ? `${reportMonth} API 费用 · ${exact(month)}` : connected ? '费用尚未查询成功' : 'API 报告未连接，点击打开连接设置';
    $('summary').title = monthTitle + (current.busy ? ' · 正在查询' : current.error ? ' · 未更新' : '');
    $('api-compact-cost').title = monthTitle;
    $('api-month').title = `${reportMonth} · UTC`;
    renderMonth(month, Boolean(report));
    $('api-today-cost').textContent = shortCost(today, Boolean(report));
    $('api-today-cost').title = today.length ? `今日费用（UTC） · ${exact(today)}` : report ? '官方报告未返回今日费用记录' : '尚未获取今日费用';
    const updated = updatedText(report);
    $('api-query-status').textContent = !connected ? '尚未连接，请打开设置' : current.busy ? report ? '正在查询 · 显示上次报告' : '正在查询…' : current.error ? report ? '未更新 · 保留上次报告' : '未更新 · 请查看完整报告' : !report ? '尚未获取官方报告' : updated.short;
    $('api-query-status').title = [typeof current.error === 'string' ? current.error : '', updated.exact].filter(Boolean).join(' · ');
    $('api-open-details').textContent = connected ? '查看完整报告 ↗' : '连接 API 报告 ↗';
    label.setAttribute('aria-label', `${monthTitle}，${period}，${connected ? expanded ? '点击折叠' : '点击展开' : '打开连接设置'}`);
  }

  function action(method) {
    if (typeof bridge?.[method] !== 'function') return;
    try { Promise.resolve(bridge[method]()).catch(() => {}); } catch (_) {}
  }

  function activate() { action(current.connected ? 'toggle' : 'openDetails'); }
  $('quota-label').addEventListener('click', event => { if (event.target === $('api-open-details')) return; activate(); });
  $('quota-label').addEventListener('keydown', event => { if (event.target !== $('quota-label')) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } });
  $('api-open-details').addEventListener('click', event => { event.stopPropagation(); action('openDetails'); });
  let unsubscribe;
  render();
  try { if (typeof bridge?.onState === 'function') unsubscribe = bridge.onState(render); } catch (_) {}
  window.addEventListener('beforeunload', () => { if (typeof unsubscribe === 'function') unsubscribe(); }, { once: true });
})();
