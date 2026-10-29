(() => {
  const api = window.petApiBalanceDetails, el = id => document.getElementById(id), root = document.documentElement;
  const system = window.matchMedia?.('(prefers-color-scheme: dark)'), svg = el('balance-chart'), ns = 'http://www.w3.org/2000/svg';
  let state = null, period = 'week', appearance = 'system', points = [], pointXs = [], selectedIndex = -1, redraw = 0;
  document.addEventListener('pointerdown', () => { root.dataset.inputMode = 'pointer'; }, true);
  document.addEventListener('keydown', event => {
    if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) root.dataset.inputMode = 'keyboard';
  }, true);
  const amount = value => Number.isFinite(value) ? value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const symbol = currency => ({ CNY: '¥', USD: '$', EUR: '€', GBP: '£', JPY: '¥' }[currency] || currency || '');
  const time = at => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = at => new Date(at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  const fullTime = at => `${day(at)} ${time(at)}`;
  function theme() {
    const resolved = appearance === 'system' ? (system?.matches ? 'dark' : 'light') : appearance;
    root.dataset.appearance = appearance; root.dataset.resolvedAppearance = resolved; root.dataset.accessibleAppearance = resolved;
  }
  function node(tag, attrs = {}, text) {
    const value = document.createElementNS(ns, tag);
    for (const [key, content] of Object.entries(attrs)) value.setAttribute(key, content);
    if (text !== undefined) value.textContent = text;
    svg.append(value); return value;
  }
  function inspect(index) {
    selectedIndex = Math.max(0, Math.min(points.length - 1, index));
    const point = points[selectedIndex];
    el('record').textContent = point ? `${fullTime(point.at)} · ${symbol(state?.report?.currency)}${amount(point.available)}` : '';
    for (const circle of svg.querySelectorAll('.point')) circle.setAttribute('r', Number(circle.dataset.index) === selectedIndex ? 3.4 : 2);
  }
  // Labels are optional; every plotted point remains available for inspection.
  function fitLabels(nodes, gap = 7) {
    if (nodes.length < 2) return;
    const kept = [];
    for (const value of [nodes.at(-1), nodes[0], ...nodes.slice(1, -1)].filter(Boolean)) {
      const box = value.getBoundingClientRect();
      if (kept.some(previous => box.left < previous.right + gap && box.right > previous.left - gap)) value.remove(); else kept.push(box);
    }
  }
  function draw(view) {
    svg.replaceChildren(); points = view.points; pointXs = []; selectedIndex = -1; el('record').textContent = '';
    const width = Math.max(260, svg.clientWidth || 366), height = 144, left = 36, right = width - 22, top = 24, bottom = 110;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    el('empty').hidden = points.length > 0;
    el('empty').textContent = state?.error || (state?.status === 'unauthenticated' ? '请在连接设置中更新密钥' : period === 'today' ? '今日暂无余额记录' : '余额记录积累中');
    svg.setAttribute('aria-label', points.length ? `${period === 'today' ? '今日日内余额' : '近7天每日最新余额'}；左右方向键查看记录` : el('empty').textContent);
    if (!points.length) return;
    const values = points.map(p => p.available), min = Math.min(...values), max = Math.max(...values);
    const pad = Math.max((max - min) * .15, Math.abs(max) * .005, .1), lower = min - pad, upper = max + pad;
    const start = points[0].at, end = points.at(-1).at, span = Math.max(1, end - start);
    const x = point => period === 'week' ? left + view.days.indexOf(point.day) / 6 * (right - left)
      : points.length === 1 ? (left + right) / 2 : left + (point.at - start) / span * (right - left);
    pointXs = points.map(x);
    const y = point => top + (upper - point.available) / (upper - lower) * (bottom - top);
    for (const ratio of [0, .5, 1]) {
      const yy = top + ratio * (bottom - top), value = upper - ratio * (upper - lower);
      node('path', { class: 'axis', d: `M${left} ${yy}H${right}` });
      node('text', { x: left - 8, y: yy + 4, 'text-anchor': 'end' }, Math.abs(value) >= 10000 ? value.toExponential(1) : value.toFixed(1));
    }
    for (const segment of view.segments) {
      if (segment.length < 2) continue;
      const xy = segment.map(p => [x(p), y(p)]);
      const path = period === 'week' ? window.TrendCurve.path(xy) : xy.map((p, i) => `${i ? 'L' : 'M'}${p.join(' ')}`).join('');
      node('path', { class: 'observed-area', d: `${path}L${xy.at(-1)[0]} ${bottom}L${xy[0][0]} ${bottom}Z` });
      node('path', { class: 'observed-line', d: path });
    }
    points.forEach((point, index) => {
      const circle = node('circle', { class: 'point', cx: x(point), cy: y(point), r: 2, 'data-index': index });
      const title = document.createElementNS(ns, 'title'); title.textContent = `${fullTime(point.at)} · ${amount(point.available)}`; circle.append(title);
    });
    const labelCount = Math.min(width < 330 ? 3 : 7, points.length);
    const indices = [...new Set(Array.from({ length: labelCount }, (_, index) =>
      Math.round(index * (points.length - 1) / Math.max(1, labelCount - 1))))];
    const valueLabels = [], dateLabels = [];
    for (const index of indices) {
      const point = points[index], xx = x(point);
      const label = node('text', { class: 'value', x: xx, y: y(point) - 9, 'text-anchor': 'middle' }, amount(point.available));
      const half = label.getComputedTextLength() / 2;
      // Use the chart's right margin before hiding adjacent values, while keeping axis labels clear.
      label.setAttribute('x', Math.max(left + half, Math.min(width - half - 2, xx)));
      valueLabels.push(label);
      if (period === 'today') dateLabels.push(node('text', { class: 'date', x: xx, y: 132, 'text-anchor': index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle' }, time(point.at)));
    }
    if (period === 'week') view.days.forEach((date, index) => dateLabels.push(node('text', { class: 'date', x: left + index / 6 * (right - left), y: 132, 'text-anchor': 'middle' }, day(date))));
    fitLabels(valueLabels, 3); fitLabels(dateLabels, 3);
    if (points.length === 1) { inspect(0); el('record').textContent += ' · 继续积累中'; }
  }
  function render() {
    if (!state) return;
    const report = state.report, account = state.accounts?.find(value => value.id === state.selectedAccountId);
    const view = window.BalanceTrend.balanceTrend(report ? state.history : [], period);
    el('product').textContent = account?.provider === 'moonshot' ? 'Kimi API' : 'API';
    el('balance').textContent = report ? `${symbol(report.currency)}${amount(report.available)}` : '—';
    el('net').textContent = view.net === null ? '—' : `${view.net < 0 ? '−' : view.net > 0 ? '+' : ''}${symbol(report?.currency)}${amount(Math.abs(view.net))}`;
    el('net-label').textContent = `${period === 'today' ? '今日' : '近7天'}净变化`;
    for (const id of ['balance', 'net']) { el(id).dataset.long = String(el(id).textContent.length > 12); el(id).title = el(id).textContent; }
    el('today').setAttribute('aria-pressed', String(period === 'today')); el('week').setAttribute('aria-pressed', String(period === 'week'));
    el('unit').textContent = `余额 · ${report?.currency === 'CNY' ? '元' : report?.currency || account?.currency || '—'}`;
    el('updated').textContent = state.busy ? '更新中' : state.stale || state.error ? '待更新' : report ? time(report.updatedAt) : '—';
    const note = [state.error, state.historyError, report && (state.stale || state.error) ? `保留上次成功查询：${fullTime(report.updatedAt)}` : ''].filter(Boolean).join('；');
    el('updated').title = note || (report ? `最后更新 ${fullTime(report.updatedAt)}` : '尚未成功查询');
    el('account').textContent = `${account?.name || 'API 账户'}${report?.currency || account?.currency ? ` · ${report?.currency || account.currency}` : ''}`; el('account').title = el('account').textContent;
    draw(view); api.resize(Math.ceil(el('details-panel').getBoundingClientRect().height));
  }
  const removeModel = api.onModel(value => {
    if (state?.selectedAccountId !== value?.selectedAccountId) { period = 'week'; el('chart-help').open = false; }
    state = value; appearance = ['light', 'dark'].includes(value?.appearance) ? value.appearance : 'system'; theme(); render();
  });
  const removeColor = api.onColorMode?.((mode, preference, uiTheme) => { root.dataset.colorMode = mode; root.dataset.uiTheme = uiTheme; appearance = preference; theme(); });
  for (const range of ['today', 'week']) el(range).addEventListener('click', () => { period = range; render(); });
  el('details-close').addEventListener('click', () => api.close());
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { if (el('chart-help').open) el('chart-help').open = false; else api.close(); } });
  const inspectPointer = event => {
    if (!points.length) return;
    const rect = svg.getBoundingClientRect(), xx = (event.clientX - rect.left) / rect.width * svg.viewBox.baseVal.width;
    inspect(pointXs.reduce((best, x, i) => Math.abs(x - xx) < Math.abs(pointXs[best] - xx) ? i : best, 0));
  };
  svg.addEventListener('pointermove', inspectPointer); svg.addEventListener('click', inspectPointer);
  svg.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !points.length) return;
    event.preventDefault(); inspect(event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : (selectedIndex < 0 ? points.length - 1 : selectedIndex) + (event.key === 'ArrowRight' ? 1 : -1));
  });
  system?.addEventListener('change', theme);
  window.addEventListener('resize', () => { cancelAnimationFrame(redraw); redraw = requestAnimationFrame(render); });
  window.addEventListener('beforeunload', () => { removeModel?.(); removeColor?.(); cancelAnimationFrame(redraw); system?.removeEventListener('change', theme); }, { once: true });
})();
