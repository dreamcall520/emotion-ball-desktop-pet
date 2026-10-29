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
  const handlers = new Map(), windows = [], changes = [], requests = [], module = { exports: {} };
  let suppressed = false, persistFails = false;
  const service = { searchCities: async () => [], getWeather(city) { const d = deferred(); requests.push({ city, ...d }); return d.promise; } };
  const mockedFs = Object.create(fs); mockedFs.renameSync = (...args) => { if (persistFails) throw Object.assign(Error('fixture storage unavailable'), { code: 'EACCES' }); return fs.renameSync(...args); };
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.visible = false; this.dead = false; this.sent = [];
      this.webContents = Object.assign(new EventEmitter(), { mainFrame: { url: pathToFileURL(path.join(__dirname, '../weather.html')).href },
        send: (channel, state) => this.sent.push({ channel, state }), setWindowOpenHandler: fn => { this.openHandler = fn; } }); windows.push(this); }
    isDestroyed() { return this.dead; } isVisible() { return this.visible; } setVisibleOnAllWorkspaces() {}
    setBounds(bounds, animate) { this.lastAnimate = animate; this.bounds = { ...bounds }; } getBounds() { return { ...this.bounds }; } setSize(width, height) { this.bounds = { ...this.bounds, width, height }; }
    show() { this.visible = true; } focus() {} showInactive() { this.visible = true; } hide() { this.visible = false; } loadFile() { return Promise.resolve(); }
    destroy() { this.dead = true; this.visible = false; this.emit('closed'); }
  }
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), { module, __dirname: path.dirname(sourcePath), setInterval, clearInterval,
    require: name => name === 'node:fs' ? mockedFs : name === './weather-service' ? { createWeatherService: () => service } : require(name.startsWith('.') ? path.resolve(path.dirname(sourcePath), name) : name) }, { filename: sourcePath });
  const controller = module.exports.createWeatherWindow({ BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) },
    locationBridge, screen: { getDisplayMatching: () => ({ workArea: area }) }, filePath, getPetWindow: () => ({ isDestroyed: () => false, isVisible: () => true, getBounds: () => petBounds }),
    getStackAnchor: () => stackAnchor, getBubbleBounds: () => bubbleBounds, getPresentation: () => ({ mode: 'free' }), getSuppressed: () => suppressed, onChange: state => changes.push(state) });
  t.after(() => { controller.destroy(); fs.rmSync(dir, { recursive: true, force: true }); });
  controller.setEnabled(true);
  const event = () => ({ sender: controller.getWindow().webContents, senderFrame: controller.getWindow().webContents.mainFrame });
  return { controller, handlers, windows, changes, requests, filePath, event,
    invoke: (name, value, e) => handlers.get('weather:' + name)(e || event(), value), suppress: value => { suppressed = value; }, failPersist: () => { persistFails = true; } };
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

test('switching expanded weather content keeps top-left fixed instead of flipping around the pet', t => {
  const f = fixture(t, { area: { x: 0, y: 0, width: 1000, height: 800 }, petBounds: { x: 460, y: 200, width: 80, height: 80 } });
  f.invoke('resize', { expanded: true, height: 400 });
  const initial = f.controller.getWindow().getBounds();
  for (const height of [680, 450, 620, 400]) {
    f.invoke('resize', { expanded: true, height }); f.controller.reposition();
    const next = f.controller.getWindow().getBounds();
    assert.equal(next.x, initial.x); assert.equal(next.y, initial.y);
    assert(next.y + next.height <= 800);
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
test('native geometry animation is requested only when expanding or collapsing', t => {
  const f=fixture(t,{area:{x:0,y:0,width:1000,height:1200}}), win=f.controller.getWindow();
  f.invoke('resize',{expanded:true,height:500});
  assert.equal(win.lastAnimate,true);
  f.controller.reposition();
  assert.equal(win.lastAnimate,true);
  f.invoke('resize',{expanded:true,height:550});
  assert.equal(win.lastAnimate,false);
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
