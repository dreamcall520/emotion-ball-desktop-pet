'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { DialogueDirector } = require('../lib/dialogue');
const { normalizeSettings } = require('../lib/settings');
const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const chatRenderer = fs.readFileSync(path.join(__dirname, '../chat-renderer.js'), 'utf8');

test('disconnect revokes the main ZCode authority even when animation cleanup fails', async () => {
  const { EventEmitter } = require('node:events');
  const { pathToFileURL } = require('node:url');
  const owner = new EventEmitter(), actions = []; let handler, connected = true;
  const start = main.indexOf("  ipcMain.handle('pet:global-zcode-connection'");
  const end = main.indexOf("  ipcMain.handle('pet:global-codex-connection'", start);
  assert(start > 0 && end > start);
  vm.runInNewContext(main.slice(start, end), {
    ipcMain: { handle: (_name, callback) => { handler = callback; } }, FIRST_RELEASE: true,
    zcodeQuotaConnection: { disconnect: async () => { actions.push('revoke-main'); connected = false; } },
    zcodeNotifications: { disable: async () => { actions.push('stop-animation'); throw Error('synthetic cleanup failure'); } },
    zcodeChatConnection: { disable: async()=>{} }, storeChatDataConsent:()=>({revoke(){}}),
    require: name=>require(name.replace('./lib/','../lib/')), writeError(){},
    fromGlobalSettings: () => true, path, pathToFileURL, __dirname: path.join(__dirname, '..'),
    globalSettingsBusy: false, globalSettingsWindow: owner, AbortController,
    globalSettingsSnapshot: () => ({ connected })
  });
  const event = { sender: { getURL: () => pathToFileURL(path.join(__dirname, '../global-settings.html')).href } };
  const result = await handler(event, 'disconnect');
  assert.deepEqual(actions, ['stop-animation', 'revoke-main']);
  assert.equal(result.status, 'error'); assert.equal(result.snapshot.connected, false);
  assert.equal(owner.listenerCount('closed'), 0); assert.equal(owner.listenerCount('hide'), 0);
});

// Execute the owning functions, rather than a test copy of the arbitration.
// No Electron window, model request, source task or official account is started.
function declaration(source, name) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(match, `Actual ${name} declaration exists`);
  const rest = source.slice(match.index + match[0].length), next = /\n(?:async )?function [A-Za-z_$][\w$]*\(/.exec(rest);
  assert.ok(next, `Actual ${name} has a following top-level declaration`);
  return source.slice(match.index, match.index + match[0].length + next.index);
}
function presentationFixture() {
  const sent = [], timers = new Map(), resources = { spriteTimer: 0, spriteBounds: 0, windowStop: 0, bubbleHide: 0 };
  const now = 100000, generation = 7, pageEpoch = 3;
  const notificationState = { connected: true, generation };
  const codexAlert = { id: 31, generation, kind: 'completed', motion: 'hop' };
  const alert = id => ({ id, generation, kind: 'completed', motion: 'hop', expiresAt: now + 30000 });
  const sandbox = { Date: { now: () => now }, performance: { now: () => now },
    pomodoroQuiet: false, shortcutWindow: null, codexPageReady: true, isQuitting: false, screenLocked: false,
    chatWindow: null, presentationSuppressed: () => false, dragState: null, bounceState: null, hostMotion: null,
    settings: { codexEnabled: true }, codexPageEpoch: pageEpoch,
    petWindow: { isDestroyed: () => false, isVisible: () => true, webContents: { send: (channel, packet) => sent.push({ channel, ...JSON.parse(JSON.stringify(packet)) }) } },
    dialogue: new DialogueDirector(), hideBubble: () => { resources.bubbleHide++; },
    codexCompanion: { getSnapshot: () => ({ generation, currentAlert: codexAlert }) },
    workbuddyNotifications: { getState: () => notificationState }, zcodeNotifications: { getState: () => notificationState },
    codexPresentation: null, workbuddyPresentation: null, zcodePresentation: null,
    workbuddyAlertQueue: [alert(11)], zcodeAlertQueue: [alert(21)],
    codexRenderer: { available: true, generation, pageEpoch }, workbuddyRenderer: { available: true, generation, pageEpoch }, zcodeRenderer: { available: true, generation, pageEpoch },
    workbuddyPresentationTimer: null, zcodePresentationTimer: null,
    clearSpriteMotionTimer: () => { resources.spriteTimer++; }, restoreDogSpriteBounds: () => { resources.spriteBounds++; },
    windowMotion: { stop: () => { resources.windowStop++; } },
    setTimeout: (callback, delay) => { const handle = { unref() {} }; timers.set(handle, { callback, delay }); return handle; },
    clearTimeout: handle => timers.delete(handle) };
  const context = vm.createContext(sandbox);
  const names = ['codexHostAvailable', 'canPresentCodex', 'sendCodexCommand', 'clearCodexPresentation',
    'clearWorkBuddyPresentation', 'pumpWorkBuddyPresentation', 'clearZcodePresentation', 'pumpZcodePresentation', 'presentCodexAlert'];
  const api = vm.runInContext(names.map(name => declaration(main, name)).join('\n') + '\n;({' + names.join(',') + '})', context);
  return { sandbox, api, sent, timers, resources, codexAlert, generation, pageEpoch,
    dispatched: () => sent.filter(packet => ['task', 'codex'].includes(packet.command)) };
}

test('pending WorkBuddy and ZCode dispatches reserve the shared renderer until acknowledged or cleared', () => {
  for (const first of ['workbuddy', 'zcode']) {
    const f = presentationFixture(), second = first === 'zcode' ? 'workbuddy' : 'zcode';
    const pump = source => f.api[source === 'workbuddy' ? 'pumpWorkBuddyPresentation' : 'pumpZcodePresentation']();
    const clear = source => f.api[source === 'workbuddy' ? 'clearWorkBuddyPresentation' : 'clearZcodePresentation']();
    pump(first); pump(second); f.api.presentCodexAlert(f.codexAlert);
    assert.deepEqual(f.dispatched().map(packet => packet.source), [first]);
    assert.equal(f.sandbox.hostMotion, null, 'the reservation must work before renderer motion-ready');
    assert.equal(f.sandbox[second + 'AlertQueue'].length, 1, 'the other source stays queued, rather than losing its result');
    assert.equal(f.sandbox.codexPresentation, null);
    assert.equal(f.timers.size, 1);
    clear(first); assert.equal(f.timers.size, 0);
    pump(second); assert.deepEqual(f.dispatched().map(packet => packet.source), [first, second]);
    assert.equal(f.sandbox[second + 'AlertQueue'].length, 0);
    clear(second); f.api.presentCodexAlert(f.codexAlert);
    assert.deepEqual(f.dispatched().map(packet => packet.source || 'codex'), [first, second, 'codex']);
  }
});

test('a pending Codex presentation keeps both added-source result queues intact', () => {
  const f = presentationFixture(); f.api.presentCodexAlert(f.codexAlert);
  f.api.pumpZcodePresentation(); f.api.pumpWorkBuddyPresentation();
  assert.deepEqual(f.dispatched().map(packet => packet.command), ['codex']);
  assert.equal(f.sandbox.zcodeAlertQueue.length, 1); assert.equal(f.sandbox.workbuddyAlertQueue.length, 1);
  f.api.clearCodexPresentation(); f.api.pumpZcodePresentation();
  assert.deepEqual(f.dispatched().map(packet => packet.source || 'codex'), ['codex', 'zcode']);
});

test('clearing Codex cannot clear the active ZCode or WorkBuddy sprite resources and bubble', () => {
  for (const owner of ['zcode', 'workbuddy']) {
    const f = presentationFixture(), motion = { owner, token: 19, spriteAction: 'jump' };
    f.sandbox.hostMotion = motion; f.sandbox.codexPresentation = { id: 31, generation: f.generation, pageEpoch: f.pageEpoch };
    assert.ok(f.sandbox.dialogue.offerProviderTask({ provider: owner, id: 21, generation: f.generation, text: owner + ' 有新结果' }, 100000));
    f.api.clearCodexPresentation();
    assert.equal(f.sandbox.codexPresentation, null); assert.equal(f.sandbox.hostMotion, motion);
    assert.deepEqual(f.resources, { spriteTimer: 0, spriteBounds: 0, windowStop: 0, bubbleHide: 0 });
    assert.equal(f.sandbox.dialogue.hasBubble(100000), true);
    assert.deepEqual(f.sent.map(packet => packet.command), ['codex-cancel']);
  }
  const f = presentationFixture(); f.sandbox.hostMotion = { owner: 'codex' }; f.api.clearCodexPresentation();
  assert.equal(f.sandbox.hostMotion, null);
  assert.deepEqual(f.resources, { spriteTimer: 1, spriteBounds: 1, windowStop: 1, bubbleHide: 0 });
});

test('ZCode cannot consume a queued result using another page or renderer generation', () => {
  const f = presentationFixture(); f.sandbox.zcodeRenderer.pageEpoch--;
  f.api.pumpZcodePresentation(); assert.equal(f.dispatched().length, 0); assert.equal(f.sandbox.zcodeAlertQueue.length, 1);
  f.sandbox.zcodeRenderer.pageEpoch = f.pageEpoch; f.sandbox.zcodeRenderer.generation--;
  f.api.pumpZcodePresentation(); assert.equal(f.dispatched().length, 0); assert.equal(f.sandbox.zcodeAlertQueue.length, 1);
  f.sandbox.zcodeRenderer.generation = f.generation; f.api.pumpZcodePresentation();
  assert.deepEqual(f.dispatched().map(packet => packet.source), ['zcode']);
});

class Element {
  constructor() { this.children = []; this.dataset = {}; this.attributes = {}; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener() {}
}
test('actual first-release chat projection offers authorized official ZCode alongside ready peers', () => {
  const snapshot = vm.runInNewContext(declaration(main, 'chatSnapshot') + '\nchatSnapshot({source:"codex",connection:"ready",modelsStatus:"ready"})', {
    IS_STORE_BUILD: true, FIRST_RELEASE: true, STORE_PROVIDERS: ['codex', 'zcode', 'workbuddy'], availableUpdate: null,
    workbuddyChatConnection: { getState: () => ({ authorized: true }) }, storeChatReady: () => true,
    zcodeChatConnection: {getState:()=>({authorized:true})},
    storeRuntime: { isChatEnabled: () => true, workbuddyCli: { getState: () => ({ connected: true }) }, getZcodeAccountSource: () => 'official' },
    storeEnableFlow: { getState: () => ({}) } });
  const sourceSelect = new Element(), sourceMenu = new Element(), sourceBar = new Element();
  vm.runInNewContext([declaration(chatRenderer.replace(/^  /gm, ''), 'availableSources'),
    declaration(chatRenderer.replace(/^  /gm, ''), 'sourceNeedsAuthorization'), declaration(chatRenderer.replace(/^  /gm, ''), 'renderSources')].join('\n') + '\nrenderSources();', {
    snapshot, sourceSelect, sourceMenu, sourceBar, sourceOptionsKey: '', sourceOptions: [], historyOpen: false,
    sourceId: () => 'codex', sourceName: () => 'Codex', changeBlocked: () => false, closeSourceMenu() {}, chooseSource() {},
    api: { setSource() {}, openConnections() {} }, document: { createElement: () => new Element() } });
  const zcode = sourceMenu.children.find(option => option.value === 'zcode');
  assert.ok(zcode); assert.equal(zcode.disabled, false); assert.equal(zcode.children[1].textContent, 'ZCode');
  assert.equal(sourceMenu.children.find(option => option.value === 'workbuddy').disabled, false);
});

test('actual first-release native ZCode toggle opens settings without changing the existing connection', () => {
  for (const enabled of [false, true]) {
    const destinations = [], directToggles = [], original = { id: 'zcode-enabled', type: 'checkbox', checked: enabled,
      click: item => directToggles.push(item.checked) };
    const noop = () => {};
    const items = vm.runInNewContext(declaration(main, 'menuTemplate') + '\nmenuTemplate();', {
      FIRST_RELEASE: true, IS_STORE_BUILD: true, FirstRelease: require('../lib/mas-first-release'), process: { mas: true },
      availableUpdate: null, updateCheck: false, settings: normalizeSettings({}), app: { isPackaged: false, quit: noop },
      calendarWindow: { menu: () => ({ id: 'calendar-menu', label: '日历', submenu: [] }) },
      zcodeLink: { isEnabled: () => enabled, menu: () => ({ id: 'zcode-menu', submenu: [original] }) },
      openGlobalSettings: view => destinations.push(view), codexMenu: () => ({ id: 'codex-menu', submenu: [] }), sizeMenu: () => [],
      storeLoginItems: () => ({ getState: () => ({ supported: false }) }), loginItemEnabled: () => false, edgeTuck: null,
      openStoreConnections: noop, openChat: noop, openCustomization: noop, openPomodoro: noop, restorePet: noop,
      resetPosition: noop, setAlwaysOnTop: noop, setOpenAtLogin: noop, setAutoUpdateCheck: noop });
    const selected = items.find(item => item.id === 'zcode-menu').submenu.find(item => item.id === 'zcode-enabled');
    assert.ok(items.some(item => item.id === 'calendar-menu'), 'calendar entry coexists with the existing ZCode connection');
    const checkbox = { checked: !enabled }; selected.click(checkbox);
    assert.equal(checkbox.checked, enabled); assert.deepEqual(destinations, ['/zcode-menu']); assert.deepEqual(directToggles, []);
  }
});
