const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { deflateSync } = require('node:zlib');
const { createCodexPetStore, MAX_MANIFEST_BYTES, MAX_IMAGE_BYTES } = require('../lib/codex-pets');

function png(width, height, color = 0) {
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
    chunk('IDAT', deflateSync((()=>{const pixels=Buffer.alloc((width*4+1)*height,color);for(let y=0;y<height;y++)pixels[y*(width*4+1)]=0;return pixels})())), chunk('IEND', Buffer.alloc(0))]);
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

test('local directory import copies only validated data into an independent content-addressed store',async t=>{
 const f=fixture(t),folder=f.add('本地伙伴',{spriteVersionNumber:2});fs.writeFileSync(path.join(folder,'run.js'),'throw Error("never execute")');
 const localRoot=path.join(f.root,'private','local-pets');const local=createCodexPetStore({sourceRoot:localRoot,importRoot:localRoot,validateImport:async(pet,bytes)=>pet.rows===11&&bytes.equals(images[2])});
 const pet=await local.importDirectory(folder);assert.match(pet.id,/^codex-[a-f0-9]{64}$/);assert.deepEqual(fs.readdirSync(path.dirname(pet.spritesheetPath)).sort(),['pet.json','spritesheet.png']);
 assert.deepEqual(local.listImported().pets,[pet]);assert.deepEqual(f.store.listImported(),{pets:[],skipped:0});
 fs.rmSync(folder,{recursive:true});assert.deepEqual(local.getImported(pet.id),pet);assert.equal(fs.statSync(pet.spritesheetPath).mode&0o777,0o600);
});
test('local import rejects symlink, escapes, malformed and oversized resources before writing copies',t=>{
 const f=fixture(t),good=f.add('good'),localRoot=path.join(f.root,'local');const local=createCodexPetStore({sourceRoot:localRoot,importRoot:localRoot});
 const linked=path.join(f.root,'linked');fs.symlinkSync(good,linked);assert.throws(()=>local.importDirectory(linked));
 for(const [name,relative] of [['escape','../good/spritesheet.png'],['absolute',path.join(good,'spritesheet.png')]]){const root=f.add(name,{spritesheetPath:relative});assert.throws(()=>local.importDirectory(root));}
 const linkedImage=f.add('linked-image');fs.unlinkSync(path.join(linkedImage,'spritesheet.png'));fs.symlinkSync(path.join(good,'spritesheet.png'),path.join(linkedImage,'spritesheet.png'));assert.throws(()=>local.importDirectory(linkedImage));
 const broken=f.add('broken',{},Buffer.from('not an image'));assert.throws(()=>local.importDirectory(broken));
 const huge=f.add('huge');fs.truncateSync(path.join(huge,'spritesheet.png'),MAX_IMAGE_BYTES+1);assert.throws(()=>local.importDirectory(huge),{code:'LIMIT'});
 assert.equal(fs.existsSync(localRoot),false);
});
test('local image decoder validates captured immutable bytes before atomic publish, failures leave no partial imports',async t=>{
 const f=fixture(t),folder=f.add('captured'),localRoot=path.join(f.root,'local');let finish;
 const local=createCodexPetStore({sourceRoot:localRoot,importRoot:localRoot,validateImport:(_pet,bytes)=>{assert(bytes.equals(images[1]));return new Promise(resolve=>finish=resolve);}});
 const pending=local.importDirectory(folder);fs.writeFileSync(path.join(folder,'spritesheet.png'),Buffer.from('changed'));assert.equal(fs.existsSync(localRoot),false);finish(true);const pet=await pending;assert(fs.readFileSync(pet.spritesheetPath).equals(images[1]));
 const rejectRoot=path.join(f.root,'rejected'),failed=createCodexPetStore({sourceRoot:rejectRoot,importRoot:rejectRoot,validateImport:async()=>false});const good=f.add('reject');await assert.rejects(failed.importDirectory(good),{code:'INVALID_PET'});assert.equal(fs.existsSync(rejectRoot),false);
});

test('local content namespace keeps identical Codex/local artwork separate without changing existing Codex ids',t=>{
 const f=fixture(t),folder=f.add('same');const codex=f.store.importPet(f.store.list().pets[0].id),root=path.join(f.root,'local');const local=createCodexPetStore({namespace:'local',sourceRoot:root,importRoot:root});
 const pet=local.importDirectory(folder);assert.notEqual(pet.id,codex.id);assert.deepEqual(local.getImported(pet.id),pet);assert.deepEqual(f.store.getImported(codex.id),codex);assert.throws(()=>f.store.getImported(pet.id));assert.throws(()=>local.getImported(codex.id));
});
test('import cannot publish after its owning window session becomes invalid during decode',async t=>{
 const f=fixture(t),folder=f.add('late'),root=path.join(f.root,'local');let finish,active=true;
 const local=createCodexPetStore({namespace:'local',sourceRoot:root,importRoot:root,validateImport:()=>new Promise(resolve=>finish=resolve),canPublishImport:()=>active});
 const pending=local.importDirectory(folder);active=false;finish(true);await assert.rejects(pending,{code:'INVALID_PET'});assert.equal(fs.existsSync(root),false);
});

test('imports native 1x/2x/3x nine- and eleven-row atlases without changing manifest or image bytes', async t => {
  const f = fixture(t), localRoot = path.join(f.root, 'hd-local');
  const local = createCodexPetStore({ importRoot: localRoot, namespace: 'local',
    validateImport: (pet, bytes) => pet.spriteScale === bytes.readUInt32BE(16) / 1536 });
  for (const version of [1, 2]) for (const scale of [3, 2, 1]) {
    const rows = version === 1 ? 9 : 11;
    const image = png(1536 * scale, rows * 208 * scale);
    const folder = f.add(`native-${version}-${scale}`, { spriteVersionNumber: version }, image);
    const pet = await local.importDirectory(folder);
    assert.equal(pet.spriteScale, scale); assert.equal(pet.rows, rows);
    assert(fs.readFileSync(pet.spritesheetPath).equals(image));
    assert.deepEqual(local.getImported(pet.id), pet);
    assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(pet.spritesheetPath), 'pet.json'))).spriteScale, undefined);
  }
  assert.equal(local.listImported().pets.length, 6);
});

test('rejects fractional, excessive and inconsistent atlas scaling before invoking an image decoder', t => {
  let decoded = 0;
  const f = fixture(t, (_bytes, _ext, size) => { decoded++; return size; });
  for (const [width, height] of [[2304, 2808], [6144, 7488], [4608, 1872], [1536, 5616], [4608, 5615]]) {
    const folder = f.add(`invalid-${width}-${height}`, {}, png(width, height));
    assert.throws(() => f.store.importDirectory(folder), { code: 'INVALID_PET' });
  }
  assert.equal(decoded, 0);
});

test('native frame maps survive independent imports and reject unsafe or inconsistent ranges before copying', t => {
  const f = fixture(t), frameMap = { idle: { start: 0, count: 8, durations: Array(8).fill(150) },
    'run-right': { start: 8, count: 16, durations: Array(16).fill(75) },
    sleep: { start: 56, count: 16, durations: Array(16).fill(100) },
    wakeup: { start: 72, count: 8, durations: Array(8).fill(75), loop: false } };
  const folder = f.add('楚哥动作', { spriteVersionNumber: 2, frameMap });
  const pet = f.store.importDirectory(folder);
  assert.deepEqual(pet.frameMap['run-right'], { ...frameMap['run-right'], loop: true, flipX: false });
  assert.equal(pet.frameMap.wakeup.loop, false); assert.deepEqual(f.store.getImported(pet.id), pet);
  for (const entry of [{ ...frameMap.sleep, start: 80 }, { ...frameMap.sleep, durations: [100] }]) {
    const invalid = f.add(`bad-${entry.start}-${entry.durations.length}`, { spriteVersionNumber: 2, frameMap: { sleep: entry } });
    assert.throws(() => f.store.importDirectory(invalid), { code: 'INVALID_PET' });
  }
});

test('v3 bounded multi-sheet import validates every resource and preserves all animation frames', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-v3-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const folder=path.join(root,'source');fs.mkdirSync(folder);
  const entry=(sheet,start,count)=>({sheet,start,count,durations:Array(count).fill(100),loop:false});
  const frameMap=Object.fromEntries(['idle','run-right','run-left','wave','jump','fail','checking','waiting','running','sleep','wakeup'].map(id=>[id,entry('base',0,1)]));
  frameMap.wave=entry('motion',0,33);frameMap.tail=entry('motion',33,7);
  const raw={displayName:'楚哥',spriteVersionNumber:3,sheets:{base:{path:'base.png',rows:1},motion:{path:'motion.png',rows:5}},frameMap};
  fs.writeFileSync(path.join(folder,'base.png'),png(1536,208));fs.writeFileSync(path.join(folder,'motion.png'),png(1536,1040));
  const write=()=>fs.writeFileSync(path.join(folder,'pet.json'),JSON.stringify(raw));write();
  let decoded=0;const store=createCodexPetStore({namespace:'local',sourceRoot:folder,importRoot:path.join(root,'imports'),validateImport:()=>{decoded++;return true}});
  const pet=await store.importDirectory(folder);assert.equal(decoded,2);assert.equal(pet.version,3);assert.equal(pet.frameMap.wave.count,33);assert.equal(Object.keys(pet.sheets).length,2);
  assert(fs.existsSync(pet.sheets.motion.path));assert.equal(store.getImported(pet.id).frameMap.tail.count,7);
  fs.writeFileSync(path.join(folder,'motion.png'),png(1536,1040,1));
  const changedPet=await store.importDirectory(folder);assert.notEqual(changedPet.id,pet.id,'every resource contributes to imported identity');
  raw.sheets.motion.path='BASE.png';write();await assert.rejects(async()=>store.importDirectory(folder));
  raw.sheets.motion.path='pet.json';write();await assert.rejects(async()=>store.importDirectory(folder));
  raw.sheets.motion.path='motion.png';
  raw.sheets.motion.rows=6;write();await assert.rejects(async()=>store.importDirectory(folder));
  raw.sheets.motion.rows=5;raw.frameMap.tail.count=8;raw.frameMap.tail.durations=Array(8).fill(100);write();await assert.rejects(async()=>store.importDirectory(folder));
  raw.frameMap.tail.count=7;raw.frameMap.tail.durations=Array(7).fill(100);raw.sheets.motion.path='../escape.png';write();await assert.rejects(async()=>store.importDirectory(folder));
});

test('generic variation survives independent imports while malformed nested data is rejected for every supported format',t=>{
 const f=fixture(t),variation={initialDelayMs:[1000,3000],intervalMs:[45000,75000],clips:[{start:8,count:8,durations:Array(8).fill(375)},{start:16,count:8,durations:Array(8).fill(375)},{start:24,count:8,durations:Array(8).fill(375)}]};
 for(const version of [1,2]){const dir=f.add('var-'+version,{spriteVersionNumber:version,frameMap:{sleep:{start:0,count:8,durations:Array(8).fill(400),variation}}});const pet=f.store.importDirectory(dir);assert.deepEqual(pet.frameMap.sleep.variation,variation);assert.deepEqual(f.store.getImported(pet.id).frameMap.sleep.variation,variation);const raw=JSON.parse(fs.readFileSync(path.join(dir,'pet.json')));raw.frameMap.sleep.variation.clips[0].path='../escape';fs.writeFileSync(path.join(dir,'pet.json'),JSON.stringify(raw));assert.throws(()=>f.store.importDirectory(dir),{code:'INVALID_PET'})}
 const dir=path.join(f.sourceRoot,'var-3');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'base.png'),png(1536,832));const frameMap=Object.fromEntries(['idle','run-right','run-left','wave','jump','fail','checking','waiting','running','sleep','wakeup'].map(id=>[id,{sheet:'base',start:0,count:8,durations:Array(8).fill(400)}]));frameMap.sleep.variation=variation;const raw={displayName:'generic',spriteVersionNumber:3,sheets:{base:{path:'base.png',rows:4}},frameMap};fs.writeFileSync(path.join(dir,'pet.json'),JSON.stringify(raw));const pet=f.store.importDirectory(dir);assert.deepEqual(pet.frameMap.sleep.variation,variation);raw.frameMap.sleep.variation.clips[2].start=32;fs.writeFileSync(path.join(dir,'pet.json'),JSON.stringify(raw));assert.throws(()=>f.store.importDirectory(dir),{code:'INVALID_PET'});
});
