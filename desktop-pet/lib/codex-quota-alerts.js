const LEVELS = Object.freeze([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
const LEVEL_SET = new Set(LEVELS);
const MAX_IDENTITIES = 64;
const MAX_EVICTED_IDENTITIES = 64;
const MAX_TEXT_LENGTH = 256;
const MAX_KEY_LENGTH = 1024;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

function reasonableText(value, maxLength = MAX_TEXT_LENGTH) {
  return typeof value === 'string' && value.length <= maxLength
    && value.trim().length > 0 && !CONTROL_CHARACTERS.test(value);
}

function validWindowScalars(item) {
  return Boolean(item && typeof item === 'object' && !Array.isArray(item)
    && reasonableText(item.id) && reasonableText(item.label)
    && Number.isSafeInteger(item.windowMinutes) && item.windowMinutes > 0
    && Number.isFinite(item.remaining) && item.remaining >= 0 && item.remaining <= 100
    && Number.isSafeInteger(item.resetsAt) && item.resetsAt > 0);
}

function safeWindow(item) {
  try {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const copy = {
      id: item.id,
      label: item.label,
      windowMinutes: item.windowMinutes,
      remaining: item.remaining,
      resetsAt: item.resetsAt
    };
    return validWindowScalars(copy) ? copy : null;
  } catch {
    return null;
  }
}

function keyOf(item) {
  return JSON.stringify([item.id, item.windowMinutes, item.resetsAt]);
}

function levelOf(remaining) {
  if (remaining === 0) return 100;
  const used = 100 - remaining;
  let result = 0;
  for (const level of LEVELS) {
    if (level === 100) break;
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
  let length;
  try {
    if (!Array.isArray(windows)) return reliable;
    length = windows.length;
  } catch {
    return reliable;
  }
  if (!Number.isSafeInteger(length) || length < 0) return reliable;
  for (let index = 0; index < length; index += 1) {
    let raw;
    try {
      raw = windows[index];
    } catch {
      continue;
    }
    const item = safeWindow(raw);
    if (!item) continue;
    const key = keyOf(item);
    if (reliable.has(key)) {
      reliable.set(key, item);
      continue;
    }
    if (reliable.size < MAX_IDENTITIES) reliable.set(key, item);
  }
  return reliable;
}

function safeOptions(options) {
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      return { baseline: false, alwaysVisible: false };
    }
    return {
      baseline: options.baseline === true,
      alwaysVisible: options.alwaysVisible === true
    };
  } catch {
    return { baseline: false, alwaysVisible: false };
  }
}

function createQuotaAlertTracker() {
  const state = new Map();
  const evicted = new Map();

  function reset() {
    state.clear();
    evicted.clear();
  }

  function update(windows, options = {}) {
    const normalizedOptions = safeOptions(options);
    const baseline = normalizedOptions.baseline;
    const alwaysVisible = normalizedOptions.alwaysVisible;
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
      let entry = evicted.get(key);
      if (entry) evicted.delete(key);
      if (state.size >= MAX_IDENTITIES) {
        let evictionKey;
        for (const existingKey of state.keys()) {
          if (!batchKeys.has(existingKey)) {
            evictionKey = existingKey;
            break;
          }
        }
        const selectedKey = evictionKey === undefined ? state.keys().next().value : evictionKey;
        const selectedEntry = state.get(selectedKey);
        state.delete(selectedKey);
        if (evicted.size >= MAX_EVICTED_IDENTITIES) evicted.delete(evicted.keys().next().value);
        evicted.set(selectedKey, selectedEntry);
      }
      if (!entry) entry = { peak: 0, emitted: new Set() };
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

function safeAlert(item) {
  try {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const copy = {
      key: item.key,
      level: item.level,
      remaining: item.remaining,
      id: item.id,
      label: item.label,
      windowMinutes: item.windowMinutes,
      resetsAt: item.resetsAt
    };
    if (!validWindowScalars(copy)
      || !reasonableText(copy.key, MAX_KEY_LENGTH)
      || copy.key !== keyOf(copy)
      || !LEVEL_SET.has(copy.level)
      || copy.level !== levelOf(copy.remaining)) return null;
    return copy;
  } catch {
    return null;
  }
}

function mergeQuotaAlerts(alerts) {
  let length;
  try {
    if (!Array.isArray(alerts)) return null;
    length = alerts.length;
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(length) || length < 0) return null;
  const unique = new Map();
  for (let index = 0; index < length; index += 1) {
    let raw;
    try {
      raw = alerts[index];
    } catch {
      continue;
    }
    const item = safeAlert(raw);
    if (!item) continue;
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
