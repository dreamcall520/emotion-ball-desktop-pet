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
  let snapshot = null, selected = 'common', busy = false, last = '', request = 0;
  const descriptions = {
    '保持清醒': '关闭后，球球会根据系统空闲时间自动休息。',
    '互动气泡': '控制球球的对白与互动提示。',
    '始终置顶': '让球球保持在其他窗口上方。',
    '启用 Codex 联动': '读取本机 Codex 任务与额度；开启时会说明读取范围并请求确认。',
    '显示 API 本月费用卡': 'API 统计独立于 Codex 订阅额度，需要连接管理员 Key。',
    '自动提醒新版本': '自动检查并提醒，不会自动下载安装。',
    '来定制球球': '形象、配色、透明度、启动外观与额度展示样式。',
    '快捷键设置': '查看快捷键、修改组合键和快捷入口行为。',
    '番茄钟': '设置专注与休息时长、钟面和提醒。',
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
    'API 费用与用量': ['M4 4v16h16', 'M8 16v-4M13 16V8M18 16V5'],

    '常用设置': ['m12 3 2.6 5.6 6.1.8-4.5 4.3 1.1 6.1-5.3-3-5.3 3 1.1-6.1-4.5-4.3 6.1-.8Z'],
    '番茄钟': ['M9 3h6M12 3v3M18 7l2-2', 'M12 6a8 8 0 1 0 0 16 8 8 0 0 0 0-16M12 10v4l-2 2'],
    '快捷键': ['M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z', 'M7 9h.01M12 9h.01M17 9h.01M7 12h.01M12 12h.01M17 12h.01M8 16h8'],
    '球球与互动': ['M8 4h8a5 5 0 0 1 5 5v4a5 5 0 0 1-5 5h-5l-5 3v-4a5 5 0 0 1-3-4V9a5 5 0 0 1 5-5Z', 'M8 10h.01M16 10h.01M9 13q3 3 6 0'],
    '便签与待办': ['M7 3h10a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z', 'M8 8h8M8 12h5M8 16l2 2 5-5'],
    '球球尺寸': ['M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5', 'M9 9h6v6H9Z'],
    '贴边与显示': ['M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z', 'M8 4v16M17 9l-3 3 3 3M14 12h4'],
    '界面配色': ['M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1.7 1.7 0 0 1 1.2-2.9H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z', 'M7 10h.01M10 7h.01M15 7h.01M18 10h.01'],
    'Codex 与 API': ['m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16'],
    '常规设置': ['M4 6h7M15 6h5M4 12h2M10 12h10M4 18h10M18 18h2', 'M11 4v4M6 10v4M14 16v4']
  };
  function navigationIcon(label) {
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
    const categories = snapshot.entries.filter(entry => entry.children);
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
  function render() {
    if (!snapshot) return;
    const focusId = document.activeElement?.dataset?.action;
    $('version').textContent = `球球 v${snapshot.version} · 本地设置`;
    const categories = groups();
    const nav = [{ id: 'common', label: '常用设置' }, ...categories,
      { id: 'shortcuts', label: '快捷键' },
      ...categories.flatMap(category => category.children.flatMap(item => item.children || [])).filter(item => item.id.endsWith('/openai-api-usage')).map(item => ({ ...item, label: 'API 费用与用量', external: true })),
      ...snapshot.entries.filter(entry => externalIds.has(entry.id)).map(entry => ({ ...entry,
        label: ({ '/chat-open': '和球球聊聊', '/customize-open': '定制球球' })[entry.id] || entry.label, external: true }))];
    if (!nav.some(item => item.id === selected)) selected = 'common';
    const selectView = id => {
      selected = id; $('search').value = ''; $('search-panel').hidden = true;
      $('search-toggle').setAttribute('aria-expanded', 'false'); $('feedback').textContent = '';
      render(); document.querySelector('main').scrollTop = 0;
    };
    const navigationGroups = [
      ['', ['常用设置']],
      ['日常陪伴', ['球球与互动', '和球球聊聊', '便签与待办', '番茄钟']],
      ['外观与显示', ['定制球球', '球球尺寸', '贴边与显示', '界面配色']],
      ['应用与联动', ['Codex 与 API', 'API 费用与用量', '快捷键', '常规设置']]
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
    if (!query && selected === 'shortcuts') {
      $('empty').hidden = true;
      window.renderSettingsShortcuts($('content'), snapshot.shortcuts, api); return;
    }
    const searchable = [...categories, { id: 'shortcuts', label: '快捷键', children: snapshot.entries.filter(entry => entry.id === '/shortcut-settings') }, { id: 'windows', label: '独立功能', children: snapshot.entries.filter(entry => externalIds.has(entry.id)) }];
    const displayed = query ? searchable : selected === 'common' ? commonGroups : categories;
    for (const category of displayed) {
      if (!query && selected !== category.id) continue;
      const items = category.children.flatMap(item => leaves(item)).filter(item =>
        !query || [category.label, ...item.trail, item.label, ...(item.choices || []).map(choice => choice.label), descriptions[item.label] || ''].join(' ').toLocaleLowerCase().includes(query));
      if (!items.length) continue;
      count += items.length;
      const section = el('section', '', 'group');
      section.append(el('h3', category.label === '便签与待办' ? '打开与创建' : category.label));
      if (category.label === '便签与待办') section.classList.add('notes-settings');
      for (const item of items) {
        const row = el('div', '', `row${item.enabled ? '' : ' unavailable'}`);
        const text = el('div'); text.append(el('div', item.label, 'row-title'));
        const detail = [item.trail.join(' / '), descriptions[item.label], !item.enabled && '当前不可用，请先开启对应功能或满足使用条件。'].filter(Boolean).join(' · ');
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
          if (!choice && /恢复|靠左|靠右|离开|隐藏|显示|睡眠|唤醒|表情|检查|刷新/.test(item.label)) button.textContent = '执行';
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
      sections.push(section);
    }
    $('content').replaceChildren(...sections);
    $('empty').hidden = count !== 0;
    if (focusId) Array.from(document.querySelectorAll('[data-action]')).find(node => node.dataset.action === focusId)?.focus();
  }
  async function act(item) {
    if (busy) return;
    busy = true; request++;
    feedback(''); render();
    try {
      const result = await api.act(item.id, !item.checked);
      if (result?.snapshot) { snapshot = result.snapshot; last = JSON.stringify(snapshot); }
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
      const serialized = JSON.stringify(value);
      if (last !== serialized) { if (!snapshot && value.initialView === 'shortcuts') selected = 'shortcuts'; snapshot = value; last = serialized; render(); }
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
    if (view !== 'shortcuts') return;
    selected = view; $('search').value = ''; $('search-panel').hidden = true;
    $('search-toggle').setAttribute('aria-expanded', 'false');
    render(); document.querySelector('main').scrollTop = 0;
  });
  window.addEventListener('focus', refresh);
  const timer = setInterval(refresh, 2000);
  window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
  refresh();
})();
