'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const FILES = ['notes-todos.json', 'weather.json', 'weather.json.cache'];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const errorSources = () => ({
  todo: { state: 'error' }, weatherConfig: { state: 'error' }, weatherCache: { state: 'error' }
});
const TODO_FIELDS = ['id', 'title', 'dueDate', 'completed', 'archived', 'reminderAt', 'reminderState',
  'createdAt', 'updatedAt', 'occurrenceId', 'completedAt', 'deletedAt'];
function pick(value, keys) {
  return Object.fromEntries(keys.filter(key => Object.prototype.hasOwnProperty.call(value, key))
    .map(key => [key, value[key]]));
}
function projectSource(source, index) {
  if (source.state !== 'data') return source;
  const fields = index === 0 ? ['schema', 'revision', 'todos'] :
    index === 1 ? ['enabled', 'city'] : ['city', 'current', 'updatedAt', 'daily', 'timezone', 'utcOffsetSeconds'];
  const value = pick(source.value, fields);
  if (index === 0 && Array.isArray(value.todos)) {
    // Keep invalid row types/field values so the native validator can reject
    // them, but notes, note bodies and unused task fields never leave the app.
    value.todos = value.todos.map(row => row && typeof row === 'object' && !Array.isArray(row)
      ? pick(row, TODO_FIELDS) : row);
  }
  return { state: 'data', value };
}

// Open with O_NOFOLLOW as well as checking lstat: an atomic replacement must not
// turn a source file into a symlink between inspection and open.
async function readSource(filename) {
  let handle;
  try {
    const stat = await fs.promises.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) return { state: 'error' };
    handle = await fs.promises.open(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > MAX_FILE_BYTES) return { state: 'error' };
    const chunks = [];
    let size = 0;
    while (size <= MAX_FILE_BYTES) {
      const buffer = Buffer.alloc(Math.min(65536, MAX_FILE_BYTES + 1 - size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      chunks.push(buffer.subarray(0, bytesRead));
      size += bytesRead;
    }
    if (size > MAX_FILE_BYTES) return { state: 'error' };
    const value = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { state: 'error' };
    return { state: 'data', value };
  } catch (error) {
    return { state: error && error.code === 'ENOENT' ? 'missing' : 'error' };
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

/** Publish this profile's raw inputs to the signed, bundled App Group bridge.
 * The bridge owns validation, redaction, output files and WidgetKit reloads.
 * Optional dependencies are for isolated IO/process tests, never app settings.
 */
function createNativeWidgetSync(options = {}, dependencies = {}) {
  const platform = dependencies.platform ?? options.platform ?? process.platform;
  const release = dependencies.release ?? options.release ?? os.release();
  const noop = { start: async () => {}, refresh: async () => {}, dispose() {} };
  if (platform !== 'darwin' || !/^\d+\./.test(release) || Number(release.split('.')[0]) < 23 ||
      typeof options.userData !== 'string' || !options.userData ||
      typeof options.resourcesPath !== 'string' ||
      !/\.app\/Contents\/Resources\/?$/.test(options.resourcesPath)) return noop;

  const helperPath = path.resolve(options.resourcesPath, '../Helpers/QiuqiuWidgetBridge');
  const configPath = `${helperPath}.json`;
  const sourceRoot = path.resolve(options.userData);
  const spawnChild = dependencies.spawn || spawn;
  const watchDirectory = dependencies.watch || fs.watch;
  const debounceMs = dependencies.debounceMs ?? 400;
  const pollMs = dependencies.pollMs ?? 30000;
  const timeoutMs = Math.min(15000, Math.max(1, dependencies.helperTimeoutMs ?? 15000));
  let started = false;
  let disposed = false;
  let enabled = false;
  let starting;
  let busy = false;
  let dirty = false;
  let watcher;
  let watchedIdentity;
  let debounceTimer;
  let pollTimer;
  let active;
  let sourceID;
  let acknowledged;
  let waiters = [];

  function report(code) {
    if (disposed || typeof options.onError !== 'function') return;
    // Do not forward errors from fs or child_process: they contain source paths,
    // argv or possibly helper output. Only fixed, non-private metadata escapes.
    const error = new Error('Native widget synchronization failed');
    error.code = code;
    error.stack = `Error: Native widget synchronization failed (${code})`;
    try { options.onError(error); } catch (_) {}
  }

  function settle() {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  }

  function stopWatcher() {
    if (watcher) {
      try { watcher.close(); } catch (_) {}
    }
    watcher = undefined;
    watchedIdentity = undefined;
  }

  function changed() {
    if (disposed) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { void refresh(); }, debounceMs);
    debounceTimer.unref?.();
  }

  async function ensureWatcher() {
    try {
      const stat = await fs.promises.stat(sourceRoot);
      if (!stat.isDirectory() || disposed) return;
      const identity = `${stat.dev}:${stat.ino}`;
      if (watcher && identity === watchedIdentity) return;
      stopWatcher();
      const next = watchDirectory(sourceRoot, { persistent: false }, (_event, filename) => {
        if (filename == null || FILES.includes(filename.toString())) changed();
      });
      watcher = next;
      watchedIdentity = identity;
      next.on('error', () => {
        if (watcher === next) stopWatcher();
        // The fallback poll retries the watcher and publishes source errors.
      });
    } catch (_) {
      stopWatcher();
    }
  }

  async function packet() {
    let canonicalRoot;
    try {
      canonicalRoot = await fs.promises.realpath(sourceRoot);
      const stat = await fs.promises.stat(canonicalRoot);
      if (!stat.isDirectory()) throw new Error('not a directory');
      sourceID = hash(canonicalRoot);
    } catch (_) {
      return { schema: 1, sourceID: sourceID || hash(`unavailable\0${sourceRoot}`), ...errorSources() };
    }
    const values = (await Promise.all(FILES.map(name => readSource(path.join(canonicalRoot, name)))))
      .map(projectSource);
    return { schema: 1, sourceID, todo: values[0], weatherConfig: values[1], weatherCache: values[2] };
  }

  function publish(input) {
    return new Promise(resolve => {
      if (disposed) return resolve(false);
      let child;
      try {
        child = spawnChild(helperPath, ['--sync'], { shell: false, stdio: ['pipe', 'pipe', 'ignore'] });
      } catch (_) {
        report('HELPER_START');
        return resolve(false);
      }
      let done = false;
      let failure;
      let bytes = 0;
      const chunks = [];
      let timer;
      function finish(result) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (active?.child === child) active = undefined;
        if (!result && failure) report(failure);
        resolve(disposed ? false : result);
      }
      function kill(code) {
        failure = failure || code;
        try { child.kill('SIGKILL'); } catch (_) {}
      }
      active = { child, cancel() { kill('HELPER_CANCELLED'); finish(false); } };
      timer = setTimeout(() => kill('HELPER_TIMEOUT'), timeoutMs);
      timer.unref?.();
      child.on('error', () => {
        failure = failure || 'HELPER_START';
        if (!child.pid) finish(false);
      });
      child.stdout.on('data', chunk => {
        if (done || disposed) return;
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT_BYTES) return kill('HELPER_OUTPUT');
        chunks.push(chunk);
      });
      child.stdin.on('error', () => { failure = failure || 'HELPER_INPUT'; });
      child.on('close', code => {
        if (done) return;
        let result = false;
        if (!failure && code === 0) {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (parsed && !Array.isArray(parsed) && parsed.ok === true &&
                typeof parsed.state === 'string' && /^[a-z_-]{1,40}$/.test(parsed.state)) result = parsed;
          } catch (_) {}
        }
        if (!result) failure = failure || 'HELPER_RESULT';
        finish(result);
      });
      try { child.stdin.end(input); } catch (_) { kill('HELPER_INPUT'); }
    });
  }

  async function drain() {
    if (busy || disposed) return;
    busy = true;
    let attempted;
    try {
      while (dirty && !disposed) {
        dirty = false;
        await ensureWatcher();
        const value = await packet();
        if (disposed) break;
        let input;
        try {
          input = JSON.stringify(value);
          if (Buffer.byteLength(input) > MAX_INPUT_BYTES) throw new Error('input bound');
        } catch (_) {
          report('SOURCE_ENCODING');
          input = JSON.stringify({ schema: 1, sourceID: value.sourceID, ...errorSources() });
        }
        const fingerprint = hash(input);
        // macOS may deliver buffered directory events during the initial read.
        // One failed input is attempted once per drain; a later poll/refresh
        // still retries it because only successful publications are acknowledged.
        if (fingerprint !== acknowledged && fingerprint !== attempted) {
          attempted = fingerprint;
          const result = await publish(input);
          if (result && !disposed) {
            acknowledged = fingerprint;
            if (typeof options.onPublished === 'function') {
              try {
                // Publication has already succeeded. Callback failures must not
                // revoke the acknowledgement or make the helper rewrite data.
                const callback = options.onPublished(result);
                Promise.resolve(callback).catch(() => report('PUBLISHED_CALLBACK'));
              } catch (_) { report('PUBLISHED_CALLBACK'); }
            }
          }
        }
      }
    } catch (_) {
      report('SOURCE_READ');
    } finally {
      busy = false;
      if (dirty && !disposed) void drain();
      else settle();
    }
  }

  async function start() {
    if (disposed) return;
    if (started) return starting;
    started = true;
    starting = (async () => {
      try {
        const files = await Promise.all([helperPath, configPath].map(name => fs.promises.lstat(name)));
        if (disposed || files.some(stat => !stat.isFile() || stat.isSymbolicLink())) return;
        await fs.promises.access(helperPath, fs.constants.X_OK);
      } catch (_) { return; }
      if (disposed) return;
      enabled = true;
      pollTimer = setInterval(() => { void refresh(); }, pollMs);
      pollTimer.unref?.();
      await refresh();
    })();
    return starting;
  }

  function refresh() {
    if (!enabled || disposed) return Promise.resolve();
    dirty = true;
    const completed = new Promise(resolve => waiters.push(resolve));
    void drain();
    return completed;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    enabled = false;
    dirty = false;
    clearTimeout(debounceTimer);
    clearInterval(pollTimer);
    stopWatcher();
    active?.cancel();
    settle();
  }

  return { start, refresh, dispose };
}

module.exports = { createNativeWidgetSync };
