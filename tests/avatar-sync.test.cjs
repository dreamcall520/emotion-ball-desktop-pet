const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../demo-embed.js'), 'utf8');
const origin = 'https://qiuqiu.pet';
const location = { origin, href: `${origin}/preview/product/?v=check` };
const copy = value => JSON.parse(JSON.stringify(value));
function mount() {
  const handlers = {};
  const frames = ['customize', 'chat', 'chat'].map(demo => {
    const frame = { dataset: { demo }, height: '520', sent: [], events: {}, closest: () => null,
      addEventListener(name, fn) { this.events[name] = fn; } };
    frame.contentWindow = { postMessage(message, target) { assert.equal(target, origin); frame.sent.push(copy(message)); } };
    return frame;
  });
  vm.runInNewContext(code, {
    document: { hidden: false, querySelectorAll: () => frames, querySelector: () => null, addEventListener() {} },
    window: { addEventListener: (name, fn) => { handlers[name] = fn; } }, location, URL,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    IntersectionObserver: class { observe() {} }, MutationObserver: class { observe() {} },
  });
  return { frames, receive: (data, source = frames[0].contentWindow, eventOrigin = origin) => handlers.message({ data, source, origin: eventOrigin }) };
}
const { frames, receive } = mount();
const avatar = frame => frame.sent.filter(packet => packet.type === 'qiuqiu-demo-avatar').at(-1);
for (const [name, sha, file] of [
  ['ikun', '1efa22ef14f812a00e6bbeaea6ab410bf441085df26fa194bbbaea1c0c18789d', 'demo-ikun.webp'],
  ['春野', '1d0c978a2b7a9598bf8e1b06259ebf75b1ffd4225dedba52f1c893bb95eba007', 'demo-chunye.webp']
]) {
  const id = `codex-${sha}`;
  const packet = { type: 'qiuqiu-demo-avatar', appearance: { shape: 'codex-pet', codexPetId: id },
    codexPet: { id, name, version: 2, rows: 11, imageURL: `${origin}/preview/demos/customize/assets/${file}` } };
  const count = () => frames[1].sent.length;
  const before = count();
  receive(packet, {}, origin);
  receive(packet, frames[0].contentWindow, 'https://foreign.test');
  receive(packet, frames[1].contentWindow);
  for (const changed of [null, { ...packet.codexPet, id: 'unknown' }, { ...packet.codexPet, name: 'unknown' },
    { ...packet.codexPet, version: 1, rows: 9 }, { ...packet.codexPet, rows: 9 },
    { ...packet.codexPet, imageURL: 'https://foreign.test/pet.webp' },
    { ...packet.codexPet, imageURL: packet.codexPet.imageURL + '?extra=1' }]) receive({ ...packet, codexPet: changed });
  assert.equal(count(), before, 'Untrusted or mismatched descriptors cannot reach chat');
  receive(packet);
  for (const frame of frames.slice(1)) {
    assert.deepEqual(avatar(frame), packet);
    frame.sent.length = 0;
    frame.events.load();
    assert.deepEqual(avatar(frame), packet, 'Reload restores the saved pet');
    frame.sent.length = 0;
    receive({ type: 'qiuqiu-demo-ready' }, frame.contentWindow);
    assert.deepEqual(avatar(frame), packet, 'A lazy chat frame receives the saved pet when ready');
  }
}
receive({ type: 'qiuqiu-demo-avatar', appearance: { shape: 'square' } });
assert.equal(avatar(frames[1]).codexPet, null, 'Returning to Qiuqiu clears the sprite descriptor');
assert.equal(avatar(frames[1]).appearance.shape, 'square');
assert.equal(avatar(mount().frames[1]), undefined, 'Reloading the page resets memory-only selections');
console.log('PASS: fixed pet catalogue, trusted save relay, lazy/reloaded chat restoration, shape reset and path-prefix URLs.');
