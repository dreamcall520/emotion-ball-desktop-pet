(() => {
  const api = window.qiuqiuWorkBuddyLabel;
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab') document.documentElement.dataset.keyboard = 'true';
  }, true);
  document.addEventListener('pointerdown', () => { document.documentElement.dataset.keyboard = 'false'; }, true);
  const el = id => document.getElementById(id);
  const amount = n => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const shortDate = n => n === null ? '未知' : new Date(n).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  const exactDate = n => n === null ? '未知' : new Date(n).toLocaleString('zh-CN', { hour12: false });
  let appearance = 'system';
  const system = window.matchMedia?.('(prefers-color-scheme: dark)');
  const applyAppearance = () => {
    const resolved = appearance === 'system' ? (system?.matches ? 'dark' : 'light') : appearance;
    document.documentElement.dataset.appearance = resolved;
    document.documentElement.dataset.accessibleAppearance = resolved;
  };
  api.onColorMode?.((mode, preference, theme) => {
    document.documentElement.dataset.colorMode = mode;
    document.documentElement.dataset.uiTheme = theme;
    appearance = preference; applyAppearance();
  });
  system?.addEventListener('change', applyAppearance);
  el('toggle').addEventListener('click', () => api.toggle());
  el('refresh').addEventListener('click', () => api.refresh());
  function renderTrend(history) {
    const chart = el('trend-chart');
    chart.replaceChildren();
    const svg = (tag, attrs, text) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
      if (text) node.textContent = text;
      return node;
    };
    const samples = history || [];
    chart.appendChild(svg('path', { class: 'axis', d: 'M2 32H174' }));
    el('trend-note').textContent = samples.length < 2 ? samples.length ? '已记录 1 次' : '等待记录' : `${samples.length} 次采样`;
    const latest = samples.at(-1);
    chart.setAttribute('aria-label', latest ? `积分余额趋势，${samples.length} 次实际采样，最近 ${amount(latest.total)} 积分；曲线仅连接记录点，虚线区间缺少记录` : '暂无已采样余额趋势');
    if (!latest) return;
    const start = samples[0].at, end = latest.at;
    const low = Math.min(...samples.map(s => s.total)), high = Math.max(...samples.map(s => s.total));
    const x = sample => end === start ? 88 : 3 + (sample.at - start) / (end - start) * 170;
    const y = sample => high === low ? 18 : 29 - (sample.total - low) / (high - low) * 24;
    const segments = [[]], gaps = [];
    samples.forEach((sample, index) => {
      const previous = samples[index - 1];
      if (previous && sample.at - previous.at > 10 * 60000) { gaps.push([previous, sample]); segments.push([]); }
      segments.at(-1).push(sample);
    });
    for (const segment of segments) if (segment.length > 1) chart.appendChild(svg('path', {
      class: 'observed-line', d: window.TrendCurve.path(segment.map(sample => [x(sample), y(sample)]))
    }));
    if (gaps.length) chart.appendChild(svg('path', { class: 'unrecorded-line',
      d: gaps.map(pair => `M${x(pair[0])} ${y(pair[0])}L${x(pair[1])} ${y(pair[1])}`).join('') }));
    const stride = Math.max(1, Math.ceil(samples.length / 6));
    samples.forEach((sample, index) => {
      if (index % stride && sample !== latest) return;
      const point = svg('circle', { class: 'point', cx: x(sample), cy: y(sample), r: 1.8 });
      point.appendChild(svg('title', {}, `${exactDate(sample.at)} · ${amount(sample.total)} 积分`));
      chart.appendChild(point);
    });
  }
  api.onState(state => {
    appearance = ['light', 'dark'].includes(state.appearance) ? state.appearance : 'system';
    applyAppearance();
    el('quota-label').dataset.expanded = String(state.expanded);
    el('quota-label').dataset.queryState = state.error || state.stale ? 'error' : 'ready';
    document.body.dataset.expanded = String(state.expanded);
    document.body.dataset.invalid = String(Boolean(state.error || state.stale));
    el('toggle').setAttribute('aria-expanded', String(state.expanded));
    el('details').hidden = !state.expanded;
    const r = state.report, invalid = Boolean(r && (state.error || state.stale));
    el('period').textContent = invalid ? '失效' : state.busy ? '查询中' : r ? '积分' : '未连接';
    el('total').textContent = r ? amount(r.total) : '—';
    el('expanded-total').textContent = r ? amount(r.total) : '—';
    el('api-month-cost').dataset.long = String(el('expanded-total').textContent.length > 13);
    el('api-month-cost').dataset.empty = String(!r);
    el('api-month-cost').title = r ? `${amount(r.total)} 积分余额${invalid ? '（旧数据已失效）' : ''}` : '尚无积分数据';
    el('total').dataset.long = String(el('total').textContent.length >= 7);
    el('plan').textContent = r?.plan || '尚无积分数据';
    for (const key of ['basic', 'reward', 'purchased']) {
      el(key).textContent = r ? amount(r[key]) : '—';
      el(key).title = r ? `${amount(r[key])} 积分` : '尚无积分数据';
    }
    el('refresh-date').textContent = `基础刷新 ${r ? shortDate(r.nextRefreshAt) : '—'}`;
    el('refresh-date').title = `基础刷新：${r ? exactDate(r.nextRefreshAt) : '未知'}`;
    el('refresh-date').setAttribute('aria-label', el('refresh-date').title);
    const first = r?.expires?.slice().sort((a, b) => a.at - b.at)[0];
    const expiring = first ? r.expires.filter(e => e.at === first.at).reduce((n, e) => n + e.amount, 0) : 0;
    el('expiry').textContent = first ? `到期 ${amount(expiring)} · ${shortDate(first.at)}` : '到期 —';
    el('expiry').title = first ? `最近到期：${amount(expiring)} 积分 · ${exactDate(first.at)}` : '最近到期：暂无数据';
    el('expiry').setAttribute('aria-label', el('expiry').title);
    const status = state.spaceError ? '空间不足，保持收起；可移动球球后重试' : state.error || (state.stale ? '旧数据已失效，请刷新' : state.busy ? '正在更新…' : '');
    const updated = r?.updatedAt === null || !r ? '尚未更新' : `更新 ${new Date(r.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    el('status').textContent = state.spaceError ? '空间不足' : !r ? 'WorkBuddy 未连接' : state.error ? '更新失败' : state.stale ? '旧数据失效' : state.busy ? '查询中…' : updated;
    el('status').title = `${status || updated}${r ? `；上次成功查询：${exactDate(r.updatedAt)}` : ''}`;
    el('status').setAttribute('aria-label', el('status').title);
    el('toggle').title = status || '展开 WorkBuddy 积分';
    el('toggle').setAttribute('aria-label', `WorkBuddy ${r ? `${amount(r.total)} 积分` : '未连接'}${status ? `，${status}` : ''}`);
    el('refresh').disabled = state.busy;
    renderTrend(state.history);
    if (state.historyError) {
      el('trend-note').textContent = '暂未保存';
      el('trend-note').title = state.historyError;
    } else el('trend-note').title = '实际采样余额；超过10分钟无记录的区间用虚线表示';
  });
})();
