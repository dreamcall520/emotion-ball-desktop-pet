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
  function groups() {
    const shortcuts = snapshot.entries.filter(entry => !entry.children);
    return [{ id: 'quick', label: '功能入口', children: shortcuts }, ...snapshot.entries.filter(entry => entry.children)];
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
    $('summary').replaceChildren(...snapshot.summary.map(item => {
      const node = el('div'); node.append(el('span', item.label, 'stat-label'), el('span', item.value, 'stat-value')); return node;
    }));
    const categories = groups();
    const nav = [{ id: 'common', label: '常用设置' }, { id: 'all', label: '全部设置' }, ...categories];
    if (!nav.some(item => item.id === selected)) selected = 'common';
    const selectView = id => {
      selected = id; $('search').value = ''; render(); document.querySelector('main').scrollTop = 0;
    };
    $('navigation').replaceChildren(...categories.filter(item => item.id !== 'quick').map(item => {
      const button = el('button', item.label);
      if (selected === item.id) button.setAttribute('aria-current', 'page');
      button.onclick = () => selectView(item.id);
      return button;
    }));
    $('view-navigation').replaceChildren(...nav.slice(0, 2).concat(nav.filter(item => item.id === 'quick')).map(item => {
      const button = el('button', item.label);
      button.dataset.view = item.id;
      button.setAttribute('aria-pressed', String(selected === item.id || item.id === 'all' && !['common', 'quick'].includes(selected)));
      button.onclick = () => selectView(item.id);
      return button;
    }));
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
    const displayed = !query && selected === 'common' ? commonGroups : categories;
    for (const category of displayed) {
      if (!query && selected !== 'all' && selected !== category.id) continue;
      const items = category.children.flatMap(item => leaves(item)).filter(item =>
        !query || [category.label, ...item.trail, item.label, ...(item.choices || []).map(choice => choice.label), descriptions[item.label] || ''].join(' ').toLocaleLowerCase().includes(query));
      if (!items.length) continue;
      count += items.length;
      const section = el('section', '', 'group');
      section.append(el('h3', category.label));
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
          if (!choice && /恢复|靠左|靠右|离开|隐藏|显示|睡眠|唤醒|表情|检查|刷新/.test(item.label)) button.textContent = '执行';
          button.setAttribute('aria-label', item.label);
          button.title = choice ? `${item.label}：${item.checked ? '已开启 / 已选择' : '未开启 / 未选择'}` : item.label;
          if (choice) { button.setAttribute('role', item.type === 'checkbox' ? 'switch' : 'radio'); button.setAttribute('aria-checked', String(item.checked)); }
          button.dataset.action = item.id;
          button.disabled = !item.enabled || busy;
          button.onclick = () => act(item);
          row.append(button);
        }
        section.append(row);
      }
      sections.push(section);
    }
    $('content').replaceChildren(...sections);
    $('count').textContent = `${count} 项`;
    $('empty').hidden = count !== 0;
    if (focusId) Array.from(document.querySelectorAll('[data-action]')).find(node => node.dataset.action === focusId)?.focus();
  }
  async function act(item) {
    if (busy) return;
    busy = true; request++;
    $('feedback').textContent = '正在处理…'; render();
    try {
      const result = await api.act(item.id, !item.checked);
      if (result?.snapshot) { snapshot = result.snapshot; last = JSON.stringify(snapshot); }
      $('feedback').textContent = result?.error || (['checkbox', 'radio'].includes(item.type) ? '设置已更新' : '已执行操作');
    } catch (_) { $('feedback').textContent = '操作未完成，请稍后重试。'; }
    finally { busy = false; render(); }
  }
  async function refresh() {
    if (busy || document.hidden) return;
    const current = ++request;
    try {
      const value = await api.get();
      if (current !== request || busy || !value) return;
      const serialized = JSON.stringify(value);
      if (last !== serialized) { snapshot = value; last = serialized; render(); }
    } catch (_) { $('feedback').textContent = '暂时无法读取设置，请重新打开窗口。'; }
  }
  $('search').addEventListener('input', render);
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('search').focus(); }
  });
  window.addEventListener('focus', refresh);
  const timer = setInterval(refresh, 2000);
  window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
  refresh();
})();
