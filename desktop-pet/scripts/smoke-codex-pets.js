// Source Electron only. Two launches share disposable settings; no installed App or Codex data is changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deflateSync } = require('node:zlib');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const output = process.env.PET_CODEX_PETS_QA_OUT;
assert.ok(output && path.isAbsolute(output), 'PET_CODEX_PETS_QA_OUT 必须指定绝对验收输出目录');
let electronBinary = process.env.PET_CODEX_PETS_QA_ELECTRON;
if (!electronBinary) {
  for (const directory of [root, path.resolve(root, '../custom-motion-editor'), path.resolve(root, '../..')]) {
    try { electronBinary = require(require.resolve('electron', { paths: [directory] })); break; } catch (_) {}
  }
}
assert.ok(typeof electronBinary === 'string' && fs.existsSync(electronBinary), '找不到本地 Electron；可指定 PET_CODEX_PETS_QA_ELECTRON');

function pngChunk(type, data) {
  const name = Buffer.from(type), payload = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, payload, checksum]);
}

function syntheticSheet() {
  const width = 1536, height = 2288, stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const column = Math.floor(x / 192), row = Math.floor(y / 208), offset = y * stride + 1 + x * 4;
    // A simple oval has transparent margins; each action/frame changes its color.
    const dx = (x % 192 - 96) / 60, dy = (y % 208 - 104) / 82;
    if (dx * dx + dy * dy > 1) continue;
    raw[offset] = 40 + column * 22; raw[offset + 1] = 80 + row * 12;
    raw[offset + 2] = 150; raw[offset + 3] = 255;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

async function run() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-codex-pets-'));
  const userData = path.join(temporary, 'user-data'), sourceRoot = path.join(temporary, 'source-pets');
  const stateFile = path.join(temporary, 'qa-state.json');
  fs.mkdirSync(userData); fs.mkdirSync(sourceRoot); fs.mkdirSync(output, { recursive: true });
  const sheet = syntheticSheet();
  for (let index = 1; index <= 30; index++) {
    const directory = path.join(sourceRoot, String(index).padStart(2, '0'));
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'sheet.png'), sheet);
    fs.writeFileSync(path.join(directory, 'pet.json'), JSON.stringify({
      displayName: `测试宠物 ${String(index).padStart(2, '0')}`, spriteVersionNumber: 2, spritesheetPath: 'sheet.png'
    }));
  }
  const launch = phase => new Promise((resolve, reject) => {
    const child = spawn(electronBinary, [`--user-data-dir=${userData}`, root], { cwd: root,
      env: { ...process.env, PET_SMOKE_TEST: '1', PET_SMOKE_CODEX_PETS_ONLY: '1',
        PET_CODEX_PETS_QA_SOURCE_ROOT: sourceRoot, PET_CODEX_PETS_QA_STATE: stateFile,
        PET_CODEX_PETS_QA_PHASE: phase, PET_CODEX_PETS_QA_OUT: output,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', data => { log += data; process.stdout.write(data); });
    child.stderr.on('data', data => { log += data; });
    const timer = setTimeout(() => child.kill('SIGTERM'), 120000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer); fs.writeFileSync(path.join(output, `source-${phase}.log`), log);
      try {
        assert.equal(code, 0, log); assert.match(log, /PET_USER_DATA_OK/);
        assert.ok(log.includes(`PET_CODEX_PETS_${phase.toUpperCase()}_OK`), log);
        assert.doesNotMatch(log, /Uncaught|ERR_FILE_NOT_FOUND|did-fail-load/i); resolve();
      } catch (error) { reject(error); }
    });
  });
  try {
    await launch('save');
    // The second process must restore from the imported copy after the source disappears.
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    await launch('restart');
    process.stdout.write('PET_CODEX_PETS_SMOKE_OK\n');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

run().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
