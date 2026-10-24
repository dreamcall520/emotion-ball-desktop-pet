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
