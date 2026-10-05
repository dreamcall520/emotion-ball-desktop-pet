/* A deterministic, local-only product demo. No model, account, storage or network. */
(() => {
  const root = document.querySelector('[data-chat-demo]');
  if (!root) return;
  const get = name => root.querySelector(`[data-chat-${name}]`);
  const seeds = {
    today: [['user', '今天忙了一整天，想歇一会儿。'], ['assistant', '那就先把肩膀放松一点，我陪你待一会儿。']],
    earlier: [['user', '明天想早点把手头的事情做完。'], ['assistant', '先挑一件最重要的小事吧，给自己留一点不赶时间的余地。']],
    fresh: []
  };
  let records, current, timer, replying = false, nextChat = 0;
  function closePanels() {
    get('model-picker').open = false;
    get('records').hidden = true; get('confirm').hidden = true;
    get('history').setAttribute('aria-expanded', 'false');
  }
  root.querySelectorAll('[data-chat-model]').forEach(button => button.addEventListener('click', () => {
    get('model-label').textContent = button.dataset.chatModel;
    root.querySelectorAll('[data-chat-model]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    get('model-picker').open = false;
    get('model-picker').querySelector('summary').focus();
    get('status').textContent = `示例：已选择${button.dataset.chatModel}，仍在同一段聊天，未发送消息`;
  }));
  document.addEventListener('click', event => {
    if (!get('model-picker').contains(event.target)) get('model-picker').open = false;
  });
  function render() {
    get('messages').replaceChildren();
    for (const [role, text] of records[current]) {
      const item = document.createElement('div'); item.className = `chat-message chat-message-${role}`;
      const label = document.createElement('span'); label.textContent = role === 'user' ? '你' : '球球';
      const p = document.createElement('p'); p.textContent = text; item.append(label, p); get('messages').append(item);
    }
    const sent = records[current].length > (seeds[current]?.length || 0);
    get('new').hidden = false;
    get('new').disabled = replying;
    get('history').disabled = replying;
    root.querySelectorAll('[data-chat-select]').forEach(b => { b.disabled = replying; });
    get('send').disabled = sent; get('send').textContent = sent ? '已发送' : '发送示例';
    get('draft').textContent = sent ? '这句话仍留在同一段聊天里。' : current === 'today' ? '那就陪我放松一下吧。' : current === 'earlier' ? '我想接着上次的小计划聊。' : '你好呀，球球。';
    get('subtitle').textContent = current === 'fresh' && !sent ? '发送第一句话，才开始新聊天' : '接着聊，我还记得这一段';
    get('status').textContent = current.startsWith('fresh') ? '示例：旧记录保留在“历史”里' : '示例：延续同一段聊天';
    root.querySelectorAll('[data-chat-select]').forEach(b => b.setAttribute('aria-current', String(b.dataset.chatSelect === current)));
    get('messages').scrollTop = get('messages').scrollHeight;
  }
  get('history').addEventListener('click', () => { if (replying) return; const open = get('records').hidden; closePanels(); get('records').hidden = !open; get('history').setAttribute('aria-expanded', String(open)); });
  function bindHistory(button) {
    button.addEventListener('click', () => { if (replying) return; current = button.dataset.chatSelect; closePanels(); render(); get('history').focus(); });
  }
  root.querySelectorAll('[data-chat-select]').forEach(bindHistory);
  get('new').addEventListener('click', () => { if (replying || !records[current].length) return; closePanels(); get('confirm').hidden = false; get('cancel').focus(); });
  get('cancel').addEventListener('click', () => { closePanels(); get('new').focus(); });
  get('create').addEventListener('click', () => { if (replying || get('confirm').hidden) return; current = 'fresh'; closePanels(); render(); get('send').focus(); });
  get('send').addEventListener('click', () => {
    if (replying || get('send').disabled || !get('confirm').hidden || !get('records').hidden) return;
    const draft = get('draft').textContent;
    if (current === 'fresh') {
      current = `fresh-${++nextChat}`; records[current] = [];
      const button = document.createElement('button'); button.type = 'button';
      button.dataset.chatSelect = current; button.textContent = `新聊天 ${nextChat} · 你好呀，球球。`;
      bindHistory(button); get('records').append(button);
    }
    const target = records[current], key = current;
    replying = true; closePanels();
    records[current].push(['user', draft]); render(); get('status').textContent = '示例回复中…';
    timer = setTimeout(() => {
      target.push(['assistant', key === 'today' ? '好呀。先慢慢呼一口气，今天剩下的时间不用急。' : key === 'earlier' ? '记得的。我们就从那件最重要的小事开始，慢慢来。' : '你好，我在。想从什么聊起？']);
      replying = false;
      if (records[current] === target) render();
    }, 450);
  });
  const reset = () => { clearTimeout(timer); replying = false; nextChat = 0; root.querySelectorAll('[data-chat-select]').forEach(b => { if (!seeds[b.dataset.chatSelect]) b.remove(); }); records = structuredClone(seeds); current = 'today'; get('model-label').textContent = '自动'; root.querySelectorAll('[data-chat-model]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.chatModel === '自动'))); closePanels(); render(); };
  document.querySelector('[data-chat-reset]').addEventListener('click', reset);
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { const modelOpen = get('model-picker').open, confirming = !get('confirm').hidden; closePanels(); (modelOpen ? get('model-picker').querySelector('summary') : confirming ? get('new') : get('history')).focus(); } });
  const reopen = document.querySelector('[data-chat-reopen]');
  get('close')?.addEventListener('click', () => { root.hidden = true; reopen.hidden = false; reopen.focus(); });
  reopen?.addEventListener('click', () => { root.hidden = false; reopen.hidden = true; get('history').focus(); });
  reset();
})();
