(() => {
  const api = window.petWorkBuddyDetails, el = id => document.getElementById(id);
  let state = {}, period = 'today', view = 'records', preference = 'system';
  const amount = value => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  function theme() {
    const value = preference === 'system' ? system.matches ? 'dark' : 'light' : preference;
    document.documentElement.dataset.appearance = value;
    document.documentElement.dataset.resolvedAppearance = value;
    document.documentElement.dataset.accessibleAppearance = value;
  }
  system.addEventListener('change', theme);
  api.onColorMode((mode, appearance, color) => {
    document.documentElement.dataset.colorMode = mode; document.documentElement.dataset.uiTheme = color;
    preference = appearance; theme();
  });
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
  function svgNode(tag, attrs = {}, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function drawUsage(usage) {
    const today = view === 'records' && period === 'today';
    const midnight = Date.parse(usage.endDate + 'T00:00:00+08:00');
    let cumulative = 0;
    const points = today ? [{ at: midnight, value: 0, credits: 0 }, ...usage.todayRecords.map(record => ({ at: record.at, credits: record.credits, value: cumulative += record.credits }))]
      : usage.days.map(day => ({ date: day.date, credits: day.credits, value: view === 'daily' ? day.credits : cumulative += day.credits }));
    const maximum = Math.max(...points.map(point => point.value)), y = value => maximum ? 108 - value / maximum * 80 : 108;
    const x = index => today ? points.at(-1).at === midnight ? 62 : 62 + (points[index].at - midnight) / (points.at(-1).at - midnight) * 276 : 62 + index / (points.length - 1) * 276;
    const svg = svgNode('svg', { viewBox: '0 0 374 144', class: `trend-chart${view === 'daily' ? ' daily-chart' : ''}`, role: 'img', 'aria-label': view === 'daily' ? '官方近7天每日实际消耗积分' : today ? '官方今日按真实请求时间累计消耗积分' : '官方近7天按日累计消耗积分' });
    for (const value of maximum ? [0, maximum / 2, maximum] : [0]) svg.append(svgNode('path', { class: 'axis', d: `M48 ${y(value)}H352` }), svgNode('text', { x: 43, y: y(value) + 3, 'text-anchor': 'end' }, amount(value)));
    if (view === 'daily') {
      for (const [index, point] of points.entries()) { const bar = svgNode('rect', { class: 'daily-bar', x: x(index) - 9, y: y(point.value), width: 18, height: 108 - y(point.value), rx: 3, fill: 'var(--detail-blue)' }); bar.append(svgNode('title', {}, `${point.date} · ${amount(point.credits)}积分`)); svg.append(bar); }
    } else if (points.length > 1) {
      const path = today ? points.map((point, index) => `${index ? 'L' : 'M'}${x(index)} ${y(point.value)}`).join('') : window.TrendCurve.path(points.map((point, index) => [x(index), y(point.value)]));
      svg.append(svgNode('path', { class: 'observed-area', d: `${path}L${x(points.length - 1)} 108L${x(0)} 108Z` }), svgNode('path', { class: 'observed-line', d: path }));
    }
    for (const [index, point] of points.entries()) {
      const dot = svgNode('circle', { class: `point${!today || index === 0 || index === points.length - 1 ? ' endpoint' : ''}`, cx: x(index), cy: y(point.value), r: 2 });
      dot.append(svgNode('title', {}, `${today ? new Date(point.at).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }) : point.date} · ${view === 'daily' ? '当日' : '累计'}消耗${amount(point.value)}积分`)); svg.append(dot);
      if (!today || index === 0 || index === points.length - 1) svg.append(svgNode('text', { class: 'daily-value', x: x(index), y: y(point.value) - 8, 'text-anchor': 'middle' }, amount(point.value)));
      if (!today || index === 0 || index === points.length - 1 && point.at !== points[0].at) svg.append(svgNode('text', { x: x(index), y: 132, 'text-anchor': 'middle' }, today ? new Date(point.at).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }) : point.date.slice(5).replace('-', '/')));
    }
    el('usage-plot').append(svg);
  }
  function render() {
    el('today').setAttribute('aria-pressed', String(view !== 'daily' && period === 'today'));
    el('week').setAttribute('aria-pressed', String(view === 'daily' || period === 'week'));
    el('view-records').setAttribute('aria-selected', String(view === 'records'));
    el('view-daily').setAttribute('aria-selected', String(view === 'daily'));
    el('balance').textContent = Number.isFinite(state.report?.total) ? amount(state.report.total) : '—';
    el('period-switch').hidden = view === 'daily';
    el('change-label').textContent = (view === 'daily' || period === 'week') ? '近7天消耗' : '今日消耗';
    const usageState = state.usage || {}, usage = usageState.report;
    const available = usage?.source === 'official-request-usage' && usage.complete === true && usage.timezone === 'Asia/Shanghai' && Array.isArray(usage.days) && usage.days.length === 7 && Array.isArray(usage.todayRecords);
    el('change').textContent = available ? amount(view === 'daily' || period === 'week' ? usage.totalCredits : usage.todayCredits) : '—';
    el('usage-plot').replaceChildren(); el('usage-empty').hidden = available;
    if (available) drawUsage(usage);
    el('updated').textContent = Number.isFinite(available ? usage.updatedAt : state.report?.updatedAt) ? new Date(available ? usage.updatedAt : state.report.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    el('updated').title = available ? '官方消耗上次成功查询时间' : '余额上次成功查询时间';
    el('hint').textContent = usageState.busy ? '正在同步消耗记录…' : '消耗统计暂不可用';
    el('unavailable-note').textContent = usageState.busy ? '正在读取 WorkBuddy 官方积分记录' : '暂未取得 WorkBuddy 官方消耗记录';
    const upcoming = Array.isArray(state.report?.expires) ? state.report.expires.filter(e => e.at > Date.now() && e.amount > 0).sort((a, b) => a.at - b.at) : [];
    const expiration = upcoming[0], date = at => new Date(at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    const expiring = expiration ? upcoming.filter(e => e.at === expiration.at).reduce((total, e) => total + e.amount, 0) : 0;
    el('expiry-block').dataset.warning = String(Boolean(expiration));
    el('expiry-note').textContent = expiration ? `${amount(expiring)} 积分 ${date(expiration.at)} 到期` : state.report ? '暂无已知即将到期积分' : '暂未取得积分余额';
    el('refresh-note').textContent = Number.isFinite(state.report?.nextRefreshAt) ? `基础积分 ${date(state.report.nextRefreshAt)} 刷新` : '刷新时间暂未知';
    el('balance-note').textContent = state.stale ? '余额为上次查询结果，请刷新。' : '';
    el('balance-note').hidden = !state.stale;
    resize();
  }
  for (const value of ['today', 'week']) el(value).addEventListener('click', () => { period = value; render(); });
  for (const value of ['records', 'daily']) el(`view-${value}`).addEventListener('click', () => { view = value; render(); });
  el('details-close').addEventListener('click', () => api.close());
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); api.close(); } });
  api.onModel(value => {
    state = value; preference = ['light', 'dark'].includes(value.appearance) ? value.appearance : 'system'; theme();
    if (window.workBuddyTasksView?.render(value, resize)) return;
    render();
  });
})();
