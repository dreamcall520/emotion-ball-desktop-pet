'use strict';
const { quotaCreditDetails, normalizeResetCredits } = require('./codex-state');
const SOURCE = 'managed-codex-chat-account-quota';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validDate = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const bucketId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value);
const failure = code => Object.assign(new Error(code), { code });
function projectManagedCodexQuota(raw, at = Date.now()) {
  if (!object(raw) || !validDate(at)) throw failure('INVALID_FRAME');
  const multiple = raw.rateLimitsByLimitId;
  if (multiple !== undefined && multiple !== null && !object(multiple)) throw failure('INVALID_FRAME');
  const entries = object(multiple) ? Object.entries(multiple).slice(0, 32)
    : object(raw.rateLimits) ? [[raw.rateLimits.limitId == null ? 'codex' : raw.rateLimits.limitId, raw.rateLimits]] : [];
  const scopes = [];
  for (const [id, group] of entries) {
    if (!bucketId(id) || !object(group) || group.limitId != null && group.limitId !== id) continue;
    const windows = [];
    for (const slot of ['primary', 'secondary']) {
      const window = group[slot];
      if (!object(window)) continue;
      windows.push({ id: id + ':' + slot,
        windowMinutes: Number.isSafeInteger(window.windowDurationMins) && window.windowDurationMins > 0 ? window.windowDurationMins : null,
        usedPercent: Number.isFinite(window.usedPercent) && window.usedPercent >= 0 && window.usedPercent <= 100 ? window.usedPercent : null,
        resetsAt: Number.isSafeInteger(window.resetsAt) && window.resetsAt > 0 && validDate(window.resetsAt * 1000) ? window.resetsAt * 1000 : null });
    }
    const value = { id, windows, ...quotaCreditDetails(group) };
    scopes.push(value);
  }
  // The main card is Codex's bucket only. Other metered pools stay separate.
  const codex = scopes.find(scope => scope.id === 'codex'), windows = codex?.windows || [];
  return { source: SOURCE, billingScope: 'same-chat-login', state: !windows.length ? 'unavailable'
    : windows.every(window => window.windowMinutes !== null && window.usedPercent !== null && window.resetsAt !== null) ? 'ready' : 'partial',
    windows, scopes, ...quotaCreditDetails(codex), ...normalizeResetCredits(raw.rateLimitResetCredits), updatedAt: at };
}
async function readManagedCodexQuota({ createRpc, signal, now = Date.now } = {}) {
  if (typeof createRpc !== 'function' || typeof now !== 'function') throw new TypeError('createRpc and now required');
  let rpc;
  const check = () => { if (signal?.aborted) throw failure('CANCELLED'); };
  const abort = () => { try { void Promise.resolve(rpc?.close()).catch(() => {}); } catch (_) {} };
  try {
    check(); signal?.addEventListener('abort', abort, { once: true });
    rpc = await createRpc(); check();
    await rpc.start(); check();
    const value = await rpc.readRateLimits({ at: now() }); check();
    return value;
  } catch (error) { check(); throw error; }
  finally { signal?.removeEventListener('abort', abort); await rpc?.close(); }
}
module.exports = { SOURCE, projectManagedCodexQuota, readManagedCodexQuota };
