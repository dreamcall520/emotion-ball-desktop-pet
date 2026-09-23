const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate: flush } = require('node:timers/promises');

const source = fs.readFileSync(path.join(__dirname, '../chat-renderer.js'), 'utf8');
const idle = () => ({ messages: [], history: [], activeChatId: null, busy: false, connection: 'idle', error: null, hasConversation: false });
const stored = () => ({
  ...idle(), hasConversation: true, activeChatId: 'chat-a',
  messages: [{ id: 'u', role: 'user', text: '今天散步了吗？' }],
  history: [
    { id: 'chat-a', title: '今天散步了吗？', updatedAt: '2026-09-22T12:00:00.000Z', current: true },
    { id: 'chat-b', title: '<img src=x onerror=alert(1)>', updatedAt: '2026-09-21T12:00:00.000Z', current: false }
  ]
});
const withModels = (state = stored()) => ({
  ...state, modelSelection: 'auto', modelsStatus: 'ready', modelsError: null, activeModel: null,
  models: [{ id: 'gpt-fast', displayName: 'GPT Fast' }, { id: 'gpt-full', displayName: 'GPT Full' }]
});

function fixture(overrides = {}) {
  let receive;
  const sent = [];
  class Element {
    constructor() {
      this.listeners = new Map(); this.children = []; this.dataset = {}; this.style = {};
      this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false;
      this.scrollTop = 0; this.scrollHeight = 200; this.clientHeight = 200; this.focusCount = 0;
      this.attributes = new Map();
    }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    dispatch(name, fields = {}) { return this.listeners.get(name)?.({ preventDefault() {}, stopPropagation() {}, ...fields }); }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    appendChild(child) { if (child.parent) child.remove(); child.parent = this; this.children.push(child); }
    replaceChildren(...children) { this.children.forEach(child => { child.parent = null; }); this.children = []; this.append(...children); }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    focus() { this.focusCount += 1; document.activeElement = this; }
    contains(target) { return target === this || this.children.some(child => child.contains(target)); }
    getBoundingClientRect() { return { top: 412, bottom: 439, left: 23, right: 91, width: 68, height: 27 }; }
    scrollIntoView() {}
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
  }
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const document = new Element();
  document.getElementById = get;
  document.createElement = () => new Element();
  document.body = new Element();
  document.activeElement = document.body;
  const window = new Element();
  window.innerWidth = 360; window.innerHeight = 480;
  const api = {
    getState: () => Promise.resolve(idle()),
    onState(callback) { receive = callback; return () => {}; },
    async send(text) { sent.push(text); return { accepted: true }; },
    async stop() {},
    async newChat() { return { accepted: true }; },
    async selectChat() { return { accepted: true }; },
    async setModel() { return { accepted: true }; },
    async refreshModels() { return { accepted: true }; },
    close() {},
    ...overrides
  };
  window.qiuqiuChat = api;
  vm.runInNewContext(source, { document, window });
  return { get, sent, document, window, options: () => get('model-menu').children.filter(item => item.dataset.model), receive: next => receive(next) };
}

test('自定义模型菜单上下键 Home End Enter 选择，Esc 先关闭菜单并回焦入口', async () => {
  let closes = 0;
  const selected = [];
  const f = fixture({ close: () => { closes += 1; }, setModel: async id => { selected.push(id); return { accepted: true }; } });
  await flush();
  f.receive(withModels());
  const trigger = f.get('chat-model');
  trigger.dispatch('click');
  assert.equal(f.get('model-menu').hidden, false);
  assert.equal(trigger.attributes.get('aria-expanded'), 'true');
  assert.equal(f.options()[0].attributes.get('aria-checked'), 'true');
  assert.equal(f.document.activeElement, f.options()[0]);
  f.get('model-menu').dispatch('keydown', { key: 'End' });
  assert.equal(f.document.activeElement, f.options()[2]);
  f.get('model-menu').dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(f.document.activeElement, f.options()[1]);
  f.get('model-menu').dispatch('keydown', { key: 'Home' });
  assert.equal(f.document.activeElement, f.options()[0]);
  f.get('model-menu').dispatch('keydown', { key: 'ArrowDown' });
  f.get('model-menu').dispatch('keydown', { key: 'Enter' });
  await flush();
  assert.deepEqual(selected, ['gpt-fast']);
  assert.equal(trigger.value, 'gpt-fast');
  assert.equal(f.get('model-menu').hidden, true);
  assert.deepEqual(f.sent, []);
  trigger.dispatch('click');
  f.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(closes, 0);
  assert.equal(f.get('model-menu').hidden, true);
  assert.equal(f.document.activeElement, trigger);
  f.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(closes, 1);
});

test('模型菜单 Tab、外部点击、历史、忙碌均关闭，忙碌时入口不能打开', async () => {
  const f = fixture();
  await flush();
  f.receive(withModels());
  const trigger = f.get('chat-model');
  trigger.dispatch('click');
  f.get('model-menu').dispatch('keydown', { key: 'Tab' });
  assert.equal(f.get('model-menu').hidden, true);
  trigger.dispatch('click');
  f.document.dispatch('pointerdown', { target: f.get('message-input') });
  assert.equal(f.get('model-menu').hidden, true);
  trigger.dispatch('click');
  f.get('chat-history').dispatch('click');
  assert.equal(f.get('model-menu').hidden, true);
  f.get('history-back').dispatch('click');
  trigger.dispatch('click');
  f.receive({ ...withModels(), busy: true });
  assert.equal(f.get('model-menu').hidden, true);
  trigger.dispatch('click');
  assert.equal(f.get('model-menu').hidden, true);
});

test('中文输入确认、Shift+Enter 不发消息；普通 Enter 才明确发送，打开不自动请求聊天', async () => {
  const f = fixture();
  await flush();
  const input = f.get('message-input');
  assert.deepEqual(f.sent, []);
  input.value = '你好';
  input.dispatch('compositionstart');
  input.dispatch('keydown', { key: 'Enter', isComposing: true });
  input.dispatch('compositionend');
  input.dispatch('keydown', { key: 'Enter', keyCode: 229 });
  input.dispatch('keydown', { key: 'Enter', shiftKey: true });
  assert.deepEqual(f.sent, []);
  input.dispatch('keydown', { key: 'Enter' });
  await flush();
  assert.deepEqual(f.sent, ['你好']);
  assert.equal(input.value, '');
});

test('发送失败保留原草稿，不会自动重试；重新编辑也必须再次确认发送', async () => {
  let sends = 0;
  const f = fixture({ async send() { sends += 1; return { accepted: false, error: '请先登录 Codex。' }; } });
  await flush();
  const input = f.get('message-input');
  input.value = '  今天有点累  ';
  f.get('composer').dispatch('submit');
  await flush();
  assert.equal(input.value, '  今天有点累  ');
  assert.equal(f.get('error-text').textContent, '请先登录 Codex。');
  f.get('retry-message').dispatch('click');
  assert.equal(sends, 1);
  f.get('composer').dispatch('submit');
  await flush();
  assert.equal(sends, 2);
});

test('忙碌或发送待确认时阻止重复提交与新聊天，停止只对当前回复触发一次', async () => {
  let resolveSend, stops = 0, newChats = 0, resolveStop;
  const f = fixture({
    send: () => new Promise(resolve => { resolveSend = resolve; }),
    stop: () => { stops += 1; return new Promise(resolve => { resolveStop = resolve; }); },
    newChat: async () => { newChats += 1; return { accepted: true }; }
  });
  await flush();
  f.get('message-input').value = '说句话';
  f.get('composer').dispatch('submit');
  f.get('composer').dispatch('submit');
  f.get('new-chat').dispatch('click');
  assert.equal(newChats, 0);
  assert.equal(f.get('send-message').disabled, true);
  resolveSend({ accepted: true });
  await flush();
  f.receive({ ...idle(), busy: true, connection: 'ready' });
  f.get('new-chat').dispatch('click');
  f.get('stop-message').dispatch('click');
  f.get('stop-message').dispatch('click');
  assert.equal(stops, 1);
  assert.equal(newChats, 0);
  resolveStop();
  await flush();
});

test('流式回复按文字安全展示、不抢输入焦点，用户阅读历史时不拉回底部', async () => {
  const f = fixture();
  await flush();
  const input = f.get('message-input');
  input.value = '未发送的草稿';
  const area = f.get('conversation');
  area.scrollHeight = 1500; area.clientHeight = 250; area.scrollTop = 100;
  f.receive({ ...idle(), busy: true, messages: [{ id: 'a', role: 'assistant', status: 'streaming', text: '<script>alert(1)</script>' }] });
  const first = f.get('messages').children[0];
  assert.equal(first.children[1].textContent, '<script>alert(1)</script>');
  f.receive({ ...idle(), busy: true, messages: [{ id: 'a', role: 'assistant', status: 'streaming', text: '你好，今天怎么样？' }] });
  assert.equal(f.get('messages').children[0], first);
  assert.equal(input.focusCount, 0);
  assert.equal(input.value, '未发送的草稿');
  assert.equal(area.scrollTop, 100);
});

test('晚到的首次状态不能覆盖已收到的新回复', async () => {
  let resolveInitial;
  const f = fixture({ getState: () => new Promise(resolve => { resolveInitial = resolve; }) });
  f.receive({ ...idle(), messages: [{ id: 'current', role: 'assistant', text: '这段刚回复' }] });
  resolveInitial(idle());
  await flush();
  assert.equal(f.get('messages').children.length, 1);
  assert.equal(f.get('messages').children[0].children[1].textContent, '这段刚回复');
});

test('失败之后可找回上一条消息，新聊天不会自动发送', async () => {
  const f = fixture();
  await flush();
  f.receive({ ...idle(), error: '连接中断', hasConversation: true, messages: [{ id: 'u', role: 'user', text: '陪我聊聊' }] });
  assert.equal(f.get('retry-message').hidden, false);
  f.get('retry-message').dispatch('click');
  assert.equal(f.get('message-input').value, '陪我聊聊');
  assert.equal(f.sent.length, 0);
  f.get('chat-history').dispatch('click');
  f.get('new-chat').dispatch('click');
  assert.equal(f.get('message-input').value, '陪我聊聊');
  f.get('confirm-new-chat').dispatch('click');
  await flush();
  assert.equal(f.get('message-input').value, '');
  assert.equal(f.sent.length, 0);
});

test('聊天记录安全显示标题、时间和当前项；返回当前聊天保留草稿且不调用 API', async () => {
  let selections = 0;
  const f = fixture({ selectChat: async () => { selections += 1; return { accepted: true }; } });
  await flush();
  f.receive(stored());
  f.get('message-input').value = '还没说完';
  f.get('chat-history').dispatch('click');
  assert.equal(f.get('history-view').hidden, false);
  assert.equal(f.get('conversation').hidden, true);
  assert.equal(f.get('composer').hidden, true);
  assert.equal(f.get('chat-history').attributes.get('aria-expanded'), 'true');
  const items = f.get('history-list').children;
  assert.equal(items.length, 2);
  assert.equal(items[0].children[0].textContent, '今天散步了吗？');
  assert.match(items[0].children[1].children[0].textContent, /9.*22/);
  assert.equal(items[0].attributes.get('aria-current'), 'true');
  assert.equal(items[1].children[0].textContent, '<img src=x onerror=alert(1)>');
  items[0].dispatch('click');
  await flush();
  assert.equal(selections, 0);
  assert.equal(f.get('message-input').value, '还没说完');
  assert.equal(f.get('history-view').hidden, true);
});

test('切换聊天失败保留原内容和草稿，成功后关闭列表、清空草稿并聚焦输入', async () => {
  const ids = [];
  let succeed = false;
  const f = fixture({ selectChat: async id => {
    ids.push(id);
    return succeed ? { accepted: true } : { accepted: false, error: '请先登录同一个 Codex 账号。' };
  } });
  await flush();
  f.receive(stored());
  f.get('message-input').value = '我的草稿';
  f.get('chat-history').dispatch('click');
  f.get('history-list').children[1].dispatch('click');
  await flush();
  assert.equal(f.get('history-view').hidden, false);
  assert.equal(f.get('message-input').value, '我的草稿');
  assert.equal(f.get('messages').children[0].children[1].textContent, '今天散步了吗？');
  assert.equal(f.get('error-text').textContent, '请先登录同一个 Codex 账号。');
  succeed = true;
  f.get('history-list').children[1].dispatch('click');
  await flush();
  assert.deepEqual(ids, ['chat-b', 'chat-b']);
  assert.equal(f.get('history-view').hidden, true);
  assert.equal(f.get('message-input').value, '');
  assert.equal(f.get('message-input').focusCount, 1);
  assert.equal(f.sent.length, 0);
});

test('新聊天必须二次确认，默认聚焦取消；取消或 Esc 保留草稿、不创建聊天', async () => {
  let creates = 0, closes = 0;
  const f = fixture({ newChat: async () => { creates += 1; return { accepted: true }; }, close: () => { closes += 1; } });
  await flush();
  f.receive(stored());
  f.get('message-input').value = '不要丢掉这句话';
  f.get('chat-history').dispatch('click');
  f.get('new-chat').dispatch('click');
  assert.equal(creates, 0);
  assert.equal(f.get('new-chat-confirmation').hidden, false);
  assert.equal(f.get('cancel-new-chat').focusCount, 1);
  f.get('cancel-new-chat').dispatch('click');
  assert.equal(f.get('new-chat-confirmation').hidden, true);
  assert.equal(f.get('history-view').hidden, false);
  f.get('new-chat').dispatch('click');
  f.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(closes, 0);
  assert.equal(creates, 0);
  assert.equal(f.get('message-input').value, '不要丢掉这句话');
  f.get('new-chat').dispatch('click');
  f.get('confirm-new-chat').dispatch('click');
  await flush();
  assert.equal(creates, 1);
  assert.equal(f.sent.length, 0);
  assert.equal(f.get('message-input').value, '');
  assert.equal(f.get('history-view').hidden, true);
});

test('空聊天不可重复新建；忙碌、连接中及切换待确认时阻止切换或新建', async () => {
  let creates = 0, selections = 0, resolveSelection;
  const f = fixture({
    newChat: async () => { creates += 1; return { accepted: true }; },
    selectChat: () => { selections += 1; return new Promise(resolve => { resolveSelection = resolve; }); }
  });
  await flush();
  f.receive({ ...idle(), activeChatId: 'empty-draft-id', canStartNewChat: false });
  f.get('chat-history').dispatch('click');
  f.get('new-chat').dispatch('click');
  f.get('confirm-new-chat').dispatch('click');
  assert.equal(creates, 0);
  assert.equal(f.get('new-chat').disabled, true);
  f.receive({ ...idle(), activeChatId: 'recoverable-record', canStartNewChat: true });
  assert.equal(f.get('new-chat').disabled, false);
  for (const patch of [{ busy: true }, { connection: 'connecting' }]) {
    f.receive({ ...stored(), ...patch });
    assert.equal(f.get('history-list').children[1].disabled, true);
    f.get('history-list').children[1].dispatch('click');
    f.get('new-chat').dispatch('click');
    f.get('confirm-new-chat').dispatch('click');
  }
  assert.equal(selections, 0);
  assert.equal(creates, 0);
  f.receive(stored());
  f.get('history-list').children[1].dispatch('click');
  f.get('history-list').children[1].dispatch('click');
  f.get('new-chat').dispatch('click');
  assert.equal(selections, 1);
  assert.equal(creates, 0);
  assert.equal(f.get('history-back').disabled, true);
  resolveSelection({ accepted: false, error: '暂时无法打开' });
  await flush();
});

test('新聊天失败保留确认界面、旧消息与草稿，且不会自动重试', async () => {
  let creates = 0;
  const f = fixture({ newChat: async () => { creates += 1; throw new Error('连接暂时不可用'); } });
  await flush();
  f.receive(stored());
  f.get('message-input').value = '先留着';
  f.get('chat-history').dispatch('click');
  f.get('new-chat').dispatch('click');
  f.get('confirm-new-chat').dispatch('click');
  await flush();
  assert.equal(creates, 1);
  assert.equal(f.get('new-chat-confirmation').hidden, false);
  assert.equal(f.get('message-input').value, '先留着');
  assert.equal(f.get('messages').children[0].children[1].textContent, '今天散步了吗？');
  assert.equal(f.get('error-text').textContent, '连接暂时不可用');
});

test('直接选择真实模型或自动选择，不发送消息、不新建聊天，草稿与聊天内容保留', async () => {
  const selections = [];
  let creates = 0, refreshes = 0;
  const f = fixture({
    setModel: async id => { selections.push(id); return { accepted: true }; },
    newChat: async () => { creates += 1; },
    refreshModels: async () => { refreshes += 1; }
  });
  await flush();
  f.receive(withModels());
  const select = f.get('chat-model');
  assert.equal(select.value, 'auto');
  assert.equal(select.disabled, false);
  assert.deepEqual(f.options().map(option => option.children[1].children[0].textContent), ['自动选择', 'GPT Fast', 'GPT Full']);
  assert.match(f.get('model-hint').textContent, /日常优先轻量/);
  assert.equal(f.get('model-feedback').className, 'sr-only');
  f.get('message-input').value = '还没发出的草稿';
  select.value = 'gpt-fast';
  await select.dispatch('change');
  assert.deepEqual(selections, ['gpt-fast']);
  assert.equal(select.value, 'gpt-fast');
  assert.match(f.get('model-hint').textContent, /下条消息起生效/);
  assert.equal(f.get('message-input').value, '还没发出的草稿');
  assert.equal(f.get('messages').children[0].children[1].textContent, '今天散步了吗？');
  select.value = 'auto';
  await select.dispatch('change');
  assert.deepEqual(selections, ['gpt-fast', 'auto']);
  assert.equal(creates, 0);
  assert.equal(refreshes, 0);
  assert.deepEqual(f.sent, []);
});

test('模型保存失败回到已保存选项，提示与聊天错误分离，拒绝及异常均保留草稿', async () => {
  let throws = false;
  const f = fixture({ setModel: async () => {
    if (throws) throw new Error('模型设置暂时无法保存');
    return { accepted: false, error: '这个模型暂不可用' };
  } });
  await flush();
  f.receive({ ...withModels(), modelSelection: 'gpt-full' });
  const select = f.get('chat-model');
  f.get('message-input').value = '请保留我';
  select.value = 'gpt-fast';
  await select.dispatch('change');
  assert.equal(select.value, 'gpt-full');
  assert.equal(f.get('model-hint').textContent, '这个模型暂不可用');
  assert.equal(f.get('model-feedback').className, 'model-feedback');
  assert.equal(f.get('error-banner').hidden, true);
  throws = true;
  select.value = 'auto';
  await select.dispatch('change');
  assert.equal(select.value, 'gpt-full');
  assert.equal(f.get('model-hint').textContent, '模型设置暂时无法保存');
  assert.equal(f.get('message-input').value, '请保留我');
  assert.equal(f.sent.length, 0);
});

test('回复中、连接中、发送待确认及模型保存中均不能切换模型，历史页隐藏模型栏', async () => {
  let changes = 0, resolveSend, resolveModel;
  const f = fixture({
    send: () => new Promise(resolve => { resolveSend = resolve; }),
    setModel: () => { changes += 1; return new Promise(resolve => { resolveModel = resolve; }); }
  });
  await flush();
  const select = f.get('chat-model');
  for (const patch of [{ busy: true }, { connection: 'connecting' }]) {
    f.receive({ ...withModels(), ...patch });
    assert.equal(select.disabled, true);
    select.value = 'gpt-fast';
    await select.dispatch('change');
    assert.equal(select.value, 'auto');
  }
  f.receive(withModels());
  f.get('message-input').value = '你好';
  f.get('composer').dispatch('submit');
  assert.equal(select.disabled, true);
  select.value = 'gpt-fast';
  await select.dispatch('change');
  assert.equal(changes, 0);
  resolveSend({ accepted: true });
  await flush();
  select.value = 'gpt-full';
  const saved = select.dispatch('change');
  assert.equal(changes, 1);
  assert.equal(select.disabled, true);
  select.value = 'auto';
  await select.dispatch('change');
  assert.equal(changes, 1);
  f.get('message-input').value = '保存模型时不能发送';
  f.get('composer').dispatch('submit');
  assert.equal(f.get('send-message').disabled, true);
  resolveModel({ accepted: true });
  await saved;
  f.get('chat-history').dispatch('click');
  assert.equal(f.get('model-bar').hidden, true);
  select.value = 'gpt-fast';
  await select.dispatch('change');
  assert.equal(changes, 1);
  f.get('history-back').dispatch('click');
  assert.equal(f.get('model-bar').hidden, false);
});

test('模型目录失败可单独重试，不消耗聊天消息；已保存但缺失的模型明确标为不可用', async () => {
  let reads = 0, selections = 0, resolveRead;
  const f = fixture({
    refreshModels: () => { reads += 1; return new Promise(resolve => { resolveRead = resolve; }); },
    setModel: async () => { selections += 1; return { accepted: true }; }
  });
  await flush();
  f.receive({ ...withModels(), modelSelection: 'old-model', modelsStatus: 'error', modelsError: '模型列表暂时不可用' });
  assert.equal(f.get('chat-model').value, 'old-model');
  const missing = f.options().find(option => option.value === 'old-model');
  assert.match(missing.children[1].children[0].textContent, /暂不可用/);
  assert.equal(missing.disabled, true);
  assert.equal(f.get('refresh-models').hidden, false);
  assert.equal(f.get('error-banner').hidden, true);
  f.get('message-input').value = '我的草稿';
  const retry = f.get('refresh-models').dispatch('click');
  f.get('refresh-models').dispatch('click');
  assert.equal(reads, 1);
  f.receive({ ...withModels(), modelSelection: 'old-model' });
  resolveRead({ accepted: true });
  await retry;
  assert.equal(f.get('chat-model').value, 'old-model');
  assert.match(f.get('model-hint').textContent, /所选模型暂不可用/);
  assert.equal(f.get('message-input').value, '我的草稿');
  assert.equal(selections, 0);
  assert.deepEqual(f.sent, []);
});

test('模型名按纯文字显示，长名字不丢失；流式更新不反复替换选项，自动结果明确显示', async () => {
  const f = fixture();
  await flush();
  const name = '<img src=x onerror=alert(1)>' + '很长的模型名'.repeat(40);
  const state = { ...withModels(), models: [{ id: 'untrusted', displayName: name }, null, { id: 'untrusted', displayName: '重复' }] };
  f.receive(state);
  const options = f.options();
  assert.equal(options.length, 2);
  assert.equal(options[1].children[1].children[0].textContent, name);
  assert.equal(options[1].innerHTML, undefined);
  f.receive({ ...state, busy: true, activeModel: { model: 'untrusted', displayName: name, automatic: true } });
  assert.equal(f.options()[1], options[1]);
  assert.equal(f.get('model-hint').textContent, `本次自动选用 ${name}`);
  assert.equal(f.get('model-hint').title, `本次自动选用 ${name}`);
  f.receive({ ...state, modelSelection: 'untrusted' });
  assert.ok(f.get('chat-model').title.startsWith(`${name}\n`));
});

test('预加载限制消息类型、长度、固定频道，并能解除订阅', async () => {
  let api;
  const invoked = [], listeners = new Map(), sent = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../chat-preload.js'), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
      ipcRenderer: {
        invoke: (...args) => { invoked.push(args); return Promise.resolve({ accepted: true }); },
        send: (...args) => sent.push(args),
        on: (channel, fn) => listeners.set(channel, fn),
        removeListener: channel => listeners.delete(channel)
      }
    })
  });
  assert.equal((await api.send(' ')).accepted, false);
  assert.equal((await api.send({ text: 'no' })).accepted, false);
  assert.equal((await api.send('a'.repeat(2001))).accepted, false);
  assert.equal(invoked.length, 0);
  await api.send('  你好  ');
  assert.deepEqual(invoked[0], ['pet:chat-send', '你好']);
  assert.equal((await api.selectChat(null)).accepted, false);
  assert.equal((await api.selectChat(' ')).accepted, false);
  assert.equal((await api.selectChat('a'.repeat(201))).accepted, false);
  assert.equal(invoked.length, 1);
  await api.selectChat('chat-record-1');
  assert.deepEqual(invoked[1], ['pet:chat-select', 'chat-record-1']);
  for (const invalid of [null, {}, '', ' ', ' padded ', 'line\nbreak', 'a'.repeat(201)]) {
    assert.equal((await api.setModel(invalid)).accepted, false);
  }
  assert.equal(invoked.length, 2);
  await api.setModel('auto');
  await api.setModel('gpt-fast');
  await api.refreshModels();
  assert.deepEqual(invoked.slice(2), [
    ['pet:chat-model', 'auto'], ['pet:chat-model', 'gpt-fast'], ['pet:chat-models-refresh']
  ]);
  let snapshot;
  const unsubscribe = api.onState(next => { snapshot = next; });
  listeners.get('pet:chat-state')({}, { busy: true });
  assert.equal(snapshot.busy, true);
  unsubscribe();
  assert.equal(listeners.size, 0);
  api.close();
  assert.deepEqual(sent, [['pet:chat-close']]);
});
