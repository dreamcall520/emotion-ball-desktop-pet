const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const flush = () => new Promise(resolve => setImmediate(resolve));
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function fixture({ reduced = false, hidden = false, answer = async () => true } = {}) {
  const nodes = new Map(), documentEvents = new Map(), windowEvents = new Map(), calls = [], portraits = [], active = [];
  let receive, mediaChange, unsubscribed = 0, destroyed = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { disabled: false, textContent: '', listeners: new Map(), focusCalls: 0,
      addEventListener(name, fn) { this.listeners.set(name, fn); }, focus() { this.focusCalls++; } });
    return nodes.get(id);
  };
  const media = { matches: reduced, addEventListener(_name, fn) { mediaChange = fn; }, removeEventListener() { mediaChange = null; } };
  const document = { hidden, documentElement: { dataset: {} }, getElementById: node,
    addEventListener(name, fn) { documentEvents.set(name, fn); } };
  const context = vm.createContext({ document, matchMedia: () => media, Promise,
    addEventListener(name, fn) { windowEvents.set(name, fn); },
    qiuqiuConsent: { getInfo: async () => null, answer(value) { calls.push(value); return answer(value); },
      onInfo(fn) { receive = fn; return () => { unsubscribed++; }; } },
    PetChatAvatar: { create: target => ({ update: (...args) => portraits.push({ target, args }),
      setActive: value => active.push(value), destroy: () => { destroyed++; } }) } });
  context.window = context;
  vm.runInContext(read('codex-consent-renderer.js'), context);
  return { node, calls, portraits, active, document, receive: value => receive(value),
    click: id => node(id).listeners.get('click')(),
    key(key) { let prevented = false; documentEvents.get('keydown')({ key, preventDefault() { prevented = true; } }); return prevented; },
    pointer() { documentEvents.get('pointerdown')(); },
    visibility(value) { document.hidden = value; documentEvents.get('visibilitychange')(); },
    reduced(value) { media.matches = value; mediaChange?.(); },
    unload() { windowEvents.get('beforeunload')(); },
    get unsubscribed() { return unsubscribed; }, get destroyed() { return destroyed; } };
}

test('确认页保持完整披露与默认取消，复用关于页及真实球球资源，禁止远程内容', () => {
  const html = read('codex-consent.html');
  for (const text of ['在本机读取 Codex 的额度与任务状态', '只读查询官方服务的账户重置历史',
    '账户令牌仅用于官方查询，不保存、不发送给其他服务', '状态包可能附带已加载的聊天内容',
    '正文立即丢弃，不保存、不上传', '不监听键盘', '不会代你创建、发送、审批或中断任务', '随时关闭即可停止读取']) assert.ok(html.includes(text), text);
  assert.match(html, /id="consent-cancel"[^>]*autofocus/);
  assert.equal([...html.matchAll(/<li>/g)].length, 4, '只读状态、两条隐私与掌控说明统一列表格式');
  assert.match(html, /<li>账户令牌仅用于官方查询，不保存、不发送给其他服务。<\/li>/);
  assert.match(html, /<li>状态包可能附带已加载的聊天内容；球球只提取进展，正文立即丢弃，不保存、不上传。<\/li>/);
  assert.match(html, /id="consent-accept"[^>]*disabled/);
  assert.match(html, /href="about.css"/); assert.match(html, /src="lib\/chat-avatar.js"/);
  assert.match(html, /connect-src 'self';/); assert.doesNotMatch(html, /https?:\/\//);
  for (const source of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.equal(fs.existsSync(path.resolve(__dirname, '..', source[1])), true, source[1]);
  }
  assert.match(read('codex-consent.css'), /data-appearance="dark"/);
  assert.match(read('codex-consent.css'), /data-color-mode="accessible"/);
});

test('收到可信形象后才能确认，真实外观传入现有头像，默认聚焦取消', async () => {
  const f = fixture(); await flush();
  assert.equal(f.node('consent-accept').disabled, true); assert.deepEqual(f.calls, []);
  f.click('consent-accept'); await flush(); assert.deepEqual(f.calls, []);
  const info = { appearance: { shape: 'aurora-cloud', bodyColor: '#6543EF' }, codexPet: null };
  f.receive(info);
  assert.equal(f.node('consent-accept').disabled, false); assert.equal(f.node('consent-cancel').focusCalls, 1);
  assert.equal(f.portraits[0].args[0], info.appearance); assert.equal(f.portraits[0].args[2], null);
  assert.equal(f.key('Enter'), false); await flush(); assert.deepEqual(f.calls, [], '不绑定全局 Enter 自动同意');
  assert.equal(f.document.documentElement.dataset.consentKeyboard, undefined, '初始默认取消不显示焦点框');
  f.key('Tab'); assert.equal(f.document.documentElement.dataset.consentKeyboard, 'true', 'Tab 恢复键盘焦点提示');
  f.pointer(); assert.equal(f.document.documentElement.dataset.consentKeyboard, undefined, '鼠标操作移除键盘焦点提示');
  assert.equal(f.key('Escape'), true); await flush(); assert.deepEqual(f.calls, [false]);
});

test('提交期间防重复确认，失败不冒充开启，隐藏及减少动态停止头像，卸载释放', async () => {
  let finish;
  const f = fixture({ answer: () => new Promise(resolve => { finish = resolve; }) });
  f.receive({ appearance: { shape: 'blob' } });
  f.click('consent-accept'); f.click('consent-accept'); f.click('consent-cancel');
  assert.deepEqual(f.calls, [true]); assert.equal(f.node('consent-accept').disabled, true);
  finish(false); await flush(); assert.match(f.node('consent-status').textContent, /已失效/);
  f.visibility(true); assert.equal(f.active.at(-1), false); f.click('consent-accept'); assert.deepEqual(f.calls, [true]);
  f.visibility(false); assert.equal(f.active.at(-1), true);
  f.reduced(true); assert.equal(f.active.at(-1), false);
  f.unload(); assert.equal(f.unsubscribed, 1); assert.equal(f.destroyed, 1);
  const count = f.portraits.length; f.receive({ appearance: { shape: 'square' } }); assert.equal(f.portraits.length, count);
});

test('确认预加载只暴露固定布尔回答和只读订阅，监听可释放', async () => {
  let api;
  const calls = [], handlers = new Map();
  const context = vm.createContext({ Promise, require: name => {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld(key, value) { assert.equal(key, 'qiuqiuConsent'); api = value; } },
      ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve(true); },
        on: (key, fn) => handlers.set(key, fn), removeListener: key => handlers.delete(key) } };
  } });
  vm.runInContext(read('codex-consent-preload.js'), context);
  await api.getInfo(); await api.answer(true); await api.answer(false); assert.equal(await api.answer('true'), false);
  assert.deepEqual(calls, [['pet:codex-consent-get'], ['pet:codex-consent-answer', true], ['pet:codex-consent-answer', false]]);
  let info, mode;
  const offInfo = api.onInfo(value => { info = value; }), offMode = api.onColorMode((...args) => { mode = args; });
  handlers.get('pet:codex-consent-info')({}, { appearance: { shape: 'blob' } }); assert.equal(info.appearance.shape, 'blob');
  handlers.get('pet:color-mode')({}, 'accessible', 'dark', 'blue'); assert.deepEqual(mode, ['accessible', 'dark', 'blue']);
  offInfo(); offMode(); assert.equal(handlers.size, 0);
});
