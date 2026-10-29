(() => {
  const api = window.qiuqiuWorkBuddyLabel;
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab') document.documentElement.dataset.keyboard = 'true';
  }, true);
  document.addEventListener('pointerdown', () => { document.documentElement.dataset.keyboard = 'false'; }, true);
  const el = id => document.getElementById(id);
  const amount = n => Number.isFinite(n) ? n.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—';
  const shortDate = n => n === null ? '未知' : new Date(n).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  const exactDate = n => n === null ? '未知' : new Date(n).toLocaleString('zh-CN', { hour12: false });
  const cycleDate = n => {
    if (!Number.isFinite(n)) return '刷新时间未知';
    const date = new Date(n), pad = value => String(value).padStart(2, '0');
    return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())} 刷新`;
  };
  function fitEnterpriseAmounts() {
    const value = el('expanded-total'), limit = el('limit-value'), status = el('balance-state'), caption = el('balance-caption');
    value.style.fontSize = ''; limit.style.fontSize = ''; status.hidden = false;
    caption.title = ''; caption.setAttribute('aria-label', caption.textContent);
    if (el('quota-label').dataset.scope !== 'enterprise' || el('quota-label').dataset.expanded !== 'true'
      || !value.getBoundingClientRect || !window.getComputedStyle || !document.createRange) return;
    caption.textContent = '积分'; caption.setAttribute('aria-label', '积分');
    const entries = [{ value, row: el('value-row') }, ...(limit.dataset.unlimited === 'true' ? [] : [{ value: limit, row: el('limit-row') }])];
    if (entries.some(entry => entry.row.getBoundingClientRect().width <= 0)) return;
    for (const entry of entries) entry.value.style.fontSize = '22px';
    const textRange = document.createRange();
    let size = 22;
    const fittedSize = () => Math.min(size, ...entries.map(entry => {
      const gap = parseFloat(window.getComputedStyle(entry.row).columnGap) || 0;
      const reserved = entry.value === value && !status.hidden ? status.getBoundingClientRect().width + gap : 0;
      const available = entry.row.getBoundingClientRect().width - reserved - .5;
      textRange.selectNodeContents(entry.value);
      const measured = textRange.getBoundingClientRect().width;
      return measured > 0 ? size * Math.max(0, available) / measured : size;
    }));
    if (fittedSize() < 22) {
      // The header already names the unit; keep query status visible there when the values need the space.
      status.hidden = true; caption.textContent = status.textContent; caption.title = status.title;
      caption.setAttribute('aria-label', status.title || status.textContent);
    }
    // Optical font sizing changes glyph proportions, so remeasure after shrinking.
    for (let pass = 0; pass < 3; pass++) {
      // shortcut: keep at least 10px; use a wider layout if amounts outgrow this card.
      const next = Math.max(10, Math.floor(fittedSize() * 10) / 10);
      if (next === size) break;
      size = next;
      for (const entry of entries) entry.value.style.fontSize = `${size}px`;
    }
  }
  window.addEventListener?.('resize', fitEnterpriseAmounts);
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
  el('expanded-header').addEventListener('click', () => api.toggle());
  el('tasks').addEventListener('click', () => api.tasks('tasks'));
  el('results').addEventListener('click', () => api.tasks('results'));
  el('expanded-header').addEventListener('contextmenu', event => { event.preventDefault(); api.refresh(); });
  el('trend').addEventListener('click', () => api.trend());
  api.onState(state => {
    appearance = ['light', 'dark'].includes(state.appearance) ? state.appearance : 'system';
    applyAppearance();
    el('quota-label').dataset.expanded = String(state.expanded);
    el('quota-label').dataset.queryState = state.busy ? 'busy' : state.error || state.stale ? 'error' : 'ready';
    document.body.dataset.expanded = String(state.expanded);
    document.body.dataset.invalid = String(!state.busy && Boolean(state.error || state.stale));
    el('toggle').setAttribute('aria-expanded', String(state.expanded));
    el('expanded-header').setAttribute('aria-expanded', String(state.expanded));
    el('details').hidden = !state.expanded;
    const r = state.report, invalid = Boolean(r && (state.error || state.stale));
    const enterprise = r?.scope === 'enterprise', unlimited = enterprise && r.unlimited === true;
    const unit = enterprise ? '额度' : '积分', balance = r ? amount(unlimited ? r.used : r.total) : '—';
    const metric = unlimited ? '本期已用' : '剩余额度';
    const label = state.busy ? '查询中' : state.errorCode === 'LOGIN_REQUIRED' ? '需登录' : invalid ? '待更新' : r ? enterprise ? unlimited ? '已用' : '剩余' : unit : '未连接';
    el('quota-label').dataset.scope = enterprise ? 'enterprise' : 'personal';
    el('metrics').className = enterprise ? 'v20-periods dual' : '';
    el('metric-label').textContent = enterprise ? metric : '';
    el('metric-label').hidden = !enterprise;
    el('limit-cell').hidden = !enterprise;
    el('limit-value').textContent = enterprise ? unlimited ? '不限额' : amount(r.limit) : '—';
    el('limit-value').dataset.unlimited = String(unlimited);
    el('limit-value').title = enterprise ? `${unlimited ? '企业额度未设上限' : `额度上限 ${amount(r.limit)} 积分`}${invalid ? '（上次成功查询的数据，待更新）' : ''}` : '';
    el('limit-value').setAttribute('aria-label', el('limit-value').title);
    el('period').textContent = label;
    el('total').textContent = balance;
    el('expanded-total').textContent = balance;
    el('balance-caption').textContent = enterprise ? '积分' : '剩余积分';
    el('balance-caption').title = '';
    el('balance-caption').setAttribute('aria-label', el('balance-caption').textContent);
    el('expanded-total').dataset.long = String(!enterprise && el('expanded-total').textContent.length > 13);
    el('expanded-total').dataset.empty = String(!r);
    el('expanded-total').title = r ? `${enterprise ? `${metric} ${balance} 积分${unlimited ? '；企业额度未设上限' : ''}` : `${balance} 积分余额`}${invalid ? '（上次成功查询的数据，待更新）' : ''}` : '尚无积分数据';
    el('expanded-total').setAttribute('aria-label', el('expanded-total').title);
    el('balance-state').textContent = enterprise && ['已用', '剩余'].includes(label) ? '积分' : label;
    el('total').dataset.long = String(el('total').textContent.length >= 7);
    el('plan').textContent = r?.plan || '尚无积分数据';
    el('balances').hidden = enterprise;
    el('basic-label').textContent = enterprise ? '已用' : '基础';
    el('reward-label').textContent = enterprise ? '限额' : '奖励';
    el('basic-item').hidden = unlimited;
    el('reward-item').hidden = false;
    el('purchased-item').hidden = enterprise;
    for (const key of ['basic', 'reward', 'purchased']) {
      const value = enterprise ? key === 'basic' ? amount(r.used) : key === 'reward' ? unlimited ? '未设上限' : amount(r.limit) : '—' : r ? amount(r[key]) : '—';
      el(key).textContent = value;
      el(key).title = enterprise ? `${key === 'basic' ? '已用' : '限额'} ${value}` : r ? `${value} 积分` : '尚无积分数据';
    }
    el('refresh-date').textContent = enterprise ? cycleDate(r.nextRefreshAt) : `${r ? shortDate(r.nextRefreshAt) : '—'} 刷新`;
    el('refresh-date').title = `${enterprise ? '企业周期刷新' : '基础刷新'}：${r ? exactDate(r.nextRefreshAt) : '未知'}`;
    el('refresh-date').setAttribute('aria-label', el('refresh-date').title);
    const first = r?.expires?.slice().sort((a, b) => a.at - b.at)[0];
    const expiring = first ? r.expires.filter(e => e.at === first.at).reduce((n, e) => n + e.amount, 0) : 0;
    el('expiry').hidden = unlimited;
    el('expiry').textContent = enterprise ? unlimited ? '' : `已用 ${amount(r.used)} 积分` : first ? `${amount(expiring)} · ${shortDate(first.at)}到期` : '到期 —';
    el('expiry').title = enterprise ? unlimited ? '' : `本期已用 ${amount(r.used)} 积分` : first ? `最近到期：${amount(expiring)} 积分 · ${exactDate(first.at)}` : '最近到期：暂无数据';
    el('expiry').setAttribute('aria-label', el('expiry').title);
    const retry = !state.busy && state.error && Number.isFinite(state.nextRetryAt) ? `下次重试：${exactDate(state.nextRetryAt)}` : '';
    const status = state.spaceError ? '空间不足，保持收起；可移动球球后重试' : state.busy ? '正在更新…' : [state.error || (state.stale ? '上次查询数据待更新' : ''), retry].filter(Boolean).join('；');
    const updated = r ? `上次成功查询：${exactDate(r.updatedAt)}` : '尚未成功查询';
    el('balance-state').title = `${r ? status || (unlimited ? '本期已用积分' : enterprise ? '企业额度' : '可用积分') : `WorkBuddy 未连接${status ? `；${status}` : ''}`}；${updated}`;
    el('balance-state').setAttribute('aria-label', el('balance-state').title);
    el('refresh').title = `刷新 WorkBuddy ${unit}；${updated}`;
    el('expanded-header').title = `${updated}；${state.busy ? '正在更新' : retry || (state.error ? state.error : '每5分钟自动更新')}，右键立即刷新${unit}`;
    const activity = state.activity || {};
    const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    const running = count(activity.runningCount), unread = count(activity.unreadCount);
    el('running-count').textContent = running === null ? '—' : String(running);
    el('unread-count').textContent = unread === null ? '—' : String(unread);
    el('tasks').title = `查看球球内任务；${running === null ? '实时进行中数量暂未提供' : `进行中 ${running} 项`}；范围：本机已同步任务`;
    el('results').title = `查看球球内待查看任务；${unread === null ? '待查看数量暂未提供' : `本机已同步记录中待查看 ${unread} 项`}；不是全局任务统计`;
    el('tasks').setAttribute('aria-label', el('tasks').title);
    el('results').setAttribute('aria-label', el('results').title);
    el('toggle').title = `WorkBuddy ${unlimited ? `本期已用 ${balance} 积分` : unit} · ${status || '点击展开'}`;
    el('toggle').setAttribute('aria-label', `WorkBuddy ${r ? enterprise ? `${metric} ${balance} 积分${unlimited ? '，企业额度未设上限' : ''}` : `${balance} 积分` : '未连接'}${status ? `，${status}` : ''}`);
    el('refresh').disabled = state.busy;
    el('trend').title = '查看官方积分消耗走势与每日消耗';
    fitEnterpriseAmounts();
  });
})();
