'use strict';
// Real controller + real service. Only transport, window message sink and GPS are fakes.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events'), { pathToFileURL } = require('node:url');
const { createWeatherWindow } = require('../lib/weather-window');
const cityA = { name: 'Synthetic A', latitude: 10, longitude: 10 }, cityB = { name: 'Synthetic B', latitude: 20, longitude: 20 };
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function forecast() {
  const now = new Date().toISOString().slice(0, 16), day = now.slice(0, 10);
  return { timezone: 'UTC', utc_offset_seconds: 0,
    current: { time: now, temperature_2m: 7, weather_code: 0, is_day: 1 },
    hourly: { time: [now], temperature_2m: [7], weather_code: [0], precipitation_probability: [0], is_day: [1] },
    daily: { time: [day], temperature_2m_min: [1], temperature_2m_max: [8], weather_code: [0] } };
}
const air = () => ({ utc_offset_seconds: 0, current: { time: new Date().toISOString().slice(0, 16), us_aqi: 20, pm2_5: 5 } });
const cached = () => ({ city: cityA, updatedAt: Date.now() - 60000, timezone: 'UTC',
  current: { temperature: -3, time: Date.now() - 60000 }, daily: [{ date: '2026-11-20', min: -5, max: 1 }], hourly: [] });
function fixture(t, fetch, restored) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-weather-qa-combined-'));
  const profile = path.join(root, 'profile'); fs.mkdirSync(profile);
  const filePath = path.join(profile, 'weather.json');
  if (restored) { fs.writeFileSync(filePath, JSON.stringify({ enabled: true, city: cityA })); fs.writeFileSync(filePath + '.cache', JSON.stringify(restored)); }
  const handlers = new Map(), errors = [], changes = [];
  class Window extends EventEmitter {
    constructor(options) { super(); this.bounds = { x: 0, y: 0, width: options.width, height: options.height }; this.visible = false; this.dead = false;
      this.webContents = Object.assign(new EventEmitter(), { mainFrame: { url: pathToFileURL(path.join(__dirname, '../weather.html')).href }, send() {}, setWindowOpenHandler() {} }); }
    isDestroyed() { return this.dead; } isVisible() { return this.visible; }
    setVisibleOnAllWorkspaces() {} setAlwaysOnTop() {} focus() {} moveTop() {}
    showInactive() { this.visible = true; } show() { this.visible = true; } hide() { this.visible = false; }
    setBounds(bounds) { this.bounds = { ...bounds }; } getBounds() { return { ...this.bounds }; }
    setOpacity() {} loadFile() { return Promise.resolve(); }
    destroy() { this.dead = true; this.visible = false; this.emit('closed'); }
  }
  const controller = createWeatherWindow({ BrowserWindow: Window,
    ipcMain: { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) },
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 800 } }) },
    fetch, filePath, getPetWindow: () => ({ isDestroyed: () => false, isVisible: () => true, getBounds: () => ({ x: 400, y: 400, width: 80, height: 80 }) }),
    locationBridge: { locate() { throw Error('GPS_MUST_NOT_BE_USED'); }, cancel() {} },
    onError: (error, context) => errors.push({ error, context }), onChange: value => changes.push(value) });
  t.after(() => { controller.destroy(); fs.rmSync(root, { recursive: true, force: true }); });
  controller.setEnabled(true);
  const invoke = (name, value) => { const win = controller.getWindow(); return handlers.get('weather:' + name)({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, value); };
  return { controller, invoke, errors, changes, filePath };
}

test('combined manual weather publishes within AQI budget when optional transport hangs', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  let forecasts = 0, aqi = 0, airAborted = false;
  const f = fixture(t, (url, options) => {
    if (new URL(url).hostname === 'air-quality-api.open-meteo.com') {
      aqi++; options.signal.addEventListener('abort', () => { airAborted = true; }, { once: true }); return new Promise(() => {});
    }
    forecasts++; return Promise.resolve(response(forecast()));
  });
  await f.invoke('city', cityA); await flush();
  assert.equal(f.controller.getState().status, 'loading');
  t.mock.timers.tick(1999); await flush(); assert.equal(f.controller.getState().status, 'loading');
  t.mock.timers.tick(1); await flush();
  const state = f.controller.getState();
  assert.equal(state.status, 'ready'); assert.equal(state.current.temperature, 7);
  assert.equal(state.airQuality, null); assert.equal(airAborted, true); assert.equal(forecasts, 1); assert.equal(aqi, 1);
  assert.equal(JSON.parse(fs.readFileSync(f.filePath)).city.mode, 'manual');
});

test('combined manual same-city failure retains previous data through real forecast errors', async t => {
  let forecasts = 0; const previous = cached();
  const f = fixture(t, async url => {
    if (new URL(url).hostname === 'air-quality-api.open-meteo.com') return response(air());
    forecasts++; return response({}, 503);
  }, previous);
  await flush(); assert.equal(f.controller.getState().status, 'stale');
  await f.invoke('city', cityA); await flush();
  const state = f.controller.getState();
  assert.equal(state.status, 'stale'); assert.equal(state.current.temperature, -3); assert.equal(state.updatedAt, previous.updatedAt);
  assert.equal(forecasts, 4, 'each of two failed requests has exactly one retry');
  assert.match(state.error, /天气服务暂不可用/); assert.equal(JSON.parse(fs.readFileSync(f.filePath)).city.mode, 'manual');
});

test('combined manual different-city failure cannot display late previous-city data', async t => {
  let releasePrevious, newCityForecasts = 0;
  const f = fixture(t, url => {
    const endpoint = new URL(url);
    if (endpoint.hostname === 'air-quality-api.open-meteo.com') return Promise.resolve(response(air()));
    if (endpoint.searchParams.get('latitude') === '10') return new Promise(resolve => { releasePrevious = resolve; });
    newCityForecasts++; return Promise.resolve(response({}, 503));
  }, cached());
  await f.invoke('city', cityB); await flush();
  assert.equal(f.controller.getState().status, 'error'); assert.equal(f.controller.getState().current, undefined);
  releasePrevious(response(forecast())); await flush();
  const state = f.controller.getState();
  assert.equal(state.city.name, cityB.name); assert.equal(state.status, 'error'); assert.equal(state.current, undefined);
  assert.equal(newCityForecasts, 2); assert.equal(JSON.parse(fs.readFileSync(f.filePath)).city.name, cityB.name);
});

test('combined manual forecast 503 retries once and publishes recovered weather', async t => {
  let forecasts = 0;
  const f = fixture(t, async url => {
    if (new URL(url).hostname === 'air-quality-api.open-meteo.com') return response(air());
    return ++forecasts === 1 ? response({}, 503) : response(forecast());
  });
  await f.invoke('city', cityA); await flush();
  const state = f.controller.getState();
  assert.equal(state.status, 'ready'); assert.equal(state.current.temperature, 7); assert.equal(forecasts, 2); assert.equal(f.errors.length, 0);
});
