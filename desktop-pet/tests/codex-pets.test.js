const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { deflateSync } = require('node:zlib');
const { createCodexPetStore, MAX_MANIFEST_BYTES, MAX_IMAGE_BYTES } = require('../lib/codex-pets');

function png(width, height) {
  const chunk = (name, bytes) => {
    const type = Buffer.from(name), data = Buffer.concat([type, bytes]);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}

const images = { 1: png(1536, 1872), 2: png(1536, 2288) };
function fixture(t, readImageSize) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-codex-pets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'pets'), importRoot = path.join(root, 'private', 'codex-pets');
  fs.mkdirSync(sourceRoot);
  const add = (folder, overrides = {}, image = images[overrides.spriteVersionNumber || 1]) => {
    const dir = path.join(sourceRoot, folder);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify({ id: folder, displayName: folder, description: '', spritesheetPath: 'spritesheet.png', ...overrides }));
    fs.writeFileSync(path.join(dir, 'spritesheet.png'), image);
    return dir;
  };
  return { root, sourceRoot, importRoot, add, store: createCodexPetStore({ sourceRoot, importRoot, readImageSize }) };
}

test('读取两版精灵图，导入原子副本可重读且不依赖 Codex 来源', t => {
  const { sourceRoot, importRoot, add, store } = fixture(t);
  add('旧版'); add('春野', { displayName: '春野', description: '测试宠物', spriteVersionNumber: 2 });
  const { pets, skipped } = store.list();
  assert.equal(skipped, 0); assert.equal(pets.length, 2);
  assert.deepEqual(pets.map(pet => [pet.version, pet.rows]).sort(), [[1, 9], [2, 11]]);
  const source = pets.find(pet => pet.name === '春野');
  assert.match(source.id, /^codex-[a-f0-9]{64}$/);
  assert.match(source.importedId, /^codex-[a-f0-9]{64}$/);
  assert.deepEqual(store.resolve(source.id), source);
  const imported = store.importPet(source.id);
  assert.notEqual(imported.id, source.id);
  assert.equal(imported.id, source.importedId); assert.equal(imported.importedId, imported.id);
  assert.equal(imported.name, '春野'); assert.equal(imported.description, '测试宠物');
  assert.equal(fs.statSync(imported.spritesheetPath).mode & 0o777, 0o600);
  assert.deepEqual(store.importPet(source.id), imported);
  assert.deepEqual(fs.readdirSync(importRoot), [imported.id]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(importRoot, imported.id, 'pet.json'), 'utf8')).spriteVersionNumber, 2);
  const sourceManifest = path.join(path.dirname(source.spritesheetPath), 'pet.json');
  const updated = JSON.parse(fs.readFileSync(sourceManifest, 'utf8'));
  fs.writeFileSync(sourceManifest, JSON.stringify({ ...updated, description: '更新后的副本' }));
  const newer = store.importPet(source.id);
  assert.notEqual(newer.id, imported.id); assert.equal(newer.description, '更新后的副本');
  assert.deepEqual(store.getImported(imported.id), imported);
  fs.rmSync(sourceRoot, { recursive: true });
  const reopened = createCodexPetStore({ sourceRoot, importRoot });
  assert.deepEqual(reopened.getImported(imported.id), imported);
  assert.deepEqual(reopened.resolve(imported.id, { imported: true }), imported);
  const library = reopened.listImported();
  assert.equal(library.skipped, 0);
  assert.deepEqual(library.pets.sort((a, b) => a.id.localeCompare(b.id)), [imported, newer].sort((a, b) => a.id.localeCompare(b.id)));
  assert.deepEqual(reopened.list(), { pets: [], skipped: 0 });
  assert.throws(() => reopened.resolve(source.id), { code: 'NOT_FOUND' });
});

test('坏元数据、未知版本、尺寸不符和越界资源逐项跳过', t => {
  const { root, add, store } = fixture(t);
  add('有效');
  const broken = add('坏 JSON'); fs.writeFileSync(path.join(broken, 'pet.json'), '{');
  add('未知版本', { spriteVersionNumber: 3 }, images[2]);
  add('尺寸错误', { spriteVersionNumber: 2 }, images[1]);
  add('空名称', { displayName: '  ' });
  fs.writeFileSync(path.join(root, 'outside.png'), images[1]);
  add('越界', { spritesheetPath: '../outside.png' });
  add('绝对路径', { spritesheetPath: path.join(root, 'outside.png') });
  add('损坏图片', {}, images[1].subarray(0, 40));
  assert.equal(store.list().pets.length, 1); assert.equal(store.list().skipped, 7);
  assert.throws(() => store.resolve('../outside.png'), { code: 'INVALID_PET' });
  assert.throws(() => store.getImported('/tmp/pet'), { code: 'INVALID_PET' });
});

test('拒绝目录、元数据和图片的符号链接及非正规文件', t => {
  const { sourceRoot, root, add, store } = fixture(t);
  const good = add('有效');
  fs.symlinkSync(good, path.join(sourceRoot, '目录链接'));
  const jsonLink = add('JSON 链接'); fs.unlinkSync(path.join(jsonLink, 'pet.json'));
  fs.symlinkSync(path.join(good, 'pet.json'), path.join(jsonLink, 'pet.json'));
  const imageLink = add('图片链接'); fs.unlinkSync(path.join(imageLink, 'spritesheet.png'));
  fs.symlinkSync(path.join(good, 'spritesheet.png'), path.join(imageLink, 'spritesheet.png'));
  const nested = add('中间目录链接', { spritesheetPath: 'linked/spritesheet.png' });
  fs.symlinkSync(good, path.join(nested, 'linked'));
  const nonFile = add('非正规资源'); fs.unlinkSync(path.join(nonFile, 'spritesheet.png')); fs.mkdirSync(path.join(nonFile, 'spritesheet.png'));
  assert.equal(store.list().pets.length, 1); assert.equal(store.list().skipped, 5);
  const linkedRoot = path.join(root, 'linked-source'); fs.symlinkSync(sourceRoot, linkedRoot);
  assert.throws(() => createCodexPetStore({ sourceRoot: linkedRoot, importRoot: path.join(root, 'unused') }).list(), { code: 'INVALID_PET' });
  const imported = store.importPet(store.list().pets[0].id);
  fs.renameSync(path.dirname(imported.spritesheetPath), path.join(root, 'moved'));
  fs.symlinkSync(path.join(root, 'moved'), path.dirname(imported.spritesheetPath));
  assert.throws(() => store.getImported(imported.id), { code: 'INVALID_PET' });
  assert.deepEqual(store.listImported(), { pets: [], skipped: 1 });
});

test('资源大小限额、解码失败和导入副本篡改不会被接受', t => {
  const { add, store } = fixture(t, buffer => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }));
  add('有效');
  const bigJson = add('超限 JSON'); fs.writeFileSync(path.join(bigJson, 'pet.json'), ' '.repeat(MAX_MANIFEST_BYTES + 1));
  const bigImage = add('超限图片'); fs.truncateSync(path.join(bigImage, 'spritesheet.png'), MAX_IMAGE_BYTES + 1);
  assert.equal(store.list().skipped, 2);
  const source = store.list().pets[0];
  const imported = store.importPet(source.id);
  const manifestPath = path.join(path.dirname(imported.spritesheetPath), 'pet.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, displayName: '被篡改' }));
  assert.throws(() => store.getImported(imported.id), { code: 'INVALID_PET' });
  assert.deepEqual(store.listImported(), { pets: [], skipped: 1 });
  const failedDecoder = createCodexPetStore({ sourceRoot: path.dirname(path.dirname(source.spritesheetPath)), importRoot: path.dirname(path.dirname(imported.spritesheetPath)), readImageSize: () => ({ width: 0, height: 0 }) });
  assert.equal(failedDecoder.list().pets.length, 0);
});

test('WebP 支持 VP8L、VP8 和 VP8X 尺寸头，损坏块与动画拒绝', t => {
  const decoded = [];
  const { add, store } = fixture(t, (buffer, extension, size) => {
    decoded.push({ extension, size });
    return extension === '.webp' ? size : { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  });
  const chunk = (type, data) => { const length = Buffer.alloc(4); length.writeUInt32LE(data.length); return Buffer.concat([Buffer.from(type), length, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
  const webp = chunks => { const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]), size = Buffer.alloc(4); size.writeUInt32LE(body.length); return Buffer.concat([Buffer.from('RIFF'), size, body]); };
  const lossless = Buffer.alloc(5); lossless[0] = 0x2f; lossless.writeUInt32LE((1535 | (2287 << 14)) >>> 0, 1);
  const lossy = Buffer.alloc(10); Buffer.from([0x9d, 0x01, 0x2a]).copy(lossy, 3); lossy.writeUInt16LE(1536, 6); lossy.writeUInt16LE(2288, 8);
  const extended = Buffer.alloc(10); extended.writeUIntLE(1535, 4, 3); extended.writeUIntLE(2287, 7, 3);
  for (const [name, image] of [['无损', webp([chunk('VP8L', lossless)])], ['有损', webp([chunk('VP8 ', lossy)])], ['扩展', webp([chunk('VP8X', extended), chunk('VP8L', lossless)])]]) {
    const root = add(name, { spriteVersionNumber: 2, spritesheetPath: 'spritesheet.webp' }); fs.renameSync(path.join(root, 'spritesheet.png'), path.join(root, 'spritesheet.webp')); fs.writeFileSync(path.join(root, 'spritesheet.webp'), image);
  }
  const animated = Buffer.from(extended); animated[0] = 2;
  const dir = add('动画', { spriteVersionNumber: 2, spritesheetPath: 'spritesheet.webp' }); fs.writeFileSync(path.join(dir, 'spritesheet.webp'), webp([chunk('VP8X', animated), chunk('VP8L', lossless)]));
  const broken = add('损坏 WebP', { spriteVersionNumber: 2, spritesheetPath: 'spritesheet.webp' }); fs.writeFileSync(path.join(broken, 'spritesheet.webp'), webp([chunk('VP8L', lossless)]).subarray(0, 23));
  const result = store.list();
  assert.equal(result.pets.length, 3); assert.equal(result.skipped, 2);
  assert.deepEqual(decoded, Array.from({ length: 3 }, () => ({ extension: '.webp', size: { width: 1536, height: 2288 } })));
  add('PNG', { spriteVersionNumber: 2 });
  assert.equal(store.list().pets.length, 4);
  assert.ok(decoded.some(item => item.extension === '.png' && item.size.width === 1536 && item.size.height === 2288));
});

test('遵守 CODEX_HOME，根目录缺失为空但权限错误可以重试', t => {
  const { root, sourceRoot, importRoot, add } = fixture(t);
  add('有效');
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = root;
  t.after(() => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; });
  assert.equal(createCodexPetStore({ importRoot }).list().pets.length, 1);
  assert.deepEqual(createCodexPetStore({ importRoot }).listImported(), { pets: [], skipped: 0 });
  if (process.getuid?.() !== 0) {
    fs.chmodSync(sourceRoot, 0);
    try { assert.throws(() => createCodexPetStore({ sourceRoot, importRoot }).list(), { code: 'EACCES' }); }
    finally { fs.chmodSync(sourceRoot, 0o700); }
  }
  fs.rmSync(sourceRoot, { recursive: true });
  assert.deepEqual(createCodexPetStore({ importRoot }).list(), { pets: [], skipped: 0 });
});

test('副本库逐项验证内容编号，坏副本跳过且权限错误保留重试', t => {
  const { add, importRoot, store } = fixture(t);
  add('有效');
  const imported = store.importPet(store.list().pets[0].id);
  fs.mkdirSync(path.join(importRoot, '.import-unfinished'));
  fs.mkdirSync(path.join(importRoot, 'bad-id'));
  fs.mkdirSync(path.join(importRoot, `codex-${'0'.repeat(64)}`));
  fs.symlinkSync(path.dirname(imported.spritesheetPath), path.join(importRoot, `codex-${'1'.repeat(64)}`));
  assert.deepEqual(store.listImported(), { pets: [imported], skipped: 3 });
  if (process.getuid?.() !== 0) {
    fs.chmodSync(importRoot, 0);
    try { assert.throws(() => store.listImported(), { code: 'EACCES' }); }
    finally { fs.chmodSync(importRoot, 0o700); }
  }
});
