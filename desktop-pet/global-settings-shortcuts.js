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
    let save, reset;
    function syncDraft(message) {
      if (save) save.disabled = !dirty();
      if (reset) reset.disabled = !dirty();
      notice.textContent = message || (dirty() ? '有未保存的更改，保存后生效。' : '点击右侧设置组合键；修改后需保存。');
    }
    const row = (label, control) => { const r = node('div', '', 'row'); r.append(node('div', label, 'row-title'), control); group.append(r); };
    function choice(label, field, values) {
      const select = node('select'); select.setAttribute('aria-label', label);
      for (const [value, name] of values) { const o = node('option', name); o.value = value; o.selected = String(draft[field]) === value; select.append(o); }
      select.onchange = () => { draft[field] = field === 'enabled' ? select.value === 'true' : select.value; syncDraft(); };
      row(label, select);
    }
    const enabled = node('button', '', 'toggle'); enabled.type = 'button'; enabled.setAttribute('role', 'switch'); enabled.setAttribute('aria-label', '启用快捷面板'); enabled.setAttribute('aria-checked', String(draft.enabled));
    enabled.onclick = () => { draft.enabled = !draft.enabled; enabled.setAttribute('aria-checked', String(draft.enabled)); syncDraft(); };
    row('启用快捷面板', enabled);
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
      const clear = node('button', '', 'binding-clear'); clear.type = 'button'; clear.setAttribute('aria-label', `删除${label}快捷键`); clear.title = '删除快捷键'; clears[field] = clear;
      const trash = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      trash.setAttribute('viewBox', '0 0 24 24'); trash.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(trash.namespaceURI, 'path');
      path.setAttribute('d', 'M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M10 11v6M14 11v6');
      trash.append(path); clear.append(trash);
      clear.onclick = () => { finish(); draft[field] = ''; paint(field); syncDraft('快捷键已清除，保存后生效。'); buttons[field].focus(); };
      button.onclick = () => { finish(); active = field; button.textContent = '请按组合键…'; button.classList.add('recording'); notice.textContent = `正在设置「${label}」：按下组合键，Esc 取消。`; api.recordShortcuts(true); };
      paint(field); controls.append(button, clear); row(label, controls);
    }
    startGroup('便签与待办的启动方式', '同时用于快捷面板按钮和功能快捷键。');
    choice('便签启动方式', 'noteBehavior', [['panel', '打开主面板'], ['create', '新建便签']]);
    choice('待办启动方式', 'todoBehavior', [['panel', '打开主面板'], ['create', '添加待办']]);
    const handler = event => {
      if (!active || event.isComposing || event.repeat || event.keyCode === 229) return;
      if (event.key === 'Tab') { finish(); return; }
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape') { finish(); syncDraft(); return; }
      if (['Backspace', 'Delete'].includes(event.key)) { draft[active] = ''; finish(); syncDraft(); return; }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
      const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : /^(Space|F(?:[1-9]|1[0-2]))$/.test(event.code) ? event.code : null;
      if (!key || !(event.ctrlKey || event.altKey || event.metaKey)) { notice.textContent = '请使用 Ctrl、Alt 或 ⌘ 加字母、数字、空格或 F1–F12。'; return; }
      const value = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', key].filter(Boolean).join('+');
      if (Object.keys(labels).some(id => id !== active && draft[id] === value)) { notice.textContent = '这个组合键已经用于其他功能，请换一个。'; return; }
      draft[active] = value; finish(); syncDraft();
    };
    const stopOnOutsidePointer = event => {
      if (active && !buttons[active].contains(event.target)) { finish(); syncDraft(); }
    };
    document.addEventListener('pointerdown', stopOnOutsidePointer, true);
    document.addEventListener('keydown', handler, true);
    window.addEventListener('blur', finish);
    const observer = new MutationObserver(() => { if (!section.isConnected) cleanup(); });
    observer.observe(container, { childList: true });
    const cleanup = () => { finish(); document.removeEventListener('pointerdown', stopOnOutsidePointer, true); document.removeEventListener('keydown', handler, true); window.removeEventListener('blur', finish); observer.disconnect(); };
    cancelRecording = cleanup;
    save = node('button', '保存更改', 'action'); save.type = 'button';
    save.onclick = async () => {
      finish();
      const controls = [...section.querySelectorAll('button, select')];
      controls.forEach(control => { control.disabled = true; });
      try { const result = await api.saveShortcuts({ ...draft }); if (result.ok) baseline = signature(draft); notice.textContent = result.ok ? '快捷键已保存' : result.errors?.map(e => e.message).join('；') || '保存失败，请重试。'; }
      catch (_) { notice.textContent = '保存失败，请重试。'; }
      finally { controls.forEach(control => { control.disabled = false; }); save.disabled = !dirty(); reset.disabled = !dirty(); }
    };
    reset = node('button', '撤销更改', 'action'); reset.type = 'button';
    reset.onclick = () => { finish(); draft = JSON.parse(baseline); cancelRecording(); mounted = null; window.renderSettingsShortcuts(container, draft, api); };
    const actions = node('div', '', 'shortcut-footer');
    const controls = node('div', '', 'shortcut-save-controls'); controls.append(save, reset);
    actions.append(notice, controls); section.append(actions); syncDraft();
    container.append(section);
  };
})();
