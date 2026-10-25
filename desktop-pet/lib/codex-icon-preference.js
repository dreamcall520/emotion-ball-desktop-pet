const { execFile } = require('node:child_process');
const VALUES = new Set(['app-default', 'codex-system', 'space-system']);

function readCodexIconPreference({ signal, exec = execFile, platform = process.platform } = {}) {
  if (platform !== 'darwin') return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      exec('/usr/bin/defaults', ['read', 'com.openai.codex', 'DockIconPreference'],
        { encoding: 'utf8', timeout: 2000, maxBuffer: 256, signal }, (error, stdout) => {
          const value = !error && typeof stdout === 'string' && Buffer.byteLength(stdout) <= 256 ? stdout.trim() : null;
          resolve(VALUES.has(value) ? value : null);
        });
    } catch (_) { resolve(null); }
  });
}

function readCodexSystemDark({ signal, exec = execFile, platform = process.platform } = {}) {
  if (platform !== 'darwin') return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      exec('/usr/bin/defaults', ['read', '-g', 'AppleInterfaceStyle'],
        { encoding: 'utf8', timeout: 2000, maxBuffer: 256, signal }, (error, stdout, stderr) => {
          if (!error && typeof stdout === 'string' && Buffer.byteLength(stdout) <= 256) {
            const value = stdout.trim(); resolve(value === 'Dark' ? true : value === 'Light' ? false : null); return;
          }
          const missing = error?.code === 1 && !error.killed && typeof stderr === 'string' && Buffer.byteLength(stderr) <= 256 &&
            (/The domain\/default pair of \(kCFPreferencesAnyApplication, AppleInterfaceStyle\) does not exist/.test(stderr) ||
              stderr.trim() === "Error: Could not find key 'AppleInterfaceStyle' in domain 'kCFPreferencesAnyApplication'.");
          resolve(missing ? false : null);
        });
    } catch (_) { resolve(null); }
  });
}

function createCodexIconPreference({ read = readCodexIconPreference, readDark = readCodexSystemDark, onChange = () => {}, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let value = 'codex-system', dark = false, paused = true, closed = false, generation = 0, timer = null, pending = null, controller = null;
  function refresh() {
    if (closed || paused) return Promise.resolve(value);
    if (pending) return pending;
    const token = ++generation;
    const request = new AbortController(); controller = request;
    const task = Promise.resolve().then(() => closed || paused || token !== generation ? [null, null]
      : Promise.all([read({ signal: request.signal }), readDark({ signal: request.signal })])).then(([next, nextDark]) => {
      if (closed || paused || token !== generation) return;
      const changed = VALUES.has(next) && next !== value || typeof nextDark === 'boolean' && nextDark !== dark;
      if (VALUES.has(next)) value = next;
      if (typeof nextDark === 'boolean') dark = nextDark;
      if (changed) onChange(value, dark);
    }).catch(() => {}).finally(() => {
      if (pending === task) { pending = null; controller = null; }
      if (!closed && !paused && token === generation) timer = schedule(() => { timer = null; void refresh(); }, 5000);
    });
    pending = task;
    return task;
  }
  function pause() { paused = true; generation++; cancel(timer); timer = null; controller?.abort(); controller = null; pending = null; }
  return { getPreference: () => value, getSystemDark: () => dark,
    start() { if (closed || !paused) return pending || Promise.resolve(value); paused = false; return refresh(); },
    pause, close() { pause(); closed = true; }
  };
}
module.exports = { readCodexIconPreference, readCodexSystemDark, createCodexIconPreference };
