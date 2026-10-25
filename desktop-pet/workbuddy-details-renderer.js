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
  function render() {
    el('today').setAttribute('aria-pressed', String(period === 'today'));
    el('week').setAttribute('aria-pressed', String(period === 'week'));
    el('view-records').setAttribute('aria-selected', String(view === 'records'));
    el('view-daily').setAttribute('aria-selected', String(view === 'daily'));
    el('balance').textContent = Number.isFinite(state.report?.total) ? amount(state.report.total) : '—';
    el('change-label').textContent = period === 'week' ? '近7天消耗' : '今日消耗';
    el('change').textContent = '—';
    el('updated').textContent = Number.isFinite(state.report?.updatedAt) ? new Date(state.report.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    el('updated').title = '余额上次成功查询时间';
    el('hint').textContent = '消耗统计暂不可用';
    el('unavailable-note').textContent = '暂未取得 WorkBuddy 官方消耗记录';
    const upcoming = Array.isArray(state.report?.expires) ? state.report.expires.filter(e => e.at > Date.now() && e.amount > 0).sort((a, b) => a.at - b.at) : [];
    const expiration = upcoming[0], date = at => new Date(at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    const expiring = expiration ? upcoming.filter(e => e.at === expiration.at).reduce((total, e) => total + e.amount, 0) : 0;
    el('expiry-note').textContent = expiration ? `${amount(expiring)}积分${date(expiration.at)}到期` : '暂无已知即将到期积分';
    el('refresh-note').textContent = Number.isFinite(state.report?.nextRefreshAt) ? `基础积分${date(state.report.nextRefreshAt)}刷新` : '基础刷新时间暂未知';
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
