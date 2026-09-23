(() => {
  const api = window.qiuqiuChat;
  const byId = id => document.getElementById(id);
  const input = byId('message-input');
  const conversation = byId('conversation');
  const messages = byId('messages');
  const sendButton = byId('send-message');
  const stopButton = byId('stop-message');
  const newButton = byId('new-chat');
  const historyButton = byId('chat-history');
  const historyList = byId('history-list');
  const retryButton = byId('retry-message');
  const modelSelect = byId('chat-model');
  const modelMenu = byId('model-menu');
  const modelRetry = byId('refresh-models');
  let snapshot = { messages: [], history: [], activeChatId: null, busy: false, connection: 'idle', error: null, hasConversation: false };
  let pending = false;
  let stopping = false;
  let composing = false;
  let localError = '';
  let failedDraft = '';
  let stateEvents = 0;
  let historyOpen = false;
  let confirmingNew = false;
  let modelSaving = '';
  let modelsRefreshing = false;
  let modelError = '';
  let modelChanged = false;
  let modelOptionsKey = '';
  let modelMenuOpen = false;
  let modelOptions = [];
  const rows = new Map();
  const historyRows = new Map();

  function errorMessage(error) {
    return typeof error?.message === 'string' ? error.message : '暂时没连上，请稍后再试。';
  }

  function lastUserText() {
    return [...snapshot.messages].reverse().find(message => message.role === 'user')?.text || '';
  }

  function changeBlocked() {
    return pending || snapshot.busy || snapshot.connection === 'connecting';
  }

  function modelSelection() {
    return typeof snapshot.modelSelection === 'string' && snapshot.modelSelection ? snapshot.modelSelection : 'auto';
  }

  function availableModels() {
    const seen = new Set(['auto']);
    return (Array.isArray(snapshot.models) ? snapshot.models : []).filter(model => {
      if (typeof model?.id !== 'string' || !model.id || seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
  }

  function renderModels() {
    const bar = byId('model-bar');
    bar.hidden = historyOpen;
    const models = availableModels();
    const selected = modelSaving || modelSelection();
    const status = snapshot.modelsStatus || 'idle';
    const missing = selected !== 'auto' && !models.some(model => model.id === selected);
    const choices = [
      { id: 'auto', label: '自动选择' },
      ...models.map(model => ({ id: model.id, label: typeof model.displayName === 'string' && model.displayName.trim() ? model.displayName : model.id }))
    ];
    if (missing) choices.push({ id: selected, label: `${selected}（暂不可用）`, disabled: true });
    const optionsKey = JSON.stringify(choices);
    if (optionsKey !== modelOptionsKey) {
      closeModelMenu(false);
      modelOptionsKey = optionsKey;
      modelOptions = choices.map(choice => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = `model-option${choice.id === 'auto' ? ' model-option-auto' : ''}`;
        option.value = choice.id;
        option.dataset.model = choice.id;
        option.title = choice.label;
        option.tabIndex = -1;
        option.setAttribute('role', 'menuitemradio');
        const check = document.createElement('span');
        check.className = 'model-option-check';
        check.setAttribute('aria-hidden', 'true');
        const content = document.createElement('span');
        content.className = 'model-option-content';
        const label = document.createElement('span');
        label.className = 'model-option-label';
        label.textContent = choice.label;
        content.appendChild(label);
        if (choice.id === 'auto') {
          const description = document.createElement('span');
          description.className = 'model-option-description';
          description.textContent = '日常聊天优先快，需要分析时用更强模型';
          content.appendChild(description);
        }
        option.append(check, content);
        option.disabled = Boolean(choice.disabled);
        option.addEventListener('click', () => chooseModel(choice.id));
        return option;
      });
      const separator = document.createElement('div');
      separator.className = 'model-menu-separator';
      separator.setAttribute('role', 'separator');
      modelMenu.replaceChildren(modelOptions[0], separator, ...modelOptions.slice(1));
    }
    modelSelect.value = selected;
    const selectedLabel = choices.find(choice => choice.id === selected)?.label || selected;
    modelSelect.textContent = selectedLabel;
    modelSelect.disabled = changeBlocked() || modelsRefreshing || status !== 'ready';
    if (modelSelect.disabled || historyOpen) closeModelMenu(false);
    for (const option of modelOptions) {
      const checked = option.value === selected;
      option.setAttribute('aria-checked', String(checked));
      option.children[0].textContent = checked ? '✓' : '';
    }
    const error = modelError || (status === 'error' ? snapshot.modelsError || '暂时无法读取模型列表。' : '');
    const hint = byId('model-hint');
    const active = snapshot.activeModel;
    const activeName = typeof active?.displayName === 'string' ? active.displayName : active?.model;
    hint.textContent = error || (modelSaving ? '正在保存选择…'
      : modelsRefreshing || status === 'loading' || status === 'idle' ? '正在读取可用模型…'
        : missing ? '所选模型暂不可用，请重新选择或重试。'
          : modelChanged ? '下条消息起生效 · 继续当前聊天'
            : selected === 'auto' ? active?.automatic && activeName
              ? `${snapshot.busy ? '本次' : '上次'}自动选用 ${activeName}`
              : '日常优先轻量模型，需要分析时换更强模型'
            : '使用所选模型 · 继续当前聊天');
    hint.title = hint.textContent;
    modelSelect.title = `${selectedLabel}\n${hint.textContent}`;
    byId('model-feedback').className = error || missing ? 'model-feedback' : 'sr-only';
    bar.dataset.error = String(Boolean(error || missing));
    modelRetry.hidden = status !== 'error' && !missing;
    modelRetry.disabled = changeBlocked() || modelsRefreshing;
    modelRetry.textContent = modelsRefreshing ? '读取中…' : '重试';
  }

  function closeModelMenu(returnFocus = true) {
    const wasOpen = modelMenuOpen;
    modelMenuOpen = false;
    modelMenu.hidden = true;
    modelSelect.setAttribute('aria-expanded', 'false');
    if (wasOpen && returnFocus && !modelSelect.disabled) modelSelect.focus();
  }

  function positionModelMenu() {
    if (!modelMenuOpen) return;
    const anchor = modelSelect.getBoundingClientRect();
    const width = Math.min(226, window.innerWidth - 24);
    modelMenu.style.width = `${width}px`;
    modelMenu.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))}px`;
    modelMenu.style.bottom = `${Math.max(0, window.innerHeight - anchor.top + 6)}px`;
    modelMenu.style.maxHeight = `${Math.max(1, anchor.top - 18)}px`;
  }

  function openModelMenu(edge) {
    if (modelSelect.disabled || historyOpen || changeBlocked()) return;
    modelMenuOpen = true;
    modelMenu.hidden = false;
    modelSelect.setAttribute('aria-expanded', 'true');
    positionModelMenu();
    const enabled = modelOptions.filter(option => !option.disabled);
    const target = edge === 'last' ? enabled.at(-1) : edge === 'first' ? enabled[0]
      : enabled.find(option => option.value === modelSelection()) || enabled[0];
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
  }

  function hasCurrentChat() {
    if (typeof snapshot.canStartNewChat === 'boolean') return snapshot.canStartNewChat;
    return Boolean(snapshot.hasConversation || snapshot.messages.length);
  }

  function refreshHistory() {
    byId('history-view').hidden = !historyOpen;
    conversation.hidden = historyOpen;
    byId('composer').hidden = historyOpen;
    byId('privacy-note').hidden = historyOpen;
    historyButton.setAttribute('aria-expanded', String(historyOpen));
    historyButton.disabled = pending;
    byId('history-back').disabled = pending;
    byId('history-browse').hidden = confirmingNew;
    byId('new-chat-confirmation').hidden = !confirmingNew;
    byId('cancel-new-chat').disabled = pending;
    byId('confirm-new-chat').disabled = changeBlocked() || !hasCurrentChat();
    newButton.disabled = changeBlocked() || !hasCurrentChat();
    byId('history-hint').textContent = snapshot.busy || snapshot.connection === 'connecting'
      ? '等这次回复结束后，就可以切换聊天。'
      : hasCurrentChat() ? '原来的聊天会保留，随时可以切回来。' : '当前已是新聊天，直接发送第一句话即可。';
    for (const { button } of historyRows.values()) button.disabled = changeBlocked();
  }

  function closeHistory() {
    if (pending) return;
    historyOpen = false;
    confirmingNew = false;
    refreshControls();
    input.focus();
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function renderHistory() {
    const history = Array.isArray(snapshot.history) ? snapshot.history : [];
    const liveIds = new Set(history.map(chat => chat.id));
    for (const [id, entry] of historyRows) {
      if (!liveIds.has(id)) {
        entry.button.remove();
        historyRows.delete(id);
      }
    }
    for (const chat of history) {
      let entry = historyRows.get(chat.id);
      if (!entry) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'history-item';
        const title = document.createElement('span');
        title.className = 'history-item-title';
        const meta = document.createElement('span');
        meta.className = 'history-item-meta';
        const date = document.createElement('span');
        const current = document.createElement('span');
        current.className = 'history-current';
        meta.append(date, current);
        button.append(title, meta);
        button.addEventListener('click', () => selectChat(chat.id));
        entry = { button, title, date, current };
        historyRows.set(chat.id, entry);
      }
      entry.title.textContent = typeof chat.title === 'string' && chat.title.trim() ? chat.title : '和球球的聊天';
      entry.date.textContent = formatDate(chat.updatedAt);
      const current = chat.id === snapshot.activeChatId || chat.current === true;
      entry.current.textContent = current ? '当前聊天' : '';
      if (current) entry.button.setAttribute('aria-current', 'true');
      else entry.button.removeAttribute('aria-current');
      historyList.appendChild(entry.button);
    }
    historyList.hidden = history.length === 0;
    byId('history-empty').hidden = history.length > 0;
  }

  function refreshControls() {
    const busy = Boolean(snapshot.busy);
    sendButton.hidden = busy;
    sendButton.disabled = changeBlocked() || !input.value.trim() || input.value.length > 2000;
    stopButton.hidden = !busy;
    stopButton.disabled = stopping;
    stopButton.textContent = stopping ? '正在停止…' : '■ 停止';
    const error = localError || snapshot.error || '';
    byId('error-banner').hidden = !error;
    byId('error-text').textContent = error;
    retryButton.hidden = historyOpen || !error || busy || pending || !(failedDraft || lastUserText());
    const count = byId('character-count');
    count.hidden = input.value.length < 1800;
    count.textContent = `${input.value.length} / 2000`;
    byId('input-hint').hidden = !count.hidden;
    const status = byId('connection-status');
    status.textContent = snapshot.connection === 'connecting' ? '正在连接 Codex…' : busy
      ? '球球正在想…'
      : error ? '连接遇到了一点问题'
        : snapshot.hasConversation ? '接着聊，我还记得这一段' : '想说什么，我在听';
    refreshHistory();
    renderModels();
  }

  function resizeInput() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(112, Math.max(40, input.scrollHeight))}px`;
  }

  function makeRow(message) {
    const row = document.createElement('article');
    row.className = 'message';
    const label = document.createElement('div');
    label.className = 'message-label';
    const text = document.createElement('p');
    text.className = 'message-text';
    const status = document.createElement('p');
    status.className = 'message-status';
    row.append(label, text, status);
    messages.appendChild(row);
    const entry = { row, label, text, status };
    rows.set(message.id, entry);
    return entry;
  }

  function render(next) {
    if (!next || !Array.isArray(next.messages)) return;
    const nearBottom = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 40;
    snapshot = next;
    if (next.busy) modelChanged = false;
    const liveIds = new Set(next.messages.map(message => message.id));
    for (const [id, entry] of rows) {
      if (!liveIds.has(id)) {
        entry.row.remove();
        rows.delete(id);
      }
    }
    for (const message of next.messages) {
      const entry = rows.get(message.id) || makeRow(message);
      entry.row.dataset.role = message.role === 'user' ? 'user' : 'assistant';
      entry.row.dataset.status = message.status || 'complete';
      entry.label.textContent = message.role === 'user' ? '你' : '球球';
      const text = typeof message.text === 'string' ? message.text : '';
      if (entry.text.textContent !== text) entry.text.textContent = text;
      entry.status.textContent = message.status === 'streaming' ? (text ? '正在回复…' : '想一想…')
        : message.status === 'interrupted' ? '已停止回复'
          : message.status === 'error' ? '这次回复未完成' : '';
      entry.status.hidden = !entry.status.textContent;
    }
    byId('empty-state').hidden = next.messages.length > 0;
    renderHistory();
    if (!next.busy) stopping = false;
    refreshControls();
    if (nearBottom) conversation.scrollTop = conversation.scrollHeight;
  }

  async function send() {
    if (changeBlocked() || composing || historyOpen) return;
    const draft = input.value;
    const text = draft.trim();
    if (!text || draft.length > 2000) return;
    pending = true;
    localError = '';
    failedDraft = draft;
    refreshControls();
    try {
      const result = await api.send(text);
      if (!result?.accepted) {
        localError = result?.error || '消息没有发出，请稍后再试。';
      } else {
        failedDraft = '';
        if (input.value === draft) {
          input.value = '';
          resizeInput();
        }
      }
    } catch (error) {
      localError = errorMessage(error);
    } finally {
      pending = false;
      refreshControls();
    }
  }

  byId('composer').addEventListener('submit', event => {
    event.preventDefault();
    send();
  });
  async function chooseModel(selected) {
    if (changeBlocked() || historyOpen || modelsRefreshing || snapshot.modelsStatus !== 'ready' ||
        selected === modelSelection() || (selected !== 'auto' && !availableModels().some(model => model.id === selected))) {
      closeModelMenu();
      renderModels();
      return;
    }
    closeModelMenu();
    pending = true;
    modelSaving = selected;
    modelError = '';
    refreshControls();
    try {
      const result = await api.setModel(selected);
      if (!result?.accepted) modelError = result?.error || '模型选择没有保存，请重试。';
      else {
        snapshot = { ...snapshot, modelSelection: selected };
        modelChanged = true;
      }
    } catch (error) {
      modelError = typeof error?.message === 'string' ? error.message : '模型选择没有保存，请重试。';
    } finally {
      pending = false;
      modelSaving = '';
      refreshControls();
    }
  }
  modelSelect.addEventListener('change', () => chooseModel(modelSelect.value));
  modelSelect.addEventListener('click', () => modelMenuOpen ? closeModelMenu() : openModelMenu());
  modelSelect.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      openModelMenu(event.key === 'ArrowUp' || event.key === 'End' ? 'last' : 'first');
    }
  });
  modelMenu.addEventListener('keydown', event => {
    if (event.key === 'Tab') { closeModelMenu(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { closeModelMenu(); return; }
    const enabled = modelOptions.filter(option => !option.disabled);
    const index = enabled.indexOf(document.activeElement);
    if (event.key === 'Enter' || event.key === ' ') {
      if (index >= 0) chooseModel(enabled[index].value);
      return;
    }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
    enabled[next]?.focus();
    enabled[next]?.scrollIntoView({ block: 'nearest' });
  });
  document.addEventListener('pointerdown', event => {
    if (modelMenuOpen && !modelMenu.contains(event.target) && !byId('model-bar').contains(event.target)) closeModelMenu(false);
  });
  document.addEventListener('focusin', event => {
    if (modelMenuOpen && !modelMenu.contains(event.target) && !byId('model-bar').contains(event.target)) closeModelMenu(false);
  });
  window.addEventListener('resize', positionModelMenu);
  window.addEventListener('blur', () => closeModelMenu(false));
  modelRetry.addEventListener('click', async () => {
    if (changeBlocked() || historyOpen || modelsRefreshing) return;
    modelsRefreshing = true;
    modelError = '';
    renderModels();
    try {
      const result = await api.refreshModels();
      if (result?.accepted === false) modelError = result.error || '暂时无法读取模型列表。';
    } catch (error) {
      modelError = typeof error?.message === 'string' ? error.message : '暂时无法读取模型列表。';
    } finally {
      modelsRefreshing = false;
      renderModels();
    }
  });
  input.addEventListener('input', () => {
    resizeInput();
    refreshControls();
  });
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !composing && event.keyCode !== 229) {
      event.preventDefault();
      send();
    }
  });
  byId('close-chat').addEventListener('click', () => api.close());
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape' && !event.isComposing && !composing && event.keyCode !== 229) {
      event.preventDefault();
      if (modelMenuOpen) closeModelMenu();
      else if (confirmingNew) {
        if (pending) return;
        confirmingNew = false;
        refreshControls();
        newButton.focus();
      } else if (historyOpen) closeHistory();
      else api.close();
    }
  });
  stopButton.addEventListener('click', async () => {
    if (!snapshot.busy || stopping) return;
    stopping = true;
    localError = '';
    refreshControls();
    try {
      await api.stop();
    } catch (error) {
      localError = errorMessage(error);
    } finally {
      stopping = false;
      refreshControls();
    }
  });
  async function changeChat(action, fallbackError) {
    if (changeBlocked()) return;
    pending = true;
    localError = '';
    refreshControls();
    try {
      const result = await action();
      if (!result?.accepted) localError = result?.error || fallbackError;
      else {
        input.value = '';
        failedDraft = '';
        resizeInput();
        historyOpen = false;
        confirmingNew = false;
        conversation.scrollTop = conversation.scrollHeight;
      }
    } catch (error) {
      localError = errorMessage(error);
    } finally {
      pending = false;
      refreshControls();
      if (!historyOpen) input.focus();
    }
  }
  async function selectChat(id) {
    if (changeBlocked() || !historyOpen || confirmingNew) return;
    if (id === snapshot.activeChatId) {
      closeHistory();
      return;
    }
    await changeChat(() => api.selectChat(id), '暂时无法打开这段聊天，请稍后再试。');
  }
  historyButton.addEventListener('click', () => {
    if (pending) return;
    if (historyOpen) closeHistory();
    else {
      historyOpen = true;
      confirmingNew = false;
      refreshControls();
    }
  });
  byId('history-back').addEventListener('click', closeHistory);
  newButton.addEventListener('click', () => {
    if (changeBlocked() || !hasCurrentChat() || !historyOpen || confirmingNew) return;
    confirmingNew = true;
    localError = '';
    refreshControls();
    byId('cancel-new-chat').focus();
  });
  byId('cancel-new-chat').addEventListener('click', () => {
    if (pending) return;
    confirmingNew = false;
    refreshControls();
    newButton.focus();
  });
  byId('confirm-new-chat').addEventListener('click', () => {
    if (!confirmingNew || !historyOpen || !hasCurrentChat()) return;
    return changeChat(() => api.newChat(), '暂时无法开始新聊天，请稍后再试。');
  });
  retryButton.addEventListener('click', () => {
    if (snapshot.busy || pending) return;
    // A failed turn may already have reached Codex. Let the user review before sending again.
    if (!input.value.trim()) input.value = (failedDraft || lastUserText()).slice(0, 2000);
    resizeInput();
    refreshControls();
    input.focus();
  });
  window.addEventListener('focus', () => {
    if (!historyOpen && document.activeElement === document.body) input.focus();
  });
  const unsubscribe = api.onState(next => {
    stateEvents += 1;
    render(next);
  });
  window.addEventListener('beforeunload', unsubscribe);
  const initialEvents = stateEvents;
  api.getState().then(next => {
    if (stateEvents === initialEvents) render(next);
  }).catch(error => {
    if (stateEvents !== initialEvents) return;
    localError = errorMessage(error);
    refreshControls();
  });
  refreshControls();
})();
