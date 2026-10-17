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
    const section = node('section', '', 'group shortcut-settings-group');
    mounted = section;
    section.append(node('h3', '快捷打开'));
    const notice = node('p', '点击组合键后，按下想使用的快捷键。Esc 取消，退格清除。', 'description');
    notice.setAttribute('role', 'status');
    const row = (label, control) => { const r = node('div', '', 'row'); r.append(node('div', label, 'row-title'), control); section.append(r); };
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
    const buttons = {};
    const finish = () => { if (active) buttons[active].textContent = draft[active] || '未设置'; active = null; api.recordShortcuts(false); };
    for (const [field, label] of Object.entries(labels)) {
      const button = node('button', draft[field] || '未设置', 'action'); button.type = 'button';
      button.setAttribute('aria-label', `${label}快捷键`); buttons[field] = button;
      button.onclick = () => { finish(); active = field; button.textContent = '请按组合键…'; api.recordShortcuts(true); };
      row(label, button);
    }
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
