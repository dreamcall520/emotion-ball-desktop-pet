(() => {
  let cancelRecording = () => {}, draft = null, baseline = '', mounted = null, saving = false, paintDraft = () => {};
  const signature = value => JSON.stringify(value);
  window.addEventListener('beforeunload', () => cancelRecording());
  window.renderSettingsShortcuts = (container, config, api) => {
    const incoming = signature(config);
    // Background refreshes and theme changes must not discard an unfinished edit.
    if (mounted?.isConnected && (saving || incoming === baseline)) return;
    cancelRecording();
    if (!saving) { draft = { ...config }; baseline = incoming; }
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
    function feedback(message) {
      notice.textContent = message || (saving ? '正在应用更改…' : '修改后立即生效。点击组合键录入快捷键。');
    }
    async function persist() {
      if (saving) return;
      finish(); saving = true; paintDraft();
      const submitted = { ...draft };
      let message;
      try {
        const result = await api.saveShortcuts(submitted);
        draft = { ...(result?.config || (result?.ok ? submitted : JSON.parse(baseline))) };
        baseline = signature(draft);
        message = result?.ok ? '更改已生效。' : result?.errors?.map(e => [e.accelerator, e.message].filter(Boolean).join('：')).join('；') || '保存失败，已恢复原设置，请重试。';
      } catch (_) { draft = JSON.parse(baseline); message = '保存失败，已恢复原设置，请重试。'; }
      finally { saving = false; paintDraft(message); }
    }
    const row = (label, control) => { const r = node('div', '', 'row'); r.append(node('div', label, 'row-title'), control); group.append(r); };
    const selects = {};
    function choice(label, field, values) {
      const select = node('select'); selects[field] = select; select.setAttribute('aria-label', label);
      for (const [value, name] of values) { const o = node('option', name); o.value = value; o.selected = String(draft[field]) === value; select.append(o); }
      select.onchange = () => { if (saving) return; draft[field] = select.value; void persist(); };
      row(label, select);
    }
    const enabled = node('button', '', 'toggle'); enabled.type = 'button'; enabled.setAttribute('role', 'switch'); enabled.setAttribute('aria-label', '启用快捷面板'); enabled.setAttribute('aria-checked', String(draft.enabled));
    enabled.onclick = () => { if (saving) return; draft.enabled = !draft.enabled; void persist(); };
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
      clears[field].style.visibility = draft[field] ? 'visible' : 'hidden';
      clears[field].setAttribute('aria-hidden', String(!draft[field]));
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
      clear.onclick = () => { if (saving) return; finish(); draft[field] = ''; void persist(); buttons[field].focus(); };
      button.onclick = () => { if (saving) return; finish(); active = field; button.textContent = '请按组合键…'; button.classList.add('recording'); notice.textContent = `正在设置「${label}」：按下组合键，Esc 取消。`; api.recordShortcuts(true); };
      paint(field); controls.append(button, clear); row(label, controls);
    }
    startGroup('便签与待办的启动方式', '同时用于快捷面板按钮和功能快捷键。');
    choice('便签启动方式', 'noteBehavior', [['panel', '打开主面板'], ['create', '新建便签']]);
    choice('待办启动方式', 'todoBehavior', [['panel', '打开主面板'], ['create', '添加待办']]);
    const handler = event => {
      if (saving || !active || event.isComposing || event.repeat || event.keyCode === 229) return;
      if (event.key === 'Tab') { finish(); return; }
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape') { finish(); feedback(); return; }
      if (['Backspace', 'Delete'].includes(event.key)) { draft[active] = ''; void persist(); return; }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
      const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : /^(Space|F(?:[1-9]|1[0-2]))$/.test(event.code) ? event.code : null;
      if (!key || !(event.ctrlKey || event.altKey || event.metaKey)) { notice.textContent = '请使用 Ctrl、Alt 或 ⌘ 加字母、数字、空格或 F1–F12。'; return; }
      const value = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', key].filter(Boolean).join('+');
      if (Object.keys(labels).some(id => id !== active && draft[id] === value)) { notice.textContent = '这个组合键已经用于其他功能，请换一个。'; return; }
      draft[active] = value; void persist();
    };
    const stopOnOutsidePointer = event => {
      if (active && !buttons[active].contains(event.target)) { finish(); feedback(); }
    };
    document.addEventListener('pointerdown', stopOnOutsidePointer, true);
    document.addEventListener('keydown', handler, true);
    window.addEventListener('blur', finish);
    const observer = new MutationObserver(() => { if (!section.isConnected) cleanup(); });
    observer.observe(container, { childList: true });
    const cleanup = () => { finish(); document.removeEventListener('pointerdown', stopOnOutsidePointer, true); document.removeEventListener('keydown', handler, true); window.removeEventListener('blur', finish); observer.disconnect(); };
    cancelRecording = cleanup;
    paintDraft = message => {
      if (!section.isConnected) return;
      for (const control of section.querySelectorAll('button, select')) control.disabled = saving;
      enabled.setAttribute('aria-checked', String(draft.enabled));
      for (const [field, select] of Object.entries(selects)) select.value = String(draft[field]);
      for (const field of Object.keys(labels)) paint(field);
      feedback(message);
    };
    section.append(notice);
    container.append(section);
    paintDraft();
  };
})();
