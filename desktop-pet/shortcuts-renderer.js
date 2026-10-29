'use strict';

(() => {
  const api = window.qiuShortcuts;
  const $ = id => document.getElementById(id);
  const actions = [
    { id: 'chat', name: '聊天', icon: 'chat' },
    { id: 'custom', name: '定制球球', icon: 'custom' },
    { id: 'note', name: '便签', icon: 'note' },
    { id: 'todo', name: '待办', icon: 'todo' },
    { id: 'pomodoro', name: '番茄钟', icon: 'clock' }
  ];
  const floatingActions = [...actions, { id: 'settings', name: '设置', icon: 'settings' }];
  const defaults = { shape: 'floating', enabled: true, launcher: 'Ctrl+Alt+Q', chat: '', custom: '', note: '', todo: '', pomodoro: '', noteBehavior: 'panel', todoBehavior: 'panel' };
  const startBehaviors = { note: 'noteBehavior', todo: 'todoBehavior' };
  const bindingIds = ['launcher', ...actions.map(action => action.id)];
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const symbols = isMac ? { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘', Space: '空格' } : { Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win', Space: '空格' };
  let state = null, draft = { ...defaults }, recording = null, selected = -1, busy = false, pointerFrame = null, pointerPosition = null;
  let appearance = 'system', motionKey = '', motions = [];
  let saveNoticeTimer = null, saveGeneration = 0, confirmedConfig = { ...defaults };
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const system = window.matchMedia?.('(prefers-color-scheme: dark)');
  const currentActions = () => state?.view === 'list' ? actions : floatingActions;
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const configCopy = value => ({ ...defaults, ...(value || {}) });

  function renderKeys(node, binding) {
    node.replaceChildren();
    if (!binding) return;
    for (const key of binding.split('+')) {
      const cap = document.createElement('kbd');
      cap.textContent = symbols[key] || key;
      node.append(cap);
    }
  }

  function createAction(action, index, floating) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = floating ? 'action floating-action' : 'action';
    button.dataset.action = action.id;
    button.setAttribute('aria-label', action.name);
    button.title = action.name;
    button.innerHTML = `<span class="action-icon">${icon(action.icon)}</span><span class="action-name">${action.name}</span>${floating ? '' : '<span class="direct-key keycaps"></span>'}<kbd class="number" aria-hidden="true">${index + 1}</kbd>`;
    return button;
  }

  floatingActions.forEach((action, index) => $('floating').append(createAction(action, index, true)));
  actions.forEach((action, index) => $('list-actions').append(createAction(action, index, false)));

  function select(index, focus = false) {
    const entries = currentActions();
    selected = index < 0 ? -1 : ((index % entries.length) + entries.length) % entries.length;
    document.querySelectorAll('[data-action]').forEach(button => {
      const current = button.dataset.action === entries[selected]?.id;
      button.setAttribute('aria-current', String(current));
      button.tabIndex = current || (selected < 0 && button.dataset.action === entries[0].id) ? 0 : -1;
      if (focus && current && button.getClientRects().length) button.focus({ preventScroll: true });
    });
  }

  function resetActionSelection() {
    select(-1);
    if (document.activeElement?.matches('[data-action], .icon-button')) document.activeElement.blur();
  }
  function pointerInput() {
    document.documentElement.dataset.inputMode = 'pointer';
    if (selected >= 0) resetActionSelection();
  }
  document.documentElement.dataset.inputMode = 'pointer';

  function showError(message = '') {
    $('error').textContent = message;
    $('error').hidden = !message;
  }

  function clearSaveNotice() {
    clearTimeout(saveNoticeTimer);
    saveNoticeTimer = null;
    $('save-status').hidden = true;
    $('save-status').textContent = '';
  }

  function registrationMessage(errors = []) {
    if (!Array.isArray(errors)) return '';
    return errors.map(item => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      const id = item.field || item.id || item.key;
      const name = id === 'launcher' ? '快捷面板' : actions.find(action => action.id === id || startBehaviors[action.id] === id)?.name;
      return [name, item.message || item.error || '快捷键无法注册，请换一个组合。'].filter(Boolean).join('：');
    }).filter(Boolean).join('\n');
  }

  function setRecording(id) {
    recording = id;
    api?.recording(Boolean(id));
  }

  function stopRecording(restoreFocus = false) {
    const id = recording;
    const wasFocused = document.activeElement?.dataset.record === id;
    setRecording(null);
    if (state?.view === 'settings') {
      const control = $('settings').querySelector(`[data-record="${id}"]`)?.parentElement;
      if (control) control.replaceChildren(...bindingControl(id).childNodes);
      $('record-hint').textContent = ''; $('record-hint').hidden = true;
      if ((restoreFocus || wasFocused) && id) $('settings').querySelector(`[data-record="${id}"]`)?.focus({ preventScroll: true });
    }
  }

  function bindingControl(id) {
    const wrap = document.createElement('div');
    wrap.className = 'binding-controls';
    const name = id === 'launcher' ? '快捷面板' : actions.find(action => action.id === id).name;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'record-button' + (recording === id ? ' recording' : '');
    button.dataset.record = id;
    button.setAttribute('aria-label', `设置${name}快捷键`);
    button.setAttribute('aria-pressed', String(recording === id));
    if (recording === id) button.textContent = '请按组合键…';
    else if (draft[id]) renderKeys(button, draft[id]);
    else button.textContent = '点击设置';
    button.disabled = busy;
    wrap.append(button);
    {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'clear-binding';
      clear.dataset.clear = id;
      clear.setAttribute('aria-label', `清除${name}快捷键`);
      clear.innerHTML = icon('trash');
      clear.style.visibility = draft[id] ? 'visible' : 'hidden';
      clear.tabIndex = draft[id] ? 0 : -1;
      clear.disabled = busy;
      wrap.append(clear);
    }
    return wrap;
  }

  function renderSettings() {
    const focusedRecord = document.activeElement?.dataset.record;
    const focusedBehavior = document.activeElement?.dataset.startBehavior;
    document.querySelectorAll('[name="shape"]').forEach(input => { input.checked = input.value === draft.shape; input.disabled = busy; });
    $('enabled').checked = draft.enabled;
    $('enabled').disabled = busy;
    const global = bindingControl('launcher');
    $('launcher-binding').replaceChildren(...global.childNodes);
    $('direct-settings').replaceChildren();
    for (const action of actions) {
      const row = document.createElement('div');
      row.className = 'direct-row';
      const name = document.createElement('span');
      name.className = 'direct-name';
      name.innerHTML = icon(action.icon);
      name.append(document.createTextNode(action.name));
      row.append(name);
      const behaviorField = startBehaviors[action.id];
      if (behaviorField) {
        const select = document.createElement('select');
        select.className = 'start-behavior-select';
        select.title = '面板按钮和功能直达快捷键使用同一启动方式';
        select.dataset.startBehavior = behaviorField;
        select.setAttribute('aria-label', `${action.name}快捷启动方式`);
        for (const [value, text] of [['panel', '打开面板'], ['create', '直接新建']]) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = text;
          select.append(option);
        }
        select.value = draft[behaviorField];
        select.disabled = busy;
        row.append(select);
      }
      row.append(bindingControl(action.id));
      $('direct-settings').append(row);
    }
    $('restore').disabled = busy;
    $('settings').querySelector('[data-close]').disabled = busy;
    $('record-hint').hidden = !recording;
    $('record-hint').textContent = recording ? '按 ⌘ / ⌃ / ⌥ 与字母、数字或功能键组合。Esc 取消。' : '';
    if (focusedRecord) $('settings').querySelector(`[data-record="${focusedRecord}"]`)?.focus({ preventScroll: true });
    else if (focusedBehavior) $('settings').querySelector(`[data-start-behavior="${focusedBehavior}"]`)?.focus({ preventScroll: true });
  }

  function animateState() {
    const phase = state.animation?.phase || 'opening';
    const key = state.session + ':' + state.view + ':' + phase;
    document.body.dataset.phase = phase;
    if (key === motionKey) return;
    motionKey = key;
    motions.forEach(animation => animation.cancel()); motions = [];
    if (reducedMotion?.matches) return;
    const closing = phase === 'closing';
    const nodes = state.view === 'floating'
      ? [...$('floating').querySelectorAll('[data-action]')].filter(node => !node.hidden)
      : [$(state.view)];
    const duration = state.animation?.duration || (closing ? 180 : 260);
    nodes.forEach((node, index) => {
      const rect = node.getBoundingClientRect();
      const origin = state.origin || { x: innerWidth / 2, y: innerHeight / 2 };
      const dx = origin.x - rect.x - rect.width / 2, dy = origin.y - rect.y - rect.height / 2;
      const floating = state.view === 'floating';
      const collapsed = { transform: 'translate(' + dx * (floating ? 1 : .12) + 'px,' + dy * (floating ? 1 : .12) + 'px) scale(' + (floating ? .28 : .96) + ')', opacity: 0 };
      const expanded = { transform: 'translate(0,0) scale(1)', opacity: 1 };
      const delay = !closing && floating ? index * 10 : 0;
      const animation = node.animate(closing ? [expanded, collapsed] : [collapsed, expanded], {
        duration: Math.max(1, duration - delay), delay,
        easing: closing ? 'cubic-bezier(.4,0,.7,.2)' : 'cubic-bezier(.16,1,.3,1)',
        fill: closing ? 'forwards' : 'backwards'
      });
      animation.finished.catch(() => {});
      motions.push(animation);
    });
  }

  function applyState(next) {
    if (!next || !['floating', 'list', 'settings'].includes(next.view)) return;
    const enteringSettings = next.view === 'settings' && (state?.view !== 'settings' || state?.session !== next.session);
    if (next.view !== 'settings' && (state?.view !== next.view || state?.session !== next.session)) {
      saveGeneration++; busy = false;
      document.documentElement.dataset.inputMode = 'pointer'; pointerPosition = null;
      resetActionSelection();
    }
    if (next.view !== 'settings' && recording) setRecording(null);
    if (next.view !== 'settings' && next.animation?.phase === 'closing') {
      document.documentElement.dataset.inputMode = 'pointer'; pointerPosition = null; resetActionSelection();
    }
    state = { ...next, config: configCopy(next.config) };
    document.body.dataset.session = String(state.session);
    document.body.dataset.view = state.view;
    for (const view of ['floating', 'list', 'settings']) $(view).hidden = view !== state.view;
    $('runtime-error').hidden = true;
    if (state.view === 'settings') {
      if (!enteringSettings) confirmedConfig = configCopy(state.config);
      if (enteringSettings) {
        saveGeneration++; clearSaveNotice();
        draft = configCopy(state.config); confirmedConfig = { ...draft }; setRecording(null); busy = false;
        renderSettings();
        showError(registrationMessage(state.registrationErrors));
      } else if (!busy) {
        draft = configCopy(state.config); confirmedConfig = { ...draft }; renderSettings();
      }
      animateState();
      if (state.focus === true && enteringSettings) requestAnimationFrame(() => $('settings').querySelector('[name="shape"]:checked')?.focus({ preventScroll: true }));
      return;
    }
    renderKeys($('launcher-keys'), state.config.enabled ? state.config.launcher : '');
    actions.forEach(action => renderKeys($('list-actions').querySelector(`[data-action="${action.id}"] .direct-key`), state.config[action.id]));
    if (state.view === 'floating') {
      const size = Number(state.layout?.cardSize) || 58;
      $('floating').style.setProperty('--card-size', size + 'px');
      $('floating').style.setProperty('--card-font', (size >= 58 ? 13 : 11) + 'px');
      $('floating').dataset.small = String(size < 58);
      const items = new Map((state.layout?.items || []).map(item => [item.id, item]));
      $('floating').querySelectorAll('[data-action]').forEach(button => {
        const item = items.get(button.dataset.action);
        const valid = item && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(item[key]));
        button.hidden = !valid;
        if (!valid) return;
        button.style.left = item.x + 'px';
        button.style.top = item.y + 'px';
        button.style.width = item.width + 'px';
        button.style.height = item.height + 'px';
      });
    }
    select(selected);
    animateState();
  }

  function close() {
    if (busy) return;
    setRecording(null);
    draft = configCopy(state?.config);
    showError();
    clearSaveNotice();
    resetActionSelection();
    api?.close();
  }

  function choose(id) {
    resetActionSelection();
    if (id === 'settings') { setRecording(null); api?.openAction('settings'); }
    else if (actions.some(action => action.id === id)) api?.openAction(id);
  }

  for (const id of ['floating', 'list-actions']) {
    $(id).addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (button) choose(button.dataset.action);
    });
    $(id).addEventListener('focusin', event => {
      if (document.documentElement.dataset.inputMode !== 'keyboard') return;
      const button = event.target.closest('[data-action]');
      if (button) select(currentActions().findIndex(action => action.id === button.dataset.action));
    });
  }

  document.querySelectorAll('[data-close]').forEach(button => { button.onclick = close; });
  $('settings-open').onclick = () => choose('settings');
  $('switch-floating').onclick = async () => {
    try {
      const result = await api.setShape('floating');
      if (result?.ok === false) throw new Error(result.error || '形态暂时无法保存，请重试。');
      if (result?.state) applyState(result.state);
    } catch (error) {
      $('runtime-error').textContent = error.message || '形态暂时无法保存，请重试。';
      $('runtime-error').hidden = false;
    }
  };

  $('settings').addEventListener('change', event => {
    if (busy) return;
    clearSaveNotice();
    if (event.target.name === 'shape') draft.shape = event.target.value;
    if (event.target.id === 'enabled') { draft.enabled = event.target.checked; showError(); renderSettings(); }
    const field = event.target.dataset.startBehavior;
    if (Object.values(startBehaviors).includes(field) && ['panel', 'create'].includes(event.target.value)) {
      draft[field] = event.target.value;
      showError();
    }
    void saveDraft();
  });
  $('settings').addEventListener('click', event => {
    const record = event.target.closest('[data-record]'), clear = event.target.closest('[data-clear]');
    if (busy) return;
    if (clear) {
      clearSaveNotice();
      setRecording(null); draft[clear.dataset.clear] = ''; showError(); renderSettings();
      $('settings').querySelector(`[data-record="${clear.dataset.clear}"]`)?.focus({ preventScroll: true });
      void saveDraft();
    } else if (record) {
      clearSaveNotice();
      setRecording(recording === record.dataset.record ? null : record.dataset.record);
      showError(); renderSettings();
      $('settings').querySelector(`[data-record="${record.dataset.record}"]`)?.focus({ preventScroll: true });
    } else if (recording) stopRecording();
  });
  $('restore').onclick = () => { clearSaveNotice(); setRecording(null); draft = { ...defaults }; showError(); renderSettings(); $('restore').focus({ preventScroll: true }); void saveDraft(); };

  function validate(config) {
    if (config.enabled && !config.launcher) return '请设置唤起快捷键，或关闭快捷面板。';
    if (Object.values(startBehaviors).some(field => !['panel', 'create'].includes(config[field]))) return '请选择打开面板或直接新建。';
    const seen = new Map();
    for (const id of bindingIds) {
      const value = config[id];
      if (!value) continue;
      if (!/^(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:Meta\+)?(?:[A-Z0-9]|Space|F(?:[1-9]|1[0-2]))$/.test(value) || !/(?:Ctrl|Alt|Meta)\+/.test(value)) return '请使用修饰键与字母、数字或功能键组合。';
      if (seen.has(value)) return '快捷键重复，请为每项使用不同的组合。';
      seen.set(value, id);
    }
    return '';
  }

  async function saveDraft() {
    if (busy) return;
    clearSaveNotice(); setRecording(null);
    const invalid = validate(draft);
    if (invalid) { draft = configCopy(confirmedConfig); showError(invalid); renderSettings(); return; }
    const submitted = { ...draft }, token = ++saveGeneration, session = state?.session;
    busy = true; showError(); renderSettings();
    try {
      const result = await api.save(submitted);
      if (token !== saveGeneration || state?.session !== session || state?.view !== 'settings') return;
      if (result?.ok !== true) {
        if (result?.state?.config) { confirmedConfig = configCopy(result.state.config); state = { ...state, config: { ...confirmedConfig } }; }
        throw new Error(result?.error || registrationMessage(result?.registrationErrors) || '快捷键保存失败，请重试。');
      }
      if (result?.state) applyState(result.state);
      draft = configCopy(result?.state?.config || submitted);
      confirmedConfig = { ...draft }; state = { ...state, config: { ...draft } };
      $('save-status').textContent = '设置已生效'; $('save-status').hidden = false;
      saveNoticeTimer = setTimeout(clearSaveNotice, 3200);
    } catch (error) {
      if (token !== saveGeneration || state?.session !== session || state?.view !== 'settings') return;
      draft = configCopy(confirmedConfig); showError(error.message || '快捷键保存失败，请重试。');
    } finally {
      if (token === saveGeneration && state?.session === session && state?.view === 'settings') { busy = false; renderSettings(); }
    }
  }
  $('settings').onsubmit = event => event.preventDefault();

  function combo(event) {
    const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : /^(Space|F(?:[1-9]|1[0-2]))$/.test(event.code) ? event.code : null;
    if (!key || !(event.ctrlKey || event.altKey || event.metaKey)) return null;
    return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', key].filter(Boolean).join('+');
  }

  document.addEventListener('pointerdown', () => pointerInput(), true);
  document.addEventListener('pointermove', event => {
    // Native show/motion may emit pointermove while the screen position stays unchanged.
    const point = event.screenX || event.screenY ? { x: event.screenX, y: event.screenY } : { x: event.clientX, y: event.clientY };
    if (pointerPosition && (point.x !== pointerPosition.x || point.y !== pointerPosition.y)) pointerInput();
    pointerPosition = point;
  }, true);
  document.addEventListener('keydown', event => {
    if (!event.isComposing && !['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
      document.documentElement.dataset.inputMode = 'keyboard';
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229 || event.repeat) return;
    if (recording) {
      if (event.key === 'Tab') { stopRecording(); return; }
      event.preventDefault();
      if (event.key === 'Escape') { showError(); stopRecording(true); return; }
      if (event.key === 'Backspace' || event.key === 'Delete') { clearSaveNotice(); draft[recording] = ''; showError(); stopRecording(true); void saveDraft(); return; }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
      const value = combo(event);
      if (!value) { showError('请使用 ⌘ / ⌃ / ⌥ 与字母、数字或功能键组合。'); return; }
      const duplicate = bindingIds.find(id => id !== recording && draft[id] === value);
      if (duplicate) {
        const name = duplicate === 'launcher' ? '快捷面板' : actions.find(action => action.id === duplicate).name;
        showError(`与「${name}」的快捷键重复，请换一个组合。`); return;
      }
      clearSaveNotice(); draft[recording] = value; showError(); stopRecording(true); void saveDraft(); return;
    }
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (!state || state.view === 'settings') return;
    if (event.key === 'Tab') {
      const controls = [...$(state.view).querySelectorAll('button')].filter(button => !button.disabled && button.getClientRects().length);
      if (!controls.length) return;
      event.preventDefault();
      const current = controls.indexOf(document.activeElement), step = event.shiftKey ? -1 : 1;
      const target = controls[current < 0 ? (event.shiftKey ? controls.length - 1 : 0) : (current + step + controls.length) % controls.length];
      const index = currentActions().findIndex(action => action.id === target.dataset.action);
      select(index); target.focus({ preventScroll: true });
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const forward = ['ArrowDown', 'ArrowRight'].includes(event.key);
      const count = currentActions().length;
      select(selected < 0 ? (forward ? 0 : count - 1) : (selected + (forward ? 1 : -1) + count) % count, true);
    } else if (event.key === 'Enter' && document.activeElement.matches('[data-action]')) {
      event.preventDefault();
      if (selected >= 0) choose(currentActions()[selected].id);
    } else if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && /^[1-6]$/.test(event.key)) {
      const action = currentActions()[Number(event.key) - 1];
      if (action) { event.preventDefault(); choose(action.id); }
    }
  });

  function refreshAppearance() {
    const resolved = appearance === 'system' ? (system?.matches ? 'dark' : 'light') : appearance;
    document.documentElement.dataset.appearance = resolved;
    document.documentElement.dataset.accessibleAppearance = resolved;
  }
  function applyColorMode(mode, preference, theme) {
    document.documentElement.dataset.colorMode = mode === 'accessible' ? 'accessible' : 'standard';
    document.documentElement.dataset.uiTheme = theme === 'blue' ? 'blue' : 'green';
    $('blue-style').disabled = theme !== 'blue';
    appearance = ['light', 'dark'].includes(preference) ? preference : 'system';
    refreshAppearance();
  }
  applyColorMode('standard', 'system', 'green');
  system?.addEventListener('change', refreshAppearance);
  window.addEventListener('pointermove', () => {
    if (pointerFrame !== null) return;
    pointerFrame = requestAnimationFrame(() => { pointerFrame = null; api?.pointer(); });
  });
  window.addEventListener('focus', () => {
    if (state?.view === 'settings') return;
    requestAnimationFrame(() => { if (state?.view !== 'settings' && document.documentElement.dataset.inputMode === 'pointer' && selected < 0) resetActionSelection(); });
  });
  window.addEventListener('blur', () => { if (recording) stopRecording(); if (state?.view !== 'settings') { pointerPosition = null; pointerInput(); resetActionSelection(); } });
  const unsubscribeState = api?.onState(applyState);
  const unsubscribeColor = api?.onColorMode(applyColorMode);
  window.addEventListener('beforeunload', () => {
    clearTimeout(saveNoticeTimer);
    api?.recording(false);
    unsubscribeState?.(); unsubscribeColor?.();
    if (pointerFrame !== null) cancelAnimationFrame(pointerFrame);
    system?.removeEventListener('change', refreshAppearance);
  }, { once: true });
  if (api) api.getState().then(applyState).catch(() => {
    $('runtime-error').textContent = '快捷面板暂时无法打开，请重新呼出。'; $('runtime-error').hidden = false;
  });
})();
