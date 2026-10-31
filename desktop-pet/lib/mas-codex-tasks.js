'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SOURCE = 'codex-session-log';
const SOURCES = new Set(['cli', 'vscode', 'exec', 'appServer', 'api']);
const THREAD_SOURCES = new Set([...SOURCES, 'user', 'agent_created_thread', 'agent_forked_thread']);
const EVENT_STATES = new Map([['task_started', 'active'], ['task_complete', 'completed'], ['turn_aborted', 'interrupted']]);
const isId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const fail = code => Object.assign(new Error(code), { code });
const bound = (value, fallback, low, high) => Number.isSafeInteger(value) ? Math.max(low, Math.min(high, value)) : fallback;
function timestamp(value) {
  const at = typeof value === 'string' ? Date.parse(value) : typeof value === 'number' ? value < 1e12 ? value * 1000 : value : NaN;
  return Number.isSafeInteger(at) && at >= 0 && at <= 8640000000000000 ? at : null;
}
function safeTitle(value) {
  if (typeof value !== 'string') return 'Codex 任务';
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]').replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g, '[已隐藏]')
    .replace(/\s+/g, ' ').trim().slice(0, 140) || 'Codex 任务';
}
function parse(line, limit) {
  if (!line || Buffer.byteLength(line) > limit) return null;
  try { return JSON.parse(line); } catch (_) { return null; }
}
function metadataFrom(head, maxLineBytes) {
  const end = head.indexOf('\n');
  if (end < 0) return null;
  const record = parse(head.slice(0, end), maxLineBytes);
  const data = record?.type === 'session_meta' ? record.payload : null;
  if (!data || !isId(data.id) || !SOURCES.has(data.source) || data.parent_thread_id != null || data.parentThreadId != null ||
      typeof data.cwd !== 'string' || !path.isAbsolute(data.cwd) ||
      (data.thread_source ?? data.threadSource) != null && !THREAD_SOURCES.has(data.thread_source ?? data.threadSource)) return null;
  return { id: data.id, cwd: data.cwd, source: data.source, threadSource: data.thread_source ?? data.threadSource,
    name: safeTitle(data.title || data.name), parentThreadId: null };
}
function project(metadata, lines, now, activeMaxAgeMs, maxLineBytes) {
  const events = [];
  const activityEvents = new Set(['agent_reasoning', 'agent_message', 'exec_command_begin', 'exec_command_end',
    'mcp_tool_call_begin', 'mcp_tool_call_end']);
  const activityItems = new Set(['reasoning', 'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output']);
  let contextTurnId = null;
  for (const line of lines) {
    // A gap may hide a new turn or a completion. Never inherit untagged activity across it.
    if (line === null) { contextTurnId = null; continue; }
    const record = parse(line, maxLineBytes), payload = record?.payload;
    if (!payload) continue;
    if (record.type === 'turn_context') {
      contextTurnId = isId(payload.turn_id) ? payload.turn_id : null;
      continue;
    }
    if (record.type === 'event_msg' && EVENT_STATES.has(payload.type)) {
      const at = timestamp(record.timestamp) ?? timestamp(payload.type === 'task_started' ? payload.started_at : payload.completed_at);
      if (at === null || at > now) continue;
      const turnId = isId(payload.turn_id) ? payload.turn_id : null;
      events.push({ type: payload.type, state: EVENT_STATES.get(payload.type), at,
        startedAt: payload.type === 'task_started' ? at : timestamp(payload.started_at), turnId });
      if (payload.type === 'task_started' || !turnId || turnId === contextTurnId) contextTurnId = null;
      continue;
    }
    const activity = record.type === 'event_msg' && activityEvents.has(payload.type) ||
      record.type === 'response_item' && activityItems.has(payload.type);
    if (!activity) continue; // User messages and tool error text cannot start or fail a turn.
    const turnId = isId(payload.turn_id) ? payload.turn_id : contextTurnId;
    const at = timestamp(record.timestamp);
    if (turnId && at !== null && at <= now) events.push({ type: 'activity', turnId, at });
  }
  events.sort((a, b) => a.at - b.at || Number(a.state !== 'active') - Number(b.state !== 'active'));
  const turns = new Map(); let currentTurnId = null;
  for (const event of events) {
    const id = event.turnId || (event.type === 'turn_aborted' ? currentTurnId : null);
    if (!id) continue;
    const before = turns.get(id);
    if (event.type === 'activity') {
      // Activity refreshes an already-open turn only. It never creates or reopens one.
      if (before?.state === 'active' && before.startedAt !== null && event.at >= before.at) {
        turns.set(id, { ...before, at: event.at });
      }
      continue;
    }
    // A duplicate/delayed start for the same terminal turn must not resurrect it.
    if (before && before.state !== 'active' && event.state === 'active') continue;
    const startedAt = before?.startedAt ?? event.startedAt ?? (event.state === 'active' ? event.at : null);
    if (!before || event.at > before.at || event.at === before.at && event.state !== 'active') {
      turns.set(id, { ...event, turnId: id, startedAt });
    }
    if (event.state === 'active' && (!currentTurnId || (turns.get(currentTurnId)?.startedAt ?? -1) <= (startedAt ?? -1))) currentTurnId = id;
  }
  const latest = [...turns.values()].sort((a, b) => (b.startedAt ?? b.at) - (a.startedAt ?? a.at) || b.at - a.at)[0];
  const state = latest?.state === 'active' && now - latest.at > activeMaxAgeMs ? 'unknown' : latest?.state || 'unknown';
  return { id: metadata.id, title: metadata.name, state, turnId: latest?.turnId || null,
    updatedAt: latest?.at ?? null, partial: true, source: SOURCE };
}

// Polling reader, not a watcher. It only reads user-authorized .codex/sessions,
// never auth/config, socket traffic, raw conversation text or external processes.
function createMasCodexTasks({ directoryAccess, now = Date.now, ignoreTask = () => false, ignoreThread = () => false,
  activeMaxAgeMs = 120000, maxDepth = 3, maxFiles = 32, maxDirectories = 64, maxEntries = 2048,
  headBytes = 262144, tailBytes = 262144, maxTotalBytes = 8388608, maxLineBytes = 262144,
  io = fs.promises } = {}) {
  if (!directoryAccess || typeof directoryAccess.withAccess !== 'function') throw new TypeError('Explicit directoryAccess.withAccess is required');
  const limits = {
    depth: bound(maxDepth, 3, 0, 4), files: bound(maxFiles, 32, 1, 64), directories: bound(maxDirectories, 64, 1, 128),
    entries: bound(maxEntries, 2048, 1, 8192), head: bound(headBytes, 262144, 128, 262144),
    tail: bound(tailBytes, 262144, 128, 524288), total: bound(maxTotalBytes, 8388608, 128, 16777216),
    line: bound(maxLineBytes, 262144, 128, 524288), age: bound(activeMaxAgeMs, 120000, 1000, 3600000)
  };
  let diagnostics = { partial: true, filesRead: 0, bytesRead: 0, bounded: false };
  async function read({ signal } = {}) {
    const checkAbort = () => { if (signal?.aborted) throw fail('ABORT_ERR'); };
    checkAbort();
    return directoryAccess.withAccess('codex', async directory => {
      if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.basename(directory) !== '.codex') throw fail('CODEX_DIRECTORY_REQUIRED');
      const rootStat = await io.lstat(directory);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw fail('CODEX_DIRECTORY_REQUIRED');
      const root = await io.realpath(directory), sessions = path.join(root, 'sessions');
      const observedAt = now(), stats = { partial: true, filesRead: 0, bytesRead: 0, directoriesRead: 0, entriesRead: 0, bounded: false };
      diagnostics = stats;
      async function safe(file) {
        const relative = path.relative(root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw fail('CODEX_OUTSIDE_AUTHORIZED_DIRECTORY');
        let current = root;
        for (const part of relative.split(path.sep).filter(Boolean)) {
          current = path.join(current, part);
          if ((await io.lstat(current)).isSymbolicLink()) throw fail('CODEX_OUTSIDE_AUTHORIZED_DIRECTORY');
        }
        const canonical = await io.realpath(file);
        if (canonical !== root && !canonical.startsWith(root + path.sep)) throw fail('CODEX_OUTSIDE_AUTHORIZED_DIRECTORY');
        return canonical;
      }
      const files = [];
      async function collect(folder, depth) {
        checkAbort();
        if (stats.directoriesRead >= limits.directories || stats.entriesRead >= limits.entries) { stats.bounded = true; return; }
        let entries = [], dir;
        try {
          await safe(folder); dir = await io.opendir(folder); stats.directoriesRead++;
          for await (const entry of dir) {
            checkAbort();
            if (stats.entriesRead >= limits.entries) { stats.bounded = true; break; }
            stats.entriesRead++; entries.push(entry);
          }
        } catch (error) {
          if (error.code === 'ABORT_ERR') throw error;
          return;
        }
        entries.sort((a, b) => b.name.localeCompare(a.name, 'en'));
        for (const entry of entries) {
          checkAbort();
          if (entry.isSymbolicLink()) continue;
          const file = path.join(folder, entry.name);
          if (entry.isDirectory() && depth < limits.depth) await collect(file, depth + 1);
          else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            try {
              const stat = await io.lstat(file);
              if (stat.isFile() && !stat.isSymbolicLink()) files.push({ file, modified: Number(stat.mtimeMs) || 0 });
            } catch (_) { /* A concurrently rotated candidate is optional evidence. */ }
          }
        }
      }
      await collect(sessions, 0);
      // mtime only schedules bounded reads. Every task state still comes exclusively from event timestamps.
      files.sort((a, b) => b.modified - a.modified || b.file.localeCompare(a.file, 'en'));
      if (files.length > limits.files) stats.bounded = true;
      const rows = [];
      for (const { file } of files.slice(0, limits.files)) {
        checkAbort();
        if (stats.bytesRead >= limits.total) { stats.bounded = true; break; }
        let handle;
        try {
          const canonical = await safe(file), before = await io.lstat(canonical);
          handle = await io.open(canonical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
          const stat = await handle.stat();
          if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.size < 1) continue;
          async function chunk(start, size) {
            checkAbort();
            const length = Math.min(size, limits.total - stats.bytesRead);
            if (length <= 0) return Buffer.alloc(0);
            const buffer = Buffer.alloc(length), result = await handle.read(buffer, 0, length, start);
            stats.bytesRead += result.bytesRead;
            checkAbort();
            return buffer.subarray(0, result.bytesRead);
          }
          stats.filesRead++;
          const headLimit = Math.min(stat.size, limits.head), pieces = [];
          let headSize = 0;
          // Most excluded subagents have ~23KB metadata. Read it incrementally instead of
          // spending a full head budget on each one before knowing whether it is eligible.
          while (headSize < headLimit && stats.bytesRead < limits.total) {
            const piece = await chunk(headSize, Math.min(8192, headLimit - headSize));
            if (!piece.length) break;
            pieces.push(piece); headSize += piece.length;
            if (piece.includes(10)) break;
          }
          let head = Buffer.concat(pieces, headSize).toString('utf8');
          const metadata = metadataFrom(head, limits.line);
          if (!metadata || ignoreTask(metadata.id) || ignoreThread(metadata)) continue;
          // Eligible main threads retain the original bounded head+tail evidence coverage.
          if (headSize < headLimit && stats.bytesRead < limits.total) {
            const remainder = await chunk(headSize, headLimit - headSize);
            pieces.push(remainder); headSize += remainder.length;
            head = Buffer.concat(pieces, headSize).toString('utf8');
          }
          // Only complete lines are evidence; a file may be actively appending a half JSON line.
          let lines = head.slice(0, head.lastIndexOf('\n')).split('\n');
          const tailStart = Math.max(headSize, stat.size - limits.tail);
          if (tailStart < stat.size) {
            let tail = (await chunk(tailStart, stat.size - tailStart)).toString('utf8');
            if (tailStart > headSize || !head.endsWith('\n')) tail = tail.includes('\n') ? tail.slice(tail.indexOf('\n') + 1) : '';
            tail = tail.slice(0, Math.max(0, tail.lastIndexOf('\n')));
            lines = lines.concat(tailStart > headSize || !head.endsWith('\n') ? [null] : [], tail.split('\n'));
          }
          rows.push(project(metadata, lines, observedAt, limits.age, limits.line));
        } catch (error) {
          if (error.code === 'ABORT_ERR') throw error;
          // A removed, denied or concurrently rotated file is partial evidence only.
        } finally { if (handle) await handle.close().catch(() => {}); }
      }
      checkAbort();
      const unique = new Map();
      for (const row of rows) if (!unique.has(row.id) || (unique.get(row.id).updatedAt ?? -1) < (row.updatedAt ?? -1)) unique.set(row.id, row);
      return [...unique.values()].sort((a, b) => (b.updatedAt ?? -1) - (a.updatedAt ?? -1));
    });
  }
  return { read, getDiagnostics: () => ({ ...diagnostics }) };
}

module.exports = { createMasCodexTasks };
