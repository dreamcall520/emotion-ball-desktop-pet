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
 search:()=>Promise.resolve([]),selectCity:()=>Promise.reject(Error('not used')),
 useLocation:()=>ipcRenderer.invoke('fixture:location'),resize:()=>Promise.resolve(),
 onState:()=>()=>{},onColorMode:()=>()=>{},onCollapse:()=>()=>{},onChooseCity:()=>()=>{}
});`);
let state = { status: 'ready', city: { name: '当前位置', displayName: '北京市 · 朝阳区', mode: 'current', timezone: 'Asia/Shanghai' }, timezone: 'Asia/Shanghai',
 current: { temperature: 19, apparentTemperature: 18, weatherCode: 2, isDay: 1, time: Date.UTC(2026, 9, 28, 6) }, hourly: [], daily: [], updatedAt: Date.now(), appearance: 'light' };
let win, locationCalls = 0, resolveLocation;
ipcMain.handle('fixture:get', () => state);
ipcMain.handle('fixture:location', () => { locationCalls++; return new Promise(resolve => { resolveLocation = resolve; }); });
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
  await evaluate(`document.getElementById('search-input').value='旧搜索';document.getElementById('search-results').append(document.createElement('button'));`);
  await click('use-location');
  await until(() => locationCalls === 1, 'location invoked');
  assert.equal((await snapshot()).status, '定位中…');
  state = { status: 'loading', city: { name: '当前位置', displayName: '北京市 · 海淀区', mode: 'current', timezone: 'Asia/Shanghai' }, hourly: [], daily: [], appearance: 'light' };
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
  console.log(JSON.stringify({ passed: true, startupLocationCalls: 0, locationCalls, successWhileWeatherLoading: true, successfulReopens: 3, deniedReopen: reopened.status, noNetworkOrDeviceLocation: true }));
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  win?.destroy(); ipcMain.removeHandler('fixture:get'); ipcMain.removeHandler('fixture:location');
  fs.rmSync(directory, { recursive: true, force: true }); app.exit(process.exitCode || 0);
});
