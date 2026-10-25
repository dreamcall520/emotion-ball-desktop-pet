const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createZcodeLink } = require('../lib/zcode-link');

function fixture(overrides = {}) {
  let prefs = { zcodeEnabled: false, zcodeQuotaAlwaysVisible: true, zcodeQuotaLabelSize: 'compact' };
  const calls = [], ipcMain = new EventEmitter();
  ipcMain.handle = (name, fn) => ipcMain.on(name, fn);
  const card = { show: model => calls.push(['show', model]), hide: () => calls.push(['hide']),
    destroy: () => calls.push(['destroy']), getWindow: () => null, reposition() {}, setAlwaysOnTop() {}, getVisibleBounds: () => null };
  const details = { owns: event => event.sender === 'own', isVisible: () => false, close() {}, destroy() {},
    resize: n => calls.push(['resize', n]), setAlwaysOnTop() {}, open: model => { calls.push(['detail', model]); return true; } };
  const service = { getSnapshot: () => ({ state: 'ready', buckets: [], generation: 2 }),
    setEnabled: async value => calls.push(['enabled', value]), refresh: async () => calls.push(['refresh']), close() {} };
  const link = createZcodeLink({ BrowserWindow: {}, screen: {}, ipcMain,
    getSettings: () => prefs, save: patch => { prefs = { ...prefs, ...patch }; },
    getPetWindow: () => ({ isDestroyed: () => false, isVisible: () => true }),
    getSuppressed: () => false, getObstacles: () => [], filePath: '/tmp/not-written',
    createCompanion: () => service, createCard: () => card, createDetails: () => details,
    buildCard: () => ({ sourceId: 'zcode', state: 'ready', items: [] }),
    buildDetails: (_snapshot, options) => ({ ...options, sourceId: 'zcode' }),
    requestConsent: async () => true, ...overrides });
  return { link, calls, ipcMain, prefs: () => prefs };
}

test('ZCode card visibility is independent of the enabled connection', async () => {
  const f = fixture();
  await f.link.setEnabled(true);
  assert.equal(f.prefs().zcodeEnabled, true);
  assert.equal(f.link.setPreference('zcodeQuotaAlwaysVisible', false), true);
  assert.equal(f.prefs().zcodeQuotaAlwaysVisible, false);
  assert.deepEqual(f.calls.filter(call => call[0] === 'enabled'), [['enabled', true]]);
  await f.link.setEnabled(false);
  assert.deepEqual(f.calls.filter(call => call[0] === 'enabled'), [['enabled', true], ['enabled', false]]);
  f.link.close();
});

test('ZCode detail IPC rejects other windows and accepts only its own sender', async () => {
  const f = fixture();
  await f.link.setEnabled(true);
  f.ipcMain.emit('pet:zcode-details-resize', { sender: 'other' }, 400);
  assert.equal(f.calls.some(call => call[0] === 'resize'), false);
  f.ipcMain.emit('pet:zcode-details-resize', { sender: 'own' }, 400);
  assert.deepEqual(f.calls.at(-1), ['resize', 400]);
  f.link.close();
});


test('duplicate enable preserves the pending consent and disable persistence failure stays visible', async () => {
  let accept;
  const f = fixture({ requestConsent: () => new Promise(resolve => { accept = resolve; }) });
  const pending = f.link.setEnabled(true);
  assert.equal(await f.link.setEnabled(true), false);
  accept(true);
  assert.equal(await pending, true);
  f.link.close();
  const failed = fixture({ save: () => { throw new Error('disk'); } });
  await failed.link.setEnabled(false);
  assert.equal(failed.link.isEnabled(), false);
  assert.match(failed.link.menu().submenu.find(item => item.id === 'zcode-preference-warning').label, /未保存.*重启/);
  failed.link.close();
});


test('completed result rows keep the ZCode app entry and reject unknown IDs', async () => {
  const opened = [];
  const f = fixture({ openTask: async id => { opened.push(id); },
    createDetails: () => ({ owns: event => event.sender === 'own', isVisible: () => true,
      getAction: () => 'results', close() {}, destroy() {}, update() {}, setAlwaysOnTop() {} }),
    createCompanion: () => ({ getSnapshot: () => ({ generation: 2, tasks: { items: [] },
      history: { results: [{ id: 'known' }] } }), setEnabled: async () => {}, close() {} }) });
  await f.link.setEnabled(true);
  f.ipcMain.emit('pet:zcode-details-thread', { sender: 'own' }, 'known');
  f.ipcMain.emit('pet:zcode-details-thread', { sender: 'other' }, 'known');
  f.ipcMain.emit('pet:zcode-details-thread', { sender: 'own' }, 'unknown');
  assert.deepEqual(opened, ['known']);
  f.link.close();
});


test('disabling while consent is pending cancels it without enabling or saving true', async () => {
  let answer, cancelled = 0;
  const f = fixture({ requestConsent: () => new Promise(resolve => { answer = resolve; }),
    cancelConsent: () => { cancelled++; answer?.(false); } });
  const pending = f.link.setEnabled(true);
  await f.link.setEnabled(false);
  assert.equal(await pending, false); assert.equal(f.prefs().zcodeEnabled, false);
  assert.equal(f.calls.some(row => row[0] === 'enabled' && row[1] === true), false);
  f.link.close(); assert.equal(cancelled, 2);
});

test('ZCode practice preference saves independently and opening requires its visible own main frame', async () => {
  const { pathToFileURL } = require('node:url'); const path = require('node:path');
  let opened = 0, entry = true;
  const contents = { mainFrame: {}, getURL: () => pathToFileURL(path.resolve(__dirname, '../quota-label.html')).href };
  const f = fixture({ getGuardEntry: () => true, onOpenGuard: () => { opened++; },
    createCard: () => ({ show() {}, hide() {}, destroy() {}, reposition() {}, setAlwaysOnTop() {}, getVisibleBounds: () => null,
      getWindow: () => ({ webContents: contents }), isGuardEntryVisible: () => entry }) });
  await f.link.setEnabled(true);
  const event = { sender: contents, senderFrame: contents.mainFrame };
  f.ipcMain.emit('pet:zcode-quota-guard-open', event); assert.equal(opened, 1);
  f.ipcMain.emit('pet:zcode-quota-guard-open', { ...event, senderFrame: {} });
  f.ipcMain.emit('pet:zcode-quota-guard-open', { ...event, sender: {} }); assert.equal(opened, 1);
  entry = false; f.ipcMain.emit('pet:zcode-quota-guard-open', event); assert.equal(opened, 1); entry = true;
  assert.equal(f.link.setPreference('zcodeQuotaFunEnabled', false), true);
  assert.equal(f.prefs().zcodeQuotaFunEnabled, false); f.ipcMain.emit('pet:zcode-quota-guard-open', event); assert.equal(opened, 1);
  f.link.menu().submenu.find(row => row.id === 'zcode-quota-fun').click({ checked: true });
  assert.equal(f.prefs().zcodeQuotaFunEnabled, true); f.ipcMain.emit('pet:zcode-quota-guard-open', event); assert.equal(opened, 2);
  f.link.setPreference('zcodeQuotaAlwaysVisible', false); f.ipcMain.emit('pet:zcode-quota-guard-open', event); assert.equal(opened, 2);
  f.link.close();
});
