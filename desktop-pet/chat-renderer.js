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
  let snapshot = { messages: [], history: [], activeChatId: null, busy: false, connection: 'idle', error: null, hasConversation: false };
  let pending = false;
  let stopping = false;
  let composing = false;
  let localError = '';
  let failedDraft = '';
  let stateEvents = 0;
  let historyOpen = false;
  let confirmingNew = false;
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
    if (event.key === 'Escape' && !event.isComposing && !composing && event.keyCode !== 229) {
      event.preventDefault();
      if (confirmingNew) {
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
