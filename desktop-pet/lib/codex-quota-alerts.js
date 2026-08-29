const LEVELS = Object.freeze([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
const LEVEL_SET = new Set(LEVELS);
const MAX_IDENTITIES = 64;
const MAX_TEXT_LENGTH = 256;
const MAX_KEY_LENGTH = 1024;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

function reasonableText(value, maxLength = MAX_TEXT_LENGTH) {
  return typeof value === 'string' && value.length <= maxLength
    && value.trim().length > 0 && !CONTROL_CHARACTERS.test(value);
}

function validWindow(item) {
  return Boolean(item && typeof item === 'object' && !Array.isArray(item)
    && reasonableText(item.id) && reasonableText(item.label)
    && Number.isSafeInteger(item.windowMinutes) && item.windowMinutes > 0
    && Number.isFinite(item.remaining) && item.remaining >= 0 && item.remaining <= 100
    && Number.isSafeInteger(item.resetsAt) && item.resetsAt > 0);
}

function keyOf(item) {
  return JSON.stringify([item.id, item.windowMinutes, item.resetsAt]);
}

function copyWindow(item) {
  return {
    id: item.id,
    label: item.label,
    windowMinutes: item.windowMinutes,
    remaining: item.remaining,
    resetsAt: item.resetsAt
  };
}

function levelOf(remaining) {
  const used = 100 - remaining;
  let result = 0;
  for (const level of LEVELS) {
    if (used < level) break;
    result = level;
  }
  return result;
}

function alertOf(key, level, item) {
  return {
    key,
    level,
    remaining: item.remaining,
    id: item.id,
    label: item.label,
    windowMinutes: item.windowMinutes,
    resetsAt: item.resetsAt
  };
}

function reliableByIdentity(windows) {
  const reliable = new Map();
  if (!Array.isArray(windows)) return reliable;
  for (const item of windows) {
    if (!validWindow(item)) continue;
    const key = keyOf(item);
    if (reliable.has(key)) {
      reliable.set(key, copyWindow(item));
      continue;
    }
    if (reliable.size < MAX_IDENTITIES) reliable.set(key, copyWindow(item));
  }
  return reliable;
}

function createQuotaAlertTracker() {
  const state = new Map();

  function reset() {
    state.clear();
  }

  function update(windows, options = {}) {
    const safeOptions = options && typeof options === 'object' && !Array.isArray(options)
      ? options : {};
    const baseline = safeOptions.baseline === true;
    const alwaysVisible = safeOptions.alwaysVisible === true;
    const reliable = reliableByIdentity(windows);
    const batchKeys = new Set(reliable.keys());
    const alertsByKey = new Map();

    function observe(key, item, entry, isNewIdentity) {
      const currentLevel = levelOf(item.remaining);
      const isBaseline = baseline || isNewIdentity;
      const exceedsPeak = currentLevel > entry.peak;
      const candidate = exceedsPeak && (!isBaseline || currentLevel >= 80) ? currentLevel : 0;
      entry.peak = Math.max(entry.peak, currentLevel);

      if (!candidate || entry.emitted.has(candidate) || (alwaysVisible && candidate < 80)) return;
      entry.emitted.add(candidate);
      alertsByKey.set(key, alertOf(key, candidate, item));
    }

    for (const [key, item] of reliable) {
      const entry = state.get(key);
      if (entry) observe(key, item, entry, false);
    }

    for (const [key, item] of reliable) {
      if (state.has(key)) continue;
      if (state.size >= MAX_IDENTITIES) {
        let evictionKey;
        for (const existingKey of state.keys()) {
          if (!batchKeys.has(existingKey)) {
            evictionKey = existingKey;
            break;
          }
        }
        state.delete(evictionKey === undefined ? state.keys().next().value : evictionKey);
      }
      const entry = { peak: 0, emitted: new Set() };
      state.set(key, entry);
      observe(key, item, entry, true);
    }

    const alerts = [];
    for (const key of reliable.keys()) {
      if (alertsByKey.has(key)) alerts.push(alertsByKey.get(key));
    }
    return alerts;
  }

  return { update, reset };
}

function validAlert(item) {
  return validWindow(item)
    && reasonableText(item.key, MAX_KEY_LENGTH)
    && item.key === keyOf(item)
    && LEVEL_SET.has(item.level);
}

function copyAlert(item) {
  return {
    key: item.key,
    level: item.level,
    remaining: item.remaining,
    id: item.id,
    label: item.label,
    windowMinutes: item.windowMinutes,
    resetsAt: item.resetsAt
  };
}

function mergeQuotaAlerts(alerts) {
  if (!Array.isArray(alerts)) return null;
  const unique = new Map();
  for (const item of alerts) {
    if (!validAlert(item)) continue;
    if (unique.has(item.key)) {
      unique.set(item.key, copyAlert(item));
      continue;
    }
    if (unique.size < MAX_IDENTITIES) unique.set(item.key, copyAlert(item));
  }
  if (!unique.size) return null;

  const refs = Array.from(unique.values(), copyAlert);
  return {
    level: Math.max(...refs.map(item => item.level)),
    remaining: Math.min(...refs.map(item => item.remaining)),
    count: refs.length,
    refs
  };
}

module.exports = { LEVELS, createQuotaAlertTracker, mergeQuotaAlerts };
