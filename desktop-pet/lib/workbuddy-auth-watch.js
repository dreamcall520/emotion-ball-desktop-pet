const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Watch the directory so replacing the credential file atomically keeps working.
// No token contents are read, copied, logged or changed by this subscription.
function watchWorkBuddyAuth(onChange, { watch = fs.watch, stat = fs.statSync,
  authFile = path.join(os.homedir(), 'Library/Application Support/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info') } = {}) {
  const targetDirectory = path.dirname(authFile), name = path.basename(authFile);
  let watcher = null, closed = false, generation = 0;
  function attach(start = targetDirectory) {
    generation++;
    watcher?.close(); watcher = null;
    if (closed) return;
    let directory = start;
    while (true) {
      try {
        if (!stat(directory).isDirectory()) throw Error();
        const current = generation;
        const targetName = directory === targetDirectory ? null : path.relative(directory, targetDirectory).split(path.sep)[0];
        const candidate = watch(directory, { persistent: false }, (event, filename) => {
          if (closed || current !== generation) return;
          const changed = filename === null || filename === undefined ? null : String(filename);
          if (targetName ? changed !== null && changed !== targetName
            : changed !== null && ![name, `${name}.logged-out`, path.basename(directory)].includes(changed)) return;
          if (targetName || event === 'rename') attach();
          if (!closed) onChange();
        });
        watcher = candidate;
        candidate.on?.('error', () => {
          if (!closed && current === generation) attach(path.dirname(directory));
        });
        candidate.unref?.();
        return;
      } catch (_) {
        const parent = path.dirname(directory);
        if (parent === directory) return;
        directory = parent;
      }
    }
  }
  attach();
  return () => { closed = true; generation++; watcher?.close(); watcher = null; };
}
module.exports = { watchWorkBuddyAuth };
