const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate: flush } = require('node:timers/promises');

const source = fs.readFileSync(path.join(__dirname, '../chat-renderer.js'), 'utf8');
const idle = () => ({ messages: [], busy: false, connection: 'idle', error: null, hasConversation: false });

function fixture(overrides = {}) {
  let receive;
  const sent = [];
  class Element {
    constructor() {
      this.listeners = new Map(); this.children = []; this.dataset = {}; this.style = {};
      this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false;
      this.scrollTop = 0; this.scrollHeight = 200; this.clientHeight = 200; this.focusCount = 0;
    }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    dispatch(name, fields = {}) { return this.listeners.get(name)?.({ preventDefault() {}, ...fields }); }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    appendChild(child) { child.parent = this; this.children.push(child); }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    focus() { this.focusCount += 1; }
  }
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const document = new Element();
  document.getElementById = get;
  document.createElement = () => new Element();
  document.body = new Element();
  document.activeElement = document.body;
  const window = new Element();
  const api = {
    getState: () => Promise.resolve(idle()),
    onState(callback) { receive = callback; return () => {}; },
    async send(text) { sent.push(text); return { accepted: true }; },
    async stop() {},
    async newChat() { return { accepted: true }; },
    close() {},
    ...overrides
  };
  window.qiuqiuChat = api;
  vm.runInNewContext(source, { document, window });
  return { get, sent, document, window, receive: next => receive(next) };
}

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
  f.get('new-chat').dispatch('click');
  await flush();
  assert.equal(f.get('message-input').value, '');
  assert.equal(f.sent.length, 0);
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
  let snapshot;
  const unsubscribe = api.onState(next => { snapshot = next; });
  listeners.get('pet:chat-state')({}, { busy: true });
  assert.equal(snapshot.busy, true);
  unsubscribe();
  assert.equal(listeners.size, 0);
  api.close();
  assert.deepEqual(sent, [['pet:chat-close']]);
});
