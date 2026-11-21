'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { setImmediate: flush } = require('node:timers/promises');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const start = source.indexOf('function selectDefaultStoreChatSource()');
const end = source.indexOf('\nasync function showUpdateResult', start);
const readyStart = source.indexOf('function storeChatReady(');
const readyEnd = source.indexOf('\nfunction ', readyStart);
const selectStart = source.indexOf('    onSelect: (chatSource, change) => {');
const selectEnd = source.indexOf('\n    onChange:', selectStart);
assert(start > 0 && end > start && readyStart > 0 && selectStart > 0, 'extract actual main helpers and selection persistence');
const onSelect = source.slice(selectStart + '    onSelect: '.length, selectEnd).trim().replace(/,$/, '');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture({ saved = 'codex', current = 'codex', codex = false, workbuddy = false, pending = 0, firstRelease = true } = {}) {
  const selected = [], savedSettings = [], grants = { codex, workbuddy };
  const providers = Object.fromEntries(['codex', 'workbuddy'].map(id => [id, { connection: 'ready', modelsStatus: 'ready', accountMismatch: false }]));
  const state = { ...providers[current], source: current, busy: false, sourceChanging: false };
  let selectionGate = null, accepted = true, failure = null;
  const context = vm.createContext({ FIRST_RELEASE: firstRelease, IS_STORE_BUILD: true, STORE_PROVIDERS: ['codex', 'workbuddy'],
    settings: { chatSource: saved }, settingsFile: '/synthetic/settings.json', storeChatRestorePending: pending,
    storeChatDefaultFlight: null, isQuitting: false, availableUpdate: null,
    saveSettings(_file, settings) { savedSettings.push({ ...settings }); return settings; },
    workbuddyChatConnection: { getState: () => ({ authorized: grants.workbuddy }) },
    storeRuntime: { isChatEnabled: id => grants[id] === true },
    storeEnableFlow: { getState: () => ({ codex: { chat: { status: grants.codex ? 'ready' : 'needs-data-authorization' } } }) },
    chat: { getState: () => ({ ...state }), getSourceState: id => providers[id],
      async selectSource(id) {
        selected.push(id); if (selectionGate) await selectionGate;
        if (failure) throw failure; if (!accepted) return { accepted: false };
        context.persistSelection(id); Object.assign(state, providers[id], { source: id }); return { accepted: true };
      } } });
  vm.runInContext(source.slice(readyStart, readyEnd) + '\n' + source.slice(start, end) + '\nvar persistSelection = ' + onSelect + ';', context);
  return { context, grants, providers, state, selected, savedSettings,
    choose: () => context.selectDefaultStoreChatSource(), finish: () => context.finishStoreChatRestore(),
    set gate(value) { selectionGate = value; }, set accepted(value) { accepted = value; }, set failure(value) { failure = value; } };
}
test('saved Codex without authorization falls back to an authorized available WorkBuddy', async () => {
  const f = fixture({ workbuddy: true });
  assert.equal(await f.choose(), true); assert.deepEqual(f.selected, ['workbuddy']);
  assert.equal(f.context.settings.chatSource, 'workbuddy'); assert.equal(f.savedSettings.length, 1);
});
test('saved WorkBuddy survives both asynchronous restore steps without premature selection or save', async () => {
  const f = fixture({ saved: 'workbuddy', codex: true, pending: 2 });
  assert.equal(await f.choose(), false); assert.deepEqual(f.selected, []); assert.deepEqual(f.savedSettings, []);
  f.finish(); await flush(); assert.equal(f.context.storeChatRestorePending, 1);
  assert.deepEqual(f.selected, []); assert.equal(f.context.settings.chatSource, 'workbuddy');
  f.grants.workbuddy = true; f.finish(); await flush();
  assert.equal(f.context.storeChatRestorePending, 0); assert.deepEqual(f.selected, ['workbuddy']);
  assert(f.savedSettings.every(settings => settings.chatSource === 'workbuddy'));
});
test('when both are available saved preference wins; an already selected saved source is not reconnected', async () => {
  for (const saved of ['codex', 'workbuddy']) {
    const other = saved === 'codex' ? 'workbuddy' : 'codex';
    const f = fixture({ saved, current: other, codex: true, workbuddy: true });
    assert.equal(await f.choose(), true); assert.deepEqual(f.selected, [saved]);
    assert.equal(await f.choose(), false); assert.deepEqual(f.selected, [saved]);
  }
});
test('no authorized source leaves selection and saved preference unchanged', async () => {
  const f = fixture({ saved: 'workbuddy' }); assert.equal(await f.choose(), false);
  assert.deepEqual(f.selected, []); assert.deepEqual(f.savedSettings, []); assert.equal(f.context.settings.chatSource, 'workbuddy');
});
test('busy, connecting, source transition and quitting never steal the current conversation', async () => {
  for (const state of [{ busy: true }, { connection: 'connecting' }, { sourceChanging: true }, { quitting: true }]) {
    const f = fixture({ saved: 'workbuddy', codex: true, workbuddy: true });
    if (state.quitting) f.context.isQuitting = true; else Object.assign(f.state, state);
    assert.equal(await f.choose(), false); assert.deepEqual(f.selected, []); assert.deepEqual(f.savedSettings, []);
  }
});
test('simultaneous refreshes share a single source switch and persistence', async () => {
  const f = fixture({ workbuddy: true }), gate = deferred(); f.gate = gate.promise;
  const first = f.choose(), second = f.choose(); assert.equal(first, second);
  await flush(); assert.deepEqual(f.selected, ['workbuddy']); assert.deepEqual(f.savedSettings, []);
  gate.resolve(); assert.equal(await first, true); await second; assert.equal(f.savedSettings.length, 1);
  await flush(); assert.equal(f.context.storeChatDefaultFlight, null);
});
test('failed or rejected source switching clears its flight and can be retried', async () => {
  for (const mode of ['reject', 'throw']) {
    const f = fixture({ workbuddy: true }); if (mode === 'reject') f.accepted = false; else f.failure = Error('synthetic offline');
    assert.equal(await f.choose(), false); await flush(); assert.equal(f.context.storeChatDefaultFlight, null);
    assert.deepEqual(f.savedSettings, []); f.accepted = true; f.failure = null;
    assert.equal(await f.choose(), true); assert.deepEqual(f.selected, ['workbuddy', 'workbuddy']);
  }
});
test('temporary disabled fallback cannot overwrite the MAS saved preference during restore', () => {
  const f = fixture({ saved: 'workbuddy', pending: 2 });
  f.context.persistSelection('codex', { reason: 'disabled' });
  assert.deepEqual(f.savedSettings, []); assert.equal(f.context.settings.chatSource, 'workbuddy');
  f.context.persistSelection('codex'); assert.equal(f.context.settings.chatSource, 'codex'); assert.equal(f.savedSettings.length, 1);
});
test('website behavior does not run MAS default selection and retains its original disabled fallback persistence', async () => {
  const f = fixture({ firstRelease: false, workbuddy: true });
  assert.equal(await f.choose(), false); assert.deepEqual(f.selected, []);
  f.context.persistSelection('codex', { reason: 'disabled' }); assert.equal(f.savedSettings.length, 1);
});
test('account mismatch and connection error exclude an authorized source from automatic defaulting', async () => {
  for (const provider of ['codex', 'workbuddy']) for (const invalid of [{ accountMismatch: true }, { connection: 'error' }]) {
    const other = provider === 'codex' ? 'workbuddy' : 'codex';
    const f = fixture({ saved: provider, current: other, codex: true, workbuddy: true }); Object.assign(f.providers[provider], invalid);
    assert.equal(await f.choose(), false, provider + ' ' + JSON.stringify(invalid));
    assert.deepEqual(f.selected, []); assert.deepEqual(f.savedSettings, []);
  }
});
