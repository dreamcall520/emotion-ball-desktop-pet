const { TextDecoder } = require('node:util');
const { MAX_FRAME_BYTES } = require('./codex-rpc');
const { isTaskId } = require('./codex-state');

const MAX_DISCARD_FRAME_BYTES = 256 * 1024 * 1024;
const MAX_PREFIX_BYTES = 8192;

function targetIds(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 64 || value.some(id => !isTaskId(id))) throw new Error('INVALID_FRAME');
  return value.slice();
}

// A bounded envelope reader, NOT a history/JSON streaming parser. It stops exactly
// at the value of the top-level params.change property, before any state body byte.
function createEnvelopeReader() {
  const bytes = Buffer.alloc(MAX_PREFIX_BYTES);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const stack = [];
  let length = 0;
  let quoted = false;
  let escaped = false;
  let stringStart = 0;
  let keyString = false;
  function close() { bytes.fill(0); stack.length = 0; length = 0; }
  function push(data) {
    for (const byte of data) {
      if (length === MAX_PREFIX_BYTES) throw new Error('INVALID_FRAME');
      bytes[length++] = byte;
      const current = stack.at(-1);
      if (quoted) {
        if (escaped) { escaped = false; continue; }
        if (byte === 92) { escaped = true; continue; }
        if (byte === 34) {
          quoted = false;
          if (keyString) {
            const key = JSON.parse(decoder.decode(bytes.subarray(stringStart, length)));
            if (current.keys.has(key)) throw new Error('INVALID_FRAME');
            current.keys.add(key); current.key = key; current.expectKey = false;
          }
        }
        continue;
      }
      if (byte === 34) {
        quoted = true; stringStart = length - 1; keyString = current?.kind === '{' && current.expectKey;
      } else if (byte === 123 || byte === 91) {
        const path = !current ? [] : current.kind === '{' && current.path && current.key !== null ? [...current.path, current.key] : null;
        stack.push({ kind: byte === 123 ? '{' : '[', path, key: null, keys: new Set(), expectKey: true });
        if (stack.length > 8) throw new Error('INVALID_FRAME');
      } else if (byte === 125 || byte === 93) {
        if (!current || current.kind !== (byte === 125 ? '{' : '[')) throw new Error('INVALID_FRAME');
        stack.pop();
        if (stack.length === 0) throw new Error('INVALID_FRAME');
      } else if (byte === 44 && current?.kind === '{') {
        current.expectKey = true; current.key = null;
      } else if (byte === 58 && current?.kind === '{' && current.key === 'change' && current.path?.length === 1 && current.path[0] === 'params') {
        const suffix = stack.slice().reverse().map(item => item.kind === '{' ? '}' : ']').join('');
        const raw = JSON.parse(decoder.decode(bytes.subarray(0, length)) + 'null' + suffix);
        if (raw.type !== 'broadcast' || raw.method !== 'thread-stream-state-changed' || !isTaskId(raw.sourceClientId) ||
          !isTaskId(raw.params?.conversationId) || raw.params?.hostId !== 'local') throw new Error('INVALID_FRAME');
        return { type: 'broadcast', method: 'thread-stream-state-changed', sourceClientId: raw.sourceClientId,
          conversationId: raw.params.conversationId, hostId: 'local', targetClientIds: targetIds(raw.targetClientIds),
          paramTargetClientIds: targetIds(raw.params.targetClientIds) };
      }
    }
    if (length === MAX_PREFIX_BYTES) throw new Error('INVALID_FRAME');
    return null;
  }
  return { push, close };
}

function createFrameParser({ onMessage, onError, onOversized, maxFrameBytes = MAX_FRAME_BYTES, frameTimeoutMs = 15000 }) {
  const limit = Math.max(1, Math.min(MAX_FRAME_BYTES, maxFrameBytes));
  const timeout = Number.isFinite(frameTimeoutMs) ? Math.max(1, Math.min(15000, frameTimeoutMs)) : 15000;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let header = Buffer.alloc(4);
  let headerLength = 0;
  let frame = null;
  let frameLength = 0;
  let discarding = null;
  let frameTimer = null;
  let closed = false;
  function finishFrame() { clearTimeout(frameTimer); frameTimer = null; }
  function close() {
    closed = true; finishFrame(); header?.fill(0); frame?.fill(0);
    header = null; frame = null; headerLength = 0; frameLength = 0;
    discarding?.reader?.close(); discarding = null;
  }
  function fail(code = 'INVALID_FRAME') { if (!closed) { close(); onError(code); } }
  function push(input) {
    if (closed) return;
    const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
    let offset = 0;
    let frames = 0;
    while (offset < data.length && !closed) {
      if (frame === null && discarding === null) {
        if (!frameTimer) frameTimer = setTimeout(() => fail('TIMEOUT'), timeout);
        const count = Math.min(4 - headerLength, data.length - offset);
        data.copy(header, headerLength, offset, offset + count); headerLength += count; offset += count;
        if (headerLength !== 4) break;
        const length = header.readUInt32LE(); headerLength = 0;
        if (length === 0 || length > MAX_DISCARD_FRAME_BYTES || (length > limit && !onOversized)) { fail(); return; }
        if (length > limit) discarding = { remaining: length, reader: createEnvelopeReader() };
        else { frame = Buffer.allocUnsafe(length); frameLength = 0; }
      }
      if (discarding) {
        const count = Math.min(discarding.remaining, data.length - offset);
        try {
          const envelope = discarding.reader?.push(data.subarray(offset, offset + count));
          if (envelope) {
            discarding.reader.close(); discarding.reader = null;
            if (onOversized(envelope) !== true) { fail(); return; }
            if (closed) return;
          }
        } catch { fail(); return; }
        discarding.remaining -= count; offset += count;
        if (discarding.remaining > 0) break;
        if (discarding.reader) { fail(); return; }
        discarding = null; finishFrame();
        if (++frames > 1024) { fail(); return; }
        continue;
      }
      const count = Math.min(frame.length - frameLength, data.length - offset);
      data.copy(frame, frameLength, offset, offset + count); frameLength += count; offset += count;
      if (frameLength !== frame.length) break;
      if (++frames > 1024) { fail(); return; }
      const complete = frame; frame = null; frameLength = 0; finishFrame();
      let packet;
      try { packet = JSON.parse(decoder.decode(complete)); }
      catch { complete.fill(0); fail(); return; }
      complete.fill(0);
      if (packet === null || typeof packet !== 'object' || Array.isArray(packet)) { fail(); return; }
      onMessage(packet);
    }
  }
  return { push, close };
}

module.exports = { createFrameParser, MAX_DISCARD_FRAME_BYTES, MAX_PREFIX_BYTES };
