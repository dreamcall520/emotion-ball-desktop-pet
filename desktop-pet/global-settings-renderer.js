(() => {
  const api = window.qiuqiuSettings;
  const $ = id => document.getElementById(id);
  // Render the original character, with its real silhouette, lighting and eyes.
  const source = window.EmotionBall.config.get('02').raw;
  window.EmotionBall.config.register({ ...source, id: '50', name: '设置页球球', group: 'custom', antics: false, anims: [], pool: [0] });
  const brandPet = window.EmotionBall.create($('brand-pet'), {
    emotion: '50', fallbackId: '50', shape: 'blob', color: '#EEEBE4', eyeColor: '#1A1A1A',
    idle: false, autostart: false, lite: false, label: '经典球球'
  });
  window.addEventListener('beforeunload', () => brandPet.destroy(), { once: true });
  let feedbackTimer;
  function feedback(message) {
    clearTimeout(feedbackTimer); $('feedback').textContent = message;
    if (message) feedbackTimer = setTimeout(() => { $('feedback').textContent = ''; }, 3200);
  }
  let snapshot = null, selected = 'common', busy = false, last = '', request = 0, apiSectionRequested = false, codexTab = 'codex';
  let latestSleepState, quotaSectionRequested = false;
  const quotaCardsView = () => 'quota-cards';
  const isApiView = view => ['api', 'openai-api', '/codex-menu/openai-api-menu'].includes(view);
  const descriptions = {
    '外观（所有窗口）': '统一设置各功能窗口的浅色或深色外观。',
    '主题色': '调整功能窗口的强调色；球球本身的颜色请到「定制球球」修改。',
    '球球尺寸': '调整桌面上球球的显示大小。',
    '保持清醒': '关闭后，球球会根据系统空闲时间自动休息。',
    '互动气泡': '控制球球的对白与互动提示。',
    '始终置顶': '让球球保持在其他窗口上方。',
    '启用 WorkBuddy 联动': '只读本机当前 WorkBuddy 登录与积分；聊天仅在你发送消息后消耗积分。',
    '启用 Codex 联动': '读取本机 Codex 任务与额度；开启时会说明读取范围并请求确认。',
    '启用 ZCode 联动': '读取本机 ZCode 套餐、额度与任务；开启时会说明读取范围并请求确认，可在聊天中选择 ZCode。',
    '显示 ZCode 额度': '独立显示 ZCode 额度卡；隐藏卡片不关闭 ZCode 联动。',
    '启用 API 余额监控': '从 ZCode 已配置的 API 读取账户余额；目前支持 Kimi。只查询余额，不调用模型，也不保存密钥。',
    '管理 API 账户': '打开 ZCode，在其 API 设置中新增或修改账户；球球会自动发现配置变化。',
    '显示 API 余额卡': '在一张卡内切换多个账户，分别保留余额与趋势。',
    '刷新 API 余额': '更新当前选中账户；其他已支持账户在后台定期更新。',
    '显示 API 本月费用卡': 'API 统计独立于 Codex 订阅额度，需要连接管理员 Key。',
    '自动提醒新版本': '自动检查并提醒，不会自动下载安装。',
    '定制球球': '形象、配色、透明度、启动外观与额度展示样式。',
    '快捷键设置': '查看快捷键、修改组合键和快捷入口行为。',
    '番茄钟': '设置专注与休息时长、钟面和提醒。',
    '启用天气': '查询所选城市的天气预报与空气质量，关闭后停止后台刷新。',
    '显示天气卡': '与现有卡片一起排列，可排序、固定展示或收纳。',
    '天气与城市设置': '选择当前位置或固定城市，查看今天与未来7天预报。',
    '和球球聊聊': '打开聊天面板，选择模型、查看记录或继续聊天。'
  };
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  // Original 24px line icons, kept local to the settings navigation.
  const navigationIcons = {
    '和球球聊聊': ['M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-6 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M7 9h10M7 13h6'],
    '定制球球': ['M12 4a8 8 0 1 0 8 8', 'm15 4 2-2 5 5-2 2-5-5ZM15 4l-6 6-1 4 4-1 6-6'],

    '天气': ['M5 16a4 4 0 0 1 1-7.9A6 6 0 0 1 18 10a3 3 0 0 1 0 6H5Z', 'M18 3v2M22 7h-2M14 3l1 2'],
    '常用设置': ['m12 3 2.6 5.6 6.1.8-4.5 4.3 1.1 6.1-5.3-3-5.3 3 1.1-6.1-4.5-4.3 6.1-.8Z'],
    '番茄钟': ['M9 3h6M12 3v3M18 7l2-2', 'M12 6a8 8 0 1 0 0 16 8 8 0 0 0 0-16M12 10v4l-2 2'],
    '快捷键': ['M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z', 'M7 9h.01M12 9h.01M17 9h.01M7 12h.01M12 12h.01M17 12h.01M8 16h8'],
    '球球与互动': ['M8 4h8a5 5 0 0 1 5 5v4a5 5 0 0 1-5 5h-5l-5 3v-4a5 5 0 0 1-3-4V9a5 5 0 0 1 5-5Z', 'M8 10h.01M16 10h.01M9 13q3 3 6 0'],
    '便签与待办': ['M7 3h10a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z', 'M8 8h8M8 12h5M8 16l2 2 5-5'],
    '球球尺寸': ['M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5', 'M9 9h6v6H9Z'],
    '贴边与显示': ['M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z', 'M8 4v16M17 9l-3 3 3 3M14 12h4'],
    '界面配色': ['M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1.7 1.7 0 0 1 1.2-2.9H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z', 'M7 10h.01M10 7h.01M15 7h.01M18 10h.01'],
    'Codex': ['m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16'],
    'ZCode 联动': ['m5 5h14L5 19h14', 'M5 12h14'],
    '常规设置': ['M4 6h7M15 6h5M4 12h2M10 12h10M4 18h10M18 18h2', 'M11 4v4M6 10v4M14 16v4']
  };
  function navigationIcon(label) {
    const integration = { Codex: 'codex', 'ZCode 联动': 'zcode', WorkBuddy: 'workbuddy' }[label];
    if (integration) {
      const image = file => {
        const icon = el('img', '', 'nav-icon'); icon.src = `assets/integrations/${file}.png`;
        icon.alt = ''; icon.setAttribute('aria-hidden', 'true'); return icon;
      };
      if (integration !== 'codex') return image(integration);
      const icon = el('span', '', 'nav-icon nav-app-icon'); icon.setAttribute('aria-hidden', 'true');
      let [lightFile, darkFile] = snapshot?.codexIconPreference === 'app-default' ? ['codex-default', 'codex-default']
        : snapshot?.codexIconPreference === 'space-system' ? ['codex-space', 'codex-space-dark'] : ['codex', 'codex-dark'];
      if (typeof snapshot?.codexIconDark === 'boolean') lightFile = darkFile = snapshot.codexIconDark ? darkFile : lightFile;
      const light = image(lightFile), dark = image(darkFile);
      light.classList.add('codex-light-icon'); dark.classList.add('codex-dark-icon');
      icon.append(light, dark); return icon;
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'nav-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const data of navigationIcons[label] || navigationIcons['常规设置']) {
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', data); svg.append(path);
    }
    return svg;
  }
  const externalIds = new Set(['/chat-open', '/customize-open', '/pomodoro-open', '/about-open']);
  function groups() {
    const categories = snapshot.entries.filter(entry => entry.children).map(entry => ({
      ...entry, ...(entry.id === '/codex-menu' ? { label: 'Codex' } : {}),
      children: entry.children.filter(child => child.label !== '咩咩互动')
    }));
    const workbuddy = snapshot.entries.find(entry => entry.id === '/workbuddy-enabled');
    if (workbuddy) categories.push({ id: 'workbuddy-settings', label: 'WorkBuddy', children: snapshot.entries.filter(entry => /^\/workbuddy-(?:enabled|quota-visible|quota-fun)$/.test(entry.id)) });
    const weather = snapshot.entries.filter(entry => ['/weather-enabled', '/weather-open'].includes(entry.id));
    if (weather.length) categories.push({ id: 'weather-settings', label: '天气', children: weather });
    const general = categories.find(entry => entry.label === '常规设置');
    if (general) categories[categories.indexOf(general)] = { ...general, children: [...general.children,
      ...snapshot.entries.filter(entry => entry.id === '/update-check')] };
    return categories;
  }
  function externalIcon() {
    const icon = navigationIcon('常规设置');
    icon.setAttribute('class', 'external-icon');
    icon.replaceChildren();
    const path = document.createElementNS(icon.namespaceURI, 'path');
    path.setAttribute('d', 'M7 17 17 7M7 7h10v10'); icon.append(path);
    return icon;
  }
  function leaves(entry, trail = []) {
    if (entry.children?.length && entry.children.every(child => child.type === 'radio')) return [{ ...entry, type: 'select', choices: entry.children, trail }];
    if (entry.children) return entry.children.flatMap(child => leaves(child, [...trail, entry.label]));
    return [{ ...entry, trail }];
  }
  function codexStatus(entry) {
    const state = snapshot.codexStatus || {}, card = el('div', '', 'codex-status');
    card.append(el('h4', '连接与状态'));
    const values = el('dl', '', 'status-values');
    const add = (label, value) => { values.append(el('dt', label), el('dd', value)); };
    const connections = { disabled: '已关闭', connecting: '正在连接', connected: '已连接', missing: '未找到 Codex', unauthenticated: '未登录', unsupported: '暂不支持', disconnected: '未连接' };
    const date = value => Number.isFinite(value) && value >= 0 && value <= 8640000000000000
      ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '待更新';
    add('连接', connections[state.connection] || state.connection || '待更新');
    const quotas = Array.isArray(state.quota) ? state.quota : [];
    add('当前额度', quotas.length ? quotas.map(item => `${item.label || '额度'} ${Number.isFinite(item.remaining) && item.remaining >= 0 && item.remaining <= 100 ? `${Number(item.remaining.toFixed(1))}%` : '待更新'}`).join(' · ') : '待更新');
    add('重置时间', quotas.length ? quotas.map(item => `${item.label || '额度'} ${date(item.resetsAt)}`).join(' · ') : '待更新');
    add('上次更新', date(state.updatedAt));
    card.append(values);
    const tasks = state.tasks || {}, counts = ['active', 'waiting'].map(key => Number.isSafeInteger(tasks[key]) && tasks[key] >= 0 ? tasks[key] : '待更新');
    card.append(el('p', `本机最近任务 · 处理中 ${counts[0]} · 待确认 ${counts[1]}`, 'status-tasks'));
    const actions = el('div', '', 'status-actions');
    const all = snapshot.entries.flatMap(item => leaves(item));
    const task = all.find(item => item.id === state.taskActionId);
    const refresh = leaves(entry).find(item => item.id.endsWith('/codex-refresh'));
    for (const [item, label] of [[task, '打开任务'], [refresh, '刷新状态']]) {
      if (!item) continue;
      const button = el('button', label, 'action'); button.dataset.action = item.id;
      button.disabled = busy || !item.enabled; button.onclick = () => act(item); actions.append(button);
    }
    card.append(actions); return card;
  }
  function quotaCardSettings() {
    const section = el('section', '', 'group quota-card-settings');
    section.dataset.settingsSection = 'quota-cards';
    section.append(el('h3', '联动样式管理'), el('p', '调整各张卡的显示顺序。固定展示的卡不参与收纳，仍遵循各来源的联动与显示开关。', 'description group-intro'));
    const names = { codex: 'Codex', api: 'OpenAI API', zcode: 'ZCode', workbuddy: 'WorkBuddy', balance: 'API 余额', weather: '天气' };
    const config = snapshot.quotaCards || { order: Object.keys(names), pinned: [] };
    const displayIds = { codex: '/codex-menu/codex-quota-visible', api: '/codex-menu/openai-api-menu/openai-api-visible', zcode: '/zcode-menu/zcode-quota-visible', workbuddy: '/workbuddy-quota-visible', balance: '/api-balance-menu/api-balance-visible', weather: '/weather-visible' };
    const displayActions = snapshot.entries.flatMap(entry => leaves(entry));
    config.order.forEach((source, index) => {
      if (!names[source]) return;
      const row = el('div', '', 'row'); row.dataset.quotaCard = source; row.draggable = !busy;
      const heading = el('div', '', 'quota-card-name');
      const handle = el('span', '⠿', 'quota-card-drag-handle'); handle.setAttribute('aria-hidden', 'true'); handle.title = '拖拽调整顺序';
      heading.append(handle, el('span', names[source], 'row-title')); row.append(heading);
      let dragFromControl = false;
      row.addEventListener('pointerdown', event => { dragFromControl = Boolean(event.target.closest?.('button,input,label')); });
      row.addEventListener('dragstart', event => {
        if (busy || dragFromControl || event.target.closest?.('button,input,label')) { event.preventDefault(); return; }
        event.dataTransfer.setData('application/x-qiuqiu-quota-card', source); event.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => section.querySelectorAll('.dragging,.drag-over').forEach(node => node.classList.remove('dragging', 'drag-over')));
      row.addEventListener('dragover', event => {
        if (busy || !Array.from(event.dataTransfer.types).includes('application/x-qiuqiu-quota-card')) return;
        event.preventDefault(); event.dataTransfer.dropEffect = 'move'; row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', event => { if (!row.contains(event.relatedTarget)) row.classList.remove('drag-over'); });
      row.addEventListener('drop', event => {
        event.preventDefault(); row.classList.remove('drag-over');
        const moved = event.dataTransfer.getData('application/x-qiuqiu-quota-card');
        if (busy || moved === source || !config.order.includes(moved)) return;
        const order = config.order.filter(id => id !== moved); order.splice(index, 0, moved);
        saveQuotaCards({ order, pinned: [...config.pinned] });
      });
      const controls = el('div', '', 'quota-card-controls');
      for (const [label, offset] of [['上移', -1], ['下移', 1]]) {
        const button = el('button', label, 'action'); button.setAttribute('aria-label', `${names[source]}${label}`);
        button.disabled = busy || index + offset < 0 || index + offset >= config.order.length;
        button.onclick = () => { const order = [...config.order]; [order[index], order[index + offset]] = [order[index + offset], order[index]]; saveQuotaCards({ order, pinned: [...config.pinned] }); };
        controls.append(button);
      }
      const visibility = displayActions.find(item => item.id === displayIds[source]);
      const displayLabel = el('label', '', 'quota-card-pin'); const displayCheckbox = el('input'); displayCheckbox.type = 'checkbox';
      displayCheckbox.checked = visibility?.checked === true; displayCheckbox.disabled = busy || !visibility?.enabled;
      const displayText = source === 'weather' ? '显示天气卡' : '显示额度卡';
      displayCheckbox.setAttribute('aria-label', source === 'weather' ? displayText : `${names[source]}${displayText}`);
      if (visibility) displayCheckbox.dataset.action = visibility.id;
      if (!visibility?.enabled) displayLabel.title = visibility ? '请先开启该来源的联动。' : '当前来源设置暂不可用。';
      displayCheckbox.onchange = () => { if (visibility?.enabled) act(visibility); };
      displayLabel.append(displayCheckbox, document.createTextNode(displayText)); controls.append(displayLabel);
      const label = el('label', '', 'quota-card-pin'); const checkbox = el('input'); checkbox.type = 'checkbox';
      checkbox.checked = config.pinned.includes(source); checkbox.disabled = busy; checkbox.setAttribute('aria-label', `${names[source]}固定展示`);
      checkbox.onchange = () => saveQuotaCards({ order: [...config.order], pinned: checkbox.checked ? [...config.pinned, source] : config.pinned.filter(value => value !== source) });
      label.append(checkbox, document.createTextNode('固定展示')); controls.append(label); row.append(controls); section.append(row);
    });
    return section;
  }
  async function saveQuotaCards(config) {
    if (busy) return;
    busy = true; request++; feedback(''); render();
    try {
      const result = await api.saveQuotaCards(config);
      if (result?.snapshot) { snapshot = result.snapshot; if (latestSleepState !== undefined) snapshot.petSleepState = latestSleepState; }
      if (result?.config) snapshot.quotaCards = result.config;
      last = JSON.stringify(snapshot); feedback(result?.error || (result?.ok ? '额度卡设置已更新' : '保存未完成，已保留原设置。'));
    } catch (_) { feedback('保存未完成，已保留原设置。'); }
    finally { busy = false; render(); }
  }
  function render() {
    if (!snapshot) return;
    const focusId = document.activeElement?.dataset?.action;
    $('version').textContent = `球球 v${snapshot.version} · 本地设置`;
    const categories = groups();
    const nav = [{ id: 'common', label: '常用设置' }, ...categories,
      { id: 'shortcuts', label: '快捷键' }, { id: 'quota-cards', label: '联动样式管理' },
      ...snapshot.entries.filter(entry => externalIds.has(entry.id)).map(entry => ({ ...entry,
        label: ({ '/chat-open': '和球球聊聊', '/customize-open': '定制球球' })[entry.id] || entry.label, external: true }))];
    if (!nav.some(item => item.id === selected)) selected = 'common';
    const selectView = id => {
      selected = id; if (id === '/codex-menu') codexTab = 'codex'; $('search').value = ''; $('search-panel').hidden = true;
      $('search-toggle').setAttribute('aria-expanded', 'false'); $('feedback').textContent = '';
      render(); document.querySelector('main').scrollTop = 0;
    };
    const navigationGroups = [
      ['', ['常用设置']],
      ['日常陪伴', ['球球与互动', '和球球聊聊', '便签与待办', '番茄钟']],
      ['外观与显示', ['定制球球', '球球尺寸', '贴边与显示', '界面配色', '天气']],
      ['应用与联动', ['Codex', 'ZCode 联动', 'WorkBuddy', 'API 余额', '联动样式管理']],
      ['快捷与常规', ['快捷键', '常规设置']]
    ];
    $('navigation').replaceChildren(...navigationGroups.map(([label, labels]) => {
      const section = el('div', '', 'nav-group');
      section.setAttribute('role', 'group'); section.setAttribute('aria-label', label || '快捷导航');
      if (label) section.append(el('div', label, 'nav-group-title'));
      for (const name of labels) {
        const item = nav.find(category => category.label === name);
        if (!item) continue;
        const button = el('button');
        button.dataset.view = item.id;
        const iconLabel = item.label;
        button.append(navigationIcon(iconLabel), el('span', item.label));
        if (item.external) { button.append(externalIcon()); button.title = '在独立窗口打开'; button.setAttribute('aria-label', `${item.label}（独立窗口）`); button.disabled = busy || !item.enabled; }
        if (selected === item.id) button.setAttribute('aria-current', 'page');
        button.onclick = () => item.external ? act(item) : selectView(item.id);
        section.append(button);
      }
      return section;
    }));
    $('about-link').disabled = busy;
    $('about-link').onclick = () => act(snapshot.entries.find(entry => entry.id === '/about-open'));
    const appearance = snapshot.entries.find(item => item.id === '/color-mode')?.children.find(item => item.id.endsWith('/color-appearance'));
    $('appearance-switch').replaceChildren(...(appearance?.children || []).map(item => {
      const button = el('button', item.label);
      button.setAttribute('aria-pressed', String(item.checked));
      button.setAttribute('aria-label', `界面外观：${item.label}`);
      button.dataset.action = `header:${item.id}`;
      button.disabled = busy || !item.enabled;
      button.onclick = () => act(item);
      return button;
    }));
    const query = $('search').value.trim().toLocaleLowerCase();
    $('section-title').textContent = query ? '搜索结果' : nav.find(item => item.id === selected).label;
    const sections = [];
    let count = 0;
    const allEntries = snapshot.entries.flatMap(entry => entry.children ? entry.children : []);
    const commonGroups = [
      { id: 'common', label: '日常陪伴', children: allEntries.filter(entry => ['保持清醒', '互动气泡', '始终置顶'].includes(entry.label)) },
      { id: 'common', label: '外观与感受', children: allEntries.filter(entry => ['外观（所有窗口）', '主题色', '色弱友好（增强对比度）'].includes(entry.label)).concat(snapshot.entries.filter(entry => entry.label === '球球尺寸')) },
      { id: 'common', label: '应用偏好', children: allEntries.filter(entry => entry.label === '自动提醒新版本') }
    ];
    const shortcutApi = { ...api, saveShortcuts: async config => {
      const result = await api.saveShortcuts(config);
      request++;
      if (result?.config) { snapshot.shortcuts = result.config; last = JSON.stringify(snapshot); }
      return result;
    } };
    if (!query && selected === 'shortcuts') {
      $('empty').hidden = true;
      window.renderSettingsShortcuts($('content'), snapshot.shortcuts, shortcutApi); return;
    }
    const searchable = [...categories, { id: 'shortcuts', label: '快捷键', children: snapshot.entries.filter(entry => entry.id === '/shortcut-settings') }, { id: 'windows', label: '独立功能', children: snapshot.entries.filter(entry => externalIds.has(entry.id)) }];
    const displayed = (query ? searchable : selected === 'common' ? commonGroups : categories).flatMap(category => {
      if (!['/codex-menu', '/zcode-menu', 'workbuddy-settings'].includes(category.id)) return [category];
      const apiGroup = category.id === '/codex-menu' && category.children.find(child => child.id.endsWith('/openai-api-menu'));
      const apiSections = apiGroup && (query || codexTab === 'api') ? [{ ...category, heading: 'OpenAI API', section: 'openai-api',
        introduction: 'API 费用独立于 Codex 订阅额度，按使用量单独计费；连接配置需要管理员 Key。', children: apiGroup.children }] : [];
      if (category.id === '/codex-menu' && !query && codexTab === 'api') return apiSections;
      const enable = category.children.find(child => /\/(?:codex|zcode|workbuddy)-enabled$/.test(child.id));
      if (!enable) return apiSections;
      const sections = [{ ...category, heading: '启用联动', children: [enable] }];
      if (enable.checked !== true) return sections.concat(apiSections);
      const children = category.children.filter(child => child !== enable && child !== apiGroup);
      if (category.id === 'workbuddy-settings') return sections.concat([
        { ...category, heading: '积分卡显示', children: children.filter(child => child.id === '/workbuddy-quota-visible') },
        { ...category, heading: '积分趣味互动', children: children.filter(child => child.id === '/workbuddy-quota-fun') }
      ]);
      const module = child => /\/codex-task-names$/.test(child.id) ? '任务提醒'
        : /\/(?:codex|zcode)-quota-fun$/.test(child.id) ? '额度趣味互动'
        : /\/(?:codex-status|codex-tasks-open|codex-trend-open|zcode-quota-detail|zcode-trend|zcode-tasks|zcode-refresh)$/.test(child.id) ? '额度与任务信息' : '额度显示';
      return sections.concat(['任务提醒', '额度显示', '额度趣味互动', '额度与任务信息'].map(heading => ({
        ...category, heading, children: children.filter(child => module(child) === heading)
      })), apiSections);
    });
    for (const category of displayed) {
      if (!query && selected !== category.id) continue;
      const statusEntry = category.children.find(item => item.id.endsWith('/codex-status'));
      const items = category.children.filter(item => item !== statusEntry && !item.id.endsWith('/codex-tasks-open')).flatMap(item => leaves(item)).filter(item =>
        !query || [category.label, category.heading, ...item.trail, item.label, ...(item.choices || []).map(choice => choice.label), descriptions[item.label] || ''].join(' ').toLocaleLowerCase().includes(query));
      if (!items.length && !statusEntry) continue;
      count += items.length + (statusEntry ? 1 : 0);
      const section = el('section', '', 'group');
      if (category.section) section.dataset.settingsSection = category.section;
      section.append(el('h3', category.heading || (category.label === '便签与待办' ? '打开与创建' : category.label)));
      if (category.introduction) section.append(el('p', category.introduction, 'description group-intro'));
      if (category.label === '便签与待办') section.classList.add('notes-settings');
      for (const item of items) {
        const row = el('div', '', `row${item.enabled ? '' : ' unavailable'}`);
        const text = el('div'); text.append(el('div', item.label, 'row-title'));
        if (item.label === '立即睡眠') {
          const state = el('span', '', 'pet-sleep-status'); state.dataset.petSleepState = '';
          state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite');
          state.setAttribute('aria-atomic', 'true'); updateSleepStatus(state); text.querySelector('.row-title').append(state);
        }
        const provider = item.id.startsWith('/zcode-menu/') ? 'zcode' : item.id.includes('/codex-') ? 'codex' : null;
        const providerOff = provider && snapshot.entries.find(entry => entry.id === `/${provider}-menu`)?.children.find(entry => entry.id.endsWith(`/${provider}-enabled`))?.checked === false;
        const detail = [item.trail.join(' / '), descriptions[item.label], !item.enabled && (providerOff ? `请先开启「启用 ${provider === 'zcode' ? 'ZCode' : 'Codex'} 联动」。` : '当前不可用，请先开启对应功能或满足使用条件。')].filter(Boolean).join(' · ');
        if (detail) text.append(el('p', detail, 'description'));
        row.append(text);
        if (item.type === 'select') {
          const select = el('select');
          select.setAttribute('aria-label', item.label); select.dataset.action = item.id;
          select.disabled = !item.enabled || busy;
          for (const choice of item.choices) {
            const option = el('option', choice.label); option.value = choice.id;
            option.selected = choice.checked; option.disabled = !choice.enabled; select.append(option);
          }
          select.onchange = () => act(item.choices.find(choice => choice.id === select.value));
          row.append(select);
        } else if (item.actionable) {
          const choice = ['checkbox', 'radio'].includes(item.type);
          const button = el('button', choice ? '' : '打开', choice ? item.type === 'checkbox' ? 'toggle' : 'radio' : 'action');
          if (!choice && (externalIds.has(item.id) || /notes-open|openai-api-usage/.test(item.id))) { button.textContent = '打开'; button.append(externalIcon()); }
          if (!choice && /恢复|靠左|靠右|离开|隐藏|显示|睡眠|唤醒|表情|检查|刷新/.test(item.label)) button.textContent = /恢复/.test(item.label) ? '恢复位置' : /刷新/.test(item.label) ? '刷新状态' : /检查/.test(item.label) ? '检查更新' : item.label;
          if (item.id.endsWith('/zcode-refresh')) button.textContent = '刷新状态';
          button.setAttribute('aria-label', item.label);
          button.title = choice ? `${item.label}：${item.checked ? '已开启 / 已选择' : '未开启 / 未选择'}` : item.label;
          if (choice) { button.setAttribute('role', item.type === 'checkbox' ? 'switch' : 'radio'); button.setAttribute('aria-checked', String(item.checked)); }
          button.dataset.action = item.id;
          button.disabled = !item.enabled || busy;
          button.onclick = () => item.id === '/shortcut-settings' ? selectView('shortcuts') : act(item);
          row.append(button);
        }
        if (category.label === '便签与待办') {
          if (item.type === 'select') { row.classList.add('notes-preference'); text.querySelector('.row-title').textContent = '主面板默认显示'; }
          else {
            const labels = { '打开主面板': ['便签与待办', '查看、整理全部便签和待办。'], '新建便签': ['新建便签', '随手记录，支持固定在桌面。'], '添加待办': ['添加待办', '记录任务并设置提醒。'] };
            const copy = labels[item.label];
            if (copy) { text.querySelector('.row-title').textContent = copy[0]; text.append(el('p', copy[1], 'description')); }
            row.querySelector('button').textContent = item.label === '打开主面板' ? '打开面板 ↗' : '新建 ↗';
          }
        }
        section.append(row);
      }
      if (statusEntry && (!query || 'codex 状态 额度 任务 刷新'.includes(query))) section.append(codexStatus(statusEntry));
      sections.push(section);
    }
    const notes = categories.find(category => category.label === '便签与待办');
    const behaviors = snapshot.shortcuts && notes && (!query ? selected === notes.id : '便签 待办 启动方式'.includes(query)) ? el('div') : null;
    if (behaviors) { sections.push(behaviors); count++; }
    if (!query && selected === '/codex-menu') {
      const tabs = el('div', '', 'integration-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Codex 与 OpenAI API 设置');
      for (const [id, label] of [['codex', 'Codex'], ['api', 'OpenAI API']]) {
        const button = el('button', label); button.type = 'button'; button.id = `codex-tab-${id}`;
        button.dataset.codexTab = id; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(codexTab === id));
        button.tabIndex = codexTab === id ? 0 : -1; button.disabled = busy;
        button.onclick = () => { codexTab = id; render(); document.querySelector('main').scrollTop = 0; document.getElementById(`codex-tab-${id}`)?.focus(); };
        button.onkeydown = event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); codexTab = event.key === 'Home' ? 'codex' : event.key === 'End' ? 'api' : codexTab === 'codex' ? 'api' : 'codex'; render(); document.getElementById(`codex-tab-${codexTab}`)?.focus(); };
        tabs.append(button);
      }
      sections.unshift(tabs);
    }
    if (!query && selected === 'quota-cards') { sections.unshift(quotaCardSettings()); count++; }
    $('content').replaceChildren(...sections);
    if (behaviors) window.renderSettingsShortcuts(behaviors, snapshot.shortcuts, shortcutApi, true);
    $('empty').hidden = count !== 0;
    if (quotaSectionRequested) { document.querySelector('main').scrollTop = 0; quotaSectionRequested = false; }
    if (apiSectionRequested) { document.querySelector('[data-settings-section="openai-api"]')?.scrollIntoView({ block: 'start' }); apiSectionRequested = false; }
    if (focusId) Array.from(document.querySelectorAll('[data-action]')).find(node => node.dataset.action === focusId)?.focus();
  }
  async function act(item) {
    if (busy) return;
    busy = true; request++;
    feedback(''); render();
    try {
      const result = await api.act(item.id, !item.checked);
      if (result?.snapshot) { snapshot = result.snapshot; if (latestSleepState !== undefined) snapshot.petSleepState = latestSleepState; last = JSON.stringify(snapshot); }
      feedback(result?.error || (['checkbox', 'radio'].includes(item.type) ? '设置已更新' : ''));
    } catch (_) { feedback('操作未完成，请稍后重试。'); }
    finally { busy = false; render(); }
  }
  async function refresh() {
    if (busy || document.hidden) return;
    const current = ++request;
    try {
      const value = await api.get();
      if (current !== request || busy || !value) return;
      if (latestSleepState !== undefined) value.petSleepState = latestSleepState;
      const serialized = JSON.stringify(value);
      if (last !== serialized) { if (!snapshot && value.initialView === 'quota-cards') { selected = quotaCardsView(value); quotaSectionRequested = true; }
        else if (!snapshot && value.initialView === 'shortcuts') selected = 'shortcuts';
        else if (!snapshot && value.initialView === '/api-balance-menu') selected = '/api-balance-menu';
        else if (!snapshot && isApiView(value.initialView)) { selected = '/codex-menu'; codexTab = 'api'; apiSectionRequested = true; } snapshot = value; last = serialized; render(); }
    } catch (_) { $('feedback').textContent = '暂时无法读取设置，请重新打开窗口。'; }
  }
  function setSearchOpen(open) {
    $('search-panel').hidden = !open;
    $('search-toggle').setAttribute('aria-expanded', String(open));
    if (open) $('search').focus();
    else { $('search').value = ''; render(); $('search-toggle').focus(); }
  }
  $('search-toggle').addEventListener('click', () => setSearchOpen($('search-panel').hidden));
  $('search').addEventListener('input', render);
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); }
    if (event.key === 'Escape' && !$('search-panel').hidden) { event.preventDefault(); setSearchOpen(false); }
  });
  api.onNavigate(view => {
    if (view === 'quota-cards') { selected = quotaCardsView(snapshot); quotaSectionRequested = true; apiSectionRequested = false; $('search').value = ''; $('search-panel').hidden = true; $('search-toggle').setAttribute('aria-expanded', 'false'); render(); return; }
    if (view === '/api-balance-menu') { selected = view; apiSectionRequested = false; quotaSectionRequested = false; $('search').value = ''; $('search-panel').hidden = true; $('search-toggle').setAttribute('aria-expanded', 'false'); render(); document.querySelector('main').scrollTop = 0; return; }
    if (view !== 'shortcuts' && !isApiView(view)) return;
    apiSectionRequested = isApiView(view); if (apiSectionRequested) codexTab = 'api';
    selected = apiSectionRequested ? '/codex-menu' : view; $('search').value = ''; $('search-panel').hidden = true;
    $('search-toggle').setAttribute('aria-expanded', 'false');
    render(); if (view === 'shortcuts') document.querySelector('main').scrollTop = 0;
  });
  function updateSleepStatus(badge) {
    const state = snapshot?.petSleepState;
    badge.dataset.state = ['awake', 'sleep'].includes(state) ? state : 'unknown';
    badge.textContent = state === 'sleep' ? '当前：睡眠' : state === 'awake' ? '当前：清醒' : '状态待更新';
  }
  const removeSleepState = api.onPetSleepState?.(state => {
    if (!['awake', 'sleep', 'unknown'].includes(state)) return;
    latestSleepState = state;
    if (!snapshot) return;
    request++;
    snapshot.petSleepState = state; last = JSON.stringify(snapshot);
    document.querySelectorAll('[data-pet-sleep-state]').forEach(updateSleepStatus);
  });
  window.addEventListener('beforeunload', () => removeSleepState?.(), { once: true });
  window.addEventListener('focus', refresh);
  const timer = setInterval(refresh, 2000);
  window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
  refresh();
})();
