(() => {
  const api = window.qiuqiuChat;
  const byId = id => document.getElementById(id);
  const input = byId('message-input');
  const conversation = byId('conversation');
  const messages = byId('messages');
  const sendButton = byId('send-message');
  const stopButton = byId('stop-message');
  const newButton = byId('new-chat');
  const retryButton = byId('retry-message');
  let snapshot = { messages: [], busy: false, connection: 'idle', error: null, hasConversation: false };
  let pending = false;
  let stopping = false;
  let composing = false;
  let localError = '';
  let failedDraft = '';
  let stateEvents = 0;
  const rows = new Map();

  function errorMessage(error) {
    return typeof error?.message === 'string' ? error.message : '暂时没连上，请稍后再试。';
  }

  function lastUserText() {
    return [...snapshot.messages].reverse().find(message => message.role === 'user')?.text || '';
  }

  function refreshControls() {
    const busy = Boolean(snapshot.busy);
    sendButton.hidden = busy;
    sendButton.disabled = pending || busy || !input.value.trim() || input.value.length > 2000;
    stopButton.hidden = !busy;
    stopButton.disabled = stopping;
    stopButton.textContent = stopping ? '正在停止…' : '■ 停止';
    newButton.disabled = busy || pending;
    const error = localError || snapshot.error || '';
    byId('error-banner').hidden = !error;
    byId('error-text').textContent = error;
    retryButton.hidden = !error || busy || pending || !(failedDraft || lastUserText());
    const count = byId('character-count');
    count.hidden = input.value.length < 1800;
    count.textContent = `${input.value.length} / 2000`;
    byId('input-hint').hidden = !count.hidden;
    const status = byId('connection-status');
    status.textContent = busy
      ? (snapshot.connection === 'connecting' ? '正在连接 Codex…' : '球球正在想…')
      : error ? '连接遇到了一点问题'
        : snapshot.hasConversation ? '接着聊，我还记得这一段' : '想说什么，我在听';
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
    if (!next.busy) stopping = false;
    refreshControls();
    if (nearBottom) conversation.scrollTop = conversation.scrollHeight;
  }

  async function send() {
    if (pending || snapshot.busy || composing) return;
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
      api.close();
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
  newButton.addEventListener('click', async () => {
    if (pending || snapshot.busy) return;
    pending = true;
    localError = '';
    refreshControls();
    try {
      const result = await api.newChat();
      if (!result?.accepted) localError = result?.error || '暂时无法开始新聊天，请稍后再试。';
      else {
        input.value = '';
        failedDraft = '';
        resizeInput();
        input.focus();
      }
    } catch (error) {
      localError = errorMessage(error);
    } finally {
      pending = false;
      refreshControls();
    }
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
    if (document.activeElement === document.body) input.focus();
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
