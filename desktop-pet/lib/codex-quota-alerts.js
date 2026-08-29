const crypto = require('node:crypto');

const LEVELS = Object.freeze([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
const LEVEL_SET = new Set(LEVELS);
const MAX_IDENTITIES = 64;
const MAX_INPUT_ITEMS = 1024;
const MAX_TEXT_LENGTH = 256;
const MAX_KEY_LENGTH = 1024;
const BLOOM_BITS = 1 << 20;
const BLOOM_MASK = BLOOM_BITS - 1;
const BLOOM_HASHES = 6;
const FINGERPRINT_SALT_BYTES = 32;
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
  for (let index = LEVELS.length - 2; index >= 0; index -= 1) {
    const level = LEVELS[index];
    if (remaining <= 100 - level) return level;
  }
  return 0;
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
  length = Math.min(length, MAX_INPUT_ITEMS);
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

function createBloomSummary() {
  const words = new Uint32Array(BLOOM_BITS >>> 5);

  function add(positions) {
    for (const bit of positions) {
      words[bit >>> 5] |= 1 << (bit & 31);
    }
  }

  function has(positions) {
    for (const bit of positions) {
      if ((words[bit >>> 5] & (1 << (bit & 31))) === 0) return false;
    }
    return true;
  }

  function clear() {
    words.fill(0);
  }

  return { add, has, clear };
}

function defaultFingerprintDigest(key, salt) {
  return crypto.createHmac('sha256', salt).update(key, 'utf8').digest();
}

function createFingerprintPositions(options) {
  let randomBytes = crypto.randomBytes;
  let fingerprintDigest = defaultFingerprintDigest;
  let suppliedSalt;

  try {
    if (options && typeof options === 'object' && !Array.isArray(options)) {
      const randomBytesOption = options.randomBytes;
      const digestOption = options.fingerprintDigest;
      const saltOption = options.fingerprintSalt;
      if (typeof randomBytesOption === 'function') randomBytes = randomBytesOption;
      if (typeof digestOption === 'function') fingerprintDigest = digestOption;
      if (saltOption !== undefined) suppliedSalt = Buffer.from(saltOption);
    }
  } catch {
    return () => null;
  }

  let salt;
  try {
    salt = suppliedSalt === undefined
      ? Buffer.from(randomBytes(FINGERPRINT_SALT_BYTES))
      : suppliedSalt;
    if (salt.length < 16) return () => null;
    salt = Buffer.from(salt);
  } catch {
    return () => null;
  }

  return key => {
    try {
      const digest = Buffer.from(fingerprintDigest(key, Buffer.from(salt)));
      if (digest.length < BLOOM_HASHES * 4) return null;
      const positions = [];
      for (let index = 0; index < BLOOM_HASHES; index += 1) {
        positions.push(digest.readUInt32BE(index * 4) & BLOOM_MASK);
      }
      return positions;
    } catch {
      return null;
    }
  };
}

function createQuotaAlertTracker(options = {}) {
  const state = new Map();
  // 11 张固定 2^20 位位图、6 个 HMAC 位置，共约 1.4 MiB；不保存身份列表。
  // 每个 tracker 使用独立随机盐，外部无法复用预计算碰撞；大位图将完整碰撞压到极低。
  // 碰撞会合并历史，可能保守少提醒；seen 单独命中时仍按首次身份处理，避免普通档误报。
  const positionsForKey = createFingerprintPositions(options);
  const seenSummary = createBloomSummary();
  const observedSummaries = LEVELS.map(() => createBloomSummary());

  function summarizedPeak(positions) {
    for (let index = LEVELS.length - 1; index >= 0; index -= 1) {
      if (observedSummaries[index].has(positions)) return LEVELS[index];
    }
    return 0;
  }

  function remember(positions, level) {
    if (!positions) return;
    seenSummary.add(positions);
    for (let index = 0; index < LEVELS.length && LEVELS[index] <= level; index += 1) {
      observedSummaries[index].add(positions);
    }
  }

  function reset() {
    state.clear();
    seenSummary.clear();
    for (const summary of observedSummaries) summary.clear();
  }

  function update(windows, options = {}) {
    const normalizedOptions = safeOptions(options);
    const baseline = normalizedOptions.baseline;
    const alwaysVisible = normalizedOptions.alwaysVisible;
    const reliable = reliableByIdentity(windows);
    const batchKeys = new Set(reliable.keys());
    const positionsByKey = new Map();
    for (const key of reliable.keys()) positionsByKey.set(key, positionsForKey(key));
    const alertsByKey = new Map();

    function observe(key, item, entry, isNewIdentity, positions) {
      const currentLevel = levelOf(item.remaining);
      const isBaseline = baseline || isNewIdentity;
      const exceedsPeak = currentLevel > entry.peak;
      const candidate = exceedsPeak && (!isBaseline || currentLevel >= 80) ? currentLevel : 0;
      entry.peak = Math.max(entry.peak, currentLevel);
      remember(positions, currentLevel);

      if (!candidate || entry.emitted.has(candidate) || (alwaysVisible && candidate < 80)) return;
      entry.emitted.add(candidate);
      alertsByKey.set(key, alertOf(key, candidate, item));
    }

    for (const [key, item] of reliable) {
      const entry = state.get(key);
      if (entry) observe(key, item, entry, false, positionsByKey.get(key));
    }

    for (const [key, item] of reliable) {
      if (state.has(key)) continue;
      const positions = positionsByKey.get(key);
      const seenHit = Boolean(positions && seenSummary.has(positions));
      const summaryPeak = seenHit ? summarizedPeak(positions) : 0;
      const wasSeen = seenHit && summaryPeak > 0;
      const summaryUnavailableWhileFull = !positions && state.size >= MAX_IDENTITIES;
      if (state.size >= MAX_IDENTITIES) {
        let evictionKey;
        for (const existingKey of state.keys()) {
          if (!batchKeys.has(existingKey)) {
            evictionKey = existingKey;
            break;
          }
        }
        const selectedKey = evictionKey === undefined ? state.keys().next().value : evictionKey;
        state.delete(selectedKey);
      }
      const entry = {
        peak: summaryUnavailableWhileFull ? levelOf(item.remaining) : summaryPeak,
        emitted: new Set()
      };
      state.set(key, entry);
      observe(key, item, entry, !wasSeen && !summaryUnavailableWhileFull, positions);
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
  length = Math.min(length, MAX_INPUT_ITEMS);
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
