(function renderQuotaLabel() {
  const creditBalanceText = typeof window !== 'undefined' && typeof window.petCreditBalanceText === 'function'
    ? window.petCreditBalanceText : typeof require === 'function' ? require('./credit-balance') : () => '暂未提供';
  if (typeof module !== 'undefined' && module.exports) module.exports = { creditBalanceText };
  const states = new Map([
    ['disabled', 'Codex 联动已关闭'],
    ['connecting', '正在连接 Codex…'],
    ['connected', 'Codex 已连接'],
    ['ready', 'Codex 剩余额度'],
    ['stale', '额度已过期'],
    ['reset-wait', '等待额度更新'],
    ['period-missing', '当前账号未返回所选周期'],
    ['empty', '暂未返回可用额度'],
    ['missing', '未找到 Codex'],
    ['unauthenticated', 'Codex 尚未登录'],
    ['unsupported', '当前 Codex 暂不支持额度读取'],
    ['disconnected', 'Codex 未连接']
  ]);
  const directionAndControl = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

  function record(value) {
    try { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
    catch (_) { return null; }
  }

  function cleanText(value) {
    if (typeof value !== 'string') return '';
    return Array.from(value.replace(directionAndControl, ' ').replace(/\s+/gu, ' ').trim())
      .slice(0, 32).join('');
  }

  function copyItem(value) {
    const item = record(value);
    if (!item) return null;
    let labelValue;
    let windowMinutes;
    let remaining;
    let resetsAt;
    let paceValue;
    try {
      labelValue = item.label;
      windowMinutes = item.windowMinutes;
      remaining = item.remaining;
      resetsAt = item.resetsAt;
      paceValue = item.pace;
    } catch (_) { return null; }
    const itemLabel = cleanText(labelValue);
    if (!itemLabel || !Number.isSafeInteger(windowMinutes) || windowMinutes <= 0 ||
      typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || remaining > 100) return null;
    return {
      label: itemLabel,
      windowMinutes,
      remaining,
      pace: copyPace(paceValue),
      ...(Number.isSafeInteger(resetsAt) && resetsAt > 0 ? { resetsAt } : {})
    };
  }

  function copyPace(value) {
    try {
      const source = record(value);
      const state = source?.state;
      const percent = source?.remainingTimePercent;
      return { state: ['fast', 'balanced', 'slow'].includes(state) ? state : 'unknown',
        remainingTimePercent: typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : null };
    } catch (_) { return { state: 'unknown', remainingTimePercent: null }; }
  }

  function activityFields(source) {
    try {
      const activity = record(source.activity);
      const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
      return { activity: { runningCount: count(activity?.runningCount), unreadCount: count(activity?.unreadCount) } };
    } catch (_) { return { activity: { runningCount: null, unreadCount: null } }; }
  }

  function copyItems(value) {
    try { if (!Array.isArray(value)) return []; } catch (_) { return []; }
    let length;
    try { length = value.length; } catch (_) { return []; }
    const limit = Number.isSafeInteger(length) && length >= 0 ? Math.min(length, 2) : 0;
    const items = [];
    for (let index = 0; index < limit; index += 1) {
      let raw;
      try { raw = value[index]; } catch (_) { continue; }
      const item = copyItem(raw);
      if (item) items.push(item);
    }
    return items;
  }

  function extraCreditsFields(source, state) {
    try {
      const value = record(source.extraCredits);
      if (!value || !['balance', 'none', 'unlimited', 'unknown', 'stale'].includes(value.state)) return {};
      const balance = typeof value.balance === 'string' && value.balance.length <= 128 &&
        /^\d+(?:\.\d+)?$/.test(value.balance) ? value.balance : null;
      const creditState = state === 'stale' ? 'stale' : value.state === 'balance' && balance === null ? 'unknown' : value.state;
      return { extraCredits: { state: creditState,
        ...(creditState === 'balance' ? { balance } : {}),
        ...(state === 'ready' && value.usageStatus === 'blocked' ? { usageStatus: 'blocked' } : {}) } };
    } catch (_) { return {}; }
  }

  function safeModel(value) {
    const source = record(value);
    if (!source) return { state: 'disconnected', items: [], overflow: 0, size: 'standard', appearance: 'system', expanded: false };
    let stateValue;
    let sizeValue;
    let appearanceValue;
    let expandedValue;
    try {
      stateValue = source.state;
      sizeValue = source.size;
      appearanceValue = source.appearance;
      expandedValue = source.expanded;
    } catch (_) { return { state: 'disconnected', items: [], overflow: 0, size: 'standard', appearance: 'system', expanded: false }; }
    const state = states.has(stateValue) ? stateValue : 'disconnected';
    const size = sizeValue === 'compact' ? 'compact' : 'standard';
    const appearance = ['light', 'dark'].includes(appearanceValue) ? appearanceValue : 'system';
    const expanded = expandedValue === true;
    if (!['ready', 'stale'].includes(state)) return { state, items: [], overflow: 0, size, appearance, expanded: false };
    let rawItems;
    let overflowValue;
    let resetCreditsAvailable;
    try {
      rawItems = source.items;
      overflowValue = source.overflow;
      resetCreditsAvailable = source.resetCreditsAvailable;
    } catch (_) { return { state, items: [], overflow: 0, size, appearance, expanded }; }
    const hidden = Number.isSafeInteger(overflowValue) && overflowValue > 0
      ? Math.min(overflowValue, 99) : 0;
    return {
      state,
      items: copyItems(rawItems),
      overflow: hidden,
      size,
      appearance,
      expanded,
      ...activityFields(source),
      ...extraCreditsFields(source, state),
      ...(Number.isSafeInteger(resetCreditsAvailable) && resetCreditsAvailable >= 0
        ? { resetCreditsAvailable } : {})
    };
  }

  function periodText(minutes) {
    if (minutes % 1440 === 0) return `${minutes / 1440}天`;
    if (minutes % 60 === 0) return `${minutes / 60}小时`;
    return `${minutes}分钟`;
  }

  function periodTypeText(minutes) {
    if (minutes === 10080) return '周额度';
    if (minutes === 300) return '5小时';
    return periodText(minutes);
  }

  function periodBadgeText(minutes) {
    if (minutes === 10080) return '周';
    if (minutes === 300) return '5h';
    return periodText(minutes).slice(0, 3);
  }

  function severityOf(remaining) {
    if (remaining <= 10) return 'urgent';
    if (remaining <= 20) return 'low';
    return 'normal';
  }

  function severityText(remaining) {
    if (remaining === 0) return '已用尽';
    const severity = severityOf(remaining);
    return severity === 'urgent' ? '紧张' : severity === 'low' ? '偏低' : '';
  }

  function renderValue(node, remaining) {
    if (!node) return;
    const percentage = `${Math.round(remaining)}%`;
    const state = severityText(remaining);
    if (!state || typeof node.replaceChildren !== 'function') {
      node.textContent = `${percentage}${state}`;
      return;
    }
    const number = document.createElement('span');
    const status = document.createElement('span');
    number.className = 'quota-number';
    number.textContent = percentage;
    status.className = 'quota-state-label';
    status.textContent = state;
    node.replaceChildren(number, status);
  }

  function labelProgress(node, item) {
    if (!node || typeof node.setAttribute !== 'function') return;
    const state = severityText(item.remaining);
    node.setAttribute('aria-label', `${periodTypeText(item.windowMinutes)}剩余额度`);
    node.setAttribute('aria-valuetext', `${Math.round(item.remaining)}%${state ? `，${state}` : ''}`);
  }

  function resetTimeText(model, item = model.items[0]) {
    if (model.state === 'stale') return '重置时间待额度更新';
    const now = Date.now();
    const resetsAt = Number.isSafeInteger(item?.resetsAt) && item.resetsAt > now ? item.resetsAt : null;
    if (!resetsAt) return '重置时间暂不可用';
    const totalMinutes = Math.max(1, Math.ceil((resetsAt - now) / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const relative = days > 0
      ? `${days}天${hours > 0 ? `${hours}小时` : ''}`
      : hours > 0
        ? `${hours}小时${minutes > 0 ? `${minutes}分钟` : ''}`
        : `${minutes}分钟`;
    const date = new Date(resetsAt);
    const exact = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    return `${relative}后重置 · ${exact}`;
  }

  function resetCreditsText(value) {
    if (!Number.isSafeInteger(value) || value < 0) return '重置机会暂不可用';
    if (value === 0) return '暂无重置机会';
    return `${value > 99 ? '99+' : value} 次重置机会`;
  }

  function detailParts(text, type) {
    if (type === 'time') {
      const parts = text.split(' · ');
      return parts.length === 2
        ? { primary: parts[0], separator: ' · ', secondary: parts[1] }
        : { primary: text, separator: '', secondary: '' };
    }
    const match = text.match(/^(99\+|\d+) 次(重置机会)$/u);
    return match
      ? { primary: `${match[1]} 次`, separator: '', secondary: match[2] }
      : { primary: text, separator: '', secondary: '' };
  }

  function renderDetail(node, text, type) {
    if (!node) return;
    if (typeof node.replaceChildren !== 'function') {
      node.textContent = text;
      return;
    }
    const parts = detailParts(text, type);
    const primary = document.createElement('span');
    const separator = document.createElement('span');
    const secondary = document.createElement('span');
    if (!primary || !separator || !secondary) {
      node.textContent = text;
      return;
    }
    primary.className = 'detail-primary';
    primary.textContent = parts.primary;
    separator.className = 'detail-separator';
    separator.textContent = parts.separator;
    secondary.className = 'detail-secondary';
    secondary.textContent = parts.secondary;
    node.replaceChildren(primary, separator, secondary);
  }

  let label;
  let status;
  let summary;
  let items;
  let overflow;
  let resetTime;
  let resetCredits;
  let compactProduct;
  let compactPeriod;
  let secondaryQuota;
  let secondaryPeriod;
  let secondaryValue;
  let secondaryProgress;
  let secondaryReset;
  let extraCredits;
  let creditsBalance;
  let creditsUnit;
  let root;
  let bridge;
  let expandedCard;
  try {
    root = document.documentElement;
    label = document.getElementById('quota-label');
    status = document.getElementById('status');
    summary = document.getElementById('summary');
    items = document.getElementById('items');
    overflow = document.getElementById('overflow');
    resetTime = document.getElementById('reset-time');
    resetCredits = document.getElementById('reset-credits');
    compactProduct = document.getElementById('compact-product');
    compactPeriod = document.getElementById('compact-period');
    secondaryQuota = document.getElementById('secondary-quota');
    secondaryPeriod = document.getElementById('secondary-period');
    secondaryValue = document.getElementById('secondary-value');
    secondaryProgress = document.getElementById('secondary-progress');
    secondaryReset = document.getElementById('secondary-reset');
    extraCredits = document.getElementById('extra-credits');
    creditsBalance = document.getElementById('credits-balance');
    creditsUnit = document.getElementById('credits-unit');
    bridge = window.petQuotaLabel;
    expandedCard = document.getElementById('codex-expanded');
  } catch (_) { return; }
  if (!label || !label.dataset || !status || !summary || typeof summary.replaceChildren !== 'function' ||
    !items || typeof items.replaceChildren !== 'function' ||
    !overflow || !bridge || typeof bridge.onModel !== 'function' ||
    !document || typeof document.createElement !== 'function') return;

  const node = (tag, className, text) => {
    const result = document.createElement(tag);
    result.className = className || '';
    if (text !== undefined) result.textContent = text;
    return result;
  };
  const countText = value => !Number.isSafeInteger(value) ? '—' : value > 99 ? '99+' : String(value);
  function detailButton(text, action, period, className = '') {
    const button = node('button', className, text);
    button.type = 'button';
    button.dataset.action = action;
    button.dataset.period = String(period);
    button.addEventListener?.('click', event => {
      event.stopPropagation();
      try { bridge.openDetail?.(action, period); } catch (_) {}
    });
    return button;
  }
  function renderExpanded(model) {
    if (!expandedCard?.replaceChildren) return;
    if (!model.items.length) { expandedCard.replaceChildren(); return; }
    const dual = model.items.length > 1;
    const header = node('div', 'v20-header');
    const brand = node('span', 'v20-brand');
    brand.replaceChildren(node('b', '', 'CODEX'), ...(!dual ? [node('span', 'period-pill', periodTypeText(model.items[0].windowMinutes))] : []));
    const headerTools = node('div', 'v20-header-tools');
    const collapse = node('button', 'v20-collapse', '⌃');
    if (document.createElementNS) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
      const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      chevron.setAttribute('d', 'M3 10.5L8 5.5L13 10.5');
      svg.appendChild(chevron); collapse.replaceChildren(svg);
    }
    collapse.type = 'button'; collapse.title = '收起额度卡片';
    collapse.setAttribute?.('aria-label', '收起额度卡片');
    collapse.addEventListener?.('click', event => {
      event.stopPropagation();
      try { bridge.toggleExpanded?.(); } catch (_) {}
    });
    headerTools.replaceChildren(node('span', 'v20-caption', '本周期剩余'), collapse);
    header.replaceChildren(brand, headerTools);
    const periods = node('div', dual ? 'v20-periods dual' : 'v20-periods');
    periods.replaceChildren(...model.items.map(item => {
      const cell = node('section', 'v20-period');
      cell.dataset.severity = severityOf(item.remaining);
      cell.setAttribute?.('aria-label', `${periodTypeText(item.windowMinutes)}，本周期剩余 ${Math.round(item.remaining)}%`);
      const valueRow = node('div', 'v20-value-row');
      const pace = node('span', `v20-pace ${item.pace.state}`, model.state === 'stale' ? '待更新'
        : ({ fast: dual ? '偏快' : '用量偏快', balanced: dual ? '均衡' : '节奏均衡', slow: dual ? '较慢' : '用量较慢', unknown: '待记录' }[item.pace.state]));
      pace.title = model.state === 'stale' ? '额度数据已过期' : item.pace.state === 'unknown' ? '记录不足，暂无法比较用量节奏' : '对比本周期剩余额度与剩余时间';
      const value = node('strong', 'v20-value', `${Math.round(item.remaining)}%`);
      value.title = severityText(item.remaining);
      valueRow.replaceChildren(value, pace);
      const progress = node('progress', 'v20-progress');
      progress.max = 100; progress.value = item.remaining; labelProgress(progress, item);
      const reset = node('p', 'v20-reset');
      const parts = resetTimeText(model, item).split(' · ');
      reset.title = resetTimeText(model, item);
      reset.replaceChildren(node('span', '', parts[0]), ...(!dual && parts[1] ? [node('span', 'v20-date', parts[1])] : []));
      cell.replaceChildren(...(dual ? [node('div', 'v20-cell-label', '')] : []), valueRow, progress, reset);
      if (dual) cell.children[0].replaceChildren(node('span', 'period-pill', periodTypeText(item.windowMinutes)));
      return cell;
    }));
    const auxiliary = node('div', 'v20-auxiliary');
    const shared = node('div', 'v20-shared');
    const reset = detailButton('', 'opportunities', model.items[0].windowMinutes, 'v20-opportunities');
    const resetCount = node('b', 'v20-reset-count', Number.isSafeInteger(model.resetCreditsAvailable)
      ? `${countText(model.resetCreditsAvailable)} 次` : '暂未提供');
    resetCount.dataset.available = model.resetCreditsAvailable > 0 ? 'true' : 'false';
    reset.setAttribute?.('aria-label', Number.isSafeInteger(model.resetCreditsAvailable)
      ? `重置机会 ${model.resetCreditsAvailable} 次，查看详情` : '重置机会数量暂未提供，查看详情');
    reset.title = '查看重置机会详情';
    reset.replaceChildren(node('span', '', '重置机会 '), resetCount);
    if (document.createElementNS) {
      const clock = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      clock.setAttribute('class', 'v20-reset-clock');
      clock.setAttribute('viewBox', '0 0 16 16');
      clock.setAttribute('aria-hidden', 'true'); clock.setAttribute('focusable', 'false');
      const outline = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      outline.setAttribute('cx', '8'); outline.setAttribute('cy', '8'); outline.setAttribute('r', '5.8');
      const hands = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hands.setAttribute('d', 'M8 4.5V8L10.5 9.5');
      clock.appendChild(outline); clock.appendChild(hands); reset.appendChild(clock);
    }
    shared.replaceChildren(reset);
    if (model.extraCredits) {
      const credit = model.extraCredits;
      const text = credit.state === 'balance' ? creditBalanceText(credit.balance) : credit.state === 'none' ? '暂无' : credit.state === 'unlimited' ? '不限额' : '暂未提供';
      const balance = detailButton('', 'credits', model.items[0].windowMinutes, 'v20-credit');
      balance.title = credit.state === 'stale' ? '余额数据已过期，等待更新' : '账户剩余额度，与本周期额度分别统计';
      balance.setAttribute?.('aria-label', `剩余额度 ${text}${credit.state === 'balance' ? ' 点' : ''}，查看详情`);
      balance.replaceChildren(node('span', '', '剩余额度 '), node('b', 'v20-credit-balance', text));
      shared.appendChild(balance);
    }
    const links = node('nav', 'v20-links');
    links.setAttribute?.('aria-label', 'Codex 详情');
    const activity = node('div', 'v20-activity');
    const running = model.activity?.runningCount, unread = model.activity?.unreadCount;
    const tasks = detailButton('', 'tasks', model.items[0].windowMinutes);
    tasks.title = Number.isSafeInteger(running) ? '球球已观察到的进行中任务' : '任务状态暂未提供';
    tasks.setAttribute?.('aria-label', Number.isSafeInteger(running) ? `进行中任务 ${running} 项，查看任务` : '进行中任务数量暂未提供，查看任务');
    tasks.replaceChildren(node('span', '', '进行中'), node('b', 'v20-count', countText(running)));
    const results = detailButton('', 'results', model.items[0].windowMinutes, 'v20-unread');
    results.title = Number.isSafeInteger(unread) ? '球球本地记录的待查看结果' : '待查看结果暂未提供';
    results.setAttribute?.('aria-label', Number.isSafeInteger(unread) ? `待查看结果 ${unread} 项，查看结果` : '待查看结果数量暂未提供，查看结果');
    results.replaceChildren(node('span', '', '待查看'), node('b', 'v20-count', countText(unread)));
    activity.replaceChildren(tasks, results);
    const trend = detailButton('趋势', 'trend', model.items[0].windowMinutes, 'v20-trend');
    if (document.createElementNS) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M2 2V14H14M4 10L7 7L10 9L14 4');
      svg.appendChild(path); trend.replaceChildren(svg, node('span', '', '趋势'));
    }
    links.replaceChildren(activity, trend);
    auxiliary.replaceChildren(shared, links);
    expandedCard.replaceChildren(header, periods, auxiliary);
  }

  const render = value => {
    const model = safeModel(value);
    try {
      status.textContent = states.get(model.state);
      label.dataset.state = model.state;
      label.dataset.size = model.size;
      label.dataset.appearance = model.appearance;
      if (root?.dataset) root.dataset.appearance = model.appearance;
      label.dataset.expanded = model.expanded ? 'true' : 'false';
      label.dataset.hasItems = 'false';
      label.dataset.itemCount = '0';
      label.dataset.severity = 'normal';
      label.dataset.hasExtraCredits = model.extraCredits ? 'true' : 'false';
      label.dataset.status = model.state === 'ready' && model.extraCredits?.usageStatus === 'blocked' ? 'blocked'
        : model.state === 'ready' && model.extraCredits && model.items[0]?.remaining === 0 ? 'exhausted' : '';
      renderExpanded(model);
      const rows = [];
      let overallSeverity = 'normal';
      for (const [index, item] of model.items.entries()) {
        const row = document.createElement('li');
        const nameNode = document.createElement('span');
        const periodNode = document.createElement('span');
        const valueNode = document.createElement('span');
        const progressNode = document.createElement('progress');
        if (!row || !row.dataset || typeof row.replaceChildren !== 'function' ||
          !nameNode || !periodNode || !valueNode || !progressNode) continue;
        const severity = severityOf(item.remaining);
        row.dataset.severity = severity;
        row.dataset.role = index === 0 ? 'primary' : 'secondary';
        nameNode.className = 'quota-name';
        nameNode.textContent = item.label;
        periodNode.className = 'quota-period period-pill';
        periodNode.textContent = `${model.state === 'stale' ? '已过期 ' : ''}${periodText(item.windowMinutes)}`;
        valueNode.className = 'quota-value';
        renderValue(valueNode, item.remaining);
        progressNode.className = 'quota-progress';
        progressNode.max = 100;
        progressNode.value = item.remaining;
        labelProgress(progressNode, item);
        row.replaceChildren(nameNode, periodNode, valueNode, progressNode);
        if (model.extraCredits && index === 0) {
          valueNode.textContent = `${Math.round(item.remaining)}%`;
          const description = document.createElement('span');
          description.className = 'quota-description';
          description.textContent = label.dataset.status === 'blocked' ? '已达花费限制'
            : label.dataset.status === 'exhausted' ? '套餐额度已用尽' : '剩余额度';
          row.replaceChildren(nameNode, periodNode, valueNode, progressNode, description);
        }
        rows.push(row);
        if (severity === 'urgent' || (severity === 'low' && overallSeverity === 'normal')) overallSeverity = severity;
      }
      items.replaceChildren(...rows);
      const summaryItem = model.items[0];
      if (summary.dataset) summary.dataset.severity = label.dataset.status === 'blocked' ? 'urgent'
        : summaryItem ? severityOf(summaryItem.remaining) : 'normal';
      if (summaryItem) {
        const periodNode = document.createElement('span');
        const badgeNode = document.createElement('span');
        const periodLabelNode = document.createElement('span');
        const valueNode = document.createElement('span');
        periodNode.className = 'summary-period';
        badgeNode.className = 'summary-badge';
        badgeNode.textContent = periodBadgeText(summaryItem.windowMinutes);
        periodLabelNode.className = 'summary-period-label';
        periodLabelNode.textContent = label.dataset.status === 'blocked' ? '受限' : severityText(summaryItem.remaining) || '额度';
        periodNode.replaceChildren(badgeNode, periodLabelNode);
        valueNode.className = 'summary-value';
        valueNode.textContent = `${Math.round(summaryItem.remaining)}%`;
        summary.replaceChildren(periodNode, valueNode);
        if (compactProduct) compactProduct.textContent = 'CODEX';
        if (compactPeriod) compactPeriod.textContent = periodTypeText(summaryItem.windowMinutes);
      } else {
        summary.replaceChildren();
        if (compactProduct) compactProduct.textContent = 'CODEX';
        if (compactPeriod) compactPeriod.textContent = '';
      }
      label.dataset.hasItems = rows.length > 0 ? 'true' : 'false';
      label.dataset.itemCount = String(rows.length);
      label.dataset.severity = label.dataset.status === 'blocked' ? 'urgent' : rows.length > 0 ? overallSeverity : 'normal';
      overflow.textContent = '';
      renderDetail(resetTime, resetTimeText(model, summaryItem), 'time');
      renderDetail(resetCredits, resetCreditsText(model.resetCreditsAvailable), 'credits');
      const secondaryItem = model.items[1];
      if (secondaryQuota?.dataset) secondaryQuota.dataset.severity = secondaryItem
        ? severityOf(secondaryItem.remaining) : 'normal';
      if (secondaryItem && secondaryPeriod) secondaryPeriod.textContent = periodTypeText(secondaryItem.windowMinutes);
      else if (secondaryPeriod) secondaryPeriod.textContent = '';
      if (secondaryItem) renderValue(secondaryValue, secondaryItem.remaining);
      else if (secondaryValue) secondaryValue.textContent = '';
      if (secondaryProgress) {
        secondaryProgress.max = 100;
        secondaryProgress.value = secondaryItem ? secondaryItem.remaining : 0;
        if (secondaryItem) labelProgress(secondaryProgress, secondaryItem);
      }
      if (secondaryItem && secondaryReset) secondaryReset.textContent = resetTimeText(model, secondaryItem);
      else if (secondaryReset) secondaryReset.textContent = '';
      if (extraCredits && creditsBalance && creditsUnit) {
        const credits = model.extraCredits;
        const hasBalance = credits?.state === 'balance';
        const text = hasBalance ? creditBalanceText(credits.balance)
          : credits?.state === 'none' ? '暂无额外点数' : credits?.state === 'unlimited' ? '不限额' : '暂不可用';
        creditsBalance.textContent = credits ? text : '';
        creditsUnit.textContent = hasBalance ? '点' : '';
        creditsUnit.hidden = !hasBalance;
        if (extraCredits.dataset) extraCredits.dataset.kind = hasBalance ? 'balance' : 'text';
        extraCredits.title = credits?.state === 'stale' ? '额外点数数据已过期，等待更新；当前余额暂不可用。'
          : hasBalance ? `额外点数余额：${credits.balance} 点。与套餐额度、重置机会分别统计。` : credits ? `额外点数：${text}` : '';
      }
    } catch (_) {}
  };

  if (typeof label.addEventListener === 'function' && typeof bridge.toggleExpanded === 'function') {
    try {
      label.addEventListener('click', () => {
        if (label.dataset.hasItems !== 'true') return;
        try { bridge.toggleExpanded(); } catch (_) {}
      });
    } catch (_) {}
  }

  let unsubscribe = null;
  try {
    const candidate = bridge.onModel(render);
    if (typeof candidate === 'function') unsubscribe = candidate;
  } catch (_) { return; }
  if (unsubscribe && typeof window.addEventListener === 'function') {
    try {
      window.addEventListener('beforeunload', () => {
        try { unsubscribe(); } catch (_) {}
      });
    } catch (_) {}
  }
})();
