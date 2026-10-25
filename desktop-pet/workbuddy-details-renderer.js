(function () {
  function observations(history, period, now = Date.now()) {
    const start = period === 'week' ? now - 7 * 86400000 : new Date(now).setHours(0, 0, 0, 0);
    const points = (Array.isArray(history) ? history : []).filter(p => p && Number.isSafeInteger(p.at) && p.at >= start && p.at <= now && Number.isFinite(p.total) && p.total >= 0).sort((a, b) => a.at - b.at);
    return points.filter((p, i) => i === points.length - 1 || p.at !== points[i + 1].at);
  }
  if (typeof module !== 'undefined') { module.exports = { observations }; return; }
  const api = window.petWorkBuddyDetails, el = id => document.getElementById(id);
  let state = {}, period = 'today', preference = 'system';
  const amount = value => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  function theme() { const value = preference === 'system' ? system.matches ? 'dark' : 'light' : preference; document.documentElement.dataset.appearance = value; document.documentElement.dataset.resolvedAppearance = value; document.documentElement.dataset.accessibleAppearance = value; }
  system.addEventListener('change', theme);
  api.onColorMode((mode, appearance, color) => { document.documentElement.dataset.colorMode = mode; document.documentElement.dataset.uiTheme = color; preference = appearance; theme(); });
  function node(tag, attrs = {}, text) { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value); if (text !== undefined) n.textContent = text; return n; }
  function resize() {
    if (!api.resize || !window.getComputedStyle) return;
    const measure = () => {
      const panel = el('details-panel'), content = el('details-content'), style = window.getComputedStyle(panel);
      const height = Math.ceil(content.getBoundingClientRect().bottom - panel.getBoundingClientRect().top
        + (panel.scrollTop || 0) + parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth));
      if (Number.isFinite(height)) api.resize(Math.max(120, Math.min(700, height)));
    };
    if (window.requestAnimationFrame) window.requestAnimationFrame(measure); else measure();
  }
  function render() {
    const points = observations(state.history, period), first = points[0], last = points.at(-1);
    el('today').setAttribute('aria-pressed', String(period === 'today')); el('week').setAttribute('aria-pressed', String(period === 'week'));
    el('balance').textContent = Number.isFinite(state.report?.total) ? amount(state.report.total) : '—';
    const change = points.length > 1 ? last.total - first.total : null;
    el('change').textContent = change === null ? '—' : `${change > 0 ? '+' : ''}${amount(change)}`;
    el('chart').replaceChildren();
    const notes = [state.stale ? '余额为上次查询结果，请刷新。' : '', state.historyError || ''];
    if (points.length < 2) { el('hint').textContent = [...notes, points.length ? '仅有1次真实查询，积累更多记录后显示趋势。' : '本时段暂无真实查询记录。'].filter(Boolean).join(' '); resize(); return; }
    const low = Math.min(...points.map(p => p.total)), high = Math.max(...points.map(p => p.total));
    const min = low === high ? Math.max(0, low - 1) : low, max = low === high ? high + 1 : high;
    const x = at => 48 + (at - first.at) / (last.at - first.at) * 304, y = total => 108 - (total - min) / (max - min) * 80;
    const svg = node('svg', { viewBox: '0 0 374 144', class: 'trend-chart', role: 'img', 'aria-label': '真实积分余额趋势，虚线表示未记录时段' });
    for (const value of [min, max]) { svg.append(node('path', { class: 'axis', d: `M48 ${y(value)}H352` }), node('text', { x: 43, y: y(value) + 3, 'text-anchor': 'end' }, amount(value))); }
    const segments = [[first]], gaps = [];
    points.slice(1).forEach((point, i) => { if (point.at - points[i].at > 10 * 60000) { gaps.push([points[i], point]); segments.push([point]); } else segments.at(-1).push(point); });
    for (const segment of segments) if (segment.length > 1) svg.append(node('path', { class: 'observed-line', d: window.TrendCurve.path(segment.map(p => [x(p.at), y(p.total)])) }));
    for (const gap of gaps) svg.append(node('path', { class: 'unrecorded-line', d: `M${x(gap[0].at)} ${y(gap[0].total)}L${x(gap[1].at)} ${y(gap[1].total)}` }));
    for (const point of points) { const dot = node('circle', { class: 'point', cx: x(point.at), cy: y(point.total), r: 2 }); dot.append(node('title', {}, `${new Date(point.at).toLocaleString('zh-CN', { hour12: false })} · ${amount(point.total)} 积分`)); svg.append(dot); }
    for (const [point, anchor] of [[first, 'start'], [last, 'end']]) svg.append(node('text', { x: x(point.at), y: 132, 'text-anchor': anchor }, new Date(point.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })));
    el('chart').append(svg); el('hint').textContent = [...notes, '仅展示实际查询；虚线为超过10分钟的记录间隔，净变化包含赠送、到期及使用。'].filter(Boolean).join(' '); resize();
  }
  for (const value of ['today', 'week']) el(value).addEventListener('click', () => { period = value; render(); });
  el('details-close').addEventListener('click', () => api.close());
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); api.close(); } });
  api.onModel(value => { state = value; preference = ['light', 'dark'].includes(value.appearance) ? value.appearance : 'system'; theme(); render(); });
})();
