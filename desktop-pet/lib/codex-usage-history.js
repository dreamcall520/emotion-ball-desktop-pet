const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MAX_FILES = 96;
const MAX_BYTES = 64 * 1024 * 1024;
const TAIL_BYTES = 4 * 1024 * 1024;
const HEADER_BYTES = 64 * 1024;
const MAX_LINE_BYTES = 256 * 1024;
const MAX_SAMPLES = 12000;
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const parse = line => { try { return JSON.parse(line); } catch { return null; } };

// Read only actual quota observations, never derive quota from token counts.
// ponytail: bounded recent tails can recover partial history; stream older sections if complete history is later required.
async function readCodexUsageHistory({ accountId, windows, root = path.join(os.homedir(), '.codex'),
  now = Date.now(), io = fs.promises } = {}) {
  if (typeof accountId !== 'string' || !accountId || accountId.length > 200 || !validTime(now)) return [];
  const current = (Array.isArray(windows) ? windows : []).filter(window =>
    /^codex:(primary|secondary)$/.test(window?.id) && [300, 10080].includes(window.windowMinutes)
    && validTime(window.resetsAt) && window.resetsAt > now);
  if (!current.length) return [];
  const since = Math.min(...current.map(window => window.resetsAt - window.windowMinutes * 60000));
  const files = [];
  let inspected = 0;
  async function collect(directory, depth) {
    try {
      const stat = await io.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return;
      for (const entry of (await io.readdir(directory, { withFileTypes: true })).slice(0, 4096)) {
        if (entry.isSymbolicLink()) continue;
        const filename = path.join(directory, entry.name);
        if (depth && entry.isDirectory() && /^\d{2,4}$/.test(entry.name)) await collect(filename, depth - 1);
        else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name) && inspected++ < 6000) {
          const info = await io.lstat(filename);
          if (info.isFile() && !info.isSymbolicLink() && info.mtimeMs >= since && info.size > 0)
            files.push({ filename, modified: info.mtimeMs });
        }
      }
    } catch { /* Missing/unreadable logs must not block live quota. */ }
  }
  await collect(path.join(root, 'sessions'), 3);
  await collect(path.join(root, 'archived_sessions'), 0);
  files.sort((a, b) => b.modified - a.modified);
  const samples = [];
  let remainingBytes = MAX_BYTES;
  for (const { filename } of files.slice(0, MAX_FILES)) {
    if (remainingBytes <= 0 || samples.length >= MAX_SAMPLES) break;
    let handle;
    try {
      handle = await io.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 1) continue;
      const header = Buffer.alloc(Math.min(stat.size, HEADER_BYTES, remainingBytes));
      const firstRead = await handle.read(header, 0, header.length, 0);
      remainingBytes -= firstRead.bytesRead;
      const firstLine = header.subarray(0, firstRead.bytesRead).toString('utf8').split('\n')[0];
      const metadata = parse(firstLine);
      if (metadata?.type !== 'session_meta' || metadata.payload?.creator_account_id !== accountId) continue;
      const size = Math.min(stat.size, TAIL_BYTES, remainingBytes);
      if (size < 1) continue;
      const start = stat.size - size;
      const tail = Buffer.alloc(size);
      const read = await handle.read(tail, 0, size, start);
      remainingBytes -= read.bytesRead;
      let text = tail.subarray(0, read.bytesRead).toString('utf8');
      if (start > 0) text = text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : '';
      let owner = accountId;
      for (const line of text.split('\n')) {
        if (samples.length >= MAX_SAMPLES) break;
        if (Buffer.byteLength(line) > MAX_LINE_BYTES) { owner = null; continue; }
        if (!line.includes('"session_meta"') && !line.includes('"token_count"')) continue;
        const row = parse(line);
        if (row?.type === 'session_meta') { owner = row.payload?.creator_account_id; continue; }
        if (owner !== accountId || row?.type !== 'event_msg' || row.payload?.type !== 'token_count') continue;
        const limits = row.payload.rate_limits;
        if (limits?.limit_id !== 'codex' || typeof row.timestamp !== 'string' || row.timestamp.length > 64) continue;
        const at = Date.parse(row.timestamp);
        if (!validTime(at) || at > now) continue;
        for (const slot of ['primary', 'secondary']) {
          if (samples.length >= MAX_SAMPLES) break;
          const observed = limits[slot];
          if (!Number.isFinite(observed?.used_percent) || observed.used_percent < 0 || observed.used_percent > 100
            || !Number.isSafeInteger(observed.resets_at) || !validTime(observed.resets_at * 1000)) continue;
          const window = current.find(item => item.id === `codex:${slot}` && item.windowMinutes === observed.window_minutes
            && Math.abs(item.resetsAt - observed.resets_at * 1000) <= 1000);
          if (!window || at < window.resetsAt - window.windowMinutes * 60000) continue;
          samples.push({ at, id: window.id, windowMinutes: window.windowMinutes,
            resetsAt: window.resetsAt, remaining: 100 - observed.used_percent });
        }
      }
    } catch { /* A changing/truncated file is optional history, not a quota failure. */ }
    finally { if (handle) await handle.close().catch(() => {}); }
  }
  const unique = new Map();
  samples.sort((a, b) => a.at - b.at).forEach(sample => {
    const key = `${sample.id}:${sample.at}`;
    if (!unique.has(key)) unique.set(key, sample);
  });
  return [...unique.values()];
}

module.exports = { readCodexUsageHistory };
