(() => {
  const api = window.qiuqiuApiBalanceLabel;
  const el = id => document.getElementById(id);
  const root = document.documentElement, system = window.matchMedia?.('(prefers-color-scheme: dark)');
  let appearance = 'system', current = null, menuOpen = false;
  const providerName = provider => provider === 'moonshot' ? 'Kimi' : 'API';
  const amount = value => Number.isFinite(value) ? value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const symbol = currency => ({ CNY: '¥', USD: '$', EUR: '€', GBP: '£', JPY: '¥' }[currency] || currency || '');
  const money = report => report ? `${symbol(report.currency)}${amount(report.available)}` : '—';
  const time = at => Number.isFinite(at) ? new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '未查询';
  const date = at => Number.isFinite(at) ? new Date(at).toLocaleString('zh-CN', { hour12: false }) : '尚未成功查询';
  const statusText = account => account.busy || account.status === 'loading' ? '更新中'
    : account.status === 'disabled' ? '已停用'
    : account.supported === false || account.status === 'unsupported' ? '暂无余额接口'
    : account.status === 'unauthenticated' ? '需更新密钥'
    : account.status === 'unconfigured' ? '待连接'
    : account.stale || account.status === 'stale' ? '待更新'
    : account.status === 'error' ? '查询失败' : account.report ? '已更新' : '未查询';
  function applyAppearance() {
    const resolved = appearance === 'system' ? (system?.matches ? 'dark' : 'light') : appearance;
    root.dataset.appearance = resolved; root.dataset.accessibleAppearance = resolved;
  }
  const removeColor = api.onColorMode?.((mode, preference, theme) => {
    root.dataset.colorMode = mode; root.dataset.uiTheme = theme;
    appearance = preference; applyAppearance();
  });
  system?.addEventListener('change', applyAppearance);
  document.addEventListener('keydown', event => { if (event.key === 'Tab') root.dataset.keyboard = 'true'; }, true);
  document.addEventListener('pointerdown', () => { root.dataset.keyboard = 'false'; }, true);
  function closeMenu(focus = false) {
    if (!menuOpen) return;
    menuOpen = false; el('account-menu').hidden = true; el('account-toggle').setAttribute('aria-expanded', 'false');
    for (const id of ['collapse', 'trend', 'refresh', 'settings']) el(id).removeAttribute('tabindex');
    if (focus) el('account-toggle').focus();
  }
  function openMenu() {
    if (!current?.expanded) return;
    menuOpen = true; el('account-menu').hidden = false; el('account-toggle').setAttribute('aria-expanded', 'true');
    for (const id of ['collapse', 'trend', 'refresh', 'settings']) el(id).tabIndex = -1;
    const selected = el('account-list').querySelector('[aria-selected="true"]') || el('account-list').firstElementChild;
    (selected || el('account-settings')).focus(); selected?.scrollIntoView({ block: 'nearest' });
  }
  function select(id) { api.selectAccount(id); closeMenu(true); }
  el('summary').addEventListener('click', () => api.toggle());
  el('collapse').addEventListener('click', () => { closeMenu(); api.toggle(); });
  el('account-toggle').addEventListener('click', () => menuOpen ? closeMenu(true) : openMenu());
  el('account-toggle').addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); openMenu(); }
  });
  el('account-list').addEventListener('keydown', event => {
    const options = [...el('account-list').children], index = options.indexOf(document.activeElement);
    let next = index;
    if (event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowUp') next = (index + options.length - 1) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;
    event.preventDefault(); options[next]?.focus(); options[next]?.scrollIntoView({ block: 'nearest' });
  });
  document.addEventListener('keydown', event => {
    if (menuOpen && event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
  });
  document.addEventListener('pointerdown', event => {
    if (menuOpen && !el('account-menu').contains(event.target) && !el('account-toggle').contains(event.target)) closeMenu();
  });
  document.addEventListener('focusin', event => {
    if (menuOpen && !el('account-menu').contains(event.target) && !el('account-toggle').contains(event.target)) closeMenu();
  });
  window.addEventListener('blur', () => closeMenu());
  for (const id of ['settings', 'account-settings']) el(id).addEventListener('click', () => { closeMenu(); api.settings(); });
  el('refresh').addEventListener('click', () => api.refresh());
  el('trend').addEventListener('click', () => { closeMenu(); api.trend(); });
  function renderAccounts(accounts, selectedId) {
    const focused = document.activeElement?.dataset?.accountId;
    const options = accounts.map(account => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'account-option'; button.tabIndex = -1;
      button.dataset.accountId = account.id; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(account.id === selectedId));
      const row = document.createElement('span'), name = document.createElement('span'), balance = document.createElement('span');
      row.className = 'account-row'; name.className = 'account-name'; balance.className = 'account-amount';
      name.textContent = account.name; balance.textContent = money(account.report); row.append(name, balance);
      const meta = document.createElement('span'), status = document.createElement('span'), updated = document.createElement('time');
      meta.className = 'account-meta'; status.textContent = `${providerName(account.provider)} · ${statusText(account)}`;
      updated.textContent = account.report ? time(account.report.updatedAt) : '—'; meta.append(status, updated);
      button.title = `${account.name} · ${providerName(account.provider)}；${statusText(account)}；${money(account.report)}${account.report ? ` ${account.report.currency}；${date(account.report.updatedAt)}` : ''}`;
      button.setAttribute('aria-label', button.title); button.append(row, meta); button.addEventListener('click', () => select(account.id));
      return button;
    });
    el('account-list').replaceChildren(...options); el('accounts-empty').hidden = accounts.length > 0;
    if (menuOpen && focused) options.find(option => option.dataset.accountId === focused)?.focus();
  }
  const removeState = api.onState(state => {
    if (current?.selectedAccountId !== state.selectedAccountId || !state.expanded) closeMenu();
    current = state; appearance = ['light', 'dark'].includes(state.appearance) ? state.appearance : 'system'; applyAppearance();
    const accounts = Array.isArray(state.accounts) ? state.accounts : [], selected = accounts.find(account => account.id === state.selectedAccountId);
    const report = state.report, name = providerName(selected?.provider), fullName = selected ? `${name} · ${selected.name}` : 'API 账户余额';
    const stale = Boolean(state.stale || state.error || state.status === 'stale');
    const low = report?.currency === 'CNY' && report.available <= 10;
    const severity = report?.currency === 'CNY' && report.available <= 0 ? 'empty-balance' : low ? 'low' : 'ready';
    const status = state.busy ? 'loading' : stale && report ? 'stale' : report ? severity : state.status;
    const labels = { loading: '更新中', stale: '待更新', low: '余额偏低', 'empty-balance': '余额不足', ready: '已更新', unsupported: '暂无接口', unauthenticated: '需更新密钥', error: '查询失败', unconfigured: '待连接', empty: '待连接', disabled: '已停用' };
    el('quota-label').dataset.expanded = String(state.expanded); el('quota-label').dataset.state = status || 'empty';
    el('summary').setAttribute('aria-expanded', String(state.expanded));
    el('mini-label').textContent = ({ ready: '余额', low: '偏低', 'empty-balance': '不足', unsupported: '暂无接口', unauthenticated: '需连接' })[status] || labels[status] || '未连接';
    el('mini-amount').textContent = money(report); el('mini-amount').dataset.long = String(el('mini-amount').textContent.length > 8);
    el('provider-name').textContent = name; el('selected-name').textContent = report?.currency || selected?.currency || ''; el('selected-name').title = fullName;
    el('source-image').hidden = selected?.provider !== 'moonshot'; el('source-fallback').hidden = selected?.provider === 'moonshot';
    el('source-icon').setAttribute('aria-label', name); el('source-icon').title = name;
    el('account-chevron').hidden = accounts.length <= 1;
    const accountAction = accounts.length > 1 ? '切换账户与连接设置' : '账户信息与连接设置';
    el('account-toggle').title = `${fullName}；${accountAction}`; el('account-toggle').setAttribute('aria-label', `${fullName}，${accountAction}`);
    el('currency').textContent = report ? symbol(report.currency) : ''; el('amount').textContent = report ? amount(report.available) : '—';
    el('amount').dataset.long = String(el('amount').textContent.length > 10); el('amount').title = report ? `${money(report)} ${report.currency}；${stale ? '上次成功查询的数据' : '账户可用余额'}` : '尚无余额数据';
    el('health').textContent = labels[status] || '待连接';
    const retry = Number.isFinite(state.nextRetryAt) ? `下次重试：${date(state.nextRetryAt)}` : '';
    const threshold = low ? '人民币余额不高于 10 元时提醒' : '';
    el('health').title = [state.busy ? '正在同步余额' : state.error, retry, threshold].filter(Boolean).join('；');
    for (const key of ['cash', 'voucher']) { el(key).textContent = report ? amount(report[key]) : '—'; el(key).title = report && Number.isFinite(report[key]) ? `${amount(report[key])} ${report.currency}` : '暂无明细'; }
    const connectionNeeded = !selected || ['empty', 'unconfigured', 'unauthenticated', 'unsupported', 'disabled'].includes(state.status);
    el('trend').disabled = !selected?.supported || ['disabled', 'unconfigured', 'unauthenticated'].includes(state.status);
    el('settings').hidden = !connectionNeeded; el('refresh').hidden = connectionNeeded; el('refresh').disabled = state.busy === true;
    el('update').textContent = state.busy ? '正在同步余额' : report ? `${stale ? '上次 ' : ''}${time(report.updatedAt)}${stale ? '' : ' 更新'}`
      : state.status === 'unsupported' ? '暂无余额接口' : state.status === 'disabled' ? '请在配置中启用账户' : state.status === 'unauthenticated' ? '请更新账户密钥' : connectionNeeded ? '请连接 API 账户' : '稍后自动重试';
    const detail = [state.spaceError ? '空间不足，保持收起；可移动球球后重试' : '', fullName, report ? `${money(report)} ${report.currency}；上次成功查询：${date(report.updatedAt)}` : '尚未成功查询', state.busy ? '正在同步余额' : state.error, retry].filter(Boolean).join('；');
    el('update').title = detail; el('refresh').title = `刷新当前账户；${detail}`; el('summary').title = detail;
    el('summary').setAttribute('aria-label', `${detail}；点击展开`);
    renderAccounts(accounts, state.selectedAccountId);
  });
  window.addEventListener('beforeunload', () => { removeState?.(); removeColor?.(); system?.removeEventListener('change', applyAppearance); }, { once: true });
})();
