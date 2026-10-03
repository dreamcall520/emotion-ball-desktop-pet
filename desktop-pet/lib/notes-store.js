const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const M = require('./notes-model');

const MAX_BYTES = 4 * 1024 * 1024;
const emptyState = () => ({ schema: 1, revision: 0, notes: [], todos: [] });
const storageError = cause => Object.assign(new Error('便签与待办暂时无法保存，请检查本机存储后重试。', { cause }), { code: 'STORAGE' });

function createNotesStore(filePath, { fsImpl = fs, onError = () => {} } = {}) {
  let state = emptyState(), readError = null;
  const listeners = new Set();
  const report = error => { try { onError(error); } catch (_) {} };
  try {
    const stat = fsImpl.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw Error('记录文件格式或大小不合法');
    state = M.validate(JSON.parse(fsImpl.readFileSync(filePath, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      readError = '便签与待办读取失败。原文件已保留，请先导出原始数据，再决定是否重置。';
      report(error);
    }
  }

  function write(next) {
    const content = JSON.stringify(next);
    if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) throw Object.assign(new Error('记录超过 4 MiB，未保存；请先导出并整理内容。'), { code: 'LIMIT' });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    let fd;
    try {
      fsImpl.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
      fd = fsImpl.openSync(temporary, 'wx', 0o600);
      fsImpl.writeFileSync(fd, content, 'utf8');
      fsImpl.fsyncSync(fd);
      fsImpl.closeSync(fd); fd = undefined;
      fsImpl.renameSync(temporary, filePath);
    } catch (error) {
      if (fd !== undefined) { try { fsImpl.closeSync(fd); } catch (_) {} }
      try { fsImpl.unlinkSync(temporary); } catch (_) {}
      throw storageError(error);
    }
  }

  function publish(next) {
    state = next;
    for (const listener of listeners) {
      try { listener(M.copy(next)); } catch (error) { report(error); }
    }
    return M.copy(next);
  }

  function save(next, expectedRevision) {
    try {
      if (readError) throw Object.assign(new Error(readError), { code: 'READ_BLOCKED' });
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== state.revision) {
        throw Object.assign(new Error('记录已被另一窗口更新，请保留当前输入并重新载入最新记录。'), { code: 'CONFLICT' });
      }
      M.validate(next);
      const clean = M.validate({ ...M.copy(next), revision: state.revision + 1 });
      write(clean);
      return publish(clean);
    } catch (error) { report(error); throw error; }
  }

  return {
    getState: () => M.copy(state),
    getReadError: () => readError,
    subscribe(listener) {
      if (typeof listener !== 'function') throw TypeError('需要记录更新回调');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    save,
    update(fn) {
      if (typeof fn !== 'function') throw TypeError('需要记录更新函数');
      const revision = state.revision;
      return save(fn(M.copy(state)), revision);
    },
    reset() {
      try {
        const next = { ...emptyState(), revision: state.revision + 1 };
        write(next);
        readError = null;
        return publish(next);
      } catch (error) { report(error); throw error; }
    },
    exportRaw(destination) {
      if (path.resolve(destination) === path.resolve(filePath)) throw Error('请选择与原文件不同的导出位置');
      try {
        const stat = fsImpl.lstatSync(filePath);
        if (!stat.isFile() || stat.isSymbolicLink()) throw Error('原始记录不是普通文件');
        fsImpl.copyFileSync(filePath, destination, fs.constants.COPYFILE_EXCL);
        return destination;
      } catch (error) { report(error); throw error; }
    }
  };
}

module.exports = { createNotesStore, MAX_BYTES };
