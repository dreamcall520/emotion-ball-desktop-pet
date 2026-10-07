import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const base = new URL('./', import.meta.url);
const read = path => readFile(new URL(path, base), 'utf8');
const manifest = JSON.parse(await read('source-manifest.json'));
for (const entry of manifest.files) {
  const bytes = await readFile(new URL(entry.file, base));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.file);
}
const html = await read('index.html');
for (const [, path] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  await readFile(new URL(path, base));
}
assert.match(html, /id="preset-form"[^>]*hidden/);
assert.doesNotMatch(html, /示例名称|载入收藏只改变预览/);
assert.match(await read('lib/aurora-rive.js'), /assets\/aurora-six-lobe-body\.png/);

const customizationSource = await read('lib/customization.js');
const bridgeSource = await read('browser-bridge.js');
function createDemo() {
  const messages = [], listeners = new Map();
  const reducedMotion = { matches: false,
    addEventListener: (_name, callback) => { reducedMotion.change = callback; },
    removeEventListener: () => {} };
  const makeController = () => ({ active: true, destroyed: false,
    setActive(value) { this.active = value; },
    destroy() { this.destroyed = true; this.setActive(false); } });
  const parent = { postMessage: (value, targetOrigin) => messages.push({ value, targetOrigin }) };
  const window = { parent, location: { origin: 'https://qiuqiu.example', href: 'https://qiuqiu.example/demos/customize/' },
    matchMedia: () => reducedMotion,
    EmotionBall: { create: makeController },
    AuroraRive: Object.freeze({ create: makeController }),
    addEventListener: (name, callback) => listeners.set(name, callback) };
  const context = vm.createContext({ window, URL, crypto: { randomUUID }, queueMicrotask });
  vm.runInContext(customizationSource, context);
  vm.runInContext(bridgeSource, context);
  return { bridge: window.petCustomizer, window, parent, messages, listeners, reducedMotion };
}
const demo = createDemo();
const initial = await demo.bridge.load();
assert.equal(initial.appearancePresets.length, 2);
assert.equal(initial.customization.appearance.shape, 'blob');
let theme;
demo.bridge.onColorMode((colorMode, appearance) => { theme = { colorMode, appearance }; });
await new Promise(resolve => queueMicrotask(resolve));
assert.deepEqual(theme, { colorMode: 'standard', appearance: 'light' });
const themeMessage = { type: 'qiuqiu-demo-theme', appearance: 'dark', colorMode: 'accessible' };
const receive = demo.listeners.get('message');
receive({ source: demo.parent, origin: 'https://unrelated.example', data: themeMessage });
receive({ source: {}, origin: demo.window.location.origin, data: themeMessage });
assert.equal(theme.appearance, 'light');
receive({ source: demo.parent, origin: demo.window.location.origin, data: themeMessage });
assert.deepEqual(theme, { colorMode: 'accessible', appearance: 'dark' });

const preview = { id: 'preview-ball' };
const ball = demo.window.EmotionBall.create(preview, { autostart: true });
const rive = demo.window.AuroraRive.create(preview);
const thumbnail = demo.window.EmotionBall.create({ id: 'thumbnail' });
const pause = { type: 'qiuqiu-demo-motion', paused: true };
receive({ source: {}, origin: demo.window.location.origin, data: pause });
receive({ source: demo.parent, origin: 'https://unrelated.example', data: pause });
receive({ source: demo.parent, origin: demo.window.location.origin, data: { ...pause, paused: 'true' } });
assert.equal(ball.active, true, 'Invalid pause messages are ignored');
receive({ source: demo.parent, origin: demo.window.location.origin, data: pause });
assert.equal(ball.active, false);
assert.equal(rive.active, false);
assert.equal(thumbnail.active, true, 'Only the main preview is enrolled');
const replacedWhilePaused = demo.window.AuroraRive.create(preview);
assert.equal(replacedWhilePaused.active, false, 'New preview engines inherit the pause');
rive.destroy();
receive({ source: demo.parent, origin: demo.window.location.origin, data: { ...pause, paused: false } });
assert.equal(ball.active, true);
assert.equal(replacedWhilePaused.active, true);
assert.equal(rive.active, false, 'Destroyed engines are never resumed');
demo.reducedMotion.matches = true;
demo.reducedMotion.change();
assert.equal(ball.active, false, 'The operating system reduced-motion preference still wins');
receive({ source: demo.parent, origin: demo.window.location.origin, data: { ...pause, paused: false } });
assert.equal(replacedWhilePaused.active, false);
demo.reducedMotion.matches = false;
demo.reducedMotion.change();
assert.equal(ball.active, true);

const aurora = { shape: 'aurora-cloud', auroraContour: 'original', bodyColor: '#8B72D8', eyeScale: 2 };
demo.bridge.preview(aurora);
assert.equal(demo.messages.length, 0, 'Draft preview must not synchronize the parent avatar');
let result = await demo.bridge.addPreset('薰衣草幻彩', aurora);
assert.equal(result.ok, true);
assert.equal(result.presets.at(-1).appearance.auroraContour, 'six-lobe');
assert.equal(result.presets.at(-1).appearance.eyeScale, 1);
const id = result.presets.at(-1).id;
assert.equal((await demo.bridge.addPreset('重复外观', aurora)).ok, false);
assert.equal((await demo.bridge.renamePreset(id, '薄荷奶糖')).ok, false);
assert.equal((await demo.bridge.renamePreset(id, '薰衣草')).ok, true);
assert.equal((await demo.bridge.deletePreset(id)).ok, true);
assert.equal(demo.messages.length, 0, 'Preset changes must not synchronize the parent avatar');
await demo.bridge.save({ appearance: aurora }, true);
assert.equal(demo.messages.length, 1);
assert.equal(demo.messages[0].targetOrigin, demo.window.location.origin);
assert.equal(demo.messages[0].value.type, 'qiuqiu-demo-avatar');
assert.equal(demo.messages[0].value.appearance.auroraContour, 'six-lobe');
assert.equal((await demo.bridge.load()).startupAppearance.bodyColor, '#8B72D8');
assert.equal((await createDemo().bridge.load()).customization.appearance.shape, 'blob', 'Reload starts a separate memory demo');
console.log('PASS: source hashes, local dependencies, public six-lobe normalization, memory presets, origin/source validation, save-only avatar protocol and preview pause/resume.');
