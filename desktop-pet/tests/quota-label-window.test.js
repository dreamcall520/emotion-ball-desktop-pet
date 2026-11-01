const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: flush } = require('node:timers/promises');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createQuotaLabelWindow } = require('../lib/quota-label-window');

const AREA = Object.freeze({ x: 0, y: 0, width: 1440, height: 900 });
const readyModel = () => ({
  state: 'ready',
  items: [{ id: 'private-id', label: 'Codex', windowMinutes: 300, remaining: 47.6, resetsAt: 2000000000000 }],
  overflow: 0,
  resetCreditsAvailable: 1
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(load = () => Promise.resolve(), options = {}) {
  const windows = [];
  const errors = [];
  const matching = [];
  let pet = {
    destroyed: false,
    visible: true,
    bounds: { x: 300, y: 300, width: 80, height: 80 },
    isDestroyed() { return this.destroyed; },
    isVisible() { return this.visible; },
    getBounds() { return { ...this.bounds }; }
  };
  let obstacle = null;
  let presentation = options.presentation || null;
  const maybeThrow = (name, target) => {
    if (typeof options.onCall === 'function') options.onCall(name, windows.length, target);
    if (typeof options.fail === 'function' && options.fail(name, windows.length, target)) {
      throw new Error(`${name} failed`);
    }
  };

  class NativeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.visible = false;
      this.ignoreCalls = [];
      this.boundsCalls = [];this.boundsAnimations=[];
      this.sent = [];
      this.topmostCalls = [];
      this.openHandler = null;
      this.loadedFile = null;
      this.webContents = new EventEmitter();
      this.webContents.destroyed = false;
      this.webContents.isDestroyed = () => this.webContents.destroyed;
      this.webContents.send = (...args) => { maybeThrow('send', this); this.sent.push(args); };
      this.webContents.setWindowOpenHandler = handler => { maybeThrow('setWindowOpenHandler', this); this.openHandler = handler; };
      windows.push(this);
      maybeThrow('constructor', this);
    }
    setAlwaysOnTop(...args) { maybeThrow('setAlwaysOnTop', this); this.topmostCalls.push(args); }
    setVisibleOnAllWorkspaces() { maybeThrow('setVisibleOnAllWorkspaces', this); }
    setHiddenInMissionControl() { maybeThrow('setHiddenInMissionControl', this); }
    setBounds(bounds,animate) { this.boundsAnimations.push(animate);maybeThrow('setBounds', this); this.boundsCalls.push({ ...bounds }); this.bounds = { ...bounds }; }
    setIgnoreMouseEvents(...args) { maybeThrow('setIgnoreMouseEvents', this); this.ignoreCalls.push(args); }
    loadFile(file) { maybeThrow('loadFile', this); this.loadedFile = file; return load(windows.length, this); }
    showInactive() { maybeThrow('showInactive', this); this.visible = true; this.showInactiveCalls = (this.showInactiveCalls || 0) + 1; }
    hide() { maybeThrow('hide', this); this.visible = false; this.hideCalls = (this.hideCalls || 0) + 1; }
    isDestroyed() { maybeThrow('isDestroyed', this); return this.destroyed; }
    isVisible() { return this.visible; }
    getBounds() { return { ...this.bounds }; }
    destroy() {
      maybeThrow('destroy', this);
      if (this.destroyed) return;
      this.destroyed = true;
      this.visible = false;
      this.destroyCalls = (this.destroyCalls || 0) + 1;
      this.emit('closed');
    }
  }

  const label = createQuotaLabelWindow({
    BrowserWindow: NativeWindow,
    sourceId: options.sourceId,
    screen: {
      ...(options.getCursorScreenPoint ? { getCursorScreenPoint: options.getCursorScreenPoint } : {}),
      getDisplayMatching(bounds) {
        matching.push({ ...bounds });
        return { workArea: AREA };
      }
    },
    getPetWindow: () => pet,
    getObstacle: () => obstacle,
    getSize: () => options.labelSize || 'standard',
    getAppearance: () => options.appearance || 'system',
    getPresentation: () => presentation,
    getSuppressed: () => options.getSuppressed?.() === true,
    getGuardEntry: () => options.getGuardEntry?.() === true,
    onLayout: () => options.onLayout?.(),
    onError: error => {
      errors.push(error);
      if (typeof options.onError === 'function') options.onError(error);
    }
  });
  return {
    label, windows, errors, matching,
    get pet() { return pet; },
    set pet(value) { pet = value; },
    set obstacle(value) { obstacle = value; },
    set presentation(value) { presentation = value; }
  };
}

test('可见额度边界随加载、展开、移动和隐藏同步，状态卡也作为锚点', async t => {
  const loading = deferred();
  let changes = 0;
  const f = fixture(() => loading.promise, { onLayout: () => changes++ });
  t.after(() => f.label.destroy());
  assert.equal(f.label.getVisibleBounds(), null);
  f.label.show(readyModel());
  assert.equal(f.label.getVisibleBounds(), null, '加载期间没有可见卡');
  loading.resolve(); await flush();
  assert.deepEqual(f.label.getVisibleBounds(), f.windows[0].getBounds());
  assert.ok(changes > 0, '首次异步显示通知跟随窗口');
  const compact = f.label.getVisibleBounds();
  const beforeExpand = changes;
  f.windows[0].webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  if (f.label.getLayoutMetrics()?.height < 100) await new Promise(resolve => setTimeout(resolve, 230));
  assert.ok(changes > beforeExpand);
  assert.ok(f.label.getVisibleBounds().height > compact.height);
  f.pet.bounds.x += 100;
  const beforeMove = changes;
  f.label.reposition();
  assert.ok(changes > beforeMove);
  assert.notEqual(f.label.getVisibleBounds().x, compact.x);
  f.label.show({ state: 'empty', items: [] });
  assert.deepEqual(f.label.getVisibleBounds(), f.windows[0].getBounds());
  f.label.show(readyModel());
  const beforeHide = changes;
  f.label.hide();
  assert.equal(f.label.getVisibleBounds(), null);
  assert.ok(changes > beforeHide);
  f.label.show(readyModel()); f.label.destroy();
  assert.equal(f.label.getVisibleBounds(), null);
});

test('ZCode 团队双周期紧凑展开尺寸同步原生窗口、可见区域和整组布局，个人版与 Codex 不变', async t => {
  const { quotaFreeStackBounds } = require('../lib/quota-label-placement');
  const { pathToFileURL } = require('node:url');
  const rows = [300,10080].map((windowMinutes,index)=>({label:'Coding Plan 积分',planName:'Coding Plan · 团队',
    bucketId:`zcode:paid:CREDIT_LIMIT:${index ? '6:1' : '3:5'}`,windowMinutes,remaining:70,resetsAt:2000000000000}));
  for (const size of ['compact','standard']) for (const sourceId of ['zcode','codex']) {
    const f=fixture(()=>Promise.resolve(),{sourceId,labelSize:size});t.after(()=>f.label.destroy());
    f.label.show({sourceId,state:'ready',items:rows});await flush();
    const win=f.windows[0], sender=win.webContents, senderFrame={};
    sender.mainFrame=senderFrame;sender.getURL=()=>pathToFileURL(path.resolve(__dirname,'../quota-label.html')).href;
    const toggle=()=>sender.emit('ipc-message',{sender,senderFrame},sourceId==='zcode'?'pet:zcode-quota-label-toggle':'pet:quota-label-toggle');
    toggle();
    const height=sourceId==='zcode'?149:144;
    assert.equal(win.getBounds().height,height);assert.equal(f.label.getVisibleBounds().height,height);
    assert.equal(f.label.getLayoutMetrics().height,height);
    const presentation={mode:'free',shape:'blob'};
    const plan=quotaFreeStackBounds(f.pet.bounds,AREA,{codex:{width:128,height:32,inset:2},api:{width:128,height:32,inset:2},zcode:f.label.getLayoutMetrics()},presentation);
    f.presentation={...presentation,quotaGroupLayout:plan.cards.zcode};f.label.reposition();
    assert.deepEqual(f.label.getVisibleBounds(),plan.cards.zcode.face);
    assert.equal(plan.cards.zcode.face.y-plan.cards.api.face.y-plan.cards.api.face.height,8);
    f.presentation=null;toggle();await new Promise(resolve=>setTimeout(resolve,230));assert.equal(win.getBounds().height,size==='compact'?32:58);
    f.label.show({sourceId,state:'ready',items:rows.map(row=>({...row,planName:'Coding Plan'}))});toggle();
    assert.equal(win.getBounds().height,sourceId==='zcode'?166:144);
    assert.deepEqual(f.errors,[]);
  }
});

test('无额度的状态卡参与整组布局，胶囊始终位于固定卡片外侧', async t => {
  const { quotaCardBarBounds } = require('../lib/quota-card-group-window');
  const { quotaFreeStackBounds } = require('../lib/quota-label-placement');
  for (const sourceId of ['codex', 'zcode']) for (const size of ['standard', 'compact']) {
    const f = fixture(() => Promise.resolve(), { sourceId, labelSize: size });
    t.after(() => f.label.destroy());
    for (const y of [300, 800]) for (const state of ['disconnected', 'connecting', 'unauthenticated', 'empty', 'ready']) {
      f.pet.bounds.y = y;
      const presentation = { mode: 'free', shape: 'new-year-sheep', sheepTheme: 'halloween' };
      f.presentation = presentation;
      f.label.show(state === 'ready' ? readyModel() : { state, items: [] });
      await flush();
      const metrics = f.label.getLayoutMetrics();
      assert.ok(metrics, `${sourceId}/${size}/${state}: 可见状态卡有布局尺寸`);
      const plan = quotaFreeStackBounds(f.pet.bounds, AREA, { [sourceId]: metrics }, presentation);
      f.presentation = { ...presentation, quotaGroupLayout: plan.cards[sourceId] };
      f.label.reposition();
      const face = f.label.getVisibleBounds();
      assert.deepEqual(face, plan.cards[sourceId].face);
      const bar = quotaCardBarBounds(f.pet.bounds, AREA, { ...presentation,
        quotaPreferredPlacement: plan.placement, cardStackBounds: [face] });
      const gap = plan.placement === 'below' ? bar.y + 6.5 - (face.y + face.height) : face.y - (bar.y + 13.5);
      assert.ok(gap >= 6 && gap <= 8, `${sourceId}/${size}/${state}/${plan.placement}: 胶囊与卡面间距 ${gap}`);
    }
    f.label.hide();
    assert.equal(f.label.getLayoutMetrics(), null);
    assert.equal(f.label.getVisibleBounds(), null);
    f.label.show({ state: 'disconnected', items: [], display: 'numbers' });
    assert.equal(f.label.getLayoutMetrics(), null, '纯数字仍不参与卡片队列');
    assert.equal(f.label.getVisibleBounds(), null, '未连接纯数字不当作完整卡片');
  }
});

test('标准与小巧锚点读取实际卡面，守护角色只扩大原生避让窗口', async t => {
  for (const [size, width, height, inset, gutter] of [
    ['standard', 168, 58, 0, 6], ['compact', 128, 32, 2, 18]
  ]) {
    let guard = true;
    const f = fixture(() => Promise.resolve(), { labelSize: size, getGuardEntry: () => guard });
    t.after(() => f.label.destroy());
    for (const [enabled, state] of [[true, 'ready'], [false, 'ready'], [true, 'stale']]) {
      guard = enabled;
      f.label.show({ ...readyModel(), state }); await flush();
      const native = f.label.getWindow().getBounds(), roleVisible = enabled && state === 'ready';
      if(roleVisible){assert(native.width>=width+56);assert(native.height>=131);}else{assert.equal(native.width,width);assert.equal(native.height,height);}
      const viewport=f.windows[0].sent.findLast(row=>row[0]==='pet:quota-label')[1].cardViewport;
      assert.deepEqual(f.label.getVisibleBounds(), { x: native.x + (viewport?.face.left||0) + inset,
        y: native.y + (viewport?.face.top||0) + inset,
        width: width - inset * 2, height: height - inset * 2 });
      assert.deepEqual(f.label.getWindow().getBounds(), native, '读取卡面不改变完整原生避让边界');
      f.windows[0].webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  await new Promise(resolve => setTimeout(resolve, 230));
      if(roleVisible)assert.deepEqual(f.label.getWindow().getBounds(),native,'toggle keeps carrier fixed');else assert.deepEqual(f.label.getVisibleBounds(),f.label.getWindow().getBounds());
      assert.equal(f.label.getVisibleBounds().width, 196);
      assert.equal(f.label.getVisibleBounds().height, 131);
      f.windows[0].webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  await new Promise(resolve => setTimeout(resolve, 230));
      f.label.hide();
      assert.equal(f.label.getVisibleBounds(), null);
    }
    const dual = readyModel();
    dual.items.push({ label: 'Codex 周额度', windowMinutes: 10080, remaining: 82 });
    f.label.show(dual); await flush();
    f.windows[0].webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  await new Promise(resolve => setTimeout(resolve, 230));
    assert.equal(f.label.getVisibleBounds().width,196);
    assert.equal(f.label.getVisibleBounds().height, 144, '双周期展开使用完整卡面高度');
    assert.deepEqual(f.errors, []);
  }
});

test('角色透明顶沿首次显示和重显均穿透，仅可信主页面可切换卡面/角色点击', async t => {
  let cursor = { x: 340, y: 375 };
  const f = fixture(() => Promise.resolve(), { labelSize: 'compact', getGuardEntry: () => true,
    getCursorScreenPoint: () => cursor });
  t.after(() => f.label.destroy());
  f.label.show(readyModel()); await flush();
  const win = f.windows[0], contents = win.webContents, frame = {};
  contents.mainFrame = frame;
  contents.getURL = () => require('node:url').pathToFileURL(win.loadedFile).href;
  const trusted = { sender: contents, senderFrame: frame };
  const pointer = (value, event = trusted) => contents.emit('ipc-message', event, 'pet:quota-label-pointer', value);
  assert.deepEqual(win.ignoreCalls.at(-1), [true, { forward: true }], '球体底部透明顶沿不挡球体 hover');
  const before = win.ignoreCalls.length;
  pointer('true'); pointer(true, { sender: {}, senderFrame: frame }); pointer(true, { sender: contents, senderFrame: {} });
  assert.equal(win.ignoreCalls.length, before, '非布尔值、其它窗口与子 frame 均拒绝');
  cursor = { x: 300, y: 400 }; pointer(true);
  assert.deepEqual(win.ignoreCalls.at(-1), [false, { forward: true }]);
  contents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(f.label.getVisibleBounds().height, 131, '恢复命中后保留正常卡点击展开');
  contents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  await new Promise(resolve => setTimeout(resolve, 230));
  pointer(false); assert.deepEqual(win.ignoreCalls.at(-1), [true, { forward: true }]);
  f.label.hide(); const hiddenCalls = win.ignoreCalls.length;
  pointer(true); assert.equal(win.ignoreCalls.length, hiddenCalls, '隐藏态不能被迟到 mouse move 重新拦截');
  cursor = { x: 340, y: 375 }; f.label.show(readyModel());
  assert.deepEqual(win.ignoreCalls.at(-1), [true, { forward: true }], '重显重新按真实 cursor 初始化');
  cursor = { x: 420, y: 392 }; f.label.reposition();
  assert.deepEqual(win.ignoreCalls.at(-1), [false, { forward: true }], '真实角色按钮区域可接收点击');
});

test('详情打开期间暂时隐藏额度卡，刷新与重排不抬升，关闭后保留展开和最新数据', async t => {
  let suppressed = false;
  const f = fixture(() => Promise.resolve(), { getSuppressed: () => suppressed });
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  await flush();
  const win = f.windows[0];
  win.webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  if (f.label.getLayoutMetrics()?.height < 100) await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(win.sent.at(-1)[1].expanded, true);
  suppressed = true;
  f.label.reposition();
  assert.equal(win.visible, false);
  assert.deepEqual(win.ignoreCalls.at(-1), [true, { forward: true }]);
  const shows = win.showInactiveCalls;
  const next = readyModel(); next.items[0].remaining = 23;
  f.label.show(next);
  f.label.reposition();
  assert.equal(win.showInactiveCalls, shows, '详情期间同步和宠物移动均不能再次 showInactive');
  suppressed = false;
  f.label.reposition();
  assert.equal(win.visible, true);
  assert.equal(win.sent.at(-1)[1].expanded, true, '暂时避让不应收起已展开的卡');
  assert.equal(win.sent.at(-1)[1].items[0].remaining, 23, '恢复展示最新额度');
  suppressed = true;
  f.label.reposition();
  f.label.hide();
  suppressed = false;
  f.label.reposition();
  assert.equal(win.visible, false, '关闭额度显示后不能因关闭详情而恢复');
});

test('标准档只在 show 时懒创建安全、透明、不聚焦的鼠标穿透窗口', async t => {
  const loading = deferred();
  const f = fixture(() => loading.promise);
  t.after(() => f.label.destroy());
  assert.equal(f.windows.length, 0);

  f.label.hide();
  f.label.reposition();
  assert.equal(f.windows.length, 0);
  f.label.show(readyModel());
  assert.equal(f.windows.length, 1);
  const win = f.windows[0];
  assert.equal(win.options.width, 168);
  assert.equal(win.options.height, 58);
  assert.equal(win.options.transparent, true);
  assert.equal(win.options.frame, false);
  assert.equal(win.options.roundedCorners, false, '系统圆角不能再裁剪CSS卡片边框');
  assert.equal(win.options.focusable, false);
  assert.equal(win.options.hasShadow, false);
  assert.equal(win.options.skipTaskbar, true);
  assert.equal(win.options.show, false);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.spellcheck, false);
  assert.equal(win.options.webPreferences.backgroundThrottling, false);
  assert.deepEqual(win.ignoreCalls.at(-1), [true, { forward: true }]);
  assert.equal(win.visible, false, '页面就绪前不能闪现');
  assert.equal(win.sent.length, 0);

  loading.resolve();
  await flush();
  assert.equal(win.visible, true);
  assert.equal(win.showInactiveCalls, 1);
});

test('原生显隐显式广播 visible，隐藏前暂停入口且暂时避让不改变原卡展开语义', async t => {
  let suppressed = false;
  const f = fixture(() => Promise.resolve(), { getSuppressed: () => suppressed,
    onCall(name, _count, target) { if (name === 'hide' && target.sent.length) assert.equal(target.sent.at(-1)[1].visible, false); } });
  t.after(() => f.label.destroy());
  f.label.show(readyModel()); await flush();
  const win = f.windows[0];
  assert.equal(win.sent.at(-1)[1].visible, true);
  win.webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  if (f.label.getLayoutMetrics()?.height < 100) await new Promise(resolve => setTimeout(resolve, 230));
  suppressed = true; f.label.reposition();
  assert.equal(win.sent.at(-1)[1].visible, false);
  assert.equal(win.sent.at(-1)[1].expanded, true);
  suppressed = false; f.label.reposition();
  assert.equal(win.sent.at(-1)[1].visible, true);
  assert.equal(win.sent.at(-1)[1].expanded, true);
  f.label.hide();
  assert.equal(win.sent.at(-1)[1].visible, false);
  assert.equal(win.sent.at(-1)[1].expanded, false);
  assert.equal(win.sent.at(-1)[1].items[0].remaining, 47.6);
});

test('额度 preload 仅保留明确 visible/guardEntry 布尔，不接受字符串或读取异常', () => {
  let api, listener, received;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../quota-label-preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
      ipcRenderer: { on(_name, callback) { listener = callback; }, removeListener() {} } })
  });
  api.onModel(value => { received = value; });
  for (const key of ['visible', 'guardEntry']) {
    for (const value of [false, true]) {
      listener({}, { ...readyModel(), [key]: value }); assert.equal(received[key], value);
    }
    listener({}, { ...readyModel(), [key]: 'false' }); assert.equal(key in received, false);
    const throwing = readyModel(); Object.defineProperty(throwing, key, { get() { throw new Error('boolean getter'); } });
    assert.doesNotThrow(() => listener({}, throwing)); assert.equal(key in received, false);
  }
  for(const width of[48,64]){listener({}, {...readyModel(),guardTargetWidth:width});assert.equal(received.guardTargetWidth,width);}
  for(const width of[22,24,44,50,'48',Infinity]){listener({}, {...readyModel(),guardTargetWidth:width});assert.equal('guardTargetWidth' in received,false);}
  assert.equal(received.items[0].remaining, 47.6);
  listener({}, { ...readyModel(), guardSide: 'left', cardInset: { x: 72, y: 18 } });
  assert.equal(received.guardSide, 'left');
  assert.equal(JSON.stringify(received.cardInset), JSON.stringify({ x: 72, y: 18 }));
  for (const cardInset of [{ x: Infinity, y: 0 }, { x: 513, y: 0 }, { x: 0, y: -1 }, { x: '72', y: 18 }]) {
    listener({}, { ...readyModel(), guardSide: 'invalid', cardInset });
    assert.equal('guardSide' in received, false); assert.equal('cardInset' in received, false);
  }
});

test('小巧档创建可点击的 128×32 横条，点击展开和收起时复用同一窗口', async t => {
  const f = fixture(() => Promise.resolve(), { labelSize: 'compact' });
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  await flush();
  const win = f.windows[0];
  assert.equal(win.options.width, 128);
  assert.equal(win.options.height, 32);
  assert.deepEqual(win.bounds, { x: 276, y: 388, width: 128, height: 32 });
  assert.equal(win.sent[0][1].size, 'compact');
  assert.equal(win.sent[0][1].expanded, false);
  assert.deepEqual(win.ignoreCalls.at(-1), [false]);

  win.webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  if (f.label.getLayoutMetrics()?.height < 100) await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(f.windows.length, 1);
  assert.deepEqual(win.bounds, { x: 242, y: 388, width: 196, height: 131 });
  assert.equal(win.sent.at(-1)[1].expanded, true);

  win.webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  if (f.label.getLayoutMetrics()?.height < 100) await new Promise(resolve => setTimeout(resolve, 230));
  assert.deepEqual(win.bounds, { x: 276, y: 388, width: 128, height: 32 });
  assert.equal(win.sent.at(-1)[1].expanded, false);
});

test('具体数字复用经典摘要徽标，单项左右排布且不补缺失周期，点击详情不展开', async t => {
  const f = fixture(() => Promise.resolve(), { labelSize: 'compact' });
  t.after(() => f.label.destroy());
  const numbers = { ...readyModel(), display: 'numbers', numberPeriods: ['fiveHour', 'weekly'],
    numberColors: { shape: 'aurora-cloud', bodyColor: '#5038AF', glowPinkColor: '#E08AD9', private: 'SECRET' } };
  numbers.items[0].remaining = 0;
  f.label.show(numbers); await flush();
  const win = f.windows[0], packet = win.sent.at(-1)[1];
  assert.equal(packet.expanded, false);
  assert.equal(win.bounds.width, 128); assert.equal(win.bounds.height, 32);
  assert.equal(JSON.stringify(packet).includes('SECRET'), false);
  win.webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  if (f.label.getLayoutMetrics()?.height < 100) await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(win.sent.at(-1)[1].expanded, false);
  let api, listener, receive, received, toggles = 0;
  const sent = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../quota-label-preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
      ipcRenderer: { on(_name, callback) { listener = callback; }, removeListener() {}, send: (...args) => sent.push(args) } })
  });
  api.onModel(value => { received = value; }); listener({}, packet);
  assert.deepEqual(JSON.parse(JSON.stringify(received.numberColors)), {
    shape: 'aurora-cloud', bodyColor: '#5038AF', glowPinkColor: '#E08AD9'
  });
  const element = () => ({ dataset: {}, style: {}, children: [], listeners: {}, attributes: {}, _text: '',
    set textContent(value) { this._text = String(value); this.children = []; },
    get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this._text; },
    replaceChildren(...children) { this._text = ''; this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { this.listeners[name] = callback; } });
  const nodes = Object.fromEntries(['quota-label', 'status', 'summary', 'items', 'overflow', 'quota-numbers'].map(id => [id, element()]));
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../quota-label-renderer.js'), 'utf8'), {
    document: { documentElement: element(), getElementById: id => nodes[id], createElement: element },
    window: { QuotaEffects: require('../quota-effects'), addEventListener() {}, petQuotaLabel: {
      onModel(callback) { receive = callback; return () => {}; },
      toggleExpanded() { toggles++; }, openDetail: api.openDetail
    } }
  });
  receive(received);
  const readings = nodes['quota-numbers'];
  assert.equal(readings.textContent, '5h已用尽0%');
  assert.equal(readings.children.length, 1, '不存在的周额度不生成空项');
  assert.equal(nodes['quota-label'].dataset.readings, '1');
  assert.deepEqual(readings.children[0].children.map(child => child.className),
    ['summary-period', 'summary-value quota-reading-value']);
  assert.equal(readings.children[0].children[0].children[0].className, 'summary-badge');
  assert.equal(nodes['quota-label'].dataset.display, 'numbers');
  assert.equal(nodes['quota-label'].dataset.expanded, 'false');
  const dual = { ...received, items: [...received.items, { label: 'Codex', windowMinutes: 10080, remaining: 38 }] };
  receive(dual); assert.equal(readings.textContent, '5h0%周38%');
  assert.equal(readings.children.length, 2);
  assert.equal(nodes['quota-label'].dataset.readings, '2');
  assert.ok(readings.children.every(reading => reading.children[0].className === 'summary-badge'));
  readings.children[1].listeners.click({ stopPropagation() {} });
  assert.deepEqual(sent.at(-1), ['pet:quota-label-detail', 'trend', 10080]);
  nodes['quota-label'].listeners.click(); assert.equal(toggles, 0);
  receive({ ...dual, state: 'stale' }); assert.equal(readings.textContent, '5h—周—');
  receive({ ...received, numberPeriods: ['weekly'], items: [{ label: 'Codex', windowMinutes: 10080, remaining: 38 }] });
  assert.equal(readings.textContent, '周额度38%');
  f.label.show({ state: 'disconnected', display: 'numbers', numberPeriods: ['weekly', 'weekly'],
    numberColors: { bodyColor: 'red;background:url(https://example.com)', shape: '<script>' } });
  const unknown = win.sent.at(-1)[1];
  assert.deepEqual(unknown.numberPeriods, ['weekly']);
  assert.equal(unknown.numberColors.bodyColor, '#EEEBE4');
  assert.deepEqual(win.ignoreCalls.at(-1), [false], '未知数字仍可查看对应额度详情');
  listener({}, unknown); receive(received); assert.equal(readings.textContent, '周额度—');
  f.label.show(readyModel());
  win.webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  if (f.label.getLayoutMetrics()?.height < 100) await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(win.sent.at(-1)[1].expanded, true, '切回经典额度卡恢复原展开行为');
});

test('余额通过原生窗口与 preload 白名单，显示与隐藏复用辅助行且高度不变', async t => {
  const f = fixture(() => Promise.resolve(), { labelSize: 'compact' });
  t.after(() => f.label.destroy());
  const extraCredits = { state: 'balance', balance: '62485.1547310000', key: 'SECRET_KEY' };
  f.label.show({ ...readyModel(), extraCredits }); await flush();
  const win = f.windows[0];
  assert.equal(win.bounds.height, 32);
  win.webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  if (f.label.getLayoutMetrics()?.height < 100) await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(win.bounds.width, 196); assert.equal(win.bounds.height, 131);
  assert.deepEqual(win.sent.at(-1)[1].extraCredits, { state: 'balance', balance: '62485.1547310000' });
  assert.equal(win.sent.at(-1)[1].resetCreditsAvailable, 1);
  assert.equal(JSON.stringify(win.sent.at(-1)[1]).includes('SECRET_KEY'), false);
  let api, listener, received;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../quota-label-preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
      ipcRenderer: { on(_name, callback) { listener = callback; }, removeListener() {} } })
  });
  api.onModel(value => { received = value; });
  listener({}, win.sent.at(-1)[1]);
  assert.equal(JSON.stringify(received.extraCredits), JSON.stringify({ state: 'balance', balance: '62485.1547310000' }));
  listener({}, { ...win.sent.at(-1)[1], state: 'stale' });
  assert.equal(JSON.stringify(received.extraCredits), JSON.stringify({ state: 'stale' }));
  f.label.show({ ...readyModel(), extraCredits: { state: 'balance', balance: '<script>secret</script>' } });
  assert.deepEqual(win.sent.at(-1)[1].extraCredits, { state: 'unknown' });
  f.label.show(readyModel());
  assert.equal(win.bounds.height, 131);
  assert.equal('extraCredits' in win.sent.at(-1)[1], false);
});

test('半露幻彩云切换屏边时重排额度标签，与可见云瓣相邻', async t => {
  const f = fixture(() => Promise.resolve(), { labelSize: 'compact',
    presentation: { shape: 'aurora-cloud', mode: 'peeked', side: 'right' } });
  t.after(() => f.label.destroy());
  f.pet.bounds = { x: 1360, y: 300, width: 80, height: 80 };
  f.label.show(readyModel());
  await flush();
  const win = f.windows[0];
  assert.deepEqual(win.bounds, { x: 1252, y: 321, width: 128, height: 32 });

  f.pet.bounds = { x: 0, y: 300, width: 80, height: 80 };
  f.presentation = { shape: 'aurora-cloud', mode: 'peeked', side: 'left' };
  f.label.reposition();
  assert.deepEqual(win.bounds, { x: 60, y: 321, width: 128, height: 32 });
});

test('双周期小巧档点击后展开为 196×144，收起仍回到 128×32', async t => {
  const f = fixture(() => Promise.resolve(), { labelSize: 'compact' });
  t.after(() => f.label.destroy());
  const model = readyModel();
  model.items.push({ id: 'weekly', label: 'Codex', windowMinutes: 10080, remaining: 94, resetsAt: 2000003600000 });
  f.label.show(model);
  await flush();
  const win = f.windows[0];
  win.webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  if (f.label.getLayoutMetrics()?.height < 100) await new Promise(resolve => setTimeout(resolve, 230));
  assert.deepEqual(win.bounds, { x: 242, y: 388, width: 196, height: 144 });
  assert.equal(win.sent.at(-1)[1].expanded, true);
  assert.equal(win.sent.at(-1)[1].items.length, 2);

  win.webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  if (f.label.getLayoutMetrics()?.height < 100) await new Promise(resolve => setTimeout(resolve, 230));
  assert.deepEqual(win.bounds, { x: 276, y: 388, width: 128, height: 32 });
});

test('标准档同样可点击展开和收起，并复用同一窗口', async t => {
  const f = fixture(() => Promise.resolve(), { labelSize: 'standard' });
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  await flush();
  const win = f.windows[0];
  assert.deepEqual(win.ignoreCalls.at(-1), [false]);

  win.webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  if (f.label.getLayoutMetrics()?.height < 100) await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(f.windows.length, 1);
  assert.deepEqual(win.bounds, { x: 242, y: 388, width: 196, height: 131 });
  assert.equal(win.sent.at(-1)[1].expanded, true);

  win.webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  if (f.label.getLayoutMetrics()?.height < 100) await new Promise(resolve => setTimeout(resolve, 230));
  assert.deepEqual(win.bounds, { x: 256, y: 388, width: 168, height: 58 });
  assert.equal(win.sent.at(-1)[1].expanded, false);
});

test('getWindow 只返回当前有效窗口，销毁后不暴露旧引用', async () => {
  const f = fixture(() => Promise.resolve());
  assert.equal(f.label.getWindow(), null);
  f.label.show(readyModel());
  await flush();
  assert.equal(f.label.getWindow(), f.windows[0]);
  f.label.destroy();
  assert.equal(f.label.getWindow(), null);
});

test('置顶开关只使用固定 floating 安全层级并作用于后续窗口', async () => {
  const f = fixture(() => Promise.resolve());
  f.label.setAlwaysOnTop(false);
  f.label.show(readyModel());
  await flush();
  assert.deepEqual(f.windows[0].topmostCalls[0], [false, 'floating']);
  f.label.setAlwaysOnTop(true);
  assert.deepEqual(f.windows[0].topmostCalls.at(-1), [true, 'floating']);
  f.label.destroy();
});

test('窗口只加载本地页面，禁止新窗口和所有导航', async t => {
  const f = fixture(() => Promise.resolve());
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  await flush();
  const win = f.windows[0];
  assert.equal(win.loadedFile, path.resolve(__dirname, '../quota-label.html'));
  assert.deepEqual(win.openHandler({ url: 'https://example.invalid' }), { action: 'deny' });
  let prevented = false;
  win.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }, 'https://example.invalid');
  assert.equal(prevented, true);
  assert.deepEqual(win.topmostCalls[0], [true, 'floating']);
});

test('按球球当前屏定位并避让气泡，只发固定通道的白名单纯标量', async t => {
  const f = fixture(() => Promise.resolve());
  t.after(() => f.label.destroy());
  f.obstacle = { x: 256, y: 388, width: 168, height: 58 };
  const model = {
    state: 'ready', account: 'secret@example.com', body: '<script>bad()</script>', html: '<b>bad</b>',
    items: [
      { id: 'account-id', label: '  Codex\u0000 \u202e ', windowMinutes: 300, remaining: 9.44, resetsAt: 2000000000000, secret: {} },
      { label: 'gpt-reserve', windowMinutes: 10080, remaining: 18.6, resetsAt: 2000003600000 },
      { label: '第三项', windowMinutes: 60, remaining: 50 }
    ],
    overflow: 7,
    resetCreditsAvailable: 1,
    resetCredits: [{ id: 'private-reset-id' }]
  };
  f.label.show(model);
  await flush();
  const win = f.windows[0];
  assert.deepEqual(f.matching, [{ x: 300, y: 300, width: 80, height: 80 }]);
  assert.equal(win.bounds.placement, undefined);
  assert.deepEqual(win.bounds, { x: 256, y: 234, width: 168, height: 58 });
  assert.equal(win.sent.length, 1);
  assert.equal(win.sent[0][0], 'pet:quota-label');
  assert.deepEqual(win.sent[0][1], {
    size: 'standard',
    appearance: 'system',
    expanded: false,
    visible: true,
    guardEntry: false,
    state: 'ready',
    items: [
      { label: 'Codex', windowMinutes: 300, remaining: 9.44, resetsAt: 2000000000000 },
      { label: 'gpt-reserve', windowMinutes: 10080, remaining: 18.6, resetsAt: 2000003600000 }
    ],
    overflow: 7,
    resetCreditsAvailable: 1
  });
  assert.equal('account' in win.sent[0][1], false);
  assert.equal('body' in win.sent[0][1], false);
  assert.equal('html' in win.sent[0][1], false);
});

test('外观只接受跟随系统、浅色和深色，切换时保留窗口和展开状态', async t => {
  const options = { labelSize: 'compact', appearance: 'light' };
  const f = fixture(() => Promise.resolve(), options);
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  await flush();
  const win = f.windows[0];
  assert.equal(win.sent.at(-1)[1].appearance, 'light');
  win.webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
  if (f.label.getLayoutMetrics()?.height < 100) await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(win.sent.at(-1)[1].expanded, true);

  options.appearance = 'dark';
  f.label.show(readyModel());
  assert.equal(f.windows.length, 1);
  assert.equal(win.sent.at(-1)[1].appearance, 'dark');
  assert.equal(win.sent.at(-1)[1].expanded, true);

  options.appearance = 'invalid';
  f.label.show(readyModel());
  assert.equal(win.sent.at(-1)[1].appearance, 'system');
  assert.equal(win.sent.at(-1)[1].expanded, true);
});

test('reposition 复用最后安全模型，重入 show 只发送最新模型', async t => {
  const loading = deferred();
  const f = fixture(() => loading.promise);
  t.after(() => f.label.destroy());
  f.label.show({ state: 'connecting', items: [], overflow: 0 });
  f.label.show({ state: 'ready', items: [{ label: 'Newest', windowMinutes: 300, remaining: 31 }], overflow: 0 });
  loading.resolve();
  await flush();
  const win = f.windows[0];
  assert.equal(win.sent.length, 1);
  assert.equal(win.sent[0][1].items[0].label, 'Newest');

  f.pet.bounds = { x: 500, y: 420, width: 120, height: 120 };
  f.label.reposition();
  assert.equal(win.sent.length, 2);
  assert.deepEqual(win.sent[1][1], win.sent[0][1]);
  assert.deepEqual(win.bounds, { x: 476, y: 548, width: 168, height: 58 });
});

test('hide 不销毁，destroy 幂等，closed 后下次 show 可重建', async () => {
  const f = fixture(() => Promise.resolve());
  f.label.show(readyModel());
  await flush();
  const first = f.windows[0];
  f.label.hide();
  assert.equal(first.visible, false);
  assert.equal(first.destroyed, false);
  first.emit('closed');
  f.label.show(readyModel());
  await flush();
  assert.equal(f.windows.length, 2);
  assert.equal(f.windows[1].visible, true);
  f.label.destroy();
  f.label.destroy();
  assert.equal(f.windows[1].destroyCalls, 1);
});

test('加载失败销毁坏窗口并可在下次 show 重建', async t => {
  const f = fixture(index => index === 1 ? Promise.reject(new Error('load failed')) : Promise.resolve());
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  await flush();
  assert.equal(f.windows[0].destroyed, true);
  assert.equal(f.errors.length, 1);
  f.label.show(readyModel());
  await flush();
  assert.equal(f.windows.length, 2);
  assert.equal(f.windows[1].visible, true);
});

test('旧窗口迟到的加载成功、失败、closed 都不得复活或伤及新窗口', async t => {
  const oldLoad = deferred();
  const f = fixture(index => index === 1 ? oldLoad.promise : Promise.resolve());
  t.after(() => f.label.destroy());
  f.label.show({ state: 'ready', items: [{ label: 'Old', windowMinutes: 300, remaining: 1 }], overflow: 0 });
  const old = f.windows[0];
  f.label.destroy();
  f.label.show({ state: 'ready', items: [{ label: 'New', windowMinutes: 300, remaining: 99 }], overflow: 0 });
  await flush();
  const current = f.windows[1];
  assert.equal(current.visible, true);
  old.webContents.emit('did-finish-load');
  old.emit('closed');
  oldLoad.reject(new Error('old failed'));
  await flush();
  assert.equal(current.visible, true);
  assert.equal(current.destroyed, false);
  assert.equal(current.sent.at(-1)[1].items[0].label, 'New');
  assert.equal(old.sent.length, 0);
  assert.equal(f.errors.length, 0);
});

test('球球隐藏或销毁时 show/reposition 只安全隐藏，恢复后仍使用原模型', async t => {
  const f = fixture(() => Promise.resolve());
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  await flush();
  const win = f.windows[0];
  f.pet.visible = false;
  f.label.reposition();
  assert.equal(win.visible, false);
  f.pet.visible = true;
  f.label.reposition();
  assert.equal(win.visible, true);
  assert.equal(win.sent.at(-1)[1].items[0].label, 'Codex');
  f.pet.destroyed = true;
  f.label.show(readyModel());
  assert.equal(win.visible, false);
});

test('渲染进程退出后隐藏并在下次 show 重建', async t => {
  const f = fixture(() => Promise.resolve());
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  await flush();
  f.windows[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(f.windows[0].destroyed, true);
  assert.equal(f.errors.length, 1);
  f.label.show(readyModel());
  await flush();
  assert.equal(f.windows[1].visible, true);
});

test('send 内重入 hide 后必须立即停止，不得再穿透设置或 showInactive', async t => {
  const loading = deferred();
  const f = fixture(() => loading.promise);
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  const win = f.windows[0];
  win.webContents.send = () => f.label.hide();
  loading.resolve();
  await flush();
  assert.equal(win.visible, false);
  assert.equal(win.showInactiveCalls || 0, 0);
});

test('原生销毁状态检查内重入 hide 后也不得短暂 showInactive', async t => {
  const f = fixture(() => Promise.resolve());
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  await flush();
  const win = f.windows[0];
  const previousShows = win.showInactiveCalls;
  let checks = 0;
  win.isDestroyed = () => {
    checks += 1;
    if (checks === 6) f.label.hide();
    return false;
  };
  f.label.show({ state: 'connecting', items: [], overflow: 0 });
  assert.equal(win.visible, false);
  assert.equal(win.showInactiveCalls, previousShows);
});

test('did-finish-load 中任一展示步骤异常都安全作废，下次 show 可重建', async t => {
  for (const method of ['setBounds', 'send', 'setIgnoreMouseEvents', 'showInactive']) {
    await t.test(method, async () => {
      const loading = deferred();
      let matchingCalls = 0;
      const f = fixture(index => index === 1 ? loading.promise : Promise.resolve(), {
        fail: (name, index) => {
          if (name !== method || index !== 1) return false;
          matchingCalls += 1;
          return matchingCalls === (method === 'setIgnoreMouseEvents' ? 2 : 1);
        }
      });
      f.label.show(readyModel());
      const old = f.windows[0];
      assert.doesNotThrow(() => old.webContents.emit('did-finish-load'));
      assert.equal(f.label.getWindow(), null);
      assert.equal(old.destroyed, true);
      f.label.show(readyModel());
      await flush();
      assert.equal(f.windows[1].visible, true);
      f.label.destroy();
    });
  }
});

test('webContents 已销毁时不发送或展示，坏窗口不从 getWindow 泄露', async () => {
  const loading = deferred();
  const f = fixture(index => index === 1 ? loading.promise : Promise.resolve());
  f.label.show(readyModel());
  const old = f.windows[0];
  old.webContents.destroyed = true;
  assert.doesNotThrow(() => old.webContents.emit('did-finish-load'));
  assert.equal(old.sent.length, 0);
  assert.equal(f.label.getWindow(), null);
  f.label.show(readyModel());
  await flush();
  assert.equal(f.windows[1].visible, true);
  f.label.destroy();
});

test('conceal、discard、ensure、destroy 和置顶边界报错均不向外抛出', async t => {
  await t.test('conceal', async () => {
    const f = fixture(() => Promise.resolve(), { fail: (name, index) => name === 'hide' && index === 1 });
    f.label.show(readyModel());
    await flush();
    assert.doesNotThrow(() => f.label.hide());
    assert.equal(f.label.getWindow(), null);
    f.label.destroy();
  });
  await t.test('ensure/discard', () => {
    const f = fixture(() => Promise.resolve(), {
      fail: (name, index) => index === 1 && ['setVisibleOnAllWorkspaces', 'isDestroyed', 'destroy'].includes(name)
    });
    assert.doesNotThrow(() => f.label.show(readyModel()));
    assert.equal(f.label.getWindow(), null);
  });
  await t.test('destroy/isDestroyed', async () => {
    const f = fixture(() => Promise.resolve());
    f.label.show(readyModel());
    await flush();
    const win = f.windows[0];
    win.isDestroyed = () => { throw new Error('isDestroyed failed'); };
    win.destroy = () => { throw new Error('destroy failed'); };
    assert.doesNotThrow(() => f.label.destroy());
    assert.equal(f.label.getWindow(), null);
  });
  await t.test('setAlwaysOnTop', async () => {
    const f = fixture(() => Promise.resolve(), { fail: (name, index) => name === 'setAlwaysOnTop' && index === 1 });
    assert.doesNotThrow(() => f.label.show(readyModel()));
    assert.equal(f.label.getWindow(), null);
    f.label.show(readyModel());
    await flush();
    assert.doesNotThrow(() => f.label.setAlwaysOnTop(false));
    f.label.destroy();
  });
});

test('onError 内重入 show 不得引发连锁报错或复活旧窗口', async () => {
  let f;
  let callbacks = 0;
  f = fixture(() => Promise.resolve(), {
    fail: name => name === 'setBounds',
    onError: () => {
      callbacks += 1;
      if (callbacks === 1) f.label.show({ state: 'connecting', items: [], overflow: 0 });
    }
  });
  assert.doesNotThrow(() => f.label.show(readyModel()));
  await flush();
  await flush();
  assert.equal(callbacks, 1);
  assert.equal(f.label.getWindow(), null);
  assert.ok(f.windows.length <= 2);
  f.label.destroy();
});

test('safeModel getter 内重入 show 时外层请求过期，不得覆盖最新模型', async t => {
  const f = fixture(() => Promise.resolve());
  t.after(() => f.label.destroy());
  let nested = false;
  const oldModel = {
    get state() {
      if (!nested) {
        nested = true;
        f.label.show({ state: 'ready', items: [{ label: 'Newest', windowMinutes: 300, remaining: 88 }], overflow: 0 });
      }
      return 'ready';
    },
    items: [{ label: 'Old', windowMinutes: 300, remaining: 1 }],
    overflow: 0
  };
  f.label.show(oldModel);
  await flush();
  assert.equal(f.windows.length, 1);
  assert.equal(f.windows[0].visible, true);
  assert.equal(f.windows[0].sent.length, 1);
  assert.equal(f.windows[0].sent[0][1].items[0].label, 'Newest');
});

test('setAlwaysOnTop 初始化内同步 show(Newest) 复用当前窗口并完成加载', async t => {
  let f;
  let reentered = false;
  f = fixture(() => Promise.resolve(), {
    onCall: name => {
      if (name === 'setAlwaysOnTop' && !reentered) {
        reentered = true;
        f.label.show({ state: 'ready', items: [{ label: 'Newest', windowMinutes: 300, remaining: 77 }], overflow: 0 });
      }
    }
  });
  t.after(() => f.label.destroy());
  f.label.show({ state: 'connecting', items: [], overflow: 0 });
  await flush();
  assert.equal(f.windows.length, 1);
  assert.equal(f.windows[0].destroyed, false);
  assert.equal(f.windows[0].visible, true);
  assert.equal(f.windows[0].sent.length, 1);
  assert.equal(f.windows[0].sent[0][1].items[0].label, 'Newest');
});

test('loadFile 内同步 show(Newest) 不中断旧初始化且只展示最新模型', async t => {
  let f;
  let reentered = false;
  f = fixture(() => {
    if (!reentered) {
      reentered = true;
      f.label.show({ state: 'ready', items: [{ label: 'Newest', windowMinutes: 10080, remaining: 66 }], overflow: 0 });
    }
    return Promise.resolve();
  });
  t.after(() => f.label.destroy());
  f.label.show({ state: 'connecting', items: [], overflow: 0 });
  await flush();
  assert.equal(f.windows.length, 1);
  assert.equal(f.windows[0].destroyed, false);
  assert.equal(f.windows[0].sent.length, 1);
  assert.equal(f.windows[0].sent[0][1].items[0].label, 'Newest');
});

test('初始化内同步 hide 仍完成加载但不展示，下次 show 复用原窗口', async () => {
  let f;
  let reentered = false;
  f = fixture(() => Promise.resolve(), {
    onCall: name => {
      if (name === 'setAlwaysOnTop' && !reentered) {
        reentered = true;
        f.label.hide();
      }
    }
  });
  f.label.show(readyModel());
  await flush();
  assert.equal(f.windows.length, 1);
  assert.equal(f.windows[0].destroyed, false);
  assert.equal(f.windows[0].visible, false);
  assert.equal(f.windows[0].sent.length, 0);
  f.label.show({ state: 'ready', items: [{ label: 'After hide', windowMinutes: 300, remaining: 55 }], overflow: 0 });
  assert.equal(f.windows.length, 1);
  assert.equal(f.windows[0].visible, true);
  assert.equal(f.windows[0].sent.at(-1)[1].items[0].label, 'After hide');
  f.label.destroy();
});

test('初始化内 destroy 并 show 新窗口时，旧流程不得销毁或发送到新窗口', async t => {
  let f;
  let reentered = false;
  f = fixture(() => Promise.resolve(), {
    onCall: (name, index) => {
      if (name === 'setAlwaysOnTop' && index === 1 && !reentered) {
        reentered = true;
        f.label.destroy();
        f.label.show({ state: 'ready', items: [{ label: 'Newest window', windowMinutes: 300, remaining: 44 }], overflow: 0 });
      }
    }
  });
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  await flush();
  assert.equal(f.windows.length, 2);
  assert.equal(f.windows[0].destroyed, true);
  assert.equal(f.windows[0].sent.length, 0);
  assert.equal(f.windows[1].destroyed, false);
  assert.equal(f.windows[1].visible, true);
  assert.equal(f.windows[1].sent.length, 1);
  assert.equal(f.windows[1].sent[0][1].items[0].label, 'Newest window');
});

test('did-finish-load 与 loadFile Promise 双完成只能 send/showInactive 一次', async t => {
  const loading = deferred();
  const f = fixture(() => loading.promise);
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  const win = f.windows[0];
  win.webContents.emit('did-finish-load');
  assert.equal(win.sent.length, 1);
  assert.equal(win.showInactiveCalls, 1);
  loading.resolve();
  await flush();
  assert.equal(win.sent.length, 1);
  assert.equal(win.showInactiveCalls, 1);
});

test('已有窗口 health 内同步 destroy 后旧 ensure 不得偷偷创建隐藏窗口', async () => {
  let f;
  let armed = false;
  f = fixture(() => Promise.resolve(), {
    onCall: (name, _index, target) => {
      if (!armed || name !== 'isDestroyed' || target !== f.windows[0]) return;
      armed = false;
      f.label.destroy();
    }
  });
  f.label.show(readyModel());
  await flush();
  armed = true;
  f.label.show({ state: 'connecting', items: [], overflow: 0 });
  await flush();
  assert.equal(f.windows.length, 1);
  assert.equal(f.windows[0].destroyed, true);
  assert.equal(f.label.getWindow(), null);
});

test('已有窗口 health 内同步 destroy 加 show 时最新窗口获胜且不得出现第三窗', async t => {
  let f;
  let armed = false;
  f = fixture(() => Promise.resolve(), {
    onCall: (name, _index, target) => {
      if (!armed || name !== 'isDestroyed' || target !== f.windows[0]) return;
      armed = false;
      f.label.destroy();
      f.label.show({ state: 'ready', items: [{ label: 'Newest health', windowMinutes: 300, remaining: 91 }], overflow: 0 });
    }
  });
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  await flush();
  armed = true;
  f.label.show({ state: 'connecting', items: [], overflow: 0 });
  await flush();
  assert.equal(f.windows.length, 2);
  assert.equal(f.windows[0].destroyed, true);
  assert.equal(f.windows[1].destroyed, false);
  assert.equal(f.label.getWindow(), f.windows[1]);
  assert.equal(f.windows[1].sent.at(-1)[1].items[0].label, 'Newest health');
});

test('BrowserWindow 构造器内同步 show 时最新窗口获胜且旧候选被安全销毁', async t => {
  let f;
  let reentered = false;
  f = fixture(() => Promise.resolve(), {
    onCall: (name, index) => {
      if (name !== 'constructor' || index !== 1 || reentered) return;
      reentered = true;
      f.label.show({ state: 'ready', items: [{ label: 'Newest constructor', windowMinutes: 10080, remaining: 82 }], overflow: 0 });
    }
  });
  t.after(() => f.label.destroy());
  f.label.show({ state: 'connecting', items: [], overflow: 0 });
  await flush();
  assert.equal(f.windows.length, 2);
  assert.equal(f.windows[0].destroyed, true);
  assert.equal(f.windows[1].destroyed, false);
  assert.equal(f.label.getWindow(), f.windows[1]);
  assert.equal(f.windows[1].sent.at(-1)[1].items[0].label, 'Newest constructor');
});

test('初始化置顶调用内同步关闭置顶时必须重放最新 false', async t => {
  let f;
  let reentered = false;
  f = fixture(() => Promise.resolve(), {
    onCall: (name, index) => {
      if (name !== 'setAlwaysOnTop' || index !== 1 || reentered) return;
      reentered = true;
      f.label.setAlwaysOnTop(false);
    }
  });
  t.after(() => f.label.destroy());
  f.label.show(readyModel());
  await flush();
  assert.deepEqual(f.windows[0].topmostCalls.at(-1), [false, 'floating']);
  f.label.destroy();
  f.label.show(readyModel());
  await flush();
  assert.deepEqual(f.windows[1].topmostCalls[0], [false, 'floating']);
});

test('置顶原生边界持续重入必须有界作废且报告一次', () => {
  let f;
  let enabled = false;
  let calls = 0;
  f = fixture(() => Promise.resolve(), {
    onCall: name => {
      if (name !== 'setAlwaysOnTop') return;
      calls += 1;
      if (calls <= 30) {
        enabled = !enabled;
        f.label.setAlwaysOnTop(enabled);
      }
    }
  });
  assert.doesNotThrow(() => f.label.show(readyModel()));
  assert.ok(calls <= 10, `置顶同步不得无界重入，实际调用 ${calls} 次`);
  assert.equal(f.label.getWindow(), null);
  assert.equal(f.errors.length, 1);
});

test('主进程模型每个外部字段只读一次，且数组最多检查前两项', async t => {
  const reads = new Map();
  const once = (target, name, value) => Object.defineProperty(target, name, {
    enumerable: true,
    get() {
      const count = (reads.get(name) || 0) + 1;
      reads.set(name, count);
      if (count > 1) throw new Error(`${name} read twice`);
      return value;
    }
  });
  const item = {};
  once(item, 'label', ' Codex ');
  once(item, 'windowMinutes', 300);
  once(item, 'remaining', 49.5);
  once(item, 'resetsAt', 2000000000000);
  const rawItems = [item, { label: 'Spark', windowMinutes: 10080, remaining: 20 },
    { label: 'must-not-read', windowMinutes: 60, remaining: 1 }];
  const itemsProxy = new Proxy(rawItems, {
    get(target, property, receiver) {
      if (property === 'slice' || property === '2') throw new Error(`unsafe array read: ${String(property)}`);
      return Reflect.get(target, property, receiver);
    }
  });
  const model = {};
  once(model, 'state', 'ready');
  once(model, 'items', itemsProxy);
  once(model, 'overflow', 1);
  once(model, 'resetCreditsAvailable', 1);
  const f = fixture(() => Promise.resolve());
  t.after(() => f.label.destroy());
  assert.doesNotThrow(() => f.label.show(model));
  await flush();
  assert.deepEqual(f.windows[0].sent[0][1], {
    size: 'standard',
    appearance: 'system',
    expanded: false,
    visible: true,
    guardEntry: false,
    state: 'ready',
    items: [
      { label: 'Codex', windowMinutes: 300, remaining: 49.5, resetsAt: 2000000000000 },
      { label: 'Spark', windowMinutes: 10080, remaining: 20 }
    ],
    overflow: 1,
    resetCreditsAvailable: 1
  });
  for (const count of reads.values()) assert.equal(count, 1);
});

test('撤销 Proxy 或抛错 getter 不能穿透 show，必须降级为断开模型', async t => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const f = fixture(() => Promise.resolve());
  t.after(() => f.label.destroy());
  assert.doesNotThrow(() => f.label.show(revoked.proxy));
  await flush();
  assert.deepEqual(f.windows[0].sent[0][1], {
    state: 'disconnected', items: [], overflow: 0, size: 'standard', appearance: 'system', expanded: false, visible: true, guardEntry: false
  });

  const throwing = {};
  Object.defineProperty(throwing, 'state', { get() { throw new Error('getter failed'); } });
  assert.doesNotThrow(() => f.label.show(throwing));
  assert.deepEqual(f.windows[0].sent.at(-1)[1], {
    state: 'disconnected', items: [], overflow: 0, size: 'standard', appearance: 'system', expanded: false, visible: true, guardEntry: false
  });
});

test('预加载层只接收固定通道，白名单纯标量且可取消订阅', () => {
  let api;
  let listener;
  const removed = [];
  const sent = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../quota-label-preload.js'), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'petQuotaLabel'); api = value; } },
      ipcRenderer: {
        on(name, callback) { assert.equal(name, 'pet:quota-label'); listener = callback; },
        removeListener: (...args) => removed.push(args),
        send: (...args) => sent.push(args)
      }
    })
  });
  let received;
  const unsubscribe = api.onModel(model => { received = model; });
  listener({}, {
    state: 'ready', size: 'compact', appearance: 'light', account: 'private', body: '<b>private</b>',
    items: [{ label: ' Codex\n', windowMinutes: 300, remaining: 19.55,
      resetsAt: 2000000000000, private: {} }], overflow: 2,
    resetCreditsAvailable: 1, resetCredits: [{ id: 'private' }]
  });
  assert.equal(JSON.stringify(received), JSON.stringify({
    state: 'ready', size: 'compact', appearance: 'light', expanded: false,
    items: [{ label: 'Codex', windowMinutes: 300, remaining: 19.55, resetsAt: 2000000000000 }],
    overflow: 2, resetCreditsAvailable: 1
  }));
  unsubscribe();
  assert.equal(removed.length, 1);
  assert.equal(removed[0][0], 'pet:quota-label');
  api.toggleExpanded();
  assert.deepEqual(sent, [['pet:quota-label-toggle']]);
  assert.equal(typeof api.reply, 'undefined');
  assert.equal(typeof api.open, 'undefined');
});

test('小巧横条只显示摘要，小巧和标准卡片均可点击展开明细', () => {
  let receive;
  let click;
  let colorUpdate;
  let mediaChange;
  const media = { matches: false, addEventListener(_name, callback) { mediaChange = callback; }, removeEventListener() {} };
  let toggles = 0;
  const root = { dataset: {} };
  const label = { dataset: {}, addEventListener(name, callback) { if (name === 'click') click = callback; } };
  const status = {};
  const summary = { children: [], replaceChildren(...children) { this.children = children; } };
  const items = { children: [], replaceChildren(...children) { this.children = children; } };
  const overflow = {};
  const resetTime = {};
  const resetCredits = {};
  const compactProduct = {};
  const compactPeriod = {};
  const secondaryQuota = { dataset: {} };
  const secondaryPeriod = {};
  const secondaryValue = {};
  const secondaryProgress = {};
  const secondaryReset = {};
  class FixedDate extends Date {
    static now() { return 1800000000000; }
  }
  const element = () => ({
    dataset: {}, className: '', children: [], _text: '',
    set textContent(value) { this._text = String(value); this.children = []; },
    get textContent() { return this.children.length
      ? this.children.map(child => child.textContent).join('') : this._text; },
    replaceChildren(...children) { this._text = ''; this.children = children; }
  });
  const context = {
    document: {
      documentElement: root,
      getElementById: id => ({ 'quota-label': label, status, summary, items, overflow,
        'reset-time': resetTime, 'reset-credits': resetCredits,
        'compact-product': compactProduct, 'compact-period': compactPeriod,
        'secondary-quota': secondaryQuota, 'secondary-period': secondaryPeriod,
        'secondary-value': secondaryValue, 'secondary-progress': secondaryProgress,
        'secondary-reset': secondaryReset })[id],
      createElement: element
    },
    window: {
      addEventListener() {},
      matchMedia: () => media,
      petQuotaLabel: {
        onColorMode(callback) { colorUpdate = callback; return () => {}; },
        onModel(callback) { receive = callback; return () => {}; },
        toggleExpanded() { toggles += 1; }
      }
    },
    Date: FixedDate
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../color-mode.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../quota-label-renderer.js'), 'utf8'), context);
  colorUpdate('standard', 'dark', 'green');
  receive({ state: 'ready', size: 'compact', appearance: 'dark', expanded: false, items: [
    { label: 'codex', windowMinutes: 10080, remaining: 64 },
    { label: 'gpt-reserve', windowMinutes: 10080, remaining: 78 }
  ], overflow: 0 });
  assert.equal(label.dataset.expanded, 'false');
  assert.equal(label.dataset.appearance, 'dark');
  assert.equal(root.dataset.appearance, 'dark');
  assert.equal(summary.children.map(node => node.textContent).join(''), '周额度64%');
  assert.deepEqual(summary.children.map(node => node.className), ['summary-period', 'summary-value']);
  click();
  assert.equal(toggles, 1);

  receive({ state: 'ready', size: 'compact', expanded: true, items: [
    { label: 'codex', windowMinutes: 300, remaining: 42, resetsAt: 1800019800000 }
  ], overflow: 0, resetCreditsAvailable: 1 });
  assert.equal(label.dataset.expanded, 'true');
  assert.equal(summary.children.map(node => node.textContent).join(''), '5h额度42%');
  assert.equal(resetTime.textContent, '5小时30分钟后重置 · 1/15 21:30');
  assert.equal(resetCredits.textContent, '1 次重置机会');

  receive({ state: 'ready', size: 'compact', appearance: 'light', expanded: true, items: [
    { label: 'codex', windowMinutes: 300, remaining: 100, resetsAt: 1800016200000 },
    { label: 'codex', windowMinutes: 10080, remaining: 94, resetsAt: 1800522000000 }
  ], overflow: 0, resetCreditsAvailable: 1 });
  assert.equal(compactProduct.textContent, 'CODEX');
  assert.equal(compactPeriod.textContent, '5小时');
  assert.equal(secondaryQuota.dataset.severity, 'normal');
  assert.equal(secondaryPeriod.textContent, '周额度');
  assert.equal(secondaryValue.textContent, '94%');
  assert.equal(secondaryProgress.max, 100);
  assert.equal(secondaryProgress.value, 94);
  assert.equal(secondaryReset.textContent, '6天1小时后重置 · 1/21 17:00');

  receive({ state: 'ready', size: 'standard', expanded: false, items: [
    { label: 'codex', windowMinutes: 10080, remaining: 64 },
    { label: 'gpt-reserve', windowMinutes: 10080, remaining: 78 }
  ], overflow: 0 });
  assert.equal(items.children[0].children[1].className, 'quota-period period-pill',
    '标准卡片收起态的周期也必须使用蓝色玻璃胶囊');
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  assert.match(css, /\.quota-period\.period-pill\s*\{[\s\S]*?justify-self:\s*start[\s\S]*?width:\s*fit-content/,
    '标准卡片周期胶囊必须按文字自适应宽度，不能被网格列拉满');
  click();
  assert.equal(toggles, 2);
  receive({ state: 'ready', size: 'standard', expanded: true, items: [
    { label: 'codex', windowMinutes: 10080, remaining: 64 }
  ], overflow: 0 });
  assert.equal(label.dataset.expanded, 'true');
  for (const [appearance, scheme, resolved] of [
    ['system', 'light', 'light'], ['system', 'dark', 'dark'],
    ['light', 'dark', 'light'], ['dark', 'light', 'dark']
  ]) {
    colorUpdate('standard', appearance, 'green');
    media.matches = scheme === 'dark'; mediaChange();
    receive({ state: 'ready', appearance, items: [{ label: 'codex', windowMinutes: 300, remaining: 64 }] });
    assert.equal(label.dataset.appearance, appearance, '额度模型保留用户的外观偏好');
    assert.equal(root.dataset.appearance, resolved, '模型刷新不能覆盖公共配色解析的实际外观');
    assert.equal(root.dataset.accessibleAppearance, resolved);
  }
});

test('预加载每个外部字段只读一次，Proxy 和回调异常不穿透 IPC', () => {
  let api;
  let listener;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../quota-label-preload.js'), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
      ipcRenderer: { on(_name, callback) { listener = callback; }, removeListener() { throw new Error('remove failed'); } }
    })
  });
  const reads = new Map();
  const once = (target, name, value) => Object.defineProperty(target, name, {
    get() {
      const count = (reads.get(name) || 0) + 1;
      reads.set(name, count);
      if (count > 1) throw new Error(`${name} read twice`);
      return value;
    }
  });
  const item = {};
  once(item, 'label', 'Codex');
  once(item, 'windowMinutes', 300);
  once(item, 'remaining', 18.2);
  once(item, 'resetsAt', 2000000000000);
  const model = {};
  once(model, 'state', 'ready');
  once(model, 'size', 'compact');
  once(model, 'appearance', 'dark');
  once(model, 'expanded', true);
  once(model, 'items', [item]);
  once(model, 'overflow', 0);
  once(model, 'resetCreditsAvailable', 1);
  let received;
  const unsubscribe = api.onModel(value => { received = value; throw new Error('consumer failed'); });
  assert.doesNotThrow(() => listener({}, model));
  assert.equal(JSON.stringify(received), JSON.stringify({
    state: 'ready', size: 'compact', appearance: 'dark', expanded: true,
    items: [{ label: 'Codex', windowMinutes: 300, remaining: 18.2, resetsAt: 2000000000000 }],
    overflow: 0, resetCreditsAvailable: 1
  }));
  for (const count of reads.values()) assert.equal(count, 1);
  assert.doesNotThrow(unsubscribe);

  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  let fallback;
  api.onModel(value => { fallback = value; });
  assert.doesNotThrow(() => listener({}, revoked.proxy));
  assert.equal(JSON.stringify(fallback), JSON.stringify({
    state: 'disconnected', size: 'standard', appearance: 'system', expanded: false, items: [], overflow: 0
  }));
});

test('预加载安全层保留标准卡片的展开状态', () => {
  let api;
  let listener;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../quota-label-preload.js'), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
      ipcRenderer: { on(_name, callback) { listener = callback; }, removeListener() {} }
    })
  });
  let received;
  api.onModel(value => { received = value; });
  listener({}, {
    state: 'ready', size: 'standard', expanded: true,
    items: [{ label: 'codex', windowMinutes: 10080, remaining: 59 }], overflow: 0
  });
  assert.equal(received.size, 'standard');
  assert.equal(received.expanded, true);
});

test('渲染层用固定中文状态、纯文本和合理四舍五入最多展示两项', () => {
  let receive;
  const label = { dataset: {} };
  const status = {};
  const summary = { children: [], replaceChildren(...children) { this.children = children; } };
  const items = { children: [], replaceChildren(...children) { this.children = children; } };
  const overflow = {};
  const element = () => ({
    dataset: {}, className: '', children: [], _text: '',
    set textContent(value) { this._text = String(value); this.children = []; },
    get textContent() { return this.children.length
      ? this.children.map(child => child.textContent).join('') : this._text; },
    replaceChildren(...children) { this._text = ''; this.children = children; }
  });
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../quota-label-renderer.js'), 'utf8'), {
    document: {
      getElementById: id => ({ 'quota-label': label, status, summary, items, overflow })[id],
      createElement: element
    },
    window: {
      addEventListener() {},
      petQuotaLabel: { onModel(callback) { receive = callback; return () => {}; } }
    }
  });
  receive({
    state: 'ready', expanded: true,
    items: [
      { label: '  <b>Codex</b>\n\u202e ', windowMinutes: 300, remaining: 47.6 },
      { label: 'Spark', windowMinutes: 10080, remaining: 9.4 },
      { label: 'Hidden', windowMinutes: 60, remaining: 1 }
    ],
    overflow: 3
  });
  assert.equal(status.textContent, 'Codex 剩余额度');
  assert.deepEqual(items.children.map(item => item.textContent), [
    '<b>Codex</b>5小时48%',
    'Spark7天9%紧张'
  ]);
  assert.deepEqual(items.children.map(item => item.children.map(child => child.className)), [
    ['quota-name', 'quota-period period-pill', 'quota-value', 'quota-progress'],
    ['quota-name', 'quota-period period-pill', 'quota-value', 'quota-progress']
  ]);
  assert.deepEqual(items.children.map(item => item.children[0].textContent), ['<b>Codex</b>', 'Spark']);
  assert.deepEqual(items.children.map(item => item.children[1].textContent), ['5小时', '7天']);
  assert.deepEqual(items.children.map(item => item.children[2].textContent), ['48%', '9%紧张']);
  assert.deepEqual(items.children.map(item => [item.children[3].max, item.children[3].value]), [
    [100, 47.6], [100, 9.4]
  ]);
  assert.equal(overflow.textContent, '');
  assert.equal(label.dataset.state, 'ready');
  assert.equal(label.dataset.severity, 'urgent');
  assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../quota-label-renderer.js'), 'utf8'), /innerHTML/);

  receive({ state: 'stale', items: [
    { label: '超长恶意标签<script>alert(1)</script>还有更多文字', windowMinutes: 300, remaining: 64 },
    { label: '周额度详情名称也可以很长很长很长', windowMinutes: 10080, remaining: 78 }
  ], overflow: 0 });
  assert.equal(status.textContent, '额度已过期');
  assert.deepEqual(items.children.map(item => item.children[1].textContent), [
    '已过期 5小时额度', '已过期 周额度'
  ]);
  assert.deepEqual(items.children.map(item => item.children[2].textContent), ['64%', '78%']);
  assert.equal(overflow.textContent, '');

  receive({ state: 'ready', items: [
    { label: '超长恶意标签<script>alert(1)</script>还有更多文字', windowMinutes: 300, remaining: 64 },
    { label: '周额度详情名称也可以很长很长很长', windowMinutes: 10080, remaining: 78 }
  ], overflow: 0 });
  assert.deepEqual(items.children.map(item => item.children[1].textContent), ['5小时额度', '周额度']);
  assert.deepEqual(items.children.map(item => item.children[2].textContent), ['64%', '78%']);

  const states = {
    disabled: 'Codex 联动已关闭', connecting: '正在连接 Codex…', connected: 'Codex 已连接',
    'reset-wait': '等待额度更新', 'period-missing': '当前账号未返回所选周期', empty: '暂未返回可用额度',
    missing: '未找到 Codex', unauthenticated: 'Codex 尚未登录', unsupported: '当前 Codex 暂不支持额度读取',
    disconnected: 'Codex 未连接'
  };
  for (const [state, text] of Object.entries(states)) {
    receive({ state, items: [{ label: 'must-not-leak', windowMinutes: 300, remaining: 0 }], overflow: 9 });
    assert.equal(status.textContent, text);
    assert.equal(items.children.length, 0);
    assert.equal(overflow.textContent, '');
    assert.equal(label.dataset.severity, 'normal');
  }
});

test('渲染层在 DOM 或 bridge 缺失、订阅退订抛错和恶意模型下均安全收口', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../quota-label-renderer.js'), 'utf8');
  assert.doesNotThrow(() => vm.runInNewContext(source, {
    document: { getElementById: () => null }, window: {}
  }));
  assert.doesNotThrow(() => vm.runInNewContext(source, {
    document: { getElementById: () => ({ dataset: {}, replaceChildren() {} }), createElement: () => ({ dataset: {} }) },
    window: { petQuotaLabel: { onModel() { throw new Error('subscribe failed'); } }, addEventListener() {} }
  }));

  let receive;
  let beforeUnload;
  const nodes = {
    'quota-label': { dataset: {} }, status: {},
    summary: { replaceChildren() {} }, items: { replaceChildren() {} }, overflow: {}
  };
  assert.doesNotThrow(() => vm.runInNewContext(source, {
    document: { getElementById: id => nodes[id], createElement: () => ({ dataset: {} }) },
    window: {
      petQuotaLabel: { onModel(callback) { receive = callback; return () => { throw new Error('unsubscribe failed'); }; } },
      addEventListener(_name, callback) { beforeUnload = callback; }
    }
  }));
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.doesNotThrow(() => receive(revoked.proxy));
  assert.equal(nodes.status.textContent, 'Codex 未连接');
  assert.doesNotThrow(beforeUnload);
});

test('静态页面无内联脚本能力，额度内容位于独立流光外壳且浅深背景可读', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../quota-label.html'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /quota-label-renderer\.js/);
  assert.match(html, /id="reset-time"/);
  assert.match(html, /id="reset-credits"/);
  assert.match(html, /id="quota-beam"/);
  assert.match(html, /id="compact-product"/);
  assert.match(html, /id="compact-period"/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(css, /font-size:\s*(?:12|1[3-9]|[2-9]\d)px/);
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /rgba\(/);
  assert.match(css, /backdrop-filter:\s*blur\(24px\)\s+saturate\(175%\)/);
  assert.match(css, /#items li\s*\{[\s\S]*?display:\s*grid/);
  assert.match(css, /\.quota-name\s*\{[\s\S]*?text-overflow:\s*ellipsis/);
  assert.match(css, /\.quota-value\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /\.quota-progress\s*\{[\s\S]*?height:\s*3px/);
});

test('额度卡流光沿可见卡面流动，悬停不变速且减少动态效果时静止', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  assert.match(css, /@property\s+--quota-beam-angle/);
  assert.match(css, /@keyframes\s+quotaBeamOrbit/);
  assert.match(css, /#quota-beam::before,[\s\S]*?#quota-beam::after[\s\S]*?conic-gradient\([\s\S]*?#3fdbec[\s\S]*?#8fa7ff[\s\S]*?#ef93de[\s\S]*?#ffd18b/);
  assert.match(css, /animation:\s*quotaBeamOrbit\s+4\.5s\s+linear\s+infinite/);
  const hoverRules = [...css.matchAll(/#quota-beam:hover[^{}]*\{([^}]+)\}/g)];
  hoverRules.forEach(([, rule]) => assert.doesNotMatch(rule, /animation(?:-duration)?:/));
  assert.match(css, /#quota-beam:hover::after\s*\{\s*opacity:\s*\.76/);
  assert.match(css, /#quota-beam:has\(#quota-label\[data-size="compact"\]\[data-expanded="false"\]\)::before\s*\{\s*inset:\s*2px;\s*border-radius:\s*11px/);
  const compactShell = css.match(/#quota-beam:has\(#quota-label\[data-size="compact"\]\[data-expanded="false"\]\)\s*\{([^}]+)\}/)?.[1] || '';
  assert.doesNotMatch(compactShell, /background:/, '外围留边必须透明，避免扩大正式版可见轮廓');
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation:\s*none/);
  assert.match(css, /@media \(prefers-color-scheme:\s*dark\)[\s\S]*?#quota-beam::before\s*\{\s*opacity:\s*\.96/);
});

test('小巧展开为 196×131，单项额度使用大数字，双项额度仍完整保留', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  assert.match(css, /#quota-label\[data-expanded="true"\][\s\S]*?padding:\s*8px 10px 7px/);
  assert.match(css, /#quota-label\[data-expanded="true"\]\[data-item-count="1"\][\s\S]*?\.quota-value[\s\S]*?font-size:\s*24px/);
  assert.match(css, /#quota-label\[data-expanded="true"\]\[data-item-count="2"\][\s\S]*?#secondary-quota[\s\S]*?display:\s*block/);
  assert.match(css, /#quota-details[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)\s+58px/);
});

test('双周期展开以第一项为主周期，并让上下周期共用同一蓝色玻璃胶囊', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../quota-label.html'), 'utf8');
  const renderer = fs.readFileSync(path.resolve(__dirname, '../quota-label-renderer.js'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  assert.match(html, /id="compact-period"\s+class="period-pill"/);
  assert.match(html, /id="secondary-quota"/);
  assert.match(html, /id="secondary-period"\s+class="period-pill"/);
  assert.match(html, /id="secondary-value"/);
  assert.match(html, /id="secondary-progress"/);
  assert.match(html, /id="secondary-reset"/);
  assert.match(renderer, /const summaryItem = model\.items\[0\]/);
  assert.match(renderer, /secondaryPeriod\.textContent\s*=\s*periodTypeText\(secondaryItem\.windowMinutes\)/);
  assert.match(renderer, /secondaryReset\.textContent\s*=\s*resetTimeText\(model, secondaryItem\)/);
  assert.match(css, /\.period-pill\s*\{/);
  assert.match(css, /#quota-label\[data-expanded="true"\]\[data-item-count="2"\][\s\S]*?#items li:nth-child\(2\)[\s\S]*?display:\s*none/);
  assert.match(css, /#secondary-value[\s\S]*?font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /\.secondary-heading\s*\{[\s\S]*?justify-content:\s*flex-start[\s\S]*?gap:\s*6px/,
    '周额度百分比应紧跟在周期胶囊后');
  assert.match(css, /#secondary-progress\s*\{[\s\S]*?width:\s*70%/,
    '第二周期进度条按设计稿保持紧凑，不与主进度条等宽');
});

test('额度卡片使用大写品牌标识、蓝色周期边界及四周一致的单层玻璃轮廓', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../quota-label.html'), 'utf8');
  const renderer = fs.readFileSync(path.resolve(__dirname, '../quota-label-renderer.js'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  assert.match(html, /id="compact-product">CODEX</);
  assert.match(renderer, /compactProduct\.textContent\s*=\s*model\.sourceId === 'zcode' \? 'ZCODE' : 'CODEX'/);
  assert.match(css, /\.period-pill\s*\{[\s\S]*?border:\s*1px solid rgba\(112, 171, 238, \.24\)/,
    '周期胶囊应使用轻蓝边界，不能用高亮白边形成白色外圈');
  assert.match(css, /:root\[data-appearance="dark"\] #quota-label::after\s*\{\s*border-color:\s*transparent/,
    '固定深色外观应移除第二层内边框');
  assert.match(css, /:root\[data-appearance="system"\] #quota-label::after\s*\{\s*border-color:\s*transparent/,
    '跟随系统的深色外观也应移除第二层内边框');
  const fixedDarkCard = css.match(/:root\[data-appearance="dark"\] #quota-label\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const systemDarkCard = css.match(/:root\[data-appearance="system"\] #quota-label\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';
  const lightCard = css.match(/^#quota-label\s*\{([\s\S]*?)\n\}/m)?.[1] || '';
  const lightInnerEdge = [...css.matchAll(/^#quota-label::after\s*\{([\s\S]*?)\n\}/gm)].at(-1)?.[1] || '';
  assert.doesNotMatch(fixedDarkCard, /inset\s+0\s+1px/,
    '固定深色卡片不能再用顶部内阴影与外边框叠成双线');
  assert.doesNotMatch(systemDarkCard, /inset\s+0\s+1px/,
    '跟随系统的深色卡片也不能叠加顶部内阴影');
  assert.doesNotMatch(fixedDarkCard, /border-top-color:\s*transparent/,
    '固定深色卡片必须保留与其他三边一致的顶部玻璃边');
  assert.doesNotMatch(systemDarkCard, /border-top-color:\s*transparent/,
    '跟随系统的深色卡片也必须保留完整四边轮廓');
  assert.match(lightCard, /border:\s*1px solid rgba\(255, 255, 255,/,
    '浅色卡片用白色玻璃边，避免与流光叠成灰黑框');
  assert.match(lightCard, /inset\s+0\s+1px\s+0\s+rgba\(255, 255, 255,/,
    '浅色卡片用轻微内高光恢复层次，背景保持填满');
  assert.doesNotMatch(lightCard, /border-top-color:\s*transparent/,
    '浅色卡片必须保留与其他三边一致的顶部玻璃边');
  assert.match(lightInnerEdge, /border:\s*1px solid rgba\(255, 255, 255,/,
    '浅色卡片内缘使用白高光，深色和色弱保留独立规则');
});

test('额度标签改为两行名称、周期、百分比和进度条，不再渲染另有项目提示', () => {
  const renderer = fs.readFileSync(path.resolve(__dirname, '../quota-label-renderer.js'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  assert.match(renderer, /createElement\('progress'\)/);
  for (const className of ['quota-name', 'quota-period', 'quota-value', 'quota-progress']) {
    assert.match(renderer, new RegExp(className));
    assert.match(css, new RegExp(`\\.${className}`));
  }
  assert.doesNotMatch(renderer, /另有.*见菜单/);
});

test('标准档复用原小巧版 11px 字号和 3px 进度条，小巧折叠为一行横条', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  const renderer = fs.readFileSync(path.resolve(__dirname, '../quota-label-renderer.js'), 'utf8');
  assert.match(renderer, /label\.dataset\.size\s*=\s*model\.size/);
  assert.match(css, /#quota-label\s*\{[\s\S]*?padding:\s*5px 8px/);
  assert.match(css, /#quota-label\s*\{[\s\S]*?font-size:\s*11px/);
  assert.match(css, /\.quota-progress\s*\{[\s\S]*?height:\s*3px/);
  assert.match(css, /#quota-label\s*\{[\s\S]*?border-radius:\s*inherit/);
  assert.match(css, /#quota-label\[data-size="compact"\]\[data-expanded="false"\][\s\S]*?#summary[\s\S]*?display:\s*flex/);
  assert.match(css, /#quota-label\[data-expanded="true"\][\s\S]*?#quota-details[\s\S]*?display:\s*grid/);
});

test('小巧展开详情在深色背景使用浅色文字，不能继承浅色页灰字', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  assert.match(css, /:root\[data-appearance="dark"\] #quota-label\[data-expanded="true"\] #quota-details\s*\{[\s\S]*?color:\s*var\(--quota-muted\)/);
  assert.match(css, /:root\[data-appearance="dark"\] #quota-label\[data-expanded="true"\]\[data-item-count="1"\] #items li::after,[\s\S]*?\{\s*color:\s*var\(--quota-subtle\)/);
});

test('额度卡片外观可独立跟随系统或固定浅深色，不影响球球和气泡', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  assert.match(css, /:root\[data-appearance="light"\]\s*\{\s*color-scheme:\s*light/);
  assert.match(css, /:root\[data-appearance="dark"\]\s*\{[\s\S]*?color-scheme:\s*dark[\s\S]*?--quota-surface:\s*rgba\(26, 34, 45, \.82\)/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)\s*\{[\s\S]*?:root\[data-appearance="system"\]\s*\{[\s\S]*?--quota-surface:\s*rgba\(26, 34, 45, \.82\)/);
  assert.doesNotMatch(css, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{/);
  assert.doesNotMatch(css, /#pet|#bubble/);
});

test('浅色系统叠在深色壁纸上仍使用高覆盖玻璃底和不透明文字', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  assert.match(css, /--quota-surface:\s*rgba\(244, 249, 255, \.86\)/);
  assert.match(css, /--quota-muted:\s*#555e6a/);
  assert.match(css, /--quota-subtle:\s*#505965/);
  assert.match(css, /\.quota-period[\s\S]*?color:\s*var\(--quota-muted\)/);
  assert.match(css, /\.detail-secondary[\s\S]*?color:\s*var\(--quota-subtle\)/);
  assert.match(css, /#quota-label\[data-expanded="true"\][\s\S]*?#quota-details[\s\S]*?display:\s*grid/);
});

test('标准卡片展开态复用 196×131 明细布局', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  assert.match(css, /#quota-label\[data-expanded="true"\][\s\S]*?padding:\s*8px 10px 7px/);
  assert.match(css, /#quota-label\[data-expanded="true"\]\[data-item-count="1"\][\s\S]*?grid-template-rows:\s*25px 3px/,
    '主额度区应压缩到设计稿高度，为底部说明保留安全空间');
  assert.match(css, /#quota-label\[data-expanded="true"\]\[data-item-count="1"\][\s\S]*?\.quota-value[\s\S]*?font-size:\s*24px[\s\S]*?line-height:\s*25px/,
    '主额度数字应按设计稿比例呈现，不能挤压下方信息');
});

test('展开详情把相对重置时间、具体时间和重置机会分层排版', () => {
  const renderer = fs.readFileSync(path.resolve(__dirname, '../quota-label-renderer.js'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  assert.match(renderer, /detail-primary/);
  assert.match(renderer, /detail-secondary/);
  assert.match(renderer, /detail-separator/);
  assert.doesNotMatch(renderer, /resetTime\.textContent\s*=\s*resetTimeText/);
  assert.match(css, /\.detail-primary\s*\{[\s\S]*?font-size:\s*8px[\s\S]*?font-weight:\s*600[\s\S]*?line-height:\s*12px/,
    '主周期重置详情应使用更轻、更疏朗的两行排版');
  assert.match(css, /\.detail-secondary\s*\{[\s\S]*?margin-top:\s*2px[\s\S]*?font-size:\s*7px[\s\S]*?line-height:\s*9px/,
    '具体重置时间应降低字号并与上行留出间距');
  assert.match(css, /#secondary-reset\s*\{[\s\S]*?margin:\s*3px 0 0[\s\S]*?font-size:\s*7px[\s\S]*?font-weight:\s*540[\s\S]*?line-height:\s*10px/,
    '周额度重置详情应按原稿降低密度并保留进度条间距');
});

test('168×58 标准档内两条额度的文字和进度条不裁切', () => {
  const inset = 2;
  const paddingY = 5;
  const border = 1;
  const lineHeight = 14;
  const rowGap = 1;
  const rowProgress = 3;
  const itemsGap = 3;
  const available = 58 - 2 * inset - 2 * paddingY - 2 * border;
  const needed = (lineHeight + rowGap + rowProgress) * 2 + itemsGap;
  assert.ok(needed <= available, `小巧档两条额度需要 ${needed}px，实际可用 ${available}px`);
});

test('168 像素宽内只允许名称和周期省略，64% 和 78% 核心比例完整', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  const renderer = fs.readFileSync(path.resolve(__dirname, '../quota-label-renderer.js'), 'utf8');
  assert.match(renderer, /renderValue\(valueNode, item\.remaining, model\.sourceId\)/);
  assert.match(renderer, /const percentage\s*=\s*remainingText\(remaining, sourceId\)/);
  assert.match(renderer, /periodNode\.textContent\s*=\s*`\$\{model\.state\s*===\s*'stale'\s*\?\s*'已过期 '\s*:\s*''\}/);
  assert.doesNotMatch(renderer, /row\.textContent\s*=\s*`\$\{item\.label\}/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, auto\)\s+minmax\(0, 1fr\)\s+auto/);
  assert.match(css, /\.quota-name\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /\.quota-period\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /\.quota-value\s*\{[\s\S]*?text-align:\s*right/);
});

function composite(foreground, background) {
  const alpha = foreground[3];
  return foreground.slice(0, 3).map((value, index) => value * alpha + background[index] * (1 - alpha));
}

function luminance(rgb) {
  const channels = rgb.map(value => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('正常深色胶囊的额度文字和周期徽标在亮色背板上仍有足够对比', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  const hex = value => [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16));
  for (const [appearance, source] of [['dark', css], ['system', css.slice(css.indexOf('@media (prefers-color-scheme: dark)'))]]) {
    const root = source.match(new RegExp(`:root\\[data-appearance="${appearance}"\\]\\s*\\{([^}]+)\\}`))[1];
    const muted = root.match(/--quota-muted:\s*#([0-9a-f]{6})/i);
    // Hidden Electron baseline: the white desktop and glass highlights make
    // the compact label's center background rgb(93, 98, 106).
    assert.ok(contrast(hex(muted[1]), [93, 98, 106]) >= 4.5, `${appearance}: 额度文字不能被玻璃高光冲淡`);
    const badge = source.match(new RegExp(`:root\\[data-appearance="${appearance}"\\] \\.summary-badge,\\s*:root\\[data-appearance="${appearance}"\\] \\.period-pill\\s*\\{([^}]+)\\}`))[1];
    const text = hex(badge.match(/color:\s*#([0-9a-f]{6})/i)[1]);
    const background = badge.match(/background:\s*linear-gradient\(([^;]+)\);/)[1];
    const stops = [...background.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g)];
    assert.equal(stops.length, 2);
    for (const stop of stops) {
      const fill = stop.slice(1).map(Number);
      assert.ok(fill[3] > 0 && fill[3] < 1, '周期徽标仍保持半透明');
      assert.ok(contrast(text, composite(fill, [150, 155, 165])) >= 4.5,
        `${appearance}: 周期徽标不能用亮蓝底托亮蓝字`);
    }
  }
});

test('168×58 内两条额度的文字和进度条不裁切', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  const inset = Number(css.match(/#quota-label\s*\{[\s\S]*?inset:\s*(\d+)px/)[1]);
  const paddingY = Number(css.match(/#quota-label\s*\{[\s\S]*?padding:\s*(\d+)px/)[1]);
  const border = Number(css.match(/#quota-label\s*\{[\s\S]*?border:\s*(\d+)px/)[1]);
  const lineHeight = Number(css.match(/#quota-label\s*\{[\s\S]*?line-height:\s*(\d+)px/)[1]);
  const rowText = Number(css.match(/grid-template-rows:\s*(\d+)px\s+(\d+)px/)[1]);
  const rowProgress = Number(css.match(/grid-template-rows:\s*(\d+)px\s+(\d+)px/)[2]);
  const rowGap = Number(css.match(/row-gap:\s*(\d+)px/)[1]);
  const itemsGap = Number(css.match(/#items\s*\{[^}]*gap:\s*(\d+)px/)[1]);
  const available = 58 - inset * 2 - paddingY * 2 - border * 2;
  const needed = (rowText + rowGap + rowProgress) * 2 + itemsGap;
  assert.ok(lineHeight >= 14, `真实 11px 正文行高不得低于 14px，当前为 ${lineHeight}px`);
  assert.ok(needed <= available, `两条额度需要 ${needed}px，实际可用 ${available}px`);
  assert.doesNotMatch(css.replace(/#quota-label\[data-source="zcode"\][^{]*\{[^}]*\}/g, ''), /overflow(?:-y)?:\s*(?:auto|scroll)/);
});

test('浅色卡片在深色壁纸上的次级文字和深色 urgent 对比度均不低于 4.5', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../quota-label.css'), 'utf8');
  const lightBackgroundMatch = css.match(/--quota-surface:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  const periodMatch = css.match(/--quota-muted:\s*#([0-9a-f]{6})/i);
  const darkBlock = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
  const darkBackgroundMatch = darkBlock.match(/--quota-surface:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  const urgentMatch = darkBlock.match(/--quota-urgent-text:\s*rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  assert.ok(lightBackgroundMatch && periodMatch && darkBackgroundMatch && urgentMatch);
  const numbers = match => match.slice(1).map(Number);
  const hex = value => [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16));
  const lightBackground = composite(numbers(lightBackgroundMatch), [0, 0, 0]);
  const periodColor = hex(periodMatch[1]);
  const darkBackground = composite(numbers(darkBackgroundMatch), [0, 0, 0]);
  const urgentColor = numbers(urgentMatch);
  assert.ok(contrast(periodColor, lightBackground) >= 4.5);
  assert.ok(contrast(urgentColor, darkBackground) >= 4.5);
});


test('侧卡透明尾跨进羊或气泡时仍穿透，普通48px入口有效区域保持', async t => {
  let cursor = { x: 1390, y: 440 };
  const f = fixture(() => Promise.resolve(), { labelSize: 'compact', getGuardEntry: () => true,
    presentation: { shape: 'new-year-sheep', mode: 'peeked', side: 'right' }, getCursorScreenPoint: () => cursor });
  t.after(() => f.label.destroy());
  f.pet.bounds = { x: 1360, y: 400, width: 80, height: 80 };
  f.label.show(readyModel()); await flush();
  const win = f.windows[0], contents = win.webContents, frame = {};
  contents.mainFrame = frame;
  contents.getURL = () => require('node:url').pathToFileURL(win.loadedFile).href;
  const pointer = () => contents.emit('ipc-message', { sender: contents, senderFrame: frame }, 'pet:quota-label-pointer', true);
  assert.equal(win.sent.findLast(row=>row[0]==='pet:quota-label')[1].guardTargetWidth,48,'普通角色48px目标继续存在');
  assert.equal(win.bounds.x + win.bounds.width > f.pet.bounds.x + 3.2, true, '真实复现透明尾与羊轮廓相交');
  assert.equal(win.ignoreCalls.at(-1)[0], true, '首次显示不能抢羊hover');
  pointer(); assert.equal(win.ignoreCalls.at(-1)[0], true, '迟到renderer命中不能抢羊点击');
  cursor = { x: 1340, y: 440 }; pointer();
  assert.equal(win.ignoreCalls.at(-1)[0], false, '羊外的完整角色目标仍可点击');
  f.pet.bounds = { x: 176, y: 400, width: 80, height: 80 };
  f.obstacle = { x: 240, y: 310, width: 146, height: 252 };
  cursor = { x: 242, y: 510 }; f.label.reposition(); pointer();
  assert.equal(win.ignoreCalls.at(-1)[0], true, '气泡下的透明尾不吃气泡点击');
  cursor = { x: 210, y: 510 }; pointer();
  assert.equal(win.ignoreCalls.at(-1)[0], false, '气泡外仍有角色点击目标');
  assert.deepEqual(f.errors, []);
});


test('实际controller区分22/24/50角色，普通48px与大角色64px同源传给页面', async t => {
  let theme='christmas';
  const f=fixture(()=>Promise.resolve(),{labelSize:'compact',getGuardEntry:()=>true});t.after(()=>f.label.destroy());
  f.pet.bounds={x:1360,y:400,width:80,height:80};
  for(const [remaining,roleWidth]of [[84,22],[100,24],[0,50]]){
    f.presentation={shape:'new-year-sheep',sheepTheme:theme,mode:'peeked',side:'right'};
    const m=readyModel();m.items[0].remaining=remaining;f.label.show(m);await flush();
    const b=f.label.getWindow().getBounds();
    const packet=f.windows[0].sent.at(-1)[1];assert.equal(packet.guardSide,'left');
    assert.equal(b.x+packet.cardInset.x+128,AREA.width);assert.equal(packet.cardViewport.face.left,packet.cardInset.x);
    assert(b.width>=(remaining===0?200:184));assert.equal(f.windows[0].sent.at(-1)[1].guardTargetWidth,remaining===0?64:48);assert.deepEqual(f.errors,[]);
  }
});

 test('ZCode 卡片保留四个独立额度桶并独立 IPC，Codex 仍限制两周期', async () => {
  const { safeModel } = require('../lib/quota-label-window');
  const model = { state: 'ready', sourceId: 'zcode', items: Array.from({length:4}, (_, i) => ({
    bucketId: `bucket-${i}`, label: `活动 GLM-${i}`, planName: i % 2 ? 'Start Plan 体验' : '1024 活动', windowMinutes: 1440, remaining: 100,
    periodKind: 'expiry', periodStart: 1900000000000, total: 200000000, remainingUnits: 200000000, unit: 'tokens'
  })) };
  assert.equal(safeModel(model).items.length, 2);
  assert.equal(safeModel(model, 'zcode').items.length, 4);
  assert.equal(safeModel(model, 'zcode').items[3].bucketId, 'bucket-3');
  assert.equal(safeModel(model, 'zcode').items[3].planName, 'Start Plan 体验');
  const h = fixture(undefined, {sourceId:'zcode'});
  h.label.show(model);
  await flush();
  const w = h.windows[0];
  w.webContents.emit('did-finish-load');
  assert.deepEqual(w.options.webPreferences.additionalArguments, ['--pet-source=zcode']);
  assert.equal(w.sent.at(-1)[0], 'pet:zcode-quota-label');
  assert.equal(w.sent.at(-1)[1].items.length, 4);
});

test('团队和额度查询原因通过 ZCode 原生窗口和 preload 白名单，未知码和 Codex 保持原行为', () => {
  const { safeModel } = require('../lib/quota-label-window');
  for (const source of ['zcode', 'codex']) {
    let api, listener, received;
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../quota-label-preload.js'), 'utf8'), {
      process: { argv: source === 'zcode' ? ['electron', '--pet-source=zcode'] : ['electron'] },
      require: () => ({ contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
        ipcRenderer: { on(_channel, callback) { listener = callback; }, removeListener() {}, send() {} } })
    });
    api.onModel(value => { received = value; });
    for (const code of ['ZCODE_TEAM_SELECTION_REQUIRED', 'ZCODE_TEAM_KEY_MISSING', 'ZCODE_TEAM_ACCESS_DENIED',
      'ZCODE_QUOTA_QUERY_FAILED', 'ZCODE_QUOTA_UPDATE_FAILED', 'ZCODE_CUSTOM_QUOTA_UNAVAILABLE', 'PRIVATE_RESPONSE']) {
      const input = { sourceId: 'zcode', state: code === 'ZCODE_QUOTA_UPDATE_FAILED' ? 'stale' : code === 'ZCODE_CUSTOM_QUOTA_UNAVAILABLE' ? 'unsupported' : 'disconnected', statusCode: code, items: [] };
      const packet = safeModel(input, source), expected = source === 'zcode' && code !== 'PRIVATE_RESPONSE' ? code : undefined;
      assert.equal(packet.statusCode, expected); listener({}, packet); assert.equal(received.statusCode, expected);
      assert.equal(received.items.length, 0);
      listener({}, input); assert.equal(received.statusCode, expected, 'preload independently validates the source and code');
    }
    const throwing = { state: 'disconnected', get statusCode() { throw new Error('PRIVATE'); } };
    assert.doesNotThrow(() => safeModel(throwing, source)); assert.doesNotThrow(() => listener({}, throwing));
    assert.equal(received.statusCode, undefined);
  }
});

 test('ZCode preload 固定来源，拒绝数字周期和跨来源操作，保留小数周期与四桶', () => {
  const handlers = new Map(), sent = [];
  let api;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../quota-label-preload.js'), 'utf8'), {
    process: {argv:['electron','--pet-source=zcode']},
    require: name => { assert.equal(name, 'electron'); return {
      contextBridge: {exposeInMainWorld(_name, value) {api = value;}},
      ipcRenderer: {on(channel, callback) {handlers.set(channel,callback);},removeListener() {},send(...args) {sent.push(args);}}
    }; }
  });
  let model;
  api.onModel(value => {model = value;});
  handlers.get('pet:zcode-quota-label')({}, {sourceId:'codex',state:'ready',items:Array.from({length:4}, (_,i) => ({label:`GLM-${i}`,planName:'1024 活动',bucketId:`bucket-${i}`,windowMinutes:18.5,remaining:70}))});
  assert.equal(model.sourceId,'zcode'); assert.equal(model.items[0].planName,'1024 活动'); assert.equal(model.items.length,4); assert.equal(model.items[0].windowMinutes,18.5);
  api.openDetail('trend',300); api.openDetail('opportunities','bucket-0');
  assert.equal(sent.length,0);
  api.openGuard(); api.openDetail('quota','bucket-0'); api.toggleExpanded(); api.setPointerInteractive(true);
  assert.deepEqual(sent,[['pet:zcode-quota-guard-open'],['pet:zcode-quota-label-detail','quota','bucket-0'],['pet:zcode-quota-label-toggle'],['pet:zcode-quota-label-pointer',true]]);
});

 test('ZCode 四桶展开显示真实模型/到期且详情入口不串入 Codex 重置机会', () => {
  class Element {
    constructor() {this.dataset={};this.children=[];this.events={};this.attributes={};this._text='';}
    set textContent(value) {this._text=String(value);this.children=[];}
    get textContent() {return this._text+this.children.map(child=>child.textContent).join('');}
    replaceChildren(...children) {this._text='';this.children=children;}
    appendChild(child) {this.children.push(child);}
    setAttribute(key,value) {this.attributes[key]=String(value);}
    addEventListener(type, callback) {this.events[type]=callback;}
  }
  const nodes=Object.fromEntries(['quota-label','status','summary','items','overflow','codex-expanded','compact-product','compact-period','quota-numbers'].map(id=>[id,new Element()]));
  let receive; const calls=[];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../quota-label-renderer.js'),'utf8'), {
    document:{documentElement:new Element(),getElementById:id=>nodes[id],createElement:()=>new Element()},
    window:{addEventListener() {},petQuotaLabel:{onModel(callback){receive=callback;},openDetail(...args){calls.push(args);},toggleExpanded(){}}}
  });
  const deadline = Date.now()+86400000;
  receive({sourceId:'zcode',state:'ready',expanded:true,items:Array.from({length:4},(_,i)=>({label:'GLM-5.3',planName:i%2?'Start Plan 体验':'1024 活动',bucketId:`bucket-${i}`,windowMinutes:1440,remaining:70,resetsAt:deadline,periodKind:i%2?'daily':'expiry'}))});
  const expanded=nodes['codex-expanded'];
  assert.equal(nodes['quota-label'].dataset.source,'zcode');
  assert.equal(expanded.children[1].children.length,4);
  assert.equal(nodes.items.children[0].children[0].textContent,'5.3');
  assert.equal(nodes.items.children[0].children[1].textContent,'1024活动');
  assert.equal(nodes.items.children[2].children[1].textContent,'每日体验');
  assert.match(expanded.textContent,/ZCODE/); assert.match(expanded.textContent,/体验/); assert.match(expanded.textContent,/1024/);
  assert.match(expanded.children[1].children[2].title,/Start Plan 体验/);
  assert.match(expanded.children[1].children[0].title,/1024 活动/); assert.match(expanded.textContent,/到期/);
  assert.doesNotMatch(expanded.textContent,/重置机会/);
  expanded.children[2].children[0].children[0].events.click({stopPropagation(){}});
  assert.deepEqual(calls,[['quota','bucket-0']]);
});

test('ZCode 无周期起点与完整长桶 ID 不丢余额，Codex 仍拒绝空周期', () => {
  const {safeModel}=require('../lib/quota-label-window');
  const bucketId='zcode:'+ 'p'.repeat(160) + ':' + 'e'.repeat(160);
  const model={state:'ready',items:[{bucketId,label:'MCP 工具',windowMinutes:null,remaining:80,periodKind:'monthly'}]};
  assert.equal(safeModel(model).items.length,0);
  const item=safeModel(model,'zcode').items[0];assert.equal(item.bucketId,bucketId);assert.equal(item.windowMinutes,null);assert.equal(item.remaining,80);
});

test('peek card keeps visible renderer through native exit and cancels late hide on reopen', async t => {
  const f = fixture(() => Promise.resolve(), { presentation: { mode: 'peeked', side: 'left' } });
  t.after(() => f.label.destroy());
  f.label.show(readyModel()); await flush(); const win = f.windows[0];
  win.setOpacity = value => { win.opacity = value; };
  f.label.hide({ animate: true });
  assert.equal(win.visible, true); assert.equal(win.sent.at(-1)[1].visible, true);
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(win.visible, false); assert.equal(win.sent.at(-1)[1].visible, false);
  f.label.show(readyModel()); assert.equal(win.opacity, 0);
  f.label.hide({ animate: true }); f.label.show(readyModel());
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(win.visible, true); assert.equal(win.opacity, 1);
  f.label.hide(); assert.equal(win.visible, false);
});

for (const sourceId of ['codex', 'zcode']) test(`${sourceId} tucked exit freezes native bounds before reentrant layout callbacks`, async t => {
  const f = fixture(() => Promise.resolve(), { sourceId, presentation: { mode: 'peeked', side: 'right' } });
  t.after(() => f.label.destroy());
  f.label.show(readyModel()); await flush(); const win = f.windows[0]; win.setOpacity = value => { win.opacity = value; };
  const before = win.getBounds();
  f.presentation = { mode: 'tucked', side: 'right', quotaAnimateHide: true }; f.pet.bounds.y += 160;
  f.label.reposition(); assert.deepEqual(win.getBounds(), before);
  f.label.show(readyModel()); assert.deepEqual(win.getBounds(), before, 'late refresh stays frozen');
  await new Promise(resolve => setTimeout(resolve, 220)); assert.equal(win.visible, false);
  f.presentation = { mode: 'peeked', side: 'right' }; f.label.show(readyModel());
  assert.equal(win.visible, true); assert.notDeepEqual(win.getBounds(), before);
  f.label.hide(); assert.equal(win.visible, false);
});


test('Codex icon enums and explicit system colors survive window and preload boundaries, unknown paths do not', () => {
  const {safeModel}=require('../lib/quota-label-window');
  let api,listener,received;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../quota-label-preload.js'),'utf8'),{
    require:()=>({contextBridge:{exposeInMainWorld(_name,value){api=value;}},ipcRenderer:{on(_name,fn){listener=fn;},removeListener(){}}})
  }); api.onModel(value=>{received=value;});
  for(const codexIconPreference of ['app-default','codex-system','space-system']) for(const codexIconDark of [false,true]) {
    const packet=safeModel({...readyModel(),codexIconPreference,codexIconDark});listener({},packet);
    assert.equal(received.codexIconPreference,codexIconPreference);assert.equal(received.codexIconDark,codexIconDark);
    assert.equal(safeModel({...readyModel(),codexIconPreference},'zcode').codexIconPreference,undefined);
  }
  for(const codexIconPreference of ['../secret','https://example.com/a.png',{},null]) {
    listener({},safeModel({...readyModel(),codexIconPreference,codexIconDark:true}));assert.equal(received.codexIconPreference,undefined);
    listener({},{...readyModel(),codexIconPreference,codexIconDark:true});assert.equal(received.codexIconPreference,undefined);
  }
  listener({},{...readyModel(),codexIconPreference:'app-default',codexIconDark:'true'});assert.equal(received.codexIconDark,undefined);
  const throwing={...readyModel()};Object.defineProperty(throwing,'codexIconPreference',{get(){throw Error('untrusted getter');}});
  assert.doesNotThrow(()=>safeModel(throwing));assert.doesNotThrow(()=>listener({},throwing));
});


for(const sourceId of ['codex','zcode']) test(`${sourceId} card resizes immediately once, keeps movement immediate and respects reduced motion and group stage`,async t=>{
 const f=fixture(()=>Promise.resolve(),{sourceId,labelSize:'compact'});t.after(()=>f.label.destroy());
 f.label.show({...readyModel(),sourceId});await flush();const win=f.windows[0],sender=win.webContents;
 sender.mainFrame={};sender.getURL=()=>require('node:url').pathToFileURL(path.resolve(__dirname,'../quota-label.html')).href;
 const toggle=()=>sender.emit('ipc-message',{sender,senderFrame:sender.mainFrame},sourceId==='zcode'?'pet:zcode-quota-label-toggle':'pet:quota-label-toggle');
 assert.equal(win.boundsAnimations[0],false,'first hidden placement stays immediate');
 toggle();assert.equal(win.boundsAnimations.at(-1),false,'expand never scales the native window');const count=win.boundsCalls.length;
 f.label.reposition();f.label.reposition();assert.equal(win.boundsCalls.length,count,'identical requested bounds do not restart animation');
 toggle();await new Promise(resolve=>setTimeout(resolve,230));assert.equal(win.boundsAnimations.at(-1),false,'collapse never scales the native window');
 f.pet.bounds.x+=20;f.label.reposition();assert.equal(win.boundsAnimations.at(-1),false,'same-size movement stays immediate');
 f.presentation={mode:'free',quotaReducedMotion:true};toggle();assert.equal(win.boundsAnimations.at(-1),false,'reduced motion disables resize animation');
 f.presentation={mode:'free'};f.label.setGroupTransitionMode('stage');f.pet.bounds.x+=20;f.label.reposition();assert.equal(win.boundsAnimations.at(-1),false,'group stage remains immediate');
});

test('resize reentry with an intermediate native frame does not restart the same requested bounds',async t=>{
 let f,armed=false,reentered=0;
 f=fixture(()=>Promise.resolve(),{labelSize:'compact',onCall(name){if(name==='setBounds'&&armed&&reentered++===0)f.label.reposition();}});
 t.after(()=>f.label.destroy());f.label.show(readyModel());await flush();const win=f.windows[0],old=win.getBounds();
 win.getBounds=()=>({...old});armed=true;const before=win.boundsCalls.length;
 win.webContents.emit('ipc-message',{},'pet:quota-label-toggle');
 assert.equal(reentered,1,'only the outer setBounds runs');assert.equal(win.boundsCalls.length,before+1);assert.equal(win.boundsAnimations.at(-1),false);assert.equal(f.errors.length,0);
});

test('empty Codex and ZCode cards retain real source icons and names across unavailable states',()=>{
 class Element{constructor(){this.dataset={};this.children=[];this._text='';}set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}replaceChildren(...c){this._text='';this.children=c;}appendChild(c){this.children.push(c);}setAttribute(){}addEventListener(){}}
 const nodes=Object.fromEntries(['quota-label','status','summary','items','overflow','codex-expanded','compact-product','compact-period','quota-numbers'].map(id=>[id,new Element()]));let receive;
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../quota-label-renderer.js'),'utf8'),{document:{documentElement:new Element(),getElementById:id=>nodes[id],createElement:()=>new Element()},window:{addEventListener(){},petQuotaLabel:{onModel(fn){receive=fn;}}}});
 for(const sourceId of ['codex','zcode'])for(const state of ['empty','unknown','error','unsupported','disconnected','loading']){
  receive({sourceId,state,size:'compact',items:[]});
  const identity=nodes.status.children[0];assert(identity,`${sourceId}/${state}`);assert.equal(identity.children[1].textContent,sourceId==='zcode'?'ZCode':'Codex');
  const icon=identity.children[0];assert(icon.children.length>0);assert(icon.children.every(img=>String(img.src).includes(sourceId==='zcode'?'zcode':'codex')));
  assert(nodes.status.children[1].textContent.length>0);assert.equal(nodes.summary.children.length,0,'no quota number is invented');assert.equal(nodes['quota-label'].dataset.source,sourceId);
 }
});

test('guard toggles publish unscaled face coordinates inside the union host, except reduced motion or group staging',async t=>{
 for(const left of [false,true]){
 const f=fixture(()=>Promise.resolve(),{labelSize:'compact',getGuardEntry:()=>true});t.after(()=>f.label.destroy());
 if(left)f.pet.bounds.x=1360;
 f.label.show(readyModel());await flush();const win=f.windows[0],initial=win.getBounds(),initialPacket=win.sent.findLast(row=>row[0]==='pet:quota-label')[1];
 const toggle=()=>win.webContents.emit('ipc-message',{},'pet:quota-label-toggle');toggle();
 const expandedPacket=win.sent.findLast(row=>row[0]==='pet:quota-label')[1],motion=expandedPacket.cardTransition;assert(motion);assert.equal(motion.duration,180);
 assert.equal(motion.from.width,128);assert.equal(motion.from.height,32);assert.equal(motion.to.width,196);assert.equal(motion.to.height,131);
 const unionX=initial.x+initialPacket.cardInset.x-motion.from.left,unionY=initial.y+initialPacket.cardInset.y-motion.from.top;
 assert.equal(unionX,Math.min(initial.x,f.label.getVisibleBounds().x));assert.equal(unionY,Math.min(initial.y,f.label.getVisibleBounds().y));
 await new Promise(resolve=>setTimeout(resolve,230));toggle();const collapsed=win.sent.findLast(row=>row[0]==='pet:quota-label')[1].cardTransition;
 assert(collapsed);assert.equal(collapsed.from.width,196);assert.equal(collapsed.to.width,128);assert.equal(collapsed.to.height,32);
 await new Promise(resolve=>setTimeout(resolve,230));
 f.presentation={mode:'free',quotaReducedMotion:true};toggle();assert.equal(win.sent.findLast(row=>row[0]==='pet:quota-label')[1].cardTransition,undefined);
 f.presentation={mode:'free'};f.label.setGroupTransitionMode('stage');toggle();assert.equal(win.sent.findLast(row=>row[0]==='pet:quota-label')[1].cardTransition,undefined);
 }
});

test('guard-capable carrier is allocated while hidden and never moves or resizes on ordinary toggles',async t=>{
 for(const labelSize of ['compact','standard']){
 let guard=true;const f=fixture(()=>Promise.resolve(),{labelSize,getGuardEntry:()=>guard});t.after(()=>f.label.destroy());f.label.show(readyModel());await flush();
 const win=f.windows[0],host=win.getBounds(),writes=win.boundsCalls.length;
 const packet=()=>win.sent.findLast(row=>row[0]==='pet:quota-label')[1];assert(packet().cardViewport);assert.deepEqual(packet().cardViewport.host,{width:host.width,height:host.height});
 for(let i=0;i<4;i++){
  win.webContents.emit('ipc-message',{},'pet:quota-label-toggle');assert.deepEqual(win.getBounds(),host);assert.equal(win.boundsCalls.length,writes);assert(packet().cardViewport);assert(packet().cardTransition);
  const face=packet().cardViewport.face;assert(face.left>=0&&face.top>=0&&face.left+face.width<=host.width&&face.top+face.height<=host.height);
  await new Promise(resolve=>setTimeout(resolve,210));assert.deepEqual(win.getBounds(),host);assert.equal(win.boundsCalls.length,writes);
 }
 guard=false;f.label.show(readyModel());assert.equal(packet().cardViewport,undefined);assert.equal(win.getBounds().width,labelSize==='compact'?128:168);
 }
});

test('a guarded carrier still contains the painted card when the coordinated column moves on corner expansion',async t=>{
 const f=fixture(()=>Promise.resolve(),{labelSize:'compact',getGuardEntry:()=>true});t.after(()=>f.label.destroy());f.pet.bounds={x:1340,y:810,width:80,height:80};
 const {quotaFreeStackBounds}=require('../lib/quota-label-placement');const metrics={width:128,height:32,inset:2};let expanded=false;
 const plan=()=>quotaFreeStackBounds(f.pet.bounds,AREA,{weather:metrics,codex:expanded?{width:196,height:131,inset:0,guardTargetWidth:0}:{...metrics,guardTargetWidth:48,roleWidth:22},balance:metrics},{mode:'free',shape:'blob',quotaStyle:'card',quotaCardOrder:['weather','codex','balance']});
 f.presentation={mode:'free',shape:'blob',quotaGroupLayout:plan().cards.codex};f.label.show(readyModel());await flush();const win=f.windows[0],before=win.getBounds();
 expanded=true;f.presentation={mode:'free',shape:'blob',quotaGroupLayout:plan().cards.codex};win.webContents.emit('ipc-message',{},'pet:quota-label-toggle');const packet=win.sent.findLast(row=>row[0]==='pet:quota-label')[1],face=packet.cardViewport.face,host=packet.cardViewport.host;
 assert(face.top>=0,'new face must not rise above a cached compact carrier');assert(face.top+face.height<=host.height+1);assert(face.left>=0);assert(face.left+face.width<=host.width+1);assert.equal(win.getBounds().y+face.top,plan().cards.codex.face.y);assert.notDeepEqual(win.getBounds(),before,'a changed coordinated stack may require moving its transparent carrier');
});

test('guarded hide preserves the last painted carrier coordinates instead of shifting the final surface', async t => {
  for (const labelSize of ['compact', 'standard']) {
    const f = fixture(() => Promise.resolve(), { labelSize, getGuardEntry: () => true });
    t.after(() => f.label.destroy());
    f.label.show(readyModel()); await flush();
    const win = f.windows[0], last = () => win.sent.findLast(row => row[0] === 'pet:quota-label')[1];
    const painted = last();
    assert(painted.cardViewport);
    assert(painted.cardInset.x > 0, 'expanded carrier leaves a real inset around the compact card');
    f.label.hide();
    assert.equal(last().visible, false);
    assert.deepEqual(last().cardInset, painted.cardInset, 'hidden packet must retain host-relative inset');
    assert.deepEqual(last().cardViewport, painted.cardViewport, 'hidden packet must not clear the painted viewport');
    assert.equal(last().cardTransition, undefined, 'hide must not replay an old resize animation');
    f.label.show(readyModel());
    assert.equal(last().visible, true);
    win.webContents.emit('ipc-message', {}, 'pet:quota-label-toggle');
    const expanded = last();
    f.label.hide();
    assert.equal(last().expanded, false, 'explicit hide keeps the existing collapsed model contract');
    assert.deepEqual(last().cardViewport, expanded.cardViewport);
    assert.equal(last().cardTransition, undefined);
  }
});

test('hidden carrier geometry is window-owned across guarded role widths and destroy/recreate', async t => {
  for (const sourceId of ['codex', 'zcode']) {
    let guard = true;
    const f = fixture(() => Promise.resolve(), { sourceId, labelSize: 'compact', getGuardEntry: () => guard });
    t.after(() => f.label.destroy());
    const model = remaining => ({ ...readyModel(), items: [{ ...readyModel().items[0], remaining }] });
    for (const remaining of [0, 47, 100]) {
      f.label.show(model(remaining)); await flush();
      const win = f.label.getWindow(), packet = () => win.sent.at(-1)[1], painted = packet(), paintedX = win.getBounds().x + painted.cardViewport.face.left;
      f.label.hide();
      assert.deepEqual(packet().cardViewport, painted.cardViewport);
      assert.deepEqual(packet().cardInset, painted.cardInset);
      f.pet.bounds = { ...f.pet.bounds, x: f.pet.bounds.x + 30 };
      f.label.show(model(remaining));
      assert.equal(packet().visible, true);
      assert.equal(win.getBounds().x + packet().cardViewport.face.left,
        paintedX + 30, 'reopen recomputes geometry from the current pet position');
    }
    const old = f.label.getWindow();
    f.label.destroy(); guard = false;
    f.label.show(model(47)); await flush();
    const replacement = f.label.getWindow();
    assert.notEqual(replacement, old);
    f.label.hide();
    assert.equal(replacement.sent.at(-1)[1].cardViewport, undefined, 'a new unguarded window cannot inherit the old carrier');
    assert.equal(replacement.sent.at(-1)[1].cardInset, undefined);
  }
});
