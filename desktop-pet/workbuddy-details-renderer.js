(function () {
  function observations(history, period, now = Date.now()) {
    const start = period === 'week' ? now - 7 * 86400000 : new Date(now).setHours(0, 0, 0, 0);
    const points = (Array.isArray(history) ? history : []).filter(p => p && Number.isSafeInteger(p.at) && p.at >= start && p.at <= now && Number.isFinite(p.total) && p.total >= 0).sort((a, b) => a.at - b.at);
    return points.filter((p, i) => i === points.length - 1 || p.at !== points[i + 1].at);
  }
  const precise = value => Math.round(value * 1000000) / 1000000;
  function changes(points) {
    return points.slice(1).flatMap((point, i) => {
      const previous = points[i], delta = precise(point.total - previous.total);
      if (!delta) return [];
      const parts = ['basic', 'reward', 'purchased'].map(key => Number.isFinite(point[key]) && Number.isFinite(previous[key]) ? precise(point[key] - previous[key]) : null);
      const exactPart = parts.every(value => value !== null) && parts.filter(value => value !== 0).length === 1 && Math.abs(parts.reduce((a, b) => a + b, 0) - delta) < .000001;
      const expiry = Array.isArray(previous.expires) ? precise(previous.expires.filter(e => e.at > previous.at && e.at <= point.at).reduce((total, e) => total + e.amount, 0)) : null;
      let kind = delta > 0 ? 'increase' : 'decrease';
      if (exactPart && delta > 0) kind = ['basic', 'reward', 'purchased'][parts.findIndex(value => value > 0)];
      if (exactPart && delta < 0 && parts[1] === delta && expiry !== null && Math.abs(expiry + delta) < .000001) kind = 'expiry';
      return [{ at: point.at, from: previous.at, delta, kind, expiry }];
    });
  }
  function dailyChanges(events) {
    const days = new Map();
    for (const event of events) {
      const date = new Date(event.at), key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const day = days.get(key) || { date: key, increase: 0, decrease: 0, events: 0 };
      if (event.delta > 0) day.increase = precise(day.increase + event.delta); else day.decrease = precise(day.decrease - event.delta);
      day.events++; days.set(key, day);
    }
    return [...days.values()];
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
  if (typeof module !== 'undefined') { module.exports = { observations, analyze, changes, dailyChanges }; return; }
  const api = window.petWorkBuddyDetails, el = id => document.getElementById(id);
  let state = {}, period = 'today', view = 'records', preference = 'system';
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
    const analysis = analyze(points, state.report), events = changes(points), increase = precise(events.filter(e => e.delta > 0).reduce((total, e) => total + e.delta, 0));
    el('view-records').setAttribute('aria-pressed', String(view === 'records')); el('view-daily').setAttribute('aria-pressed', String(view === 'daily'));
    if (state.stale) analysis.days = analysis.daily = null;
    const label = period === 'week' ? '近7天' : '今日';
    el('change-label').textContent = increase > 0 && analysis.decrease === 0 ? `${label}增加` : increase > 0 ? '最近一次变化' : `${label}减少`;
    el('change').textContent = points.length < 2 ? '—' : increase > 0 && analysis.decrease === 0 ? `+${amount(increase)}` : increase > 0 ? `${events.at(-1).delta > 0 ? '+' : '−'}${amount(Math.abs(events.at(-1).delta))}` : amount(analysis.decrease);
    el('change').title = '增加和减少来自相邻真实查询；不是消费流水';
    el('forecast').textContent = analysis.days === null ? '还不能估算可用天数' : analysis.days < 1 ? '按下降速度粗估，不足1天' : `按下降速度粗估，约可用${Math.round(analysis.days)}天`;
    el('forecast').title = analysis.daily === null ? '需要跨至少24小时的连续有效记录，且排除到期、刷新和增长影响' : `记录中日均减少约${amount(analysis.daily)}积分；这是余额速度粗估，不是确认消费`;
    const upcoming = Array.isArray(state.report?.expires) ? state.report.expires.filter(e => e.at > Date.now() && e.amount > 0).sort((a, b) => a.at - b.at) : [];
    const expiration = upcoming[0], date = at => new Date(at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    const expiring = expiration ? upcoming.filter(e => e.at === expiration.at).reduce((total, e) => total + e.amount, 0) : 0;
    el('expiry-note').textContent = expiration ? `${amount(expiring)}积分将在${date(expiration.at)}到期` : '暂无已知即将到期积分';
    el('refresh-note').textContent = Number.isFinite(state.report?.nextRefreshAt) ? `基础积分将于${date(state.report.nextRefreshAt)}刷新` : '基础刷新时间暂未知';
    el('chart').replaceChildren(); el('events').replaceChildren();
    const html = (tag, className, text) => { const n = document.createElement(tag); n.className = className; if (text !== undefined) n.textContent = text; return n; };
    const eventLabel = event => {
      const value = amount(Math.abs(event.delta));
      return ({ reward: `奖励增加${value}积分`, basic: `基础积分增加${value}`, purchased: `购买积分增加${value}`, expiry: `奖励到期${value}积分`, increase: `积分增加${value}（原因未确认）`, decrease: `观察到减少${value}（原因未确认）` })[event.kind];
    };
    if (view === 'daily') {
      for (const day of dailyChanges(events).reverse()) {
        const row = html('div', 'activity-row'), copy = html('span', 'activity-copy');
        copy.append(html('b', '', day.date), html('small', '', `增加 ${amount(day.increase)} · 减少 ${amount(day.decrease)} 积分`)); row.append(copy); el('events').append(row);
      }
    } else {
      for (const event of events.slice(-6).reverse()) {
        const row = html('div', 'activity-row'), copy = html('span', 'activity-copy');
        copy.append(html('b', '', eventLabel(event)), html('small', '', new Date(event.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })));
        row.append(copy); el('events').append(row);
      }
    }
    const notes = [state.stale ? '余额为上次查询结果，请刷新。' : '', state.historyError || ''];
    if (points.length < 2) { el('hint').textContent = [...notes, points.length ? '仅有1次查询，暂不能判断这段时间的变化。' : '本时段暂无查询记录。'].filter(Boolean).join(' '); resize(); return; }
    if (!analysis.changed) { el('hint').textContent = [...notes, '这段时间积分未变化'].filter(Boolean).join(' '); resize(); return; }
    if (view === 'daily') { el('hint').textContent = [...notes, '按查询记录分别汇总增加和减少；未记录时段不补数。'].filter(Boolean).join(' '); resize(); return; }
    const low = Math.min(...points.map(p => p.total)), high = Math.max(...points.map(p => p.total));
    const min = low, max = high;
    const x = at => 48 + (at - first.at) / (last.at - first.at) * 304, y = total => 108 - (total - min) / (max - min) * 80;
    const svg = node('svg', { viewBox: '0 0 374 144', class: 'trend-chart', role: 'img', 'aria-label': '真实积分余额趋势，虚线表示未记录时段' });
    for (const value of [min, (min + max) / 2, max]) { svg.append(node('path', { class: 'axis', d: `M48 ${y(value)}H352` }), node('text', { x: 43, y: y(value) + 3, 'text-anchor': 'end' }, amount(value))); }
    const segments = [[first]], gaps = [];
    points.slice(1).forEach((point, i) => { const event = events.find(event => event.at === point.at); if (event && (event.delta > 0 || event.kind === 'expiry')) { segments.push([point]); } else if (point.at - points[i].at > 10 * 60000) { gaps.push([points[i], point]); segments.push([point]); } else segments.at(-1).push(point); });
    for (const segment of segments) if (segment.length > 1) { const path = window.TrendCurve.path(segment.map(p => [x(p.at), y(p.total)])); svg.append(node('path', { class: 'observed-area', d: `${path}L${x(segment.at(-1).at)} 108L${x(segment[0].at)} 108Z` }), node('path', { class: 'observed-line', d: path })); }
    for (const gap of gaps) svg.append(node('path', { class: 'unrecorded-line', d: `M${x(gap[0].at)} ${y(gap[0].total)}L${x(gap[1].at)} ${y(gap[1].total)}` }));
    for (const event of events.filter(e => e.delta > 0 || e.kind === 'expiry').slice(-3)) { const label = node('text', { x: x(event.at), y: Math.max(16, y(points.find(p => p.at === event.at).total) - 8), 'text-anchor': event.at === last.at ? 'end' : 'start' }, `${event.delta > 0 ? '+' : '−'}${amount(Math.abs(event.delta))}${event.kind === 'reward' ? '奖励' : event.kind === 'expiry' ? '到期' : '新增'}`); svg.append(label); }
    for (const point of points) { const dot = node('circle', { class: `point${point === first || point === last || events.some(event => event.at === point.at) ? ' endpoint' : ''}`, cx: x(point.at), cy: y(point.total), r: 2 }); dot.append(node('title', {}, `${new Date(point.at).toLocaleString('zh-CN', { hour12: false })} · ${amount(point.total)} 积分`)); svg.append(dot); }
    for (const [point, anchor] of [[first, 'start'], [last, 'end']]) svg.append(node('text', { x: x(point.at), y: 132, 'text-anchor': anchor }, new Date(point.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })));
    el('chart').append(svg); el('hint').textContent = [...notes, events.length ? eventLabel(events.at(-1)) : '这段时间积分未变化'].filter(Boolean).join(' '); resize();
  }
  for (const value of ['today', 'week']) el(value).addEventListener('click', () => { period = value; render(); });
  for (const value of ['records', 'daily']) el(`view-${value}`).addEventListener('click', () => { view = value; render(); });
  el('explanation').addEventListener('toggle', resize);
  el('details-close').addEventListener('click', () => api.close());
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); api.close(); } });
  api.onModel(value => { state = value; preference = ['light', 'dark'].includes(value.appearance) ? value.appearance : 'system'; theme(); if (window.workBuddyTasksView?.render(value, resize)) return; render(); });
})();
