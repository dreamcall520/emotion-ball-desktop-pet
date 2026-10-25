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

  function bucketFields(item, sourceId) {
    if (sourceId !== 'zcode') return {};
    try { return {
      planName: cleanText(item.planName),
      bucketId: typeof item.bucketId === 'string' && /^[^\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]{1,400}$/u.test(item.bucketId) ? item.bucketId : '',
      periodKind: ['one_time', 'expiry', 'daily', 'rolling', 'weekly', 'monthly', 'unknown'].includes(item.periodKind) ? item.periodKind : 'unknown',
      periodStart: Number.isSafeInteger(item.periodStart) && item.periodStart > 0 ? item.periodStart : null,
      total: Number.isFinite(item.total) && item.total >= 0 ? item.total : null,
      remainingUnits: Number.isFinite(item.remainingUnits) && item.remainingUnits >= 0 ? item.remainingUnits : null,
      unit: typeof item.unit === 'string' ? item.unit.replace(/[^a-zA-Z\u4e00-\u9fff]/gu, '').slice(0, 16) : ''
    }; } catch (_) { return {}; }
  }

  function copyItem(value, sourceId = 'codex') {
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
    if (!itemLabel || (sourceId === 'zcode' ? windowMinutes !== null && (!Number.isFinite(windowMinutes) || windowMinutes <= 0) : !Number.isSafeInteger(windowMinutes) || windowMinutes <= 0) ||
      typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || remaining > 100) return null;
    return {
      label: itemLabel,
      windowMinutes,
      remaining,
      ...bucketFields(item, sourceId),
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

  function copyItems(value, sourceId = 'codex') {
    try { if (!Array.isArray(value)) return []; } catch (_) { return []; }
    let length;
    try { length = value.length; } catch (_) { return []; }
    const limit = Number.isSafeInteger(length) && length >= 0 ? Math.min(length, sourceId === 'zcode' ? 32 : 2) : 0;
    const items = [];
    for (let index = 0; index < limit; index += 1) {
      let raw;
      try { raw = value[index]; } catch (_) { continue; }
      const item = copyItem(raw, sourceId);
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

  function numberFields(source) {
    try {
      if (source.display !== 'numbers') return {};
      const rawPeriods = source.numberPeriods;
      const periods = Array.isArray(rawPeriods) && rawPeriods.length <= 2
        ? [...new Set(rawPeriods.filter(value => ['fiveHour', 'weekly'].includes(value)))] : [];
      const colors = record(source.numberColors);
      const bodyColor = colors?.bodyColor, glowPinkColor = colors?.glowPinkColor, shape = colors?.shape;
      return { display: 'numbers', numberPeriods: periods.length ? periods : ['fiveHour'], numberColors: {
        shape: shape === 'aurora-cloud' ? 'aurora-cloud' : 'blob',
        bodyColor: typeof bodyColor === 'string' && /^#[\da-f]{6}$/i.test(bodyColor) ? bodyColor : '#EEEBE4',
        glowPinkColor: typeof glowPinkColor === 'string' && /^#[\da-f]{6}$/i.test(glowPinkColor) ? glowPinkColor : '#D05ED6'
      } };
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
    const sourceId = source.sourceId === 'zcode' ? 'zcode' : 'codex';
    const state = states.has(stateValue) ? stateValue : 'disconnected';
    const identity = sourceId === 'zcode' ? { sourceId: 'zcode' } : {};
    const size = sizeValue === 'compact' ? 'compact' : 'standard';
    const appearance = ['light', 'dark'].includes(appearanceValue) ? appearanceValue : 'system';
    const numbers = numberFields(source);
    const expanded = numbers.display !== 'numbers' && expandedValue === true;
    if (!['ready', 'stale'].includes(state)) return { ...identity, state, items: [], overflow: 0, size, appearance, expanded: false, ...numbers };
    let rawItems;
    let overflowValue;
    let resetCreditsAvailable;
    try {
      rawItems = source.items;
      overflowValue = source.overflow;
      resetCreditsAvailable = source.resetCreditsAvailable;
    } catch (_) { return { ...identity, state, items: [], overflow: 0, size, appearance, expanded, ...numbers }; }
    const hidden = Number.isSafeInteger(overflowValue) && overflowValue > 0
      ? Math.min(overflowValue, 99) : 0;
    return {
      ...identity,
      state,
      ...numbers,
      items: copyItems(rawItems, sourceId),
      overflow: hidden,
      size,
      appearance,
      expanded,
      ...activityFields(source),
      ...(sourceId === 'zcode' ? {} : extraCreditsFields(source, state)),
      ...(sourceId !== 'zcode' && Number.isSafeInteger(resetCreditsAvailable) && resetCreditsAvailable >= 0
        ? { resetCreditsAvailable } : {})
    };
  }

  const itemPeriod = (model, item) => model.sourceId === 'zcode' ? item.bucketId : item.windowMinutes;
  const shortPlanName = item => /^(?:ZCode\s*)?Start\s*Plan(?:$|[\s：:])/i.test(item.planName) && item.periodKind === 'daily' ? '每日体验'
    : /^(?:ZCode\s*)?1024\s*(?:Dev\s*Day|活动)(?:$|[\s：:])/i.test(item.planName) && ['one_time', 'expiry'].includes(item.periodKind) ? '1024活动' : item.planName;
  const itemTitle = item => item.bucketId ? item.planName && !item.label.includes(item.planName) ? `${item.planName} · ${item.label}` : item.label : periodTypeText(item.windowMinutes);

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

  function remainingText(remaining, sourceId = 'codex') {
    if (sourceId !== 'zcode') return `${Math.round(remaining)}%`;
    if (remaining > 0 && remaining < .05) return '<0.1%';
    if (remaining >= 99.95 && remaining < 100) return '<100%';
    return `${Number.isInteger(remaining) ? remaining : Number(remaining.toFixed(1))}%`;
  }

  function renderValue(node, remaining, sourceId = 'codex') {
    if (!node) return;
    const percentage = remainingText(remaining, sourceId);
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

  function labelProgress(node, item, sourceId = 'codex') {
    if (!node || typeof node.setAttribute !== 'function') return;
    const state = severityText(item.remaining);
    node.setAttribute('aria-label', `${itemTitle(item)}剩余额度`);
    node.setAttribute('aria-valuetext', `${remainingText(item.remaining, sourceId)}${state ? `，${state}` : ''}`);
  }

  function resetTimeText(model, item = model.items[0]) {
    const verb = model.sourceId === 'zcode' ? ({ one_time: '到期', expiry: '到期', daily: '刷新', monthly: '刷新', rolling: '重置', weekly: '重置' }[item?.periodKind] || '有效期更新') : '重置';
    if (model.state === 'stale') return `${verb}时间待额度更新`;
    const now = Date.now();
    const resetsAt = Number.isSafeInteger(item?.resetsAt) && item.resetsAt > now ? item.resetsAt : null;
    if (!resetsAt) return `${verb}时间暂不可用`;
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
    return `${relative}后${verb} · ${exact}`;
  }

  function zcodeExpandedTime(model, item, dual) {
    const verb = ({ one_time: '到期', expiry: '到期', daily: '刷新', monthly: '刷新', rolling: '重置', weekly: '重置' }[item.periodKind] || '截止');
    if (model.state === 'stale') return { text: `${verb}时间待更新`, title: resetTimeText(model, item) };
    if (!Number.isSafeInteger(item.resetsAt) || item.resetsAt <= Date.now()) return { text: `${verb}时间暂不可用`, title: resetTimeText(model, item) };
    const date = new Date(item.resetsAt), today = new Date(), tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const sameDay = day => date.getFullYear() === day.getFullYear() && date.getMonth() === day.getMonth() && date.getDate() === day.getDate();
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const day = sameDay(today) ? '今天' : sameDay(tomorrow) ? '明天' : `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    return { text: `${day}${!dual || sameDay(today) || sameDay(tomorrow) ? ` ${time}` : ''}${verb}`,
      title: `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${time} ${verb}（本机时间）` };
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
  let quotaNumbers;
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
    quotaNumbers = document.getElementById('quota-numbers');
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
  function compactReading(minutes, text, caption, badge = null) {
    const period = node('span', 'summary-period');
    period.replaceChildren(node('span', 'summary-badge', badge || periodBadgeText(minutes)),
      node('span', 'summary-period-label', caption));
    return [period, node('span', 'summary-value', text)];
  }
  function renderNumbers(model) {
    if (!quotaNumbers?.replaceChildren) return;
    const periods = model.items.length ? model.numberPeriods.filter(period =>
      model.items.some(item => item.windowMinutes === (period === 'weekly' ? 10080 : 300))) : model.numberPeriods;
    const single = periods.length === 1;
    label.dataset.readings = String(periods.length);
    const readings = periods.map(period => {
      const minutes = period === 'weekly' ? 10080 : 300;
      const item = model.state === 'ready' ? model.items.find(item => item.windowMinutes === minutes) : null;
      const text = item ? remainingText(item.remaining, model.sourceId) : '—';
      const button = detailButton('', 'trend', minutes, 'quota-reading');
      button.setAttribute?.('aria-label', `${periodTypeText(minutes)}${item ? `剩余 ${text}` : '额度暂不可用'}，查看详情`);
      button.title = model.state === 'stale' ? '额度已过期，等待更新' : `查看${periodTypeText(minutes)}详情`;
      if (single) {
        const [periodNode, valueNode] = compactReading(minutes, text, item ? severityText(item.remaining) || '额度' : '额度');
        valueNode.className += ' quota-reading-value';
        button.replaceChildren(periodNode, valueNode);
      } else button.replaceChildren(node('span', 'summary-badge', periodBadgeText(minutes)),
        node('strong', 'summary-value quota-reading-value', text));
      return button;
    });
    quotaNumbers.replaceChildren(...readings);
  }
  function renderExpanded(model) {
    if (!expandedCard?.replaceChildren) return;
    if (!model.items.length) { expandedCard.replaceChildren(); return; }
    const dual = model.items.length > 1;
    const showHeading = dual || model.sourceId === 'zcode';
    const header = node('div', 'v20-header');
    const brand = node('span', 'v20-brand');
    brand.replaceChildren(node('b', '', model.sourceId === 'zcode' ? 'ZCODE' : 'CODEX'), ...(!dual && model.sourceId !== 'zcode' ? [node('span', 'period-pill', itemTitle(model.items[0]))] : []));
    if (model.sourceId === 'zcode') brand.title = itemTitle(model.items[0]);
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
      const cell = model.sourceId === 'zcode'
        ? detailButton('', 'trend', item.bucketId, 'v20-period') : node('section', 'v20-period');
      if (model.sourceId === 'zcode') cell.title = `查看 ${itemTitle(item)} 的额度趋势`;
      cell.dataset.severity = severityOf(item.remaining);
      cell.setAttribute?.('aria-label', `${itemTitle(item)}，本周期剩余 ${remainingText(item.remaining, model.sourceId)}${model.sourceId === 'zcode' ? '，查看该额度趋势' : ''}`);
      const valueRow = node('div', 'v20-value-row');
      const pace = node('span', `v20-pace ${item.pace.state}`, model.state === 'stale' ? '待更新'
        : ({ fast: dual ? '偏快' : '用量偏快', balanced: dual ? '均衡' : '节奏均衡', slow: dual ? '较慢' : '用量较慢', unknown: '待记录' }[item.pace.state]));
      pace.title = model.state === 'stale' ? '额度数据已过期' : item.pace.state === 'unknown' ? '记录不足，暂无法比较用量节奏' : '对比本周期剩余额度与剩余时间';
      const value = node('strong', 'v20-value', remainingText(item.remaining, model.sourceId));
      value.title = severityText(item.remaining);
      valueRow.replaceChildren(value, ...(model.sourceId === 'zcode' && model.state !== 'stale' ? [] : [pace]));
      const progress = node('progress', 'v20-progress');
      progress.max = 100; progress.value = item.remaining; labelProgress(progress, item, model.sourceId);
      const reset = node('p', 'v20-reset');
      const parts = resetTimeText(model, item).split(' · ');
      const zcodeTime = model.sourceId === 'zcode' ? zcodeExpandedTime(model, item, dual) : null;
      reset.title = zcodeTime ? zcodeTime.title : resetTimeText(model, item);
      reset.replaceChildren(node('span', '', zcodeTime ? zcodeTime.text : parts[0]), ...(!zcodeTime && !dual && parts[1] ? [node('span', 'v20-date', parts[1])] : []));
      cell.replaceChildren(...(showHeading ? [node('div', 'v20-cell-label', '')] : []), valueRow, progress, reset);
      if (showHeading) {
        const heading = cell.children[0];
        heading.title = itemTitle(item);
        heading.replaceChildren(...(model.sourceId === 'zcode' && item.planName ? [node('span', 'v20-plan-name', shortPlanName(item))] : []),
          node('span', 'period-pill', model.sourceId === 'zcode' ? item.label : itemTitle(item)));
      }
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
    if (model.sourceId === 'zcode') {
      const quotaEntry = detailButton('', 'quota', model.items[0].bucketId, 'v20-quota-entry');
      quotaEntry.title = '查看各套餐与模型的额度明细';
      quotaEntry.setAttribute?.('aria-label', quotaEntry.title);
      const arrow = node('span', 'v20-entry-arrow', '›'); arrow.setAttribute?.('aria-hidden', 'true');
      quotaEntry.replaceChildren(node('span', '', '查看额度明细'), arrow);
      shared.replaceChildren(quotaEntry);
    } else shared.replaceChildren(reset);
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
    links.setAttribute?.('aria-label', model.sourceId === 'zcode' ? 'ZCode 详情' : 'Codex 详情');
    const activity = node('div', 'v20-activity');
    const running = model.activity?.runningCount, unread = model.activity?.unreadCount;
    const tasks = detailButton('', 'tasks', itemPeriod(model, model.items[0]));
    tasks.title = Number.isSafeInteger(running) ? '球球已观察到的进行中任务' : '任务状态暂未提供';
    tasks.setAttribute?.('aria-label', Number.isSafeInteger(running) ? `进行中任务 ${running} 项，查看任务` : '进行中任务数量暂未提供，查看任务');
    tasks.replaceChildren(node('span', '', '进行中'), node('b', 'v20-count', countText(running)));
    const results = detailButton('', 'results', itemPeriod(model, model.items[0]), 'v20-unread');
    results.title = Number.isSafeInteger(unread) ? '球球本地记录的待查看结果' : '待查看结果暂未提供';
    results.setAttribute?.('aria-label', Number.isSafeInteger(unread) ? `待查看结果 ${unread} 项，查看结果` : '待查看结果数量暂未提供，查看结果');
    results.replaceChildren(node('span', '', '待查看'), node('b', 'v20-count', countText(unread)));
    activity.replaceChildren(tasks, results);
    const trend = detailButton('趋势', 'trend', itemPeriod(model, model.items[0]), 'v20-trend');
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
      status.textContent = model.sourceId === 'zcode' ? states.get(model.state).replaceAll('Codex', 'ZCode') : states.get(model.state);
      label.dataset.source = model.sourceId || 'codex';
      document.title = model.sourceId === 'zcode' ? 'ZCode 剩余额度' : 'Codex 剩余额度';
      if (model.sourceId === 'zcode') {
        label.title = `ZCode 剩余额度${model.items.length ? '：' + model.items.map(item => `${itemTitle(item)}，剩余 ${remainingText(item.remaining, model.sourceId)}`).join('；') : ''}`;
        label.setAttribute?.('aria-label', label.title);
      } else label.setAttribute?.('aria-label', 'Codex 剩余额度');
      expandedCard?.setAttribute?.('aria-label', model.sourceId === 'zcode' ? 'ZCode 额度与状态' : 'Codex 额度与状态');
      label.dataset.state = model.state;
      label.dataset.display = model.display === 'numbers' ? 'numbers' : 'card';
      label.dataset.size = model.size;
      label.dataset.appearance = model.appearance;
      label.dataset.expanded = model.expanded ? 'true' : 'false';
      label.dataset.hasItems = 'false';
      label.dataset.itemCount = '0';
      label.dataset.severity = 'normal';
      label.dataset.hasExtraCredits = model.extraCredits ? 'true' : 'false';
      label.dataset.status = model.state === 'ready' && model.extraCredits?.usageStatus === 'blocked' ? 'blocked'
        : model.state === 'ready' && model.extraCredits && model.items[0]?.remaining === 0 ? 'exhausted' : '';
      if (model.display === 'numbers') { renderNumbers(model); return; }
      quotaNumbers?.replaceChildren();
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
        nameNode.textContent = model.sourceId === 'zcode' && model.size === 'standard'
          ? ({ 'GLM-5.3': '5.3', 'GLM-5.3-Flash': '5.3 Flash' }[item.label] || item.label) : item.label;
        if (model.sourceId === 'zcode') nameNode.setAttribute?.('aria-label', item.label);
        if (model.sourceId === 'zcode') nameNode.title = itemTitle(item);
        periodNode.className = 'quota-period period-pill';
        periodNode.textContent = `${model.state === 'stale' ? '已过期 ' : ''}${model.sourceId === 'zcode' && item.planName ? shortPlanName(item) : model.sourceId === 'zcode' ? ({one_time:'活动',expiry:'活动',daily:'每日',monthly:'每月',weekly:'每周',rolling:'周期'}[item.periodKind] || '有效期') : periodText(item.windowMinutes)}`;
        if (model.sourceId === 'zcode') periodNode.title = item.planName || itemTitle(item);
        valueNode.className = 'quota-value';
        renderValue(valueNode, item.remaining, model.sourceId);
        progressNode.className = 'quota-progress';
        progressNode.max = 100;
        progressNode.value = item.remaining;
        labelProgress(progressNode, item, model.sourceId);
        row.replaceChildren(nameNode, periodNode, valueNode, progressNode);
        if (model.extraCredits && index === 0) {
          valueNode.textContent = remainingText(item.remaining, model.sourceId);
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
        summary.replaceChildren(...compactReading(summaryItem.windowMinutes, remainingText(summaryItem.remaining, model.sourceId),
          model.sourceId === 'zcode' ? '额度' : label.dataset.status === 'blocked' ? '受限' : severityText(summaryItem.remaining) || '额度', model.sourceId === 'zcode' ? 'Z' : null));
        if (compactProduct) compactProduct.textContent = model.sourceId === 'zcode' ? 'ZCODE' : 'CODEX';
        if (compactPeriod) compactPeriod.textContent = itemTitle(summaryItem);
      } else {
        summary.replaceChildren();
        if (compactProduct) compactProduct.textContent = model.sourceId === 'zcode' ? 'ZCODE' : 'CODEX';
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
      if (secondaryItem) renderValue(secondaryValue, secondaryItem.remaining, model.sourceId);
      else if (secondaryValue) secondaryValue.textContent = '';
      if (secondaryProgress) {
        secondaryProgress.max = 100;
        secondaryProgress.value = secondaryItem ? secondaryItem.remaining : 0;
        if (secondaryItem) labelProgress(secondaryProgress, secondaryItem, model.sourceId);
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
        if (label.dataset.display === 'numbers') return;
        if (label.dataset.hasItems !== 'true') return;
        try { bridge.toggleExpanded(); } catch (_) {}
      });
    } catch (_) {}
  }

  let pointerInteractive = null;
  if (typeof document.addEventListener === 'function' && typeof bridge.setPointerInteractive === 'function') {
    const interactive = value => { if (pointerInteractive !== value) {
      pointerInteractive = value; bridge.setPointerInteractive(value);
    } };
    document.addEventListener('mousemove', event => {
      const hit = event.target?.closest?.('#quota-beam, #quota-guard-entry');
      interactive(Boolean(hit && !hit.hidden && !hit.disabled));
    });
    document.addEventListener('mouseleave', () => interactive(false));
  }
  let unsubscribe = null;
  try {
    const candidate = bridge.onModel(value => { pointerInteractive = null; render(value); });
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
