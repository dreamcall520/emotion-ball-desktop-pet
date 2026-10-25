(function () {
  function observations(history, period, now = Date.now()) {
    const start = period === 'week' ? now - 7 * 86400000 : new Date(now).setHours(0, 0, 0, 0);
    const points = (Array.isArray(history) ? history : []).filter(p => p && Number.isSafeInteger(p.at) && p.at >= start && p.at <= now && Number.isFinite(p.total) && p.total >= 0).sort((a, b) => a.at - b.at);
    return points.filter((p, i) => i === points.length - 1 || p.at !== points[i + 1].at);
  }
  function analyze(points, report, now = Date.now()) {
    let decrease = 0, drops = 0, mixed = false, continuous = true;
    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1], point = points[i], difference = previous.total - point.total;
      if (difference > 0) { decrease += difference; drops++; }
      if (difference < 0) mixed = true;
      if (point.at - previous.at > 10 * 60000) continuous = false;
      for (const key of ['basic', 'reward', 'purchased']) if (!Number.isFinite(previous[key]) || !Number.isFinite(point[key]) || point[key] > previous[key]) mixed = true;
      if (Math.abs(previous.basic + previous.reward + previous.purchased - previous.total) > .000001 || Math.abs(point.basic + point.reward + point.purchased - point.total) > .000001) mixed = true;
      if (!Number.isFinite(previous.nextRefreshAt) || previous.nextRefreshAt <= point.at || !Array.isArray(previous.expires) || previous.expires.some(e => e.at > previous.at && e.at <= point.at)) mixed = true;
    }
    decrease = Math.round(decrease * 1000000) / 1000000;
    const changed = points.length > 1 && points.some(p => p.total !== points[0].total);
    const span = points.length > 1 ? points.at(-1).at - points[0].at : 0;
    let daily = null, days = null;
    if (span >= 86400000 && drops >= 3 && continuous && !mixed && decrease > 0 && Number.isFinite(report?.total)) {
      const rate = decrease / (span / 86400000), estimate = report.total / rate;
      if (Number.isFinite(estimate) && estimate >= 0 && Number.isFinite(report.nextRefreshAt) && report.nextRefreshAt > now + estimate * 86400000 &&
          Array.isArray(report.expires) && !report.expires.some(e => e.amount > 0 && e.at > now && e.at <= now + estimate * 86400000)) {
        daily = rate; days = estimate;
      }
    }
    return { decrease, changed, daily, days };
  }
  if (typeof module !== 'undefined') { module.exports = { observations, analyze }; return; }
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
    const analysis = analyze(points, state.report);
    if (state.stale) analysis.days = analysis.daily = null;
    el('change-label').textContent = period === 'week' ? '近7天减少' : '今日减少';
    el('change').textContent = points.length < 2 ? '—' : amount(analysis.decrease);
    el('change').title = '实际查询之间观察到的余额下降之和，不等于确认消费';
    el('forecast').textContent = analysis.days === null ? '还不能估算可用天数' : analysis.days < 1 ? '按下降速度粗估，不足1天' : `按下降速度粗估，约可用${Math.round(analysis.days)}天`;
    el('forecast').title = analysis.daily === null ? '需要跨至少24小时的连续有效记录，且排除到期、刷新和增长影响' : `记录中日均减少约${amount(analysis.daily)}积分；这是余额速度粗估，不是确认消费`;
    const upcoming = Array.isArray(state.report?.expires) ? state.report.expires.filter(e => e.at > Date.now() && e.amount > 0).sort((a, b) => a.at - b.at) : [];
    const expiration = upcoming[0], date = at => new Date(at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    const expiring = expiration ? upcoming.filter(e => e.at === expiration.at).reduce((total, e) => total + e.amount, 0) : 0;
    el('expiry-note').textContent = expiration ? `${amount(expiring)}积分将在${date(expiration.at)}到期` : '暂无已知即将到期积分';
    el('refresh-note').textContent = Number.isFinite(state.report?.nextRefreshAt) ? `基础积分将于${date(state.report.nextRefreshAt)}刷新` : '基础刷新时间暂未知';
    el('chart').replaceChildren();
    const notes = [state.stale ? '余额为上次查询结果，请刷新。' : '', state.historyError || ''];
    if (points.length < 2) { el('hint').textContent = [...notes, points.length ? '仅有1次查询，暂不能判断这段时间的变化。' : '本时段暂无查询记录。'].filter(Boolean).join(' '); resize(); return; }
    if (!analysis.changed) { el('hint').textContent = [...notes, '这段时间积分未变化'].filter(Boolean).join(' '); resize(); return; }
    const low = Math.min(...points.map(p => p.total)), high = Math.max(...points.map(p => p.total));
    const min = low, max = high;
    const x = at => 48 + (at - first.at) / (last.at - first.at) * 304, y = total => 108 - (total - min) / (max - min) * 80;
    const svg = node('svg', { viewBox: '0 0 374 144', class: 'trend-chart', role: 'img', 'aria-label': '真实积分余额趋势，虚线表示未记录时段' });
    for (const value of [min, max]) { svg.append(node('path', { class: 'axis', d: `M48 ${y(value)}H352` }), node('text', { x: 43, y: y(value) + 3, 'text-anchor': 'end' }, amount(value))); }
    const segments = [[first]], gaps = [];
    points.slice(1).forEach((point, i) => { if (point.at - points[i].at > 10 * 60000) { gaps.push([points[i], point]); segments.push([point]); } else segments.at(-1).push(point); });
    for (const segment of segments) if (segment.length > 1) svg.append(node('path', { class: 'observed-line', d: window.TrendCurve.path(segment.map(p => [x(p.at), y(p.total)])) }));
    for (const gap of gaps) svg.append(node('path', { class: 'unrecorded-line', d: `M${x(gap[0].at)} ${y(gap[0].total)}L${x(gap[1].at)} ${y(gap[1].total)}` }));
    for (const point of points) { const dot = node('circle', { class: 'point', cx: x(point.at), cy: y(point.total), r: 2 }); dot.append(node('title', {}, `${new Date(point.at).toLocaleString('zh-CN', { hour12: false })} · ${amount(point.total)} 积分`)); svg.append(dot); }
    for (const [point, anchor] of [[first, 'start'], [last, 'end']]) svg.append(node('text', { x: x(point.at), y: 132, 'text-anchor': anchor }, new Date(point.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })));
    el('chart').append(svg); el('hint').textContent = [...notes, analysis.decrease > 0 ? `记录中观察到减少${amount(analysis.decrease)}积分` : '这段时间积分有增加'].filter(Boolean).join(' '); resize();
  }
  for (const value of ['today', 'week']) el(value).addEventListener('click', () => { period = value; render(); });
  el('explanation').addEventListener('toggle', resize);
  el('details-close').addEventListener('click', () => api.close());
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); api.close(); } });
  api.onModel(value => { state = value; preference = ['light', 'dark'].includes(value.appearance) ? value.appearance : 'system'; theme(); render(); });
})();
