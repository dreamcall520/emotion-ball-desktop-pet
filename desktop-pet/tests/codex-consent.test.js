const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const flush = () => new Promise(resolve => setImmediate(resolve));
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function fixture({ reduced = false, hidden = false, answer = async () => true, info = null } = {}) {
  const nodes = new Map(), documentEvents = new Map(), windowEvents = new Map(), calls = [], portraits = [], active = [];
  let receive, mediaChange, unsubscribed = 0, destroyed = 0;
  const element = (tagName, id = '', textContent = '') => ({
    tagName: tagName.toUpperCase(), id, className: '', textContent, disabled: false, listeners: new Map(), focusCalls: 0,
    children: [], parentElement: null,
    addEventListener(name, fn) { this.listeners.set(name, fn); }, focus() { this.focusCalls++; },
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    replaceWith(next) {
      const parent = this.parentElement; assert.ok(parent, 'replaced disclosure is attached');
      const index = parent.children.indexOf(this); assert.ok(index >= 0);
      parent.children[index] = next; next.parentElement = parent; this.parentElement = null;
      const register = value => { if(value.id) nodes.set(value.id,value); value.children.forEach(register); }; register(next);
    }
  });
  const node = id => {
    if (!nodes.has(id)) {
      const match = new RegExp(`<([^\\s>]+)[^>]*id="${id}"[^>]*>([^<]*)`).exec(read('codex-consent.html'));
      const value = element(match?.[1] || 'div',id,match?.[2] || '');
      element('section').appendChild(value); nodes.set(id,value);
    }
    return nodes.get(id);
  };
  const media = { matches: reduced, addEventListener(_name, fn) { mediaChange = fn; }, removeEventListener() { mediaChange = null; } };
  const document = { hidden, title: '开启 Codex 联动', documentElement: { dataset: {} }, getElementById: node, createElement: tagName => element(tagName),
    addEventListener(name, fn) { documentEvents.set(name, fn); } };
  const context = vm.createContext({ document, matchMedia: () => media, Promise,
    addEventListener(name, fn) { windowEvents.set(name, fn); },
    qiuqiuConsent: { getInfo: async () => info, answer(value) { calls.push(value); return answer(value); },
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
  assert.equal([...html.matchAll(/<li(?:\s|>)/g)].length, 4, '四条披露统一圆点列表');
  assert.match(html, /<li[^>]*>账户令牌仅用于官方查询，不保存、不发送给其他服务。<\/li>/);
  assert.match(html, /<li[^>]*>状态包可能附带已加载的聊天内容；球球只提取进展，正文立即丢弃，不保存、不上传。<\/li>/);
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

test('ZCode 信息复用相同头像与控件，仅用文本替换完整授权事实', async () => {
  const info = { sourceId: 'zcode', appearance: { shape: 'blob' } };
  const f = fixture({ info }); await flush();
  assert.equal(f.document.title, '开启 ZCode 联动');
  assert.equal(f.node('consent-title').textContent, '让球球陪你关注 ZCode');
  assert.equal(f.node('consent-subtitle').textContent, '提醒额度余量，也留意任务进展。');
  assert.match(f.node('consent-state-body').textContent, /本机 ZCode 当前登录账号的套餐、额度与任务状态/);
  assert.match(f.node('consent-privacy-credentials').textContent, /凭据.*官方服务.*不保存/);
  assert.match(f.node('consent-privacy-messages').textContent, /你主动发送.*对应模型与额度.*球球自身的聊天会话/);
  assert.match(f.node('consent-control-body').textContent, /其他 ZCode 任务/);
  assert.equal(f.node('consent-status').textContent, '可随时在「ZCode 联动」中关闭。');
  assert.equal(f.portraits[0].args[0], info.appearance); assert.equal(f.node('consent-cancel').focusCalls, 1);
  f.click('consent-accept'); await flush(); assert.deepEqual(f.calls, [true]);
  assert.doesNotMatch(read('codex-consent-renderer.js'), /innerHTML/);
});

test('默认 Codex 披露不随来源扩展变化，onInfo 同样可更新 ZCode 授权文案', async () => {
  const f = fixture(); f.receive({ appearance: { shape: 'blob' } });
  assert.equal(f.document.title, '开启 Codex 联动');
  assert.equal(f.node('consent-title').textContent, '让球球陪你关注 Codex');
  assert.match(f.node('consent-control-body').textContent, /不会代你创建、发送、审批或中断任务/);
  f.receive({ sourceId: 'zcode', appearance: { shape: 'blob' } });
  assert.equal(f.node('consent-title').textContent, '让球球陪你关注 ZCode');
  assert.doesNotMatch(f.node('consent-control-body').textContent, /不会.*发送/);
});

test('ZCode 预加载固定绑定独立频道，不能切到 Codex 授权频道', async () => {
  let api; const calls = [], handlers = new Map();
  const context = vm.createContext({ Promise, process: { argv: ['electron', '--pet-source=zcode'] }, require: name => {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld(_key, value) { api = value; } }, ipcRenderer: {
      invoke: (...args) => { calls.push(args); return Promise.resolve(true); },
      on: (key, fn) => handlers.set(key, fn), removeListener: key => handlers.delete(key)
    } };
  } });
  vm.runInContext(read('codex-consent-preload.js'), context);
  await api.getInfo(); await api.answer(true); context.process.argv = []; await api.answer(false); await api.answer({ accepted: true });
  assert.deepEqual(calls, [['pet:zcode-consent-get'], ['pet:zcode-consent-answer', true], ['pet:zcode-consent-answer', false]]);
  let received; const off = api.onInfo(value => { received = value; });
  assert.equal(handlers.has('pet:codex-consent-info'), false);
  handlers.get('pet:zcode-consent-info')({}, { sourceId: 'zcode', appearance: { shape: 'blob' } });
  assert.equal(received.sourceId, 'zcode'); off(); assert.equal(handlers.size, 0);
});

test('ZCode 形象信息刷新不会覆盖提交失败反馈', async () => {
  const f = fixture({ answer: async () => false });
  f.receive({ sourceId: 'zcode', appearance: { shape: 'blob' } });
  f.click('consent-accept'); await flush(); const error = f.node('consent-status').textContent;
  assert.match(error, /已失效/);
  f.receive({ sourceId: 'zcode', appearance: { shape: 'aurora-cloud' } });
  assert.equal(f.node('consent-status').textContent, error);
  assert.equal(f.portraits.length, 2);
});


test('ZCode 本机状态和由你掌控复用隐私列表样式，保留原ID且重复更新不嵌套，Codex同样使用圆点', async () => {
  const f=fixture();f.receive({appearance:{shape:'blob'}});
  for(const id of ['consent-state-body','consent-control-body']) assert.equal(f.node(id).tagName,'LI');
  f.receive({sourceId:'zcode',appearance:{shape:'blob'}});
  const bodies=['consent-state-body','consent-control-body'].map(id=>f.node(id));
  bodies.forEach((body,index)=>{
    assert.equal(body.tagName,'LI');assert.equal(body.id,['consent-state-body','consent-control-body'][index]);
    assert.equal(body.parentElement.tagName,'UL');assert.equal(body.parentElement.className,'consent-privacy');
    assert.equal(body.parentElement.children.length,1);assert.equal(body.parentElement.parentElement.tagName,'SECTION');
  });
  f.receive({sourceId:'zcode',appearance:{shape:'aurora-cloud'}});
  bodies.forEach(body=>assert.equal(f.node(body.id),body,'appearance updates keep the same disclosure list item'));
  assert.match(f.node('consent-state-body').textContent,/套餐、额度与任务状态/);
  assert.match(f.node('consent-control-body').textContent,/不监听键盘/);
  assert.deepEqual(f.calls,[],'formatting does not grant consent');
});
