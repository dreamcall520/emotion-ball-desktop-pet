// Run with Node; exercises the real weather document with local fake IPC, never device location or weather APIs.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { stdio: 'inherit', env });
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow, ipcMain } = require('electron');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-weather-picker-'));
app.setPath('userData', path.join(directory, 'userdata'));
const root = path.resolve(__dirname, '../..');
const preload = path.join(directory, 'fixture-preload.cjs');
fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('qiuqiuWeather',{
 get:()=>ipcRenderer.invoke('fixture:get'),refresh:()=>ipcRenderer.invoke('fixture:get'),
 search:query=>ipcRenderer.invoke('fixture:search',query),selectCity:city=>ipcRenderer.invoke('fixture:city',city),
 useLocation:confirmed=>ipcRenderer.invoke('fixture:location',confirmed),resize:size=>ipcRenderer.invoke('fixture:resize',size),
 onState:()=>()=>{},onColorMode:()=>()=>{},onCollapse:()=>()=>{},onChooseCity:()=>()=>{}
});`);
let state = { status: 'ready', city: { name: '当前位置', displayName: '北京市 · 朝阳区', mode: 'current', timezone: 'Asia/Shanghai' }, timezone: 'Asia/Shanghai',
 current: { temperature: 19, apparentTemperature: 18, weatherCode: 2, isDay: 1, time: Date.UTC(2026, 9, 28, 6) }, hourly: [], daily: [], updatedAt: Date.now(), appearance: 'light', requireLocationConsent:true };
let win, locationCalls = 0, resolveLocation, resizeCalls = 0, manualCityCalls = 0;
ipcMain.handle('fixture:resize', () => { resizeCalls++; });
ipcMain.handle('fixture:get', () => state);
ipcMain.handle('fixture:location', (_event, confirmed) => { assert.equal(confirmed,true); locationCalls++; return new Promise(resolve => { resolveLocation = resolve; }); });
ipcMain.handle('fixture:search', (_event, query) => query === '上海' ? [{ name: '上海', latitude: 31.2, longitude: 121.5, timezone: 'Asia/Shanghai' }] : []);
ipcMain.handle('fixture:city', (_event, city) => { manualCityCalls++; state = { ...state, status: 'loading', city: { ...city, mode: 'manual' } }; return state; });
const evaluate = code => win.webContents.executeJavaScript(code);
const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
async function until(predicate, label) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 15)); }
  throw new Error('Timed out: ' + label);
}
async function snapshot() {
  return evaluate(`({pickerHidden:document.getElementById('city-picker').hidden,status:document.getElementById('search-status').textContent,input:document.getElementById('search-input').value,results:document.getElementById('search-results').children.length,disabled:document.getElementById('use-location').disabled})`);
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 390, height: 500, webPreferences: { preload, contextIsolation: true, sandbox: true } });
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  await win.loadFile(path.join(root, 'desktop-pet/weather.html'));
  await until(async () => (await evaluate(`document.getElementById('small-temperature').textContent`)) === '19°', 'initial cached render');
  assert.equal(locationCalls, 0, 'existing current-city startup must not request location');
  await click('folded'); await click('city');
  assert.equal((await snapshot()).status, '已选择：北京市 · 朝阳区');
  assert.equal(await evaluate("document.getElementById('location-consent') !== null"), false, 'current location must not be intercepted by a dismissible custom pre-permission dialog');
  const disclosure = await evaluate("({text:document.getElementById('location-disclosure').textContent,hidden:document.getElementById('location-disclosure').hidden})");
  assert.equal(disclosure.hidden, false);
  assert.match(disclosure.text, /位置坐标.*Open-Meteo/);
  assert.match(disclosure.text, /天气.*空气质量/);
  assert.match(disclosure.text, /自动刷新/);
  assert.equal(locationCalls, 0);
  const layouts = [];
  win.setSize(390, 250);
  for (const theme of ['blue','green','purple']) for (const appearance of ['light','dark']) {
    await evaluate("Object.assign(document.documentElement.dataset,"+JSON.stringify({uiTheme:theme,appearance})+")");
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    const layout = await evaluate("(()=>{const e=document.getElementById('location-disclosure'),r=e.getBoundingClientRect(),b=document.getElementById('use-location').getBoundingClientRect();const style=getComputedStyle(e);return {width:innerWidth,height:r.height,lineHeight:parseFloat(style.lineHeight),right:r.right,bottom:r.bottom,buttonTop:b.top,color:style.color,disclosureWidth:e.clientWidth,disclosureScrollWidth:e.scrollWidth,scrollWidth:document.documentElement.scrollWidth};})()");
    assert.equal(layout.width, 390); assert(layout.height > 0); assert(layout.right <= 390); assert(layout.bottom <= layout.buttonTop);
    assert(layout.height <= layout.lineHeight + 1, 'the concise disclosure must fit on one line');
    assert(layout.disclosureScrollWidth <= layout.disclosureWidth + 1, 'the full disclosure must remain visible');
    assert(layout.scrollWidth <= 390, 'disclosure must not widen the weather window');
    layouts.push({ theme, appearance, ...layout });
    if (process.env.QIUQIU_WEATHER_PICKER_CAPTURE_DIR) {
      const captureRoot = process.env.QIUQIU_WEATHER_PICKER_CAPTURE_DIR;
      fs.mkdirSync(captureRoot, { recursive: true });
      fs.writeFileSync(path.join(captureRoot, `location-picker-${theme}-${appearance}.png`), (await win.webContents.capturePage()).toPNG());
    }
  }
  await evaluate(`document.getElementById('search-input').value='旧搜索';document.getElementById('search-results').append(document.createElement('button'));`);
  await click('use-location');
  await until(() => locationCalls === 1, 'location invoked');
  await click('use-location'); assert.equal(locationCalls, 1, 'pending current-location request cannot be duplicated');
  assert.equal((await snapshot()).status, '定位中…');
  state = { status: 'loading', city: { name: '当前位置', displayName: '北京市 · 海淀区', mode: 'current', timezone: 'Asia/Shanghai' }, hourly: [], daily: [], appearance: 'light', requireLocationConsent:true };
  resolveLocation(state);
  await until(async () => (await snapshot()).pickerHidden, 'location success closes picker before weather');
  for (let attempt = 0; attempt < 3; attempt++) {
    await click('city'); const current = await snapshot();
    assert.equal(current.status, '已选择：北京市 · 海淀区');
    assert.equal(current.input, ''); assert.equal(current.results, 0); assert.equal(current.disabled, false);
    assert(!current.status.includes('定位中'));
    await click('close-picker');
  }
  await click('city'); await click('use-location');
  await until(() => locationCalls === 2, 'second location invoked');
  assert.equal((await snapshot()).status, '定位中…');
  resolveLocation({ locationError: { code: 'LOCATION_DENIED' } });
  await until(async () => (await snapshot()).status === '定位未授权', 'denied status');
  assert.equal((await snapshot()).pickerHidden, false);
  await click('close-picker'); await click('city');
  const reopened = await snapshot();
  assert.equal(reopened.status, '已选择：北京市 · 海淀区');
  assert.equal(reopened.disabled, false); assert(!reopened.status.includes('定位中'));
  await click('use-location');
  await until(() => locationCalls === 3, 'pending request before close');
  await click('close-picker'); await click('city');
  assert.equal((await snapshot()).disabled, false, 'closing an in-flight picker never leaves reopening disabled');
  assert.equal((await snapshot()).status, '已选择：北京市 · 海淀区');
  resolveLocation({ locationError: { code: 'LOCATION_TIMEOUT' } });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await snapshot()).status, '已选择：北京市 · 海淀区', 'late prior failure cannot overwrite reopened picker');
  await click('use-location');
  await until(() => locationCalls === 4, 'cancellation response');
  resolveLocation({ cancelled: true });
  await until(async () => (await snapshot()).disabled === false, 'cancelled request releases retry');
  assert.equal((await snapshot()).status, '定位已取消，请重试或选择城市');
  await evaluate("document.getElementById('search-input').value='上海';document.getElementById('search-form').dispatchEvent(new Event('submit',{cancelable:true}));");
  await until(async () => (await snapshot()).results === 1, 'manual city search remains available');
  await evaluate("document.querySelector('#search-results button').click()");
  await until(() => manualCityCalls === 1, 'manual city selected');
  assert.equal(locationCalls, 4, 'manual city selection must not trigger system location');
  assert.equal((await snapshot()).pickerHidden, true);
  console.log(JSON.stringify({ passed: true, startupLocationCalls: 0, locationCalls, noPrePermissionDialog: true, inlineDisclosure: disclosure.text, layouts, successWhileWeatherLoading: true, successfulReopens: 3, deniedReopen: reopened.status, staleLocationIgnored: true, cancelledRetryEnabled: true, manualCityCalls, noNetworkOrDeviceLocation: true }));
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  win?.destroy(); for (const name of ['get','location','resize','search','city']) ipcMain.removeHandler('fixture:'+name);
  fs.rmSync(directory, { recursive: true, force: true }); app.exit(process.exitCode || 0);
});
