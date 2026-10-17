(() => {
  let cancelRecording = () => {}, draft = null, baseline = '', mounted = null;
  const signature = value => JSON.stringify(value);
  const dirty = () => draft && signature(draft) !== baseline;
  window.addEventListener('beforeunload', () => cancelRecording());
  window.renderSettingsShortcuts = (container, config, api) => {
    const incoming = signature(config);
    // Background refreshes and theme changes must not discard an unfinished edit.
    if (mounted?.isConnected && (dirty() || incoming === baseline)) return;
    cancelRecording();
    if (!dirty()) { draft = { ...config }; baseline = incoming; }
    container.replaceChildren();
    const node = (tag, text, cls) => { const n = document.createElement(tag); n.textContent = text || ''; if (cls) n.className = cls; return n; };
    const section = node('div', '', 'shortcut-settings-group');
    mounted = section;
    let group;
    function startGroup(title, description) {
      group = node('section', '', 'group'); group.append(node('h3', title));
      if (description) group.append(node('p', description, 'description group-intro'));
      section.append(group);
    }
    startGroup('快捷面板', '鼠标悬停球球时出现的功能入口，也可以用快捷键唤起。');
    const notice = node('p', '点击组合键后，按下想使用的快捷键。Esc 取消，退格清除。', 'description');
    notice.setAttribute('role', 'status');
    const row = (label, control) => { const r = node('div', '', 'row'); r.append(node('div', label, 'row-title'), control); group.append(r); };
    function choice(label, field, values) {
      const select = node('select'); select.setAttribute('aria-label', label);
      for (const [value, name] of values) { const o = node('option', name); o.value = value; o.selected = String(draft[field]) === value; select.append(o); }
      select.onchange = () => { draft[field] = field === 'enabled' ? select.value === 'true' : select.value; };
      row(label, select);
    }
    choice('快捷面板', 'enabled', [['true', '开启'], ['false', '关闭']]);
    choice('面板形态', 'shape', [['floating', '悬浮按钮'], ['list', '列表面板']]);
    let active = null;
    const labels = { launcher: '唤起快捷面板', chat: '和球球聊聊', custom: '定制球球', note: '便签', todo: '待办', pomodoro: '番茄钟' };
    const buttons = {}, clears = {};
    function paint(field) {
      const button = buttons[field]; button.replaceChildren();
      button.classList.remove('recording');
      if (!draft[field]) button.textContent = '设置快捷键';
      else for (const key of draft[field].split('+')) button.append(node('kbd', ({ Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘', Space: '空格' })[key] || key));
      clears[field].hidden = !draft[field];
    }
    const finish = () => { if (active) paint(active); active = null; api.recordShortcuts(false); };
    for (const [field, label] of Object.entries(labels)) {
      if (field === 'chat') startGroup('功能快捷键', '直接打开对应功能，无需先唤起快捷面板。');
      const button = node('button', '', 'binding-button'); button.type = 'button';
      button.setAttribute('aria-label', `${label}快捷键`); buttons[field] = button;
      const controls = node('div', '', 'binding-controls');
      const clear = node('button', '×', 'binding-clear'); clear.type = 'button'; clear.setAttribute('aria-label', `删除${label}快捷键`); clear.title = '删除快捷键'; clears[field] = clear;
      clear.onclick = () => { finish(); draft[field] = ''; paint(field); notice.textContent = '快捷键已清除，保存后生效。'; };
      button.onclick = () => { finish(); active = field; button.textContent = '请按组合键…'; button.classList.add('recording'); api.recordShortcuts(true); };
      paint(field); controls.append(button, clear); row(label, controls);
    }
    startGroup('便签与待办的启动方式', '同时用于快捷面板按钮和功能快捷键。');
    choice('便签启动方式', 'noteBehavior', [['panel', '打开主面板'], ['create', '新建便签']]);
    choice('待办启动方式', 'todoBehavior', [['panel', '打开主面板'], ['create', '添加待办']]);
    const handler = event => {
      if (!active || event.isComposing || event.repeat || event.keyCode === 229) return;
      if (event.key === 'Tab') { finish(); return; }
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape') { finish(); return; }
      if (['Backspace', 'Delete'].includes(event.key)) { draft[active] = ''; finish(); return; }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
      const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : /^(Space|F(?:[1-9]|1[0-2]))$/.test(event.code) ? event.code : null;
      if (!key || !(event.ctrlKey || event.altKey || event.metaKey)) { notice.textContent = '请使用 Ctrl、Alt 或 ⌘ 加字母、数字、空格或 F1–F12。'; return; }
      const value = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', key].filter(Boolean).join('+');
      if (Object.keys(labels).some(id => id !== active && draft[id] === value)) { notice.textContent = '这个组合键已经用于其他功能，请换一个。'; return; }
      draft[active] = value; finish();
    };
    document.addEventListener('keydown', handler, true);
    window.addEventListener('blur', finish);
    const observer = new MutationObserver(() => { if (!section.isConnected) cleanup(); });
    observer.observe(container, { childList: true });
    const cleanup = () => { finish(); document.removeEventListener('keydown', handler, true); window.removeEventListener('blur', finish); observer.disconnect(); };
    cancelRecording = cleanup;
    const save = node('button', '保存快捷键', 'action'); save.type = 'button';
    save.onclick = async () => {
      finish();
      const controls = [...section.querySelectorAll('button, select')];
      controls.forEach(control => { control.disabled = true; });
      try { const result = await api.saveShortcuts({ ...draft }); if (result.ok) baseline = signature(draft); notice.textContent = result.ok ? '快捷键已保存' : result.errors?.map(e => e.message).join('；') || '保存失败，请重试。'; }
      catch (_) { notice.textContent = '保存失败，请重试。'; }
      finally { controls.forEach(control => { control.disabled = false; }); }
    };
    section.append(notice);
    const actions = node('div', '', 'shortcut-footer'); actions.append(save); section.append(actions);
    container.append(section);
  };
})();
