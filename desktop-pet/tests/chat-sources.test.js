const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatSources } = require('../lib/chat-sources');

function fixture() {
  const calls = [], saved = [], states = [];
  let enabled = true;
  const make = source => ({
    getState: () => ({ messages: [{ text: source }], busy: false, connection: 'ready' }),
    send: text => { calls.push([source, 'send', text]); return { accepted: true }; },
    connect: async () => { calls.push([source, 'connect']); },
    close: async () => { calls.push([source, 'close']); },
    stop: async () => { calls.push([source, 'stop']); },
    ownsThread: id => id === source,
    newChat: async () => ({ accepted: true })
  });
  const codex = make('codex');
  const router = createChatSources({ codex, createZcode: () => make('zcode'), createWorkbuddy: () => make('workbuddy'), isWorkbuddyEnabled: () => enabled,
    isZcodeEnabled: () => enabled, onSelect: source => saved.push(source), onChange: state => states.push(state) });
  return { router, calls, saved, states, codex, disable: () => { enabled = false; } };
}

test('chat source switching retains separate histories and sends to only the selected source', async () => {
  const f = fixture();
  assert.equal(f.router.getState().source, 'codex');
  assert.deepEqual(await f.router.selectSource('zcode'), { accepted: true });
  assert.equal(f.router.getState().messages[0].text, 'zcode');
  f.router.send('hello');
  assert.deepEqual(f.calls.filter(row => row[1] === 'send'), [['zcode', 'send', 'hello']]);
  await f.router.selectSource('codex');
  assert.equal(f.router.getState().messages[0].text, 'codex');
  assert.deepEqual(f.saved, ['zcode', 'codex']);
  await f.router.close();
});

test('busy replies and disabled ZCode cannot change source', async () => {
  const f = fixture();
  f.codex.getState = () => ({ busy: true, connection: 'ready', messages: [] });
  assert.equal((await f.router.selectSource('zcode')).accepted, false);
  f.codex.getState = () => ({ busy: false, connection: 'ready', messages: [] });
  f.disable();
  assert.equal((await f.router.selectSource('zcode')).accepted, false);
  assert.equal(f.router.getState().source, 'codex');
  await f.router.close();
});

test('disabling ZCode releases only its connection and preserves Codex history', async () => {
  const f = fixture();
  await f.router.selectSource('zcode');
  f.disable();
  await f.router.zcodeDisabled();
  assert.equal(f.router.getState().source, 'codex');
  assert.equal(f.calls.filter(row => row[0] === 'codex' && row[1] === 'close').length, 0);
  assert.equal(f.calls.filter(row => row[0] === 'zcode' && row[1] === 'close').length, 1);
  await f.router.close();
});

test('unselected source notifications never replace the selected transcript', async () => {
  const f = fixture();
  await f.router.selectSource('zcode');
  const before = f.states.length;
  f.router.sourceChanged('codex');
  assert.equal(f.states.length, before);
  f.router.sourceChanged('zcode');
  assert.equal(f.states.at(-1).messages[0].text, 'zcode');
  await f.router.close();
});

test('disabling a draining ZCode publishes the source change before accepting another message', async () => {
  let release;
  const stopped = new Promise(resolve => { release = resolve; });
  const codex = { getState: () => ({ messages: [], busy: false, connection: 'ready' }),
    send: () => assert.fail('must not send to Codex while ZCode is closing'), close() {} };
  const states = [];
  const router = createChatSources({ codex, isZcodeEnabled: () => true,
    createZcode: () => ({ getState: () => ({ messages: [], busy: false, connection: 'ready' }),
      connect: async () => {}, close: () => stopped }), onChange: state => states.push(state) });
  await router.selectSource('zcode');
  const closing = router.zcodeDisabled();
  assert.equal(states.at(-1).source, 'codex');
  assert.equal(states.at(-1).sourceChanging, true);
  assert.equal((await router.send('during close')).accepted, false);
  release(); await closing;
  assert.equal(router.getState().sourceChanging, false);
  await router.close();
});

 test('WorkBuddy uses the shared source router with independent history and disable lifecycle', async () => {
 const f = fixture();
 await f.router.selectSource('workbuddy');
 assert.equal(f.router.getState().source, 'workbuddy');
 assert.equal(f.router.getState().messages[0].text, 'workbuddy');
 f.router.send('hello');
 assert.deepEqual(f.calls.filter(row => row[1] === 'send'), [['workbuddy', 'send', 'hello']]);
 await f.router.selectSource('zcode');
 assert.equal(f.router.getState().messages[0].text, 'zcode');
 await f.router.selectSource('workbuddy'); f.disable();
 assert.equal((await f.router.send('disabled')).accepted, false);
 await f.router.workbuddyDisabled();
 assert.equal(f.router.getState().source, 'codex');
 assert.equal(f.calls.filter(row => row[0] === 'workbuddy' && row[1] === 'close').length, 1);
 assert.equal((await f.router.selectSource('workbuddy')).accepted, false);
 await f.router.close();
});
