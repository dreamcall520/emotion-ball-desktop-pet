const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: flush } = require('node:timers/promises');
const { pathToFileURL } = require('node:url');
const { createPomodoroWindows } = require('../lib/pomodoro-window');

function fixture() {
  const windows = [], handlers = new Map(), actions = [], errors = [];
  const state = { status: 'idle', mode: 'focus', face: 'analog', remaining: 1500, total: 1500,
    pinned: false, reminder: false, encouragement: '', durations: { focus: 25, short: 5, long: 15 } };
  let suppressed = false, obstacles = [], visibleQuota = null, nativeQuota = null, todoReminder = null, presentation = { shape: 'blob' };
  const area = { x: 0, y: 0, width: 1440, height: 900 };
  const pet = { bounds: { x: 300, y: 300, width: 80, height: 80 }, visible: true,
    isDestroyed: () => false, isVisible() { return this.visible; }, getBounds() { return { ...this.bounds }; } };
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.bounds = { x: 0, y: 0, width: options.width, height: options.height };
      this.destroyed = false; this.visible = false; this.moves = 0; this.shows = 0; this.sent = [];
      this.webContents = new EventEmitter(); this.webContents.mainFrame = {};
      this.webContents.getURL = () => this.url; this.webContents.send = (...args) => this.sent.push(args);
      this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
      windows.push(this);
    }
    loadFile(file, options) { const url = pathToFileURL(file); url.searchParams.set('view', options.query.view); this.url = url.href; this.view = options.query.view; return Promise.resolve(); }
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = { ...bounds }; this.moves++; }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    setAlwaysOnTop(value) { this.topmost = value; }
    setVisibleOnAllWorkspaces() {}
    setHiddenInMissionControl() {}
    setIgnoreMouseEvents(value) { this.passthrough = value; }
    showInactive() { this.visible = true; this.shows++; }
    show() { this.visible = true; this.shows++; }
    focus() { this.focused = true; }
    hide() { this.visible = false; }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
  }
  const manager = createPomodoroWindows({ BrowserWindow: Window,
    ipcMain: { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) },
    screen: { getDisplayMatching: () => ({ workArea: area }) }, getPetWindow: () => pet,
    getPetBounds: () => pet.getBounds(), getPetPresentation: () => presentation,
    getQuotaBounds: () => visibleQuota, getQuotaWindowBounds: () => nativeQuota, getReminderBounds: () => todoReminder,
    getWindowObstacles: () => [...obstacles, ...(nativeQuota ? [nativeQuota] : [])],
    getSnapshot: () => state, isSuppressed: () => suppressed, onError: error => errors.push(error),
    onAction: (type, value) => { actions.push([type, value]); if (type === 'pin') state.pinned = value; return { ok: true, state: { ...state } }; } });
  const win = view => windows.findLast(item => item.view === view && !item.destroyed);
  const event = view => ({ sender: win(view).webContents, senderFrame: win(view).webContents.mainFrame });
  return { manager, state, windows, handlers, actions, errors, pet, area, win, event,
    invoke: (view, type, value) => handlers.get('pomodoro:action')(event(view), type, value),
    suppress: value => { suppressed = value; }, obstacles: value => { obstacles = value; },
    quota: (visible, native = visible) => { visibleQuota = visible; nativeQuota = native; },
    todoReminder: value => { todoReminder = value; },
    presentation: value => { presentation = value; } };
}

test('左右贴边时小入口跟随真实额度边界，消息跟随，隐藏额度回退且贴边不隐藏番茄窗', async t => {
  const f = fixture(); t.after(() => f.manager.close());
  f.state.status = 'paused';
  const face = win => ({ x: win.bounds.x + 6, y: win.bounds.y + 6,
    width: win.bounds.width - 12, height: win.bounds.height - 12 });
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const side of ['left', 'right']) {
    Object.assign(f.pet.bounds, { x: side === 'left' ? 0 : 1360, y: 400 });
    f.presentation({ mode: 'peeked', side, shape: 'blob' });
    let quota = { x: side === 'left' ? 88 : 1224, y: 411, width: 128, height: 32 };
    f.quota(quota); f.manager.sync(); await flush();
    const mini = f.win('mini');
    assert.equal(face(mini).x + 50, quota.x + quota.width / 2, `${side} 贴边以额度卡可见中心为锚`);
    assert.equal(quota.y - face(mini).y - face(mini).height, 8);
    assert.notEqual(mini.focused, true);
    quota = { ...quota, x: quota.x + (side === 'left' ? 12 : -12), y: quota.y + 40, width: 168, height: 58 };
    f.quota(quota); f.manager.reposition();
    assert.equal(face(mini).x + 50, quota.x + quota.width / 2, '额度移动和改变大小后重新取实际边界');
    assert.equal(quota.y - face(mini).y - face(mini).height, 8);
    f.state.encouragement = '慢慢来。'; f.manager.sync(); await flush();
    const message = f.win('message');
    assert.equal(face(mini).y - face(message).y - face(message).height, 8);
    assert.equal(message.passthrough, true); assert.notEqual(message.focused, true);
    f.state.encouragement = ''; f.state.reminder = true; f.manager.sync();
    assert.equal(f.pet.bounds.y - message.bounds.y - message.bounds.height, 8, '完成提示改用球锚，mini 不把完成提示推离顶部');
    assert.equal(mini.visible, false, '完成提示显示期间收起重复的 mini');
    assert.equal(message.passthrough, false);
    f.state.reminder = false; f.quota(null); f.manager.sync();
    assert.equal(mini.visible, true, '完成提示关闭后恢复 mini');
    assert.equal(f.pet.bounds.y - face(mini).y - face(mini).height, 14, '额度隐藏或无数据时回退球锚');
    f.quota(quota); f.presentation({ mode: 'free', shape: 'blob' }); f.manager.sync();
    assert.equal(f.pet.bounds.y - face(mini).y - face(mini).height, 14, '自由态保留头顶布局');
  }
  f.presentation({ mode: 'peeked', side: 'right', shape: 'blob' });
  f.quota({ x: 1224, y: 451, width: 168, height: 58 }); f.manager.open(); await flush();
  const panel = f.win('panel'), mini = f.win('mini');
  panel.bounds = { x: 1130, y: 320, width: 320, height: 476 }; f.manager.sync();
  assert.ok(!overlaps(face(mini), panel.bounds), '邻近用户拖动后的面板时，小入口沿同一行避让');
  f.state.reminder = true; f.manager.sync();
  assert.ok(!overlaps(face(f.win('message')), panel.bounds), '完成提示避开面板');
  f.quota(null); f.presentation({ mode: 'tucked', side: 'right', shape: 'blob', suppressed: true }); f.manager.sync();
  for (const view of ['panel', 'message']) assert.equal(f.win(view).visible, true, `贴边收起球体不隐藏 ${view}`);
  assert.equal(mini.visible, false, '贴边完成提示期间也不重复展示 mini');
  f.presentation({ mode: 'hidden', side: 'right', shape: 'blob' }); f.manager.sync();
  for (const view of ['panel', 'mini', 'message']) assert.equal(f.win(view).visible, false, `用户真正隐藏球球时隐藏 ${view}`);
  f.presentation({ mode: 'peeked', side: 'right', shape: 'blob' });
  f.state.reminder = false; f.state.encouragement = '慢慢来。';
  for (const area of [{ x: -1200, y: -200, width: 1440, height: 900 }, { x: 0, y: 0, width: 700, height: 560 }]) {
    Object.assign(f.area, area); Object.assign(f.pet.bounds, { x: area.x + area.width - 80, y: area.y + 10 });
    f.quota({ x: area.x + area.width - 168, y: area.y + 4, width: 168, height: 58 }); f.manager.sync();
    for (const view of ['panel', 'mini', 'message']) {
      const b = f.win(view).bounds;
      assert.ok(b.x >= area.x && b.y >= area.y && b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height,
        `${view} 在屏幕边角保持工作区内`);
    }
  }
  assert.deepEqual(f.errors, []);
});

test('标准与小巧额度的守护外窗不推偏计时条，其他障碍及面板和完成提醒保留完整避让', async t => {
  const f = fixture(); t.after(() => f.manager.close());
  const face = win => ({ x: win.bounds.x + 6, y: win.bounds.y + 6, width: win.bounds.width - 12, height: win.bounds.height - 12 });
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  Object.assign(f.pet.bounds, { x: 0, y: 400 });
  f.presentation({ mode: 'peeked', side: 'left', shape: 'blob' }); f.state.status = 'paused';
  for (const [size, width, height, inset, gutter] of [['standard', 168, 58, 0, 6], ['compact', 128, 32, 2, 18]]) {
    for (const guard of [true, false]) {
      const native = { x: 88, y: 420, width: width + (guard ? 72 : 0), height: height + (guard ? gutter : 0) };
      const quota = { x: native.x + inset, y: native.y + (guard ? gutter : 0) + inset,
        width: width - inset * 2, height: height - inset * 2 };
      f.state.encouragement = ''; f.obstacles([]); f.quota(quota, native); f.manager.sync(); await flush();
      const mini = f.win('mini');
      assert.equal(face(mini).x + face(mini).width / 2, quota.x + quota.width / 2, `${size} 守护入口 ${guard} 保持卡面中心`);
      assert.equal(quota.y - face(mini).y - face(mini).height, 8, `${size} 守护入口 ${guard} 保持卡面8px间距`);
      f.state.encouragement = '慢慢来。'; f.manager.sync(); await flush();
      assert.equal(face(mini).y - face(f.win('message')).y - face(f.win('message')).height, 8, '鼓励卡继续跟随计时条堆叠');
      if (guard) {
        const neighboringWindow = { ...native, x: native.x + 1 };
        f.obstacles([neighboringWindow]); f.manager.sync();
        assert.equal(overlaps(face(mini), neighboringWindow), false, '仅替换逐项相等的额度外窗，邻近窗口继续避让');
        assert.notEqual(face(mini).x + face(mini).width / 2, quota.x + quota.width / 2);
        assert.equal(face(mini).y - face(f.win('message')).y - face(f.win('message')).height, 8);
      }
    }
  }
  f.obstacles([]); f.state.encouragement = ''; f.state.status = 'idle';
  Object.assign(f.pet.bounds, { x: 300, y: 300 });
  const panelObstacle = { x: 220, y: 200, width: 240, height: 64 };
  f.quota({ x: 220, y: 206, width: 168, height: 58 }, panelObstacle); f.manager.open(); await flush();
  assert.notDeepEqual(f.win('panel').bounds, { x: 404, y: 102, width: 320, height: 476 }, '面板不能进入守护外窗的透明侧边');
  assert.equal(overlaps(f.win('panel').bounds, panelObstacle), false);
  await f.invoke('panel', 'close-panel');
  const reminderObstacle = { x: 220, y: 280, width: 200, height: 50 };
  f.quota({ x: 222, y: 300, width: 124, height: 28 }, reminderObstacle);
  Object.assign(f.state, { status: 'complete', reminder: true }); f.manager.sync();
  assert.notDeepEqual(f.win('message').bounds, { x: 212, y: 104, width: 256, height: 188 }, '完成提醒保留额度原生窗口的完整避让');
  assert.equal(overlaps(face(f.win('message')), reminderObstacle), false);
  assert.deepEqual(f.errors, []);
});

test('真实贴边拖动序列中，移离边缘尚未pointerup也改用当前球体头顶锚点', async t => {
  const { createEdgeTuck } = require('../lib/edge-tuck');
  const { quotaLabelBounds } = require('../lib/quota-label-placement');
  const { petVisualBounds } = require('../lib/pet-visual-bounds');
  const f = fixture(); t.after(() => f.manager.close()); f.state.status = 'paused';
  f.pet.setPosition = (x,y) => Object.assign(f.pet.bounds,{x,y}); f.pet.setIgnoreMouseEvents = () => {};
  let shape = 'blob';
  const update = presentation => {
    f.presentation({...presentation,shape});
    const card = quotaLabelBounds(f.pet.getBounds(),f.area,null,'compact',false,1,{...presentation,shape},false,true);
    f.quota({x:card.x+card.cardInset.x+2,y:card.y+card.cardInset.y+2,width:124,height:28},card);
    f.manager.sync();
  };
  const edge = createEdgeTuck({getWindow:()=>f.pet,getWorkArea:()=>f.area,onChange:update});
  t.after(()=>edge.dispose());
  for (shape of ['blob','aurora-cloud']) for (const side of ['left','right']) {
    Object.assign(f.pet.bounds,{x:600,y:400,width:80,height:80});edge.restore();edge.dock(side);
    const docked=f.pet.getBounds();edge.sampleCursor({x:docked.x+(side==='left'?5:75),y:docked.y+40});await flush();
    assert.equal(edge.getPresentation().mode,'peeked');edge.beginDrag();
    Object.assign(f.pet.bounds,{x:600,y:500});update(edge.getPresentation());
    assert.equal(edge.getPresentation().mode,'peeked','复现边缘控制器拖动期间尚未切free');
    assert.equal(edge.getPresentation().dragging,true);
    const visual=petVisualBounds(f.pet.getBounds(),shape,edge.getPresentation()),mini=f.win('mini');
    assert.ok(Math.abs(visual.y-mini.bounds.y-42-14)<=.5,'拖出时即跟随真实可见球体头顶，不能仍锚在额度卡 '+JSON.stringify({shape,side,visual,mini:mini.bounds}));
    assert.ok(Math.abs(mini.bounds.x+56-visual.x-visual.width/2)<=.5);
    assert.equal(mini.sent.at(-1)[1].miniPointer.side,'bottom','头顶计时条下箭头指向球体');
    f.presentation({...edge.getPresentation(),dragging:false,shape});f.manager.sync();
    assert.ok(Math.abs(visual.y-mini.bounds.y-42-14)<=.5,'迟到peeked状态也不能把已移离物理边缘的小提示拉回额度锚');
    edge.endDrag(true);assert.equal(edge.getPresentation().mode,'free');
    const free=petVisualBounds(f.pet.getBounds(),shape,edge.getPresentation());
    assert.ok(Math.abs(free.y-mini.bounds.y-42-14)<=.5,'松手后保持自由态头顶');
  }
  assert.deepEqual(f.errors,[]);
});

test('顶部没有头顶空间时mini在真实卡面下方居中，箭头向上且不含角色透明槽', async t => {
  const { quotaLabelBounds } = require('../lib/quota-label-placement');
  const f = fixture();t.after(()=>f.manager.close());f.state.status='paused';
  for (const area of [{x:0,y:0,width:1440,height:900},{x:-1920,y:-180,width:1920,height:1080}]) {
    Object.assign(f.area,area);Object.assign(f.pet.bounds,{x:area.x+600,y:area.y,width:80,height:80});
    f.presentation({mode:'free',shape:'blob'});
    const card=quotaLabelBounds(f.pet.getBounds(),area,null,'compact',false,1,null,false,true);
    const face={x:card.x+2,y:card.y+card.cardInset.y+2,width:124,height:28};
    f.quota(face,card);f.manager.sync();await flush();
    const mini=f.win('mini');
    assert.equal(mini.bounds.x+56,face.x+face.width/2,'只取真实卡面中心，不能加右侧角色槽宽');
    assert.equal(mini.bounds.y+6-face.y-face.height,8);
    assert.deepEqual(mini.sent.at(-1)[1].miniPointer,{side:'top',offset:50});
    const loaded=f.handlers.get('pomodoro:load')(f.event('mini'));
    assert.deepEqual(loaded.state.miniPointer,{side:'top',offset:50},'load与broadcast方向一致，避免首次加载闪回下箭头');
  }
  assert.deepEqual(f.errors,[]);
});

test('mini renderer只接收上下方向与有界数字偏移，色弱外边框与箭头使用轻分隔线', async () => {
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},style:{setProperty(key,value){this[key]=value;}},setAttribute(){}});return nodes.get(id);};
  let receive;
  const state={mode:'focus',status:'paused',remaining:1410,total:1500,miniPointer:{side:'top',offset:50}};
  const api={onState(callback){receive=callback;return()=>{};},load:async()=>({ok:true,state})};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pomodoro-renderer.js'),'utf8'),{
    window:{qiuPomodoro:api,addEventListener(){}},document:{body:{dataset:{}},documentElement:{dataset:{appearance:'light'}},getElementById:get,querySelectorAll:()=>[],addEventListener(){}},
    URLSearchParams,location:{search:'?view=mini'},MutationObserver:class{observe(){}},cancelAnimationFrame(){},clearTimeout(){},setTimeout(){}
  });
  await Promise.resolve();
  assert.equal(get('mini').dataset.arrow,'top');assert.equal(get('mini').style['--mini-arrow-offset'],'50px');
  receive({...state,miniPointer:{side:'bottom',offset:999}});
  assert.equal(get('mini').dataset.arrow,'bottom');assert.equal(get('mini').style['--mini-arrow-offset'],'78px');
  for (const offset of [-999,999]) {
    receive({...state,miniPointer:{side:'top',offset}});
    const center=parseFloat(get('mini').style['--mini-arrow-offset']),halfWidth=6*Math.SQRT2/2;
    assert.ok(center-halfWidth>=17&&center+halfWidth<=100-17,'6px旋转箭头整体落在radius17之外的直边');
  }
  receive({...state,miniPointer:{side:'left;display:none',offset:'0px;display:none'}});
  assert.equal(get('mini').dataset.arrow,'bottom');assert.equal(get('mini').style['--mini-arrow-offset'],'50px');
  const css=fs.readFileSync(path.join(__dirname,'../pomodoro.css'),'utf8');
  assert.match(css,/\.mini-entry\[data-arrow=top\]::after\{top:-3px;bottom:auto;transform:rotate\(225deg\)/);
  assert.match(css,/:root\[data-color-mode=accessible\] #mini\{border-color:var\(--accessible-divider\)!important\}/);
  assert.match(css,/\.mini-entry::after\{background:var\(--accessible-panel\);border-color:var\(--accessible-divider\)/);
  assert.match(css,/\.entry-label\{[^}]*border-color:var\(--accessible-line\)/,'模式pill保留清晰控件边界');
});

test('已打开面板保持自身位置，球体和伴随窗口移动不追随，仅工作区变化时夹紧', async t => {
  const f = fixture(); t.after(() => f.manager.close());
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  Object.assign(f.pet.bounds, { x: 600, y: 300 }); f.manager.open(); await flush();
  const panel = f.win('panel');
  assert.deepEqual(panel.bounds, { x: 704, y: 102, width: 320, height: 476 });
  const guard = { x: 430, y: 388, width: 420, height: 410 };
  assert.equal(overlaps(panel.bounds, guard), true, '复现先打开番茄钟再显示守护时的交叠');
  const retained = { ...panel.bounds }, moves = panel.moves;
  f.obstacles([guard]); f.manager.reposition();
  assert.deepEqual(panel.bounds, retained, '后来出现的伴随窗不得覆盖已打开面板的位置');
  for (const x of [650, 780, 500, 900, 600]) {
    Object.assign(f.pet.bounds, { x, y: 300 });
    f.quota({ x: x - 80, y: 388, width: 168, height: 58 });
    f.obstacles([{ x: x - 170, y: 388, width: 420, height: 410 }]);
    f.manager.reposition();
    assert.deepEqual(panel.bounds, retained, '移动球球、额度和角色时面板不得左右换位');
  }
  assert.equal(panel.moves, moves, '不反复提交已打开面板的原生位置');
  f.obstacles([]); f.quota(null); f.manager.sync();
  assert.deepEqual(panel.bounds, retained, '障碍关闭后不把面板拉回原始位置');
  Object.assign(f.pet.bounds, { x: retained.x, y: retained.y }); f.manager.sync();
  assert.deepEqual(panel.bounds, retained, '只有球体移动进入面板时仍保留面板位置');
  const reminder = { x: retained.x + 20, y: retained.y + 20, width: 360, height: 190 };
  f.todoReminder(reminder); f.manager.sync();
  assert.deepEqual(panel.bounds, retained, '后来出现的待办提醒也不覆盖面板位置');
  panel.bounds = { x: 800, y: 150, width: 320, height: 476 };
  f.state.status = 'paused'; f.manager.sync(); await flush();
  const dragged = { ...panel.bounds }, mini = f.win('mini'), miniBefore = { ...mini.bounds };
  Object.assign(f.pet.bounds, { x: 400, y: 500 }); f.manager.sync();
  assert.deepEqual(panel.bounds, dragged, '用户手动摆放后球球移动仍保留面板位置');
  assert.notDeepEqual(mini.bounds, miniBefore, '迷你计时条继续跟随球球');
  Object.assign(f.area, { width: 900, height: 600 }); f.manager.reposition();
  assert.deepEqual(panel.bounds, { x: 580, y: 124, width: 320, height: 476 }, '屏幕工作区缩小时按面板自身位置夹紧');
  assert.deepEqual(f.errors, []);
});

test('番茄窗懒创建、原尺寸、不抢焦点、拖动稳定与屏幕边缘避让', async t => {
  const f = fixture(); t.after(() => f.manager.close());
  f.manager.sync(); assert.equal(f.windows.length, 0);
  f.manager.open(); await flush();
  const panel = f.win('panel'); assert.equal(f.win('mini'), undefined, '未开始计时，打开面板也不显示 mini');
  f.state.status = 'paused'; f.manager.sync(); await flush();
  const mini = f.win('mini');
  assert.equal(panel.bounds.width, 320); assert.equal(panel.bounds.height, 476);
  assert.deepEqual([mini.bounds.width, mini.bounds.height], [112, 48]);
  assert.equal(f.pet.bounds.y - (mini.bounds.y + 6 + 36), 14);
  assert.equal(mini.options.focusable, false); assert.equal(mini.passthrough, false);
  assert.equal(panel.options.webPreferences.sandbox, true); assert.equal(panel.options.webPreferences.nodeIntegration, false);
  assert.equal(panel.openHandler().action, 'deny');
  assert.equal(panel.focused, true); assert.notEqual(mini.focused, true);
  f.state.encouragement = '先做一件事。'; f.state.status = 'running'; f.manager.sync(); await flush();
  const firstMessage = f.win('message');
  assert.equal((mini.bounds.y + 6) - (firstMessage.bounds.y + 42), 8, '邻近面板占住一侧时，鼓励卡沿同一行避让');
  assert.ok(firstMessage.bounds.x + firstMessage.bounds.width - 6 <= panel.bounds.x - 6);
  f.state.encouragement = ''; f.state.status = 'idle'; f.manager.sync();
  panel.bounds = { x: 800, y: 150, width: 320, height: 476 };
  const moves = panel.moves; f.state.remaining--; f.manager.sync();
  assert.equal(panel.moves, moves, '每秒更新不得把用户拖动的面板拉回球球');
  await f.invoke('panel', 'layout', { face: 'analog', settings: true });
  assert.deepEqual(panel.bounds, { x: 800, y: 150, width: 320, height: 384 });
  await f.invoke('panel', 'layout', { face: 'analog', settings: false });
  assert.equal(panel.bounds.height, 476);
  f.state.status = 'running'; f.state.encouragement = '一点点推进，也是在向前。'; f.manager.sync(); await flush();
  const message = f.win('message');
  assert.equal(message.bounds.height, 48, '单行鼓励卡原生窗口为36px卡+12px留白');
  assert.equal((mini.bounds.y + 6) - (message.bounds.y + message.bounds.height - 6), 8);
  assert.equal(message.options.focusable, false); assert.equal(message.passthrough, true);
  assert.equal((await f.invoke('message', 'layout', { cardHeight: 54 })).ok, true);
  assert.equal(message.bounds.height, 66, '双行鼓励卡原生窗口为54px卡+12px留白');
  assert.equal((mini.bounds.y + 6) - (message.bounds.y + 60), 8);
  assert.equal((await f.invoke('message', 'layout', { cardHeight: 36 })).ok, true);
  f.state.reminder = true; f.manager.sync();
  assert.equal(message.passthrough, false); assert.equal(message.bounds.width, 256);
  assert.equal(message.bounds.height, 188, '专注完成卡保留两项紧凑操作空间');
  for (const mode of ['short', 'long']) {
    f.state.mode = mode; f.manager.sync();
    assert.equal(message.bounds.height, 164, '休息完成卡收合隐藏的加时操作空间');
    await f.invoke('message', 'layout', { cardHeight: 54 });
    assert.equal(message.bounds.height, 164, '鼓励卡尺寸请求不能覆盖完成卡固定尺寸');
  }
  f.state.mode = 'focus'; f.manager.sync();
  assert.equal(message.bounds.height, 188, '切回专注完成卡恢复两项操作空间');
  await f.invoke('panel', 'pin', true); assert.equal(panel.topmost, true);
  await f.invoke('panel', 'close-panel'); assert.equal(panel.visible, false); assert.equal(mini.visible, false);
  f.suppress(true); f.manager.sync(); assert.equal(mini.visible, false); assert.equal(message.visible, false);
  f.suppress(false); f.manager.sync(); assert.equal(mini.visible, false); assert.equal(message.visible, true);
  f.state.reminder = false; f.manager.sync(); assert.equal(mini.visible, true);
  const originalMiniY = mini.bounds.y;
  f.obstacles([{ x: 270, y: 240, width: 140, height: 50 }]); f.manager.sync();
  assert.notEqual(mini.bounds.y, originalMiniY, '被现有卡片挡住时，小入口需要避让');
  assert.equal((mini.bounds.y + 6) - (message.bounds.y + message.bounds.height - 6), 8, '鼓励卡跟随避让后的小入口');
  f.obstacles([]); f.presentation({ shape: 'cloud' }); f.manager.sync();
  const paintedTop = f.pet.bounds.y + (0.17 - 0.06) * f.pet.bounds.height;
  assert.ok(Math.abs(paintedTop - (mini.bounds.y + 42) - 14) <= 0.5, '小入口按球体可见轮廓保留14px距离');
  for (const bounds of [{ x: -1200, y: -200, width: 1440, height: 900 }, { x: 0, y: 0, width: 700, height: 560 }]) {
    Object.assign(f.area, bounds); f.pet.bounds.x = bounds.x + bounds.width - 90; f.pet.bounds.y = bounds.y + 10;
    f.presentation({ shape: 'cloud' }); f.manager.reposition();
    for (const view of ['mini', 'message']) { const b = f.win(view).bounds;
      assert.ok(b.x >= bounds.x && b.y >= bounds.y && b.x + b.width <= bounds.x + bounds.width && b.y + b.height <= bounds.y + bounds.height); }
  }
  assert.deepEqual(f.errors, []);
});

test('完成提示优先在球上方并收起 mini，两种待办到达顺序均不重叠', async t => {
  const f = fixture(); t.after(() => f.manager.close());
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const face = win => ({ x: win.bounds.x + 6, y: win.bounds.y + 6, width: win.bounds.width - 12, height: win.bounds.height - 12 });
  Object.assign(f.pet.bounds, { x: 600, y: 500 });
  Object.assign(f.state, { status: 'complete', reminder: true }); f.manager.sync(); await flush();
  const message = f.win('message');
  assert.equal(message.bounds.x + message.bounds.width / 2, f.pet.bounds.x + f.pet.bounds.width / 2);
  assert.equal(f.pet.bounds.y - message.bounds.y - message.bounds.height, 8);
  assert.equal(f.win('mini'), undefined, '直接恢复完成状态不创建重复 mini');
  assert.notEqual(message.focused, true);
  f.state.reminder = false; f.manager.sync();
  assert.equal(f.win('mini'), undefined, '完成提示关闭后仍无计时任务，不显示 mini');
  f.state.reminder = true; f.manager.sync();
  const todo = { x: 460, y: 302, width: 360, height: 190 };
  const originalTodo = { ...todo };
  f.todoReminder(todo); f.manager.sync();
  const completionFirst = { ...message.bounds };
  assert.equal(overlaps(face(message), todo), false, '完成先到，待办随后出现时完成卡避让');
  assert.deepEqual(todo, originalTodo, '番茄窗不写入待办原位置');
  Object.assign(f.state, { status: 'paused', reminder: false }); f.manager.sync(); await flush();
  const mini = f.win('mini'); assert.equal(mini.visible, true, '暂停中的有效计时显示小入口');
  Object.assign(f.state, { status: 'complete', reminder: true }); f.manager.sync();
  assert.equal(mini.visible, false);
  assert.deepEqual(message.bounds, completionFirst, '待办先到与完成先到得到相同避让结果');
  const expanded = { ...todo, y: 262, height: 230 };
  f.todoReminder(expanded); f.manager.sync(); assert.equal(overlaps(face(message), expanded), false);
  f.todoReminder(null); f.manager.sync();
  assert.equal(f.pet.bounds.y - message.bounds.y - message.bounds.height, 8, '待办关闭后完成卡回到球上方');
  for (const area of [{ x: 0, y: 0, width: 1440, height: 900 }, { x: -1400, y: -100, width: 1200, height: 800 }]) {
    Object.assign(f.area, area);
    for (const side of ['left', 'right']) {
      Object.assign(f.pet.bounds, { x: side === 'left' ? area.x : area.x + area.width - 80, y: area.y + 500 });
      f.presentation({ mode: 'tucked', side, shape: 'blob' }); f.manager.sync();
      assert.equal(f.pet.bounds.y - message.bounds.y - message.bounds.height, 8, '左右贴边优先横向夹紧后保持球上方');
      assert.equal(message.bounds.x, side === 'left' ? area.x : area.x + area.width - message.bounds.width);
      assert.equal(mini.visible, false);
      f.pet.bounds.y = area.y + 10; f.manager.sync();
      const b = message.bounds;
      assert.ok(b.x >= area.x && b.y >= area.y && b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height);
      assert.equal(overlaps(face(message), f.pet.bounds), false, '球顶部没有空间时再切换侧面');
    }
  }
  for (const mode of ['short', 'long', 'focus']) {
    Object.assign(f.state, { mode, status: 'running', reminder: false }); f.manager.sync();
    assert.equal(mini.visible, true, `${mode} 开始计时恢复 mini`);
    Object.assign(f.state, { status: 'complete', reminder: true }); f.manager.sync();
    assert.equal(mini.visible, false, `${mode} 完成提示收起 mini`);
    f.state.reminder = false; f.manager.sync();
    assert.equal(mini.visible, false, `${mode} 关闭完成提示后也不显示无任务 mini`);
    f.state.status = 'idle'; f.manager.open(); f.manager.sync(); await flush();
    assert.equal(mini.visible, false, `${mode} 空闲时打开面板也不显示 mini`);
  }
  assert.deepEqual(f.errors, []);
});

test('唯一来源、主frame、按窗口动作白名单及固定布局枚举保护 IPC', async t => {
  const f = fixture(); t.after(() => f.manager.close()); f.state.status = 'running'; f.manager.open(); await flush();
  const invoke = f.handlers.get('pomodoro:action'), load = f.handlers.get('pomodoro:load');
  assert.equal((await invoke({ sender: {}, senderFrame: {} }, 'toggle')).ok, false);
  assert.equal((await invoke({ ...f.event('panel'), senderFrame: {} }, 'toggle')).ok, false);
  assert.equal(load(f.event('panel')).ok, true);
  const old = f.win('panel').url; f.win('panel').url = old + '&extra=untrusted';
  assert.equal((await f.invoke('panel', 'toggle')).ok, false); f.win('panel').url = old;
  assert.equal((await f.invoke('mini', 'toggle')).ok, false);
  assert.equal((await f.invoke('mini', 'open')).ok, true);
  assert.equal(f.win('panel').focused, true);
  assert.equal((await f.invoke('panel', 'layout', { face: 'analog', settings: true, width: 9999 })).ok, false);
  assert.equal((await f.invoke('panel', 'layout', { face: 'unknown', settings: true })).ok, false);
  assert.equal((await f.invoke('panel', 'mode', 'anything')).ok, false);
  assert.equal((await f.invoke('panel', 'pin', 'true')).ok, false);
  assert.equal((await f.invoke('panel', 'intention', 'x'.repeat(61))).ok, false);
  assert.equal((await f.invoke('panel', 'settings', { face: 'analog', encouragementEnabled: true, durations: { focus: 0, short: 5, long: 15 } })).ok, false);
  assert.equal((await f.invoke('panel', 'settings', { face: 'minutes', encouragementEnabled: false, durations: { focus: 25, short: 5, long: 15 } })).ok, true);
  assert.deepEqual(f.actions.map(([type]) => type), ['settings']);
  f.state.status = 'complete'; f.state.reminder = true; f.manager.sync(); await flush();
  assert.equal((await f.invoke('message', 'pin', true)).ok, false);
  assert.equal((await f.invoke('message', 'layout', { cardHeight: 999 })).ok, false);
  assert.equal((await f.invoke('message', 'layout', { cardHeight: 36, width: 900 })).ok, false);
  assert.equal((await f.invoke('message', 'layout', { face: 'analog', settings: true })).ok, false);
  assert.equal((await f.invoke('message', 'dismiss')).ok, true);
  const cancelled = { prevented: false, preventDefault() { this.prevented = true; } };
  f.win('panel').emit('close', cancelled); assert.equal(cancelled.prevented, true); assert.equal(f.win('panel').visible, false);
  const actionCount = f.actions.length;
  assert.equal((await f.invoke('panel', 'toggle')).ok, false, '收起面板后迟到的按钮动作不得生效');
  assert.equal(load(f.event('panel')).ok, true, '隐藏窗口仍可加载快照');
  f.state.reminder = false; f.manager.sync();
  assert.equal((await f.invoke('message', 'rest')).ok, false, '隐藏提醒后迟到的休息动作不得生效');
  assert.equal((await f.invoke('message', 'extend')).ok, false);
  assert.equal(f.actions.length, actionCount);
  const before = f.windows.length; f.manager.close(); f.manager.sync();
  assert.equal(f.windows.length, before); assert.equal(f.handlers.size, 0); assert.ok(f.windows.every(win => win.destroyed));
});
