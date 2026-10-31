const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const sourcePath = path.join(__dirname, '../lib/weather-window.js');
const cityA = { name: '北京', latitude: 39.9, longitude: 116.4 }, cityB = { name: '上海', latitude: 31.2, longitude: 121.5 };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const report = city => ({ status: 'ready', updatedAt: Date.now(), data: { location: city, timezone: 'Asia/Shanghai', current: { temperature: 15 } } });
function fixture(t, { area = { x: 0, y: 0, width: 1000, height: 800 }, petBounds = { x: 460, y: 350, width: 80, height: 80 }, saved, cached, bubbleBounds = null, stackAnchor = null, locationBridge = { locate: async () => { throw Object.assign(Error('denied'), {code:'LOCATION_DENIED'}); } } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-weather-window-')), filePath = path.join(dir, 'weather.json');
  if (saved) fs.writeFileSync(filePath, JSON.stringify(saved));
  if (cached) fs.writeFileSync(filePath + '.cache', JSON.stringify(cached));
  const handlers = new Map(), windows = [], changes = [], requests = [], layouts = [], module = { exports: {} };
  let groupHidden = false;
  let suppressed = false, persistFails = false;
  const service = { searchCities: async () => [], getWeather(city) { const d = deferred(); requests.push({ city, ...d }); return d.promise; } };
  const mockedFs = Object.create(fs); mockedFs.renameSync = (...args) => { if (persistFails) throw Object.assign(Error('fixture storage unavailable'), { code: 'EACCES' }); return fs.renameSync(...args); };
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.visible = false; this.dead = false; this.sent = [];
      this.webContents = Object.assign(new EventEmitter(), { mainFrame: { url: pathToFileURL(path.join(__dirname, '../weather.html')).href },
        send: (channel, state) => this.sent.push({ channel, state }), setWindowOpenHandler: fn => { this.openHandler = fn; } }); windows.push(this); }
    isDestroyed() { return this.dead; } isVisible() { return this.visible; } setVisibleOnAllWorkspaces() {}
    setBounds(bounds, animate) { this.lastAnimate = animate; (this.boundsCalls ||= []).push({ bounds: { ...bounds }, animate }); this.bounds = { ...bounds }; } getBounds() { return { ...this.bounds }; } setSize(width, height) { this.bounds = { ...this.bounds, width, height }; }
    show() { this.visible = true; } focus() {} showInactive() { this.visible = true; } hide() { this.visible = false; } loadFile() { return Promise.resolve(); }
    destroy() { this.dead = true; this.visible = false; this.emit('closed'); }
  }
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), { module, __dirname: path.dirname(sourcePath), setInterval, clearInterval,
    require: name => name === 'node:fs' ? mockedFs : name === './weather-service' ? { createWeatherService: () => service } : require(name.startsWith('.') ? path.resolve(path.dirname(sourcePath), name) : name) }, { filename: sourcePath });
  const controller = module.exports.createWeatherWindow({ BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) },
    locationBridge, screen: { getDisplayMatching: () => ({ workArea: area }) }, filePath, getPetWindow: () => ({ isDestroyed: () => false, isVisible: () => true, getBounds: () => petBounds }),
    getStackAnchor: () => stackAnchor, getBubbleBounds: () => bubbleBounds, getPresentation: () => ({ mode: 'free', quotaGroupHidden: groupHidden }), getSuppressed: () => suppressed, onLayout: () => layouts.push(true), onChange: state => changes.push(state) });
  t.after(() => { controller.destroy(); fs.rmSync(dir, { recursive: true, force: true }); });
  controller.setEnabled(true);
  const event = () => ({ sender: controller.getWindow().webContents, senderFrame: controller.getWindow().webContents.mainFrame });
  return { controller, handlers, windows, changes, requests, layouts, filePath, event,
    invoke: (name, value, e) => handlers.get('weather:' + name)(e || event(), value), suppress: value => { suppressed = value; }, groupHidden: value => { groupHidden = value; }, failPersist: () => { persistFails = true; } };
}
test('weather IPC denies other windows, child frames and unexpected document URLs', t => {
  const f = fixture(t), trusted = f.event();
  for (const channel of ['get', 'refresh', 'search', 'city', 'location', 'resize']) {
    assert.equal(f.invoke(channel, cityA, { ...trusted, sender: {} }), null);
    assert.equal(f.invoke(channel, cityA, { ...trusted, senderFrame: { url: trusted.senderFrame.url } }), null);
  }
  trusted.senderFrame.url = 'https://untrusted.example/'; assert.equal(f.invoke('get'), null);
  assert.equal(f.requests.length, 0);
});
test('invalid latitude/longitude and empty city names never persist or fetch', async t => {
  const f = fixture(t);
  for (const value of [{ ...cityA, latitude: NaN }, { ...cityA, longitude: Infinity }, { ...cityA, latitude: 91 }, { ...cityA, longitude: -181 }, { ...cityA, name: ' ' }, { ...cityA, latitude: '39.9' }]) {
    await assert.rejects(f.invoke('city', value), /有效城市/);
  }
  assert.equal(f.requests.length, 0); assert.equal(JSON.parse(fs.readFileSync(f.filePath)).city, null);
});
test('late previous-city response cannot replace the newly selected city', async t => {
  const f = fixture(t), first = f.invoke('city', cityA), second = f.invoke('city', cityB);
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve(report(cityB)); await second;
  const changes = f.changes.length;
  f.requests[0].resolve(report(cityA)); await first;
  assert.equal(f.controller.getState().city.name, '上海'); assert.equal(f.changes.length, changes);
});
test('destroy during a request prevents late publication and unregisters IPC', async t => {
  const f = fixture(t), pending = f.invoke('city', cityA); f.controller.destroy();
  const count = f.changes.length; f.requests[0].resolve(report(cityA)); await pending;
  assert.equal(f.changes.length, count); assert.equal(f.windows[0].sent.filter(x => x.state.status === 'ready').length, 0); assert.equal(f.handlers.size, 0);
});
test('failed city persistence retains previous city in memory and on disk', async t => {
  const f = fixture(t), pending = f.invoke('city', cityA); f.requests[0].resolve(report(cityA)); await pending;
  f.failPersist(); await assert.rejects(f.invoke('city', cityB), /storage unavailable/);
  assert.equal(f.controller.getState().city.name, '北京'); assert.equal(JSON.parse(fs.readFileSync(f.filePath)).city.name, '北京'); assert.equal(f.requests.length, 1);
});
test('expanded layout remains inside small/negative-origin screen and suppression/lock hides it', t => {
  const area = { x: -700, y: -80, width: 320, height: 400 }, f = fixture(t, { area, petBounds: { x: -390, y: 290, width: 80, height: 80 } });
  f.invoke('resize', { expanded: true, height: 720 }); const win = f.controller.getWindow(), bounds = win.getBounds();
  assert.equal(bounds.height,area.height);
  assert(bounds.x >= area.x && bounds.y >= area.y); assert(bounds.x + bounds.width <= area.x + area.width); assert(bounds.y + bounds.height <= area.y + area.height);
  assert.equal(win.visible, true); f.suppress(true); f.controller.reposition(); assert.equal(win.visible, false);
  f.suppress(false); f.controller.reposition(); assert.equal(win.visible, true); f.controller.pause(); assert.equal(win.visible, false);
  f.controller.resume(); assert.equal(win.visible, true);
});
test('closing native weather window invalidates pending request publication', async t => {
  const f = fixture(t), pending = f.invoke('city', cityA); f.controller.getWindow().destroy();
  const count = f.changes.length; f.requests[0].resolve(report(cityA)); await pending;
  assert.equal(f.changes.length, count);
});

const diskCache = (city = cityA, updatedAt = Date.now() - 3600000) => ({ city, updatedAt, timezone: 'Asia/Shanghai',
  current: { temperature: -3, time: Date.now() - 3600000 }, daily: [{ date: '2026-10-28', min: -5, max: 1 }], hourly: [{ time: Date.now(), temperature: -3 }] });
const flushWindow = () => new Promise(resolve => setImmediate(resolve));
test('restart restores matching disk cache and retains same-city stale values if network fails', async t => {
  const cached = diskCache(), f = fixture(t, { saved: { enabled: true, city: cityA }, cached });
  assert.equal(f.controller.getState().current.temperature, -3); assert.equal(f.controller.getState().city.name, '北京');
  assert.equal(f.requests.length, 1); f.requests[0].resolve({ status: 'error', data: null, error: { code: 'CONNECTION_FAILED', message: '网络不可用' } }); await flushWindow();
  const state = f.controller.getState(); assert.equal(state.status, 'stale'); assert.equal(state.current.temperature, -3);
  assert.equal(state.updatedAt, cached.updatedAt); assert.equal(state.error, '网络不可用');
});
test('disk cache from another city and cache followed by a city change cannot leak old weather', async t => {
  const mismatched = fixture(t, { saved: { enabled: true, city: cityB }, cached: diskCache(cityA) });
  assert.equal(mismatched.controller.getState().current, undefined);
  mismatched.requests[0].resolve({ status: 'error', data: null, error: { message: '离线' } }); await flushWindow();
  assert.equal(mismatched.controller.getState().status, 'error'); assert.equal(mismatched.controller.getState().city.name, '上海');
  const f = fixture(t, { saved: { enabled: true, city: cityA }, cached: diskCache() });
  const selecting = f.invoke('city', cityB); assert.equal(f.controller.getState().current, undefined);
  f.requests[1].resolve({ status: 'error', data: null, error: { message: '离线' } }); await selecting;
  f.requests[0].resolve(report(cityA)); await flushWindow();
  assert.equal(f.controller.getState().city.name, '上海'); assert.equal(f.controller.getState().status, 'error'); assert.equal(f.controller.getState().current, undefined);
});
test('future disk cache timestamp is rejected rather than treated as fresh weather', async t => {
  const f = fixture(t, { saved: { enabled: true, city: cityA }, cached: diskCache(cityA, Date.now() + 3600000) });
  assert.equal(f.controller.getState().current, undefined);
  f.requests[0].resolve({ status: 'error', data: null, error: { message: '离线' } }); await flushWindow();
  assert.equal(f.controller.getState().status, 'error'); assert.equal(f.controller.getState().current, undefined);
});
test('malformed expanded resize height falls back to finite dimensions without weakening screen clamping', t => {
  const f = fixture(t);
  for (const height of [NaN, Infinity, -Infinity, 'abc', '500', {}, null]) {
    const size = f.invoke('resize', { expanded: true, height }); assert.equal(size.height, 620); assert.equal(size.width, 390);
    assert(Object.values(f.controller.getWindow().getBounds()).every(Number.isFinite));
  }
  assert.equal(f.invoke('resize', { expanded: true, height: -50 }).height, 210);
  assert.equal(f.invoke('resize', { expanded: true, height: 10000 }).height, 720);
});

test('changing weather content keeps a nearby legal side and repeated layout does not move it', t => {
  const petBounds = { x: 460, y: 200, width: 80, height: 80 };
  const f = fixture(t, { area: { x: 0, y: 0, width: 1000, height: 800 }, petBounds });
  for (const height of [400, 680, 450, 620, 400]) {
    f.invoke('resize', { expanded: true, height });
    const next = f.controller.getWindow().getBounds(); f.controller.reposition();
    assert.deepEqual(f.controller.getWindow().getBounds(), next);
    assert(next.y >= 0 && next.y + next.height <= 800);
    const dx = Math.max(petBounds.x - next.x - next.width, next.x - petBounds.x - petBounds.width, 0);
    const dy = Math.max(petBounds.y - next.y - next.height, next.y - petBounds.y - petBounds.height, 0);
    assert.equal(Math.hypot(dx, dy), 8, 'current content stays eight pixels from the pet rather than reserving 720px');
  }
});

test('weather capsule reuses released quota placement below the pet and dialogue, not above the dialogue', t => {
  const bubbleBounds = { x: 350, y: 150, width: 300, height: 70 };
  const f = fixture(t, { petBounds: { x: 460, y: 250, width: 80, height: 80 }, bubbleBounds });
  const b = f.controller.getWindow().getBounds();
  assert.equal(b.width, 128); assert.equal(b.height, 32); assert(b.y >= 338);
  assert(b.y >= bubbleBounds.y + bubbleBounds.height + 8);
});
test('weather follows the last quota card with the same eight-pixel stack gap', t => {
  const anchor = { x: 420, y: 400, width: 128, height: 32 };
  const f = fixture(t, { stackAnchor: anchor });
  const b = f.controller.getWindow().getBounds();
  assert.equal(b.x, anchor.x); assert.equal(b.y, anchor.y + anchor.height + 8);
});

test('weather visibility persists and compact group metrics do not grow with details', t => {
  const f = fixture(t);
  f.invoke('resize', { expanded: true, height: 620 });
  assert.deepEqual(JSON.parse(JSON.stringify(f.controller.getLayoutMetrics())), { width: 128, height: 32, inset: 2 });
  f.controller.setCardVisible(false);
  assert.equal(f.controller.getWindow().isVisible(), false);
  assert.equal(f.controller.getLayoutMetrics(), null);
  assert.equal(JSON.parse(fs.readFileSync(f.filePath)).cardVisible, false);
  f.controller.setCardVisible(true); f.controller.resetExpanded(); f.controller.reposition();
  assert.equal(f.controller.getWindow().getBounds().width, 128);
});

test('native location denial returns a short structured error and preserves selected city', async t => {
  const f=fixture(t,{saved:{enabled:true,city:cityA}});
  const result=await f.invoke('location');
  assert.equal(result.locationError.code,'LOCATION_DENIED');
  assert.equal(f.controller.getState().city.name,'北京');
});
test('only expansion animates native geometry; collapse commits once after renderer fade', t => {
  const f=fixture(t,{area:{x:0,y:0,width:1000,height:1200}}), win=f.controller.getWindow();
  f.invoke('resize',{expanded:true,height:500});
  assert.equal(win.lastAnimate,true);
  f.controller.reposition();
  assert.equal(win.lastAnimate,true);
  f.invoke('resize',{expanded:true,height:550});
  assert.equal(win.lastAnimate,false);
  f.invoke('resize',{expanded:false});
  assert.equal(win.lastAnimate,false,'restored quota cards cannot compete with a native shrink animation');
});

test('native reverse-geocoded city and district persist without replacing them with a placeholder', async t => {
 const f=fixture(t,{locationBridge:{locate:async()=>({latitude:39.9,longitude:116.4,accuracy:100,name:'北京市',locationLabel:'北京市 · 朝阳区'})}});
 const pending=f.invoke('location');
 await new Promise(resolve=>setImmediate(resolve));
 f.requests.at(-1).resolve(report(cityA));await pending;
 const saved=JSON.parse(fs.readFileSync(f.filePath));
 assert.equal(saved.city.name,'北京市');assert.equal(saved.city.displayName,'北京市 · 朝阳区');assert.equal(saved.city.mode,'current');
});

test('city settings opens its picker after first load even when the compact card is disabled', t => {
 const f=fixture(t);f.controller.setCardVisible(false);f.controller.openCity();const win=f.controller.getWindow();
 assert.equal(win.isVisible(),true);assert.equal(win.getBounds().width,390);
 win.webContents.emit('did-finish-load');
 assert(win.sent.some(item=>item.channel==='weather:choose-city'));
 assert.equal(f.controller.isCardVisible(),false);assert.equal(f.controller.isExpanded(),true);
 f.invoke('resize',{expanded:false});assert.equal(win.isVisible(),false);
});
test('city settings immediately opens a picker in an already loaded window', t => {
 const f=fixture(t),win=f.controller.getWindow();win.webContents.emit('did-finish-load');
 f.controller.openCity();assert(win.sent.some(item=>item.channel==='weather:choose-city'));
});

test('successful native location returns immediately while weather fetch remains pending', async t => {
 const f=fixture(t,{locationBridge:{locate:async()=>({latitude:39.9,longitude:116.4,accuracy:100,name:'北京市',locationLabel:'北京市 · 朝阳区'})}});
 const result=await Promise.race([f.invoke('location'),new Promise((_,reject)=>setTimeout(()=>reject(Error('location waited for weather')),100))]);
 assert.equal(result.city.displayName,'北京市 · 朝阳区');assert.equal(result.status,'loading');assert.equal(f.requests.length,1);
});

test('weather collection captures held card after group hides, but rejects hidden staging', async t => {
  const f = fixture(t), win = f.controller.getWindow();
  win.webContents.emit('did-finish-load');
  win.webContents.capturePage = async () => ({ isEmpty: () => false, toPNG: () => Buffer.from('snapshot') });
  f.controller.setGroupTransitionMode('hold');
  f.groupHidden(true);
  f.controller.reposition();
  assert.equal(win.isVisible(), true, 'hold keeps original card painted until overlay is ready');
  const frames = await f.controller.captureGroupTransitionFrames();
  assert.equal(frames.length, 1);
  f.controller.setGroupTransitionMode('stage');
  await assert.rejects(f.controller.captureGroupTransitionFrames(), /visible layout|stale/);
});

test('weather details and city search retain full requested height at all four corners', t => {
 const area={x:0,y:25,width:1512,height:850};
 for(const x of [0,1432])for(const y of [25,795]){
   const f=fixture(t,{area,petBounds:{x,y,width:80,height:80}});
   const compact=f.controller.getWindow().getBounds();
   f.invoke('resize',{expanded:true,height:620});const anchor=f.controller.getWindow().getBounds();
   assert.equal(anchor.height,620,JSON.stringify({x,y,anchor}));
   for(const height of [210,450,680,720,620]){
     f.invoke('resize',{expanded:true,height});const b=f.controller.getWindow().getBounds();
     assert.equal(b.height,height);
     const pet={x,y,width:80,height:80},dx=Math.max(pet.x-b.x-b.width,b.x-pet.x-pet.width,0),dy=Math.max(pet.y-b.y-b.height,b.y-pet.y-pet.height,0);
     assert.equal(Math.hypot(dx,dy),8,'visible panel stays next to the pet without covering it');
     assert.ok(b.x>=area.x&&b.x+b.width<=area.x+area.width&&b.y>=area.y&&b.y+b.height<=area.y+area.height);
   }
   f.invoke('resize',{expanded:false});assert.deepEqual(f.controller.getWindow().getBounds(),compact);
   assert.deepEqual({...f.controller.getLayoutMetrics()},{width:128,height:32,inset:2});
 }
});

 test('expanded weather recomputes the stable envelope after pet and display movement', t => {
 const area={x:0,y:25,width:1512,height:850},petBounds={x:1432,y:795,width:80,height:80};
 const f=fixture(t,{area,petBounds});f.invoke('resize',{expanded:true,height:620});
 Object.assign(area,{x:-1600,y:-100,width:1600,height:900});Object.assign(petBounds,{x:-1580,y:700});
 f.controller.reposition();const b=f.controller.getWindow().getBounds();
 assert.equal(b.height,620);assert.ok(b.x>=area.x&&b.y>=area.y&&b.x+b.width<=0&&b.y+b.height<=800);
 });

test('clicked weather remains visible after the old collection hides, and explicit collapse returns to collected state', t => {
 const f=fixture(t);f.groupHidden(true);
 f.invoke('resize',{expanded:true,height:400});
 assert.equal(f.controller.isExpanded(),true);assert.equal(f.controller.getWindow().isVisible(),true);
 f.controller.reposition();assert.equal(f.controller.getWindow().isVisible(),true);
 f.invoke('resize',{expanded:false});assert.equal(f.controller.isExpanded(),false);assert.equal(f.controller.getWindow().isVisible(),false);
});

test('expanded weather ignores old quota-stack slots and stays eight pixels above a low pet', t => {
 const petBounds={x:700,y:800,width:80,height:80},area={x:0,y:25,width:1512,height:1100};
 const stackAnchor={x:680,y:360,width:196,height:280},f=fixture(t,{area,petBounds,stackAnchor});
 f.invoke('resize',{expanded:true,height:400});const win=f.controller.getWindow(),bounds=win.getBounds();
 assert.equal(bounds.y+bounds.height,petBounds.y-8,'uses current panel height rather than a 720px empty envelope');
 Object.assign(stackAnchor,{x:100,y:100,width:224,height:144});f.controller.reposition();
 assert.deepEqual(win.getBounds(),bounds,'hidden quota-card movement cannot become a weather anchor');
 f.invoke('resize',{expanded:true,height:210});assert.equal(win.getBounds().y+210,petBounds.y-8);
});

test('near-top weather chooses below or beside the pet instead of clamping a tall panel over it', t => {
 const area={x:-524,y:-1692,width:3008,height:1692};
 for(const petBounds of [{x:1400,y:-1692,width:80,height:80},{x:2200,y:-1692,width:180,height:180},{x:-524,y:-1680,width:80,height:80}]){
  const f=fixture(t,{area,petBounds});f.invoke('resize',{expanded:true,height:620});const b=f.controller.getWindow().getBounds();
  const dx=Math.max(petBounds.x-b.x-b.width,b.x-petBounds.x-petBounds.width,0),dy=Math.max(petBounds.y-b.y-b.height,b.y-petBounds.y-petBounds.height,0);
  assert.equal(Math.hypot(dx,dy),8);assert.ok(b.x>=area.x&&b.y>=area.y&&b.x+b.width<=area.x+area.width&&b.y+b.height<=area.y+area.height);
 }
});


test('repeated weather ResizeObserver packets neither touch native bounds nor re-enter quota layout', t => {
 const f=fixture(t),win=f.controller.getWindow(),initialLayouts=f.layouts.length;
 f.invoke('resize',{expanded:true,height:500});
 const calls=win.boundsCalls.length;
 assert.equal(f.layouts.length,initialLayouts+1);
 for(let i=0;i<20;i++)f.invoke('resize',{expanded:true,height:500});
 assert.equal(win.boundsCalls.length,calls);assert.equal(f.layouts.length,initialLayouts+1);
 f.invoke('resize',{expanded:true,height:550});
 assert.equal(win.boundsCalls.length,calls+1);assert.equal(f.layouts.length,initialLayouts+1,'content height does not change quota collection');
 f.invoke('resize',{expanded:false});const compactCalls=win.boundsCalls.length;
 assert.equal(win.lastAnimate,false);assert.equal(f.layouts.length,initialLayouts+2);
 for(let i=0;i<20;i++)f.invoke('resize',{expanded:false});
 assert.equal(win.boundsCalls.length,compactCalls);assert.equal(f.layouts.length,initialLayouts+2);
});
