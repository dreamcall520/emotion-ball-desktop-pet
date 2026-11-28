(() => {
  let cancelRecording = () => {}, draft = null, baseline = '', mounted = null, mountedMode = null, saving = false, paintDraft = () => {};
  const signature = value => JSON.stringify(value);
  window.addEventListener('beforeunload', () => cancelRecording());
  window.renderSettingsShortcuts = (container, config, api, behaviorsOnly = false) => {
    const panelOnly = behaviorsOnly === 'panel';
    const bindingsOnly = !behaviorsOnly;
    const incoming = signature(config);
    // Background refreshes and theme changes must not discard an unfinished edit.
    if (mounted?.isConnected && mountedMode === behaviorsOnly && (saving || incoming === baseline)) return;
    cancelRecording();
    if (!saving) { draft = { ...config }; baseline = incoming; }
    container.replaceChildren();
    const node = (tag, text, cls) => { const n = document.createElement(tag); n.textContent = text || ''; if (cls) n.className = cls; return n; };
    const section = node('div', '', 'shortcut-settings-group');
    mounted = section; mountedMode = behaviorsOnly;
    let group;
    function startGroup(title, description) {
      group = node('section', '', 'group'); group.append(node('h3', title));
      if (description) group.append(node('p', description, 'description group-intro'));
      section.append(group);
    }
    if (panelOnly) startGroup('快捷面板', '鼠标悬停球球时出现的功能入口，也可以用快捷键唤起。');
    if (bindingsOnly) startGroup('快捷面板', '设置快捷面板的形态与唤起方式。');
    const notice = node('p', '点击组合键后，按下想使用的快捷键。Esc 取消，退格清除。', 'description');
    notice.setAttribute('role', 'status');
    function feedback(message) {
      notice.textContent = message || (saving ? '正在应用更改…' : behaviorsOnly ? '修改后立即生效。' : '修改后立即生效。点击组合键录入快捷键。');
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
    if (panelOnly || bindingsOnly) row('启用快捷面板', enabled);
    if (panelOnly || bindingsOnly) choice('面板形态', 'shape', [['floating', '悬浮按钮'], ['list', '列表面板']]);
    let active = null;
    const labels = { launcher: '唤起快捷面板', chat: '和球球聊聊', custom: '定制球球', note: '便签', todo: '待办', pomodoro: '番茄钟', weather: '天气', calendar: '日历' };
    const panelLabels = { chat: '和球球聊聊', custom: '定制球球', note: '便签', todo: '待办', pomodoro: '番茄钟', settings: '设置中心', weather: '天气', calendar: '日历' };
    const panelOrder = () => {
      const order = [...new Set((Array.isArray(draft.order) ? draft.order : []).filter(id => Object.hasOwn(panelLabels, id)))];
      return [...order, ...Object.keys(panelLabels).filter(id => !order.includes(id))];
    };
    const panelHidden = () => (Array.isArray(draft.hidden) ? draft.hidden : ['weather', 'calendar']).filter(id => Object.hasOwn(panelLabels, id));
    let panelGroup = null;
    function paintPanel() {
      if (!panelGroup) return;
      const order = panelOrder(), hidden = panelHidden(), count = order.filter(id => !hidden.includes(id)).length;
      panelGroup.replaceChildren(node('h3', '快捷面板显示'), node('p', '选择快捷面板里的入口并拖动排序，最多显示6个。隐藏入口不会清除功能快捷键。', 'description group-intro'));
      panelGroup.append(node('p', `已显示 ${count}/6`, 'description shortcut-panel-count'));
      for (const [index, id] of order.entries()) {
        const item = node('div', '', 'row'); item.dataset.shortcutPanel = id; item.draggable = !saving;
        const heading = node('div', '', 'quota-card-name'), handle = node('span', '⠿', 'quota-card-drag-handle');
        handle.title = '拖拽调整顺序'; handle.setAttribute('aria-hidden', 'true');
        heading.append(handle, node('span', panelLabels[id], 'row-title')); item.append(heading);
        let dragFromControl = false;
        item.onpointerdown = event => { dragFromControl = Boolean(event.target.closest?.('button,input,label')); };
        item.ondragstart = event => {
          if (saving || dragFromControl || event.target.closest?.('button,input,label')) { event.preventDefault(); return; }
          event.dataTransfer.setData('application/x-qiuqiu-shortcut-panel', id); event.dataTransfer.effectAllowed = 'move'; item.classList.add('dragging');
        };
        item.ondragend = () => panelGroup.querySelectorAll('.dragging,.drag-over').forEach(n => n.classList.remove('dragging', 'drag-over'));
        item.ondragover = event => {
          if (saving || !Array.from(event.dataTransfer.types).includes('application/x-qiuqiu-shortcut-panel')) return;
          event.preventDefault(); event.dataTransfer.dropEffect = 'move'; item.classList.add('drag-over');
        };
        item.ondragleave = event => { if (!item.contains(event.relatedTarget)) item.classList.remove('drag-over'); };
        item.ondrop = event => {
          event.preventDefault(); item.classList.remove('drag-over');
          const moved = event.dataTransfer.getData('application/x-qiuqiu-shortcut-panel');
          if (saving || moved === id || !order.includes(moved)) return;
          draft.order = order.filter(value => value !== moved); draft.order.splice(index, 0, moved); draft.hidden = [...hidden]; void persist();
        };
        const controls = node('div', '', 'quota-card-controls');
        for (const [label, offset] of [['上移', -1], ['下移', 1]]) {
          const button = node('button', label, 'action'); button.type = 'button'; button.setAttribute('aria-label', `快捷面板${panelLabels[id]}${label}`);
          button.disabled = saving || index + offset < 0 || index + offset >= order.length;
          button.onclick = () => {
            if (saving || index + offset < 0 || index + offset >= order.length) return;
            draft.order = [...order]; [draft.order[index], draft.order[index + offset]] = [draft.order[index + offset], draft.order[index]]; draft.hidden = [...hidden]; void persist();
          };
          controls.append(button);
        }
        const display = node('label', '', 'quota-card-pin'), checkbox = node('input'); checkbox.type = 'checkbox';
        checkbox.setAttribute('aria-label', `快捷面板显示${panelLabels[id]}`); checkbox.checked = !hidden.includes(id);
        checkbox.disabled = saving || !checkbox.checked && count >= 6;
        if (!checkbox.checked && count >= 6) display.title = '最多显示6个，请先关闭一个入口。';
        checkbox.onchange = () => {
          if (saving || checkbox.checked && count >= 6) { checkbox.checked = !hidden.includes(id); return; }
          draft.order = [...order]; draft.hidden = checkbox.checked ? hidden.filter(value => value !== id) : [...hidden, id]; void persist();
        };
        display.append(checkbox, document.createTextNode('显示')); controls.append(display); item.append(controls); panelGroup.append(item);
      }
    }
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
    for (const [field, label] of Object.entries(bindingsOnly ? labels : {})) {
      if (field === 'chat') {
        panelGroup = node('section', '', 'group shortcut-panel-settings'); section.append(panelGroup);
        startGroup('功能快捷键', '直接打开对应功能，无需先唤起快捷面板。');
      }
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
    if (behaviorsOnly === true) {
      startGroup('便签与待办的启动方式', '同时用于快捷面板按钮和功能快捷键。');
      choice('便签启动方式', 'noteBehavior', [['panel', '打开主面板'], ['create', '新建便签']]);
      choice('待办启动方式', 'todoBehavior', [['panel', '打开主面板'], ['create', '添加待办']]);
    }
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
      for (const field of Object.keys(buttons)) paint(field);
      paintPanel();
      feedback(message);
    };
    section.append(notice);
    container.append(section);
    paintDraft();
  };
})();
