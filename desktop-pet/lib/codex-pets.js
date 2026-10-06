const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const validId = id => typeof id === 'string' && /^codex-[a-f0-9]{64}$/.test(id);
const fail = (message, code = 'INVALID_PET') => Object.assign(new Error(message), { code });
const digest = (...buffers) => `codex-${buffers.reduce((hash, buffer) => hash.update(buffer), createHash('sha256')).digest('hex')}`;

function directory(root) {
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('宠物目录不是普通目录');
  return fs.realpathSync(root);
}

function containedFile(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.length > 1024 ||
      path.isAbsolute(relative) || relative.includes('\\') || relative.includes('\0') ||
      relative.split('/').some(part => !part || part === '.' || part === '..')) throw fail('宠物文件路径不合法');
  const canonicalRoot = directory(root);
  let file = root;
  for (const part of relative.split('/')) {
    file = path.join(file, part);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw fail('宠物文件不能使用符号链接');
    if (file !== path.join(root, relative) && !stat.isDirectory()) throw fail('宠物文件路径不合法');
  }
  const resolved = fs.realpathSync(file);
  if (!resolved.startsWith(`${canonicalRoot}${path.sep}`)) throw fail('宠物文件超出目录');
  return { file: resolved, stat: fs.lstatSync(resolved) };
}

function readFile(root, relative, limit) {
  const { file, stat } = containedFile(root, relative);
  if (!stat.isFile() || stat.isSymbolicLink()) throw fail('宠物资源不是普通文件');
  if (!stat.size || stat.size > limit) throw fail('宠物资源超过大小限制或为空', 'LIMIT');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.ino !== stat.ino || before.dev !== stat.dev || before.size !== stat.size) throw fail('宠物资源在读取期间发生变化');
    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!count) throw fail('宠物资源不完整');
      offset += count;
    }
    const after = fs.fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw fail('宠物资源在读取期间发生变化');
    return { buffer, file };
  } finally { fs.closeSync(fd); }
}

function imageSize(buffer, extension) {
  if (extension === '.png') {
    if (buffer.length < 45 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw fail('PNG 图片头不合法');
    let offset = 8, size, hasData = false, ended = false;
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8);
      if (length > buffer.length - offset - 12) throw fail('PNG 图片数据不完整');
      if (offset === 8) {
        if (type !== 'IHDR' || length !== 13) throw fail('PNG 图片尺寸不合法');
        size = { width: buffer.readUInt32BE(offset + 8), height: buffer.readUInt32BE(offset + 12) };
      } else if (type === 'IHDR' || type === 'acTL') throw fail('需要静态 PNG 精灵图');
      if (type === 'IDAT' && length > 0) hasData = true;
      offset += length + 12;
      if (type === 'IEND') {
        if (length !== 0 || offset !== buffer.length) throw fail('PNG 图片结尾不合法');
        ended = true; break;
      }
    }
    if (!size || !hasData || !ended) throw fail('PNG 图片数据不完整');
    return size;
  }
  if (extension !== '.webp' || buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'RIFF' ||
      buffer.toString('ascii', 8, 12) !== 'WEBP' || buffer.readUInt32LE(4) + 8 !== buffer.length) throw fail('WebP 图片头不合法');
  let offset = 12, size, frameSize;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4), length = buffer.readUInt32LE(offset + 4), start = offset + 8;
    if (length > buffer.length - start) throw fail('WebP 图片数据不完整');
    if (type === 'VP8X') {
      if (length !== 10 || (buffer[start] & 2)) throw fail('需要静态 WebP 精灵图');
      size = { width: buffer.readUIntLE(start + 4, 3) + 1, height: buffer.readUIntLE(start + 7, 3) + 1 };
    } else if (type === 'VP8L') {
      if (length < 5 || buffer[start] !== 0x2f) throw fail('WebP 无损图片头不合法');
      const bits = buffer.readUInt32LE(start + 1);
      frameSize = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    } else if (type === 'VP8 ') {
      if (length < 10 || (buffer[start] & 1) || !buffer.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) throw fail('WebP 图片帧头不合法');
      frameSize = { width: buffer.readUInt16LE(start + 6) & 0x3fff, height: buffer.readUInt16LE(start + 8) & 0x3fff };
    } else if (type === 'ANIM' || type === 'ANMF') throw fail('需要静态 WebP 精灵图');
    offset = start + length + (length & 1);
  }
  if (offset !== buffer.length || !frameSize || (size && (size.width !== frameSize.width || size.height !== frameSize.height))) throw fail('WebP 图片数据不完整或尺寸不一致');
  return size || frameSize;
}

function createCodexPetStore({ sourceRoot = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'pets'), importRoot, readImageSize } = {}) {
  if (typeof sourceRoot !== 'string' || !sourceRoot || typeof importRoot !== 'string' || !importRoot ||
      (readImageSize !== undefined && typeof readImageSize !== 'function')) throw TypeError('需要有效的宠物目录和图片解码器');
  sourceRoot = path.resolve(sourceRoot); importRoot = path.resolve(importRoot);

  function readPet(root, id) {
    const manifest = readFile(root, 'pet.json', MAX_MANIFEST_BYTES);
    let raw;
    try { raw = JSON.parse(manifest.buffer.toString('utf8')); } catch (_) { throw fail('宠物元数据不是有效 JSON'); }
    if (!raw || Array.isArray(raw) || typeof raw !== 'object' || typeof raw.displayName !== 'string' ||
        !raw.displayName.trim() || raw.displayName.length > 120 ||
        (raw.description !== undefined && (typeof raw.description !== 'string' || raw.description.length > 4000))) throw fail('宠物名称或描述不合法');
    const version = raw.spriteVersionNumber === undefined ? 1 : raw.spriteVersionNumber;
    if (version !== 1 && version !== 2) throw fail('宠物精灵图版本暂不支持');
    const image = readFile(root, raw.spritesheetPath, MAX_IMAGE_BYTES);
    const extension = path.extname(raw.spritesheetPath).toLowerCase();
    const size = imageSize(image.buffer, extension);
    const rows = version === 1 ? 9 : 11;
    if (size.width !== 1536 || size.height !== rows * 208) throw fail('宠物精灵图尺寸不合法');
    const decoded = readImageSize ? readImageSize(image.buffer, extension, { ...size }) : size;
    if (!decoded || decoded.width !== size.width || decoded.height !== size.height) throw fail('宠物图片解码结果不合法');
    return { descriptor: { id, importedId: digest(manifest.buffer, image.buffer), name: raw.displayName.trim(), description: raw.description || '', version, rows, spritesheetPath: image.file }, manifest, image, raw };
  }

  function entries(root) {
    try { directory(root); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return fs.readdirSync(root, { withFileTypes: true });
  }

  function getImported(id) {
    if (!validId(id)) throw fail('宠物编号不合法');
    directory(importRoot);
    const root = path.join(importRoot, id);
    containedFile(importRoot, `${id}/pet.json`);
    const pet = readPet(root, id);
    if (pet.descriptor.importedId !== id) throw fail('已导入宠物的数据发生变化');
    return pet.descriptor;
  }

  function readSource(id) {
    if (!validId(id)) throw fail('宠物编号不合法');
    const entry = entries(sourceRoot).find(item => digest(path.join(sourceRoot, item.name)) === id);
    if (!entry || !entry.isDirectory() || entry.isSymbolicLink()) throw fail('没有找到该 Codex 宠物', 'NOT_FOUND');
    return readPet(path.join(sourceRoot, entry.name), id);
  }

  function resolve(id, { imported = false } = {}) {
    return imported ? getImported(id) : readSource(id).descriptor;
  }

  return {
    list() {
      const pets = []; let skipped = 0;
      for (const entry of entries(sourceRoot)) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const root = path.join(sourceRoot, entry.name);
        try {
          if (entry.isSymbolicLink()) throw fail('宠物目录不能使用符号链接');
          pets.push(readPet(root, digest(root)).descriptor);
        } catch (_) { skipped += 1; }
      }
      pets.sort((a, b) => a.name.localeCompare(b.name));
      return { pets, skipped };
    },
    listImported() {
      const pets = []; let skipped = 0;
      for (const entry of entries(importRoot)) {
        if (entry.name.startsWith('.import-')) continue;
        try {
          if (!entry.isDirectory() || entry.isSymbolicLink() || !validId(entry.name)) throw fail('已导入宠物目录不合法');
          pets.push(getImported(entry.name));
        } catch (_) { skipped += 1; }
      }
      pets.sort((a, b) => a.name.localeCompare(b.name));
      return { pets, skipped };
    },
    resolve,
    getImported,
    importPet(sourceId) {
      const pet = readSource(sourceId);
      const id = pet.descriptor.importedId;
      fs.mkdirSync(importRoot, { recursive: true, mode: 0o700 });
      directory(importRoot);
      const destination = path.join(importRoot, id);
      if (fs.existsSync(destination)) return getImported(id);
      const temporary = path.join(importRoot, `.import-${randomUUID()}`);
      fs.mkdirSync(temporary, { mode: 0o700 });
      try {
        const imageFile = path.join(temporary, pet.raw.spritesheetPath);
        fs.mkdirSync(path.dirname(imageFile), { recursive: true, mode: 0o700 });
        for (const [file, buffer] of [[path.join(temporary, 'pet.json'), pet.manifest.buffer], [imageFile, pet.image.buffer]]) {
          const fd = fs.openSync(file, 'wx', 0o600);
          try { fs.writeFileSync(fd, buffer); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        }
        try { fs.renameSync(temporary, destination); }
        catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
        return getImported(id);
      } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
    }
  };
}

module.exports = { createCodexPetStore, MAX_MANIFEST_BYTES, MAX_IMAGE_BYTES };
