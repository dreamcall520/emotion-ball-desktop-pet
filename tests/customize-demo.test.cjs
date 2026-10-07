// Run with: node tests/customize-demo.test.cjs — no browser, App or user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID, createHash } = require('node:crypto');
const site = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(site, file), 'utf8');
const origin = 'https://qiuqiu.example';
const prefix = '/preview/revision/';
const clone = value => JSON.parse(JSON.stringify(value));
const events = () => {
  const listeners = new Map();
  return {
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    fire(name, event) { for (const callback of [...(listeners.get(name) || [])]) callback(event); }
  };
};

function customizer() {
  const messages = [], paints = [], requests = new Map();
  let nextRequest = 0;
  const media = Object.assign(events(), { matches: false });
  const doc = Object.assign(events(), {
    hidden: false, documentElement: { dataset: {} },
    currentScript: { src: `${origin}${prefix}demos/customize/lib/codex-pet-player.js` },
    createElement() {
      return { dataset: {}, style: {}, setAttribute() {}, remove() {},
        getContext: () => ({ clearRect() {}, drawImage(...args) { paints.push(args); } }) };
    }
  });
  const makeController = () => ({ active: true, destroyed: false,
    setActive(value) { this.active = value; }, destroy() { this.destroyed = true; this.active = false; } });
  const parent = { postMessage(value, targetOrigin) { messages.push({ value: clone(value), targetOrigin }); } };
  const window = Object.assign(events(), {
    parent, document: doc, location: { origin, href: `${origin}${prefix}demos/customize/index.html` },
    matchMedia: () => media,
    EmotionBall: { create: makeController }, AuroraRive: Object.freeze({ create: makeController }),
    requestAnimationFrame(callback) { const id = ++nextRequest; requests.set(id, callback); return id; },
    cancelAnimationFrame(id) { requests.delete(id); },
    Image: class {
      set src(value) { this.url = value; this.naturalWidth = 1536; this.naturalHeight = 2288; this.onload?.(); }
    }
  });
  doc.defaultView = window;
  const context = vm.createContext({ window, document: doc, URL, crypto: { randomUUID }, queueMicrotask });
  for (const file of ['lib/customization.js', 'lib/codex-pet-player.js', 'browser-bridge.js']) {
    vm.runInContext(read(`demos/customize/${file}`), context, { filename: file });
  }
  const receive = (data, source = parent, eventOrigin = origin) => window.fire('message', { data, source, origin: eventOrigin });
  const target = () => ({ id: 'preview-ball', ownerDocument: doc, appendChild() {} });
  const tick = now => { const pending = [...requests.values()]; requests.clear(); pending.forEach(callback => callback(now)); };
  return { bridge: window.petCustomizer, window, doc, media, messages, paints, requests, parent, receive, target, tick };
}

(async () => {
  const manifest = JSON.parse(read('demos/customize/source-manifest.json'));
  assert.equal(manifest.publicCommit, 'eac7a8d12bd425fb98f005828ab80afabe18ca0b');
  for (const row of [...manifest.files, ...manifest.websiteFiles]) {
    const bytes = fs.readFileSync(path.resolve(site, 'demos/customize', row.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, row.file);
  }
  for (const pet of manifest.demoPetCatalog) {
    const bytes = fs.readFileSync(path.resolve(site, 'demos/customize', pet.file));
    assert.equal(bytes.length, pet.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pet.sha256, pet.name);
    assert.equal(pet.id, `codex-${pet.sha256}`);
  }
  const html = read('demos/customize/index.html');
  for (const id of ['source-ball', 'source-codex', 'pet-grid', 'pet-action', 'pet-play', 'pet-size', 'pet-opacity', 'startup-default', 'preset-form', 'body-hex', 'eye-hex']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const actions = [...html.match(/<select id="pet-action"[\s\S]*?<\/select>/)[0].matchAll(/value="([^"]+)"/g)].map(match => match[1]);
  assert.equal(actions.length, 9);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /仅为网页演示，刷新后恢复/);
  assert.match(html, /data-ui-theme="blue"/);
  assert.ok(html.indexOf('lib/codex-pet-player.js') < html.indexOf('browser-bridge.js'));
  assert.ok(html.indexOf('browser-bridge.js') < html.indexOf('src="customize-renderer.js'));

  const demo = customizer(), api = demo.bridge;
  let theme;
  api.onColorMode((mode, appearance, uiTheme) => { theme = { mode, appearance, uiTheme }; });
  await new Promise(resolve => queueMicrotask(resolve));
  assert.deepEqual(theme, { mode: 'standard', appearance: 'light', uiTheme: 'blue' });
  const palette = { type: 'qiuqiu-demo-theme', appearance: 'dark', colorMode: 'accessible', uiTheme: 'green' };
  demo.receive(palette, {}, origin); demo.receive(palette, demo.parent, 'https://foreign.example');
  assert.equal(theme.uiTheme, 'blue');
  demo.receive(palette);
  assert.deepEqual(theme, { mode: 'accessible', appearance: 'dark', uiTheme: 'green' });

  const pets = (await api.listCodexPets()).pets;
  assert.deepEqual(clone(pets.map(pet => [pet.name, pet.version, pet.rows])), [['ikun', 2, 11], ['春野', 2, 11]]);
  for (const pet of pets) {
    assert.match(pet.id, /^codex-[a-f0-9]{64}$/);
    assert.equal(new URL(pet.imageURL).origin, origin);
    assert.ok(pet.imageURL.startsWith(`${origin}${prefix}demos/customize/assets/`));
    assert.equal(demo.window.CodexPetPlayer.validDescriptor(pet), true);
    assert.equal(demo.window.CodexPetPlayer.validDescriptor({ ...pet, version: 1, rows: 9 }), true, 'The published player also retains v1 descriptor compatibility');
  }
  pets[0].name = 'mutated';
  assert.equal((await api.listCodexPets()).pets[0].name, 'ikun', 'Refresh rebuilds an independent example catalogue');
  const pet = (await api.listCodexPets()).pets[0];
  const draft = { shape: 'codex-pet', codexPetId: pet.id, auroraTransparency: 22 };
  api.preview(draft);
  assert.equal(demo.messages.length, 0, 'Choosing or previewing never synchronizes the chat avatar');
  assert.equal((await api.load()).customization.appearance.shape, 'blob');
  let size;
  const unsubscribeSize = api.onSize(value => { size = value; });
  assert.equal(await api.setSize('medium'), true);
  assert.equal(size, 'medium'); assert.equal((await api.load()).size, 'medium');
  assert.equal(await api.setSize('../outside'), false);
  unsubscribeSize(); await api.setSize('compact'); assert.equal(size, 'medium');
  const preset = await api.addPreset('宠物收藏', draft);
  assert.equal(preset.ok, true); assert.equal(preset.presets.at(-1).codexPet.id, pet.id);
  assert.equal((await api.addPreset('重复宠物', draft)).ok, false);
  assert.equal(demo.messages.length, 0);
  assert.equal(await api.save({ appearance: { ...draft, codexPetId: 'codex-' + '0'.repeat(64) } }, true), false);
  assert.equal((await api.addPreset('伪造宠物', { ...draft, codexPetId: '../private' })).ok, false);
  assert.equal(await api.save({ appearance: draft }, 'true'), false);
  assert.equal(await api.save({ appearance: draft }, false), true);
  let state = await api.load();
  assert.equal(state.customization.appearance.shape, 'codex-pet');
  assert.equal(state.startupAppearance.shape, 'blob', 'Unchecked startup option retains the original startup appearance');
  assert.equal(demo.messages.at(-1).targetOrigin, origin);
  const saved = demo.messages.at(-1).value;
  assert.equal(saved.type, 'qiuqiu-demo-avatar'); assert.equal(saved.codexPet.imageURL, pet.imageURL);
  assert.equal(saved.codexPet.id, saved.appearance.codexPetId);
  assert.equal(await api.save({ appearance: { ...draft, auroraTransparency: 80 } }, true), true);
  state = await api.load();
  assert.equal(state.startupAppearance.codexPetId, pet.id); assert.equal(state.startupAppearance.auroraTransparency, 60);
  const reload = await customizer().bridge.load();
  assert.equal(reload.customization.appearance.shape, 'blob'); assert.equal(reload.appearancePresets.length, 2);

  // Exercise the actual published sprite player: row mapping, sizing and freezing.
  const player = demo.window.CodexPetPlayer.create(demo.target(), { descriptor: pet, size: 208, opacity: .78 });
  assert.equal(player.element.style.width, '192px'); assert.equal(player.element.style.height, '208px');
  assert.equal(player.element.style.opacity, '0.78');
  for (const action of demo.window.CodexPetPlayer.ACTIONS) {
    assert.ok(actions.includes(action.id)); assert.equal(player.setAction(action.id), true);
    assert.equal(player.element.dataset.codexAction, action.id);
    assert.equal(demo.paints.at(-1)[2], action.row * 208);
  }
  assert.equal(player.setAction('untrusted-action'), false);
  player.setAction('idle'); demo.tick(0); demo.tick(1679);
  assert.equal(player.element.dataset.codexFrame, '0', 'Idle retains the original 6x hold');
  demo.tick(1680); assert.equal(player.element.dataset.codexFrame, '1');
  demo.tick(6599); assert.equal(player.element.dataset.codexFrame, '5');
  demo.tick(6600); assert.equal(player.element.dataset.codexFrame, '0', 'Idle completes one cycle at 6.6s');
  player.setAction('wave'); demo.tick(7000); demo.tick(7699);
  assert.equal(player.element.dataset.codexFrame, '3');
  demo.tick(7700); assert.equal(player.element.dataset.codexFrame, '0', 'Wave keeps its 700ms cycle');
  player.setAction('idle'); demo.tick(8000); demo.tick(9680);
  assert.equal(player.element.dataset.codexFrame, '1');
  demo.receive({ type: 'qiuqiu-demo-motion', paused: true }, {}, origin);
  assert.ok(demo.requests.size > 0, 'A foreign frame cannot pause the preview');
  demo.receive({ type: 'qiuqiu-demo-motion', paused: true }); assert.equal(demo.requests.size, 0);
  const pausedFrame = player.element.dataset.codexFrame; demo.tick(10680); assert.equal(player.element.dataset.codexFrame, pausedFrame);
  player.pause(false); assert.equal(demo.requests.size, 0, 'Play cannot override a parent pause');
  const replacement = demo.window.CodexPetPlayer.create(demo.target(), { descriptor: (await api.listCodexPets()).pets[1] });
  assert.equal(demo.requests.size, 0, 'A replacement preview inherits the parent pause');
  player.pause(true);
  demo.receive({ type: 'qiuqiu-demo-motion', paused: false });
  assert.equal(demo.requests.size, 1, 'The manually paused player stays paused while the replacement resumes');
  replacement.destroy(); assert.equal(demo.requests.size, 0);
  player.pause(false); assert.ok(demo.requests.size > 0);
  demo.media.matches = true; demo.media.fire('change'); assert.equal(demo.requests.size, 0);
  demo.receive({ type: 'qiuqiu-demo-motion', paused: false }); assert.equal(demo.requests.size, 0);
  demo.media.matches = false; demo.media.fire('change'); assert.ok(demo.requests.size > 0);
  demo.doc.hidden = true; demo.doc.fire('visibilitychange'); assert.equal(demo.requests.size, 0);
  demo.doc.hidden = false; demo.doc.fire('visibilitychange'); assert.ok(demo.requests.size > 0);
  player.destroy(); demo.receive({ type: 'qiuqiu-demo-motion', paused: false }); assert.equal(demo.requests.size, 0);
  assert.equal(demo.window.CodexPetPlayer.validDescriptor({ ...pet, imageURL: 'https://foreign.example/pet.webp' }), false);
  assert.equal(demo.window.CodexPetPlayer.validDescriptor({ ...pet, imageURL: pet.imageURL + '?redirect=1' }), false);

  // Chat receives only reviewed IDs/descriptors from its own parent and origin.
  const chatEvents = events(), avatarEvents = [];
  const chatRoot = { dataset: {} }, chatDoc = { documentElement: chatRoot, addEventListener() {} };
  const chatWindow = Object.assign(chatEvents, {});
  const chatContext = vm.createContext({ window: chatWindow, document: chatDoc, parent: demo.parent,
    location: { origin, href: `${origin}${prefix}demos/chat/index.html` }, URL, Date, setTimeout, clearTimeout, Event: class {} });
  vm.runInContext(read('demos/chat/lib/customization.js'), chatContext);
  vm.runInContext(read('demos/chat/demo-bridge.js'), chatContext);
  chatWindow.qiuqiuChat.onAppearance((appearance, image, codexPet) => avatarEvents.push(clone({ appearance, image, codexPet })));
  const receiveChat = (data, source = demo.parent, eventOrigin = origin) => chatWindow.fire('message', { data, source, origin: eventOrigin });
  receiveChat(saved, {}, origin); receiveChat(saved, demo.parent, 'https://foreign.example'); assert.equal(avatarEvents.length, 0);
  for (const data of [
    { ...saved, codexPet: { ...saved.codexPet, imageURL: 'https://foreign.example/pet.webp' } },
    { ...saved, codexPet: { ...saved.codexPet, rows: 9 } },
    { ...saved, codexPet: { ...saved.codexPet, name: 'injected' } },
    { ...saved, codexPet: null }
  ]) receiveChat(data);
  assert.equal(avatarEvents.length, 0);
  receiveChat(saved); assert.equal(avatarEvents.at(-1).codexPet.id, pet.id);
  const unsubscribeAvatar = chatWindow.qiuqiuChat.onAppearance((appearance, image, codexPet) => assert.equal(codexPet.id, pet.id));
  unsubscribeAvatar();
  receiveChat({ type: 'qiuqiu-demo-avatar', appearance: { shape: 'square' } });
  assert.equal(avatarEvents.at(-1).appearance.shape, 'square'); assert.equal(avatarEvents.at(-1).codexPet, null);
  console.log('PASS: published customizer/source hashes; memory-only v1/v2 catalogue, presets, size/startup/save; nine native sprite actions; trusted avatar relay; pause/reduced-motion/visibility/reload boundaries.');
})().catch(error => { console.error(error); process.exitCode = 1; });
