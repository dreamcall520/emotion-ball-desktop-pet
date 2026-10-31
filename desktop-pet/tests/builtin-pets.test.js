const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { XIAOBAI_ID, getBuiltinPet } = require('../lib/builtin-pets');
const { validDescriptor } = require('../lib/codex-pet-player');
const { prepareStaging } = require('../scripts/package-mac');
const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '../customize-renderer.js'), 'utf8');
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
function uiPet(pet) {
  return { ...pet, imageURL: pathToFileURL(pet.spritesheetPath).href,
    sheets: Object.fromEntries(Object.entries(pet.sheets).map(([id, sheet]) => [id, { ...sheet, imageURL: pathToFileURL(sheet.path).href }])) };
}

test('官方小白固定ID独立于用户目录，包内十二动作和宽转圈沿用播放器', () => {
  assert.match(XIAOBAI_ID, /^codex-[a-f0-9]{64}$/);
  assert.equal(getBuiltinPet('codex-' + '0'.repeat(64)), null);
  const pet = getBuiltinPet(XIAOBAI_ID);
  assert.equal(pet.origin, 'builtin');
  assert.equal(pet.characterId, 'xiaobai');
  assert.equal(pet.name, '小白');
  assert.equal(Object.keys(pet.sheets).length, 12);
  assert.equal(validDescriptor(uiPet(pet)), true);
  for (const sheet of Object.values(pet.sheets)) {
    const image = fs.readFileSync(sheet.path);
    assert.equal(image.readUInt32BE(16), (sheet.frameWidth || 192) * 8 * pet.spriteScale);
    assert.equal(image.readUInt32BE(20), sheet.rows * 208 * pet.spriteScale);
  }
  for (const action of ['jump', 'happy', 'spin']) assert.equal(pet.frameMap[action].count, 40);
  assert.equal(pet.sheets.spin.frameWidth, 300);
});

test('官方皮肤保存和重启解析直接读取包内资源，不触碰任何导入库，旧导入ID仍解析', () => {
  let stored = 0;
  const legacy = 'codex-' + 'a'.repeat(64);
  const context = vm.createContext({ getBuiltinPet, codexPets: {
    getImported(id) { stored++; assert.equal(id, legacy); return { id, name: '旧小白' }; },
    importPet() { throw Error('official pet must never be imported'); }
  }, localPetStore: {}, localPetDeletingId: null });
  vm.runInContext(between(main, 'function importedPet(id)', 'function fromLocalPetWindow'), context);
  vm.runInContext(between(main, 'function importCodexAppearance(appearance)', 'async function prepareCodexAppearance'), context);
  const appearance = { shape: 'codex-pet', codexPetId: XIAOBAI_ID };
  assert.equal(context.importCodexAppearance(appearance), appearance);
  assert.equal(context.importedPet(XIAOBAI_ID).origin, 'builtin');
  assert.equal(stored, 0);
  assert.equal(context.importedPet(legacy).name, '旧小白');
  assert.equal(stored, 1);
});

test('空用户的官方小白形态卡位于咩咩后小宇前，点击选择官方ID而非本地导入副本', () => {
  const nodes = new Map();
  class Element {
    constructor() { this.dataset = {}; this.attributes = {}; this.children = []; this.style = { setProperty() {} }; }
    setAttribute(key, value) { this.attributes[key] = value; }
    append(...items) { for (const child of items) this.appendChild(child); }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    addEventListener(name, callback) { this[name] = callback; }
    querySelector(selector) { return this.children.find(child => child.dataset.shape === 'new-year-sheep'); }
    querySelectorAll() { return this.children; }
    after(child) { child.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, child); }
  }
  const pet = uiPet(getBuiltinPet(XIAOBAI_ID));
  const state = { appearance: { shape: 'blob', auroraContour: 'original' } };
  const context = vm.createContext({ state, localPets: [], codexDescriptors: new Map([[pet.id, pet]]),
    shapeNames: [['blob','经典'],['aurora-cloud','幻彩'],['cloud','云朵'],['square','方糖'],['new-year-sheep','咩咩'],['soft-orb','小宇']],
    $: id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); },
    document: { createElement: () => new Element(), createTextNode: text => ({ text }) },
    Image: class {}, shapeIcon: () => new Element(),
    choosePet(value) { state.appearance = { shape: 'codex-pet', codexPetId: value.id }; }
  });
  vm.runInContext(between(renderer, '  function renderShapeOptions()', '  function renderSwatches'), context);
  context.renderShapeOptions();
  const cards = nodes.get('shape-options').children;
  assert.deepEqual(cards.map(card => card.attributes['aria-label']), ['选择经典形态','选择幻彩形态','选择云朵形态','选择方糖形态','选择咩咩形态','选择小白形态','选择小宇形态']);
  const dog = cards[5];
  assert.equal(dog.dataset.officialPet, 'xiaobai');
  dog.click();
  assert.equal(state.appearance.codexPetId, XIAOBAI_ID);
  assert.equal(nodes.get('shape-options').children[5].attributes['aria-pressed'], 'true');
});

test('安装暂存包含官方小白manifest和全部资源，迁移至无用户皮肤的新安装仍可读取', t => {
  const root = path.resolve(__dirname, '../..');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-builtin-package-'));
  t.after(() => fs.rmSync(staging, { recursive: true, force: true }));
  prepareStaging(root, staging, { weatherNative: false });
  const staged = require(path.join(staging, 'desktop-pet/lib/builtin-pets'));
  assert.equal(staged.XIAOBAI_ID, XIAOBAI_ID);
  const original = getBuiltinPet(XIAOBAI_ID), copied = staged.getBuiltinPet(XIAOBAI_ID);
  assert.equal(validDescriptor(uiPet(copied)), true);
  for (const id of Object.keys(original.sheets)) {
    assert.ok(copied.sheets[id].path.startsWith(fs.realpathSync(staging) + path.sep));
    assert.deepEqual(fs.readFileSync(copied.sheets[id].path), fs.readFileSync(original.sheets[id].path));
  }
});
