(() => {
  'use strict';
  const el = id => document.getElementById(id), api = window.storeConnections;
  const model = window.ProviderConnectionGuide;
  let busy = false, state = null, closed = false, refreshPending = false;
  const statusLabels = { ready: '已连接', working: '连接中', 'needs-authorization': '尚未连接', partial: '部分可用', unknown: '待更新', unavailable: '暂不可用' };
  function setAvailability() {
    for (const button of document.querySelectorAll('button')) button.disabled = busy;
    const chat = state && model.buildToolCard(state, 'codex').chat;
    const ready = chat?.status === 'ready' || ['needs-model', 'needs-new-chat'].includes(state?.onboarding?.codex?.chat?.status);
    el('open-chat').disabled = busy || !ready;
    el('connect').disabled = busy || state?.onboarding?.codex?.status === 'working';
    el('connect').textContent = state?.onboarding?.codex?.status === 'working' ? '正在连接本机 Codex…' : ready ? '检查本机 Codex 连接' : '连接本机 Codex';
  }
  function paint(next) {
    if (!next || closed) return;
    state = next;
    const card = model.buildToolCard(next, 'codex');
    el('codex-status').textContent = statusLabels[card.status] || card.statusLabel || '待更新';
    el('codex-quota').textContent = card.quota.text;
    el('codex-chat').textContent = card.chat.text;
    const at = card.quota.updatedAt;
    el('codex-updated').textContent = Number.isFinite(at) ? '额度更新：' + new Date(at).toLocaleString('zh-CN') : '额度按实际读取结果显示，不以原软件其他账号的额度替代。';
    el('task-scope').textContent = next.codex?.directory === 'stored' ? card.tasks.text : '尚未开启，不影响额度和聊天。';
    el('connect-tasks').textContent = next.codex?.directory === 'stored' ? '检查任务同步' : '开启任务同步';
    const snapshot = next.codexSnapshot?.tasks, rows = next.codex?.directory === 'stored' && Array.isArray(snapshot?.items) ? snapshot.items.slice(0, 20) : [];
    const labels = { active: '进行中', completed: '已完成', interrupted: '已中断', failed: '失败', unknown: '状态未知' };
    el('task-list').replaceChildren(...rows.map(item => {
      const li = document.createElement('li');
      const phase = labels[item.state] || '状态未知';
      li.textContent = (typeof item.title === 'string' ? item.title : typeof item.name === 'string' ? item.name : '未命名任务') + ' · ' +
        (snapshot.state !== 'connected' || snapshot.stale === true ? '上次记录：' + phase + '（当前待核实）' : phase);
      return li;
    }));
    setAvailability();
  }
  async function readStatus() {
    if (closed) return;
    if (busy) { refreshPending = true; return; }
    try { const response = await api.command('status'); if (response?.state) paint(response.state); }
    catch (_) { if (!closed) el('message').textContent = '暂时无法读取连接状态，可稍后重试。'; }
  }
  async function act(action, payload) {
    if (busy || closed) return;
    busy = true; setAvailability(); el('message').textContent = '正在处理…';
    try {
      const response = await api.command(action, payload);
      if (closed) return;
      if (response?.state) paint(response.state);
      el('message').textContent = response?.message || (response?.ok ? '操作已完成。' : '操作未完成，已有其他能力保持。');
    } catch (_) { if (!closed) el('message').textContent = '操作未完成，可稍后重试；不会自动发送消息。'; }
    finally {
      busy = false;
      if (!closed) { setAvailability(); if (refreshPending) { refreshPending = false; void readStatus(); } }
    }
  }
  el('connect').onclick = () => act('enable-provider', { provider: 'codex', capability: 'chat' });
  el('refresh-quota').onclick = () => act('refresh-status');
  el('open-chat').onclick = () => act('open-provider-chat', { provider: 'codex' });
  el('connect-tasks').onclick = () => act('enable-provider-data', { provider: 'codex', capability: 'data' });
  el('revoke-consent').onclick = () => act('revoke-chat-data-consent', { provider: 'codex' });
  el('disconnect').onclick = () => act('revoke-provider', { provider: 'codex' });
  const stop = api.onChange(() => { void readStatus(); });
  window.addEventListener('beforeunload', () => { closed = true; stop?.(); });
  void readStatus();
})();
