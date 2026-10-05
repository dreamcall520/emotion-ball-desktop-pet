const fs = require('node:fs');
const path = require('node:path');
const { normalizeModelSelection } = require('./chat-models');
const { normalizeAppearance, normalizeCustomization, appearanceContentKey } = require('./customization');

const DEFAULTS = Object.freeze({
  size: 'tiny',
  x: null,
  y: null,
  alwaysOnTop: true,
  keepAwake: true,
  bubblesEnabled: true,
  colorMode: 'standard',
  chatModel: 'auto',
  notesDefaultTab: 'note',
  notesAppearance: 'light',
  customization: normalizeCustomization(),
  startupAppearance: normalizeCustomization().appearance,
  appearancePresets: Object.freeze([]),
  codexEnabled: false,
  codexTaskNameInAlerts: true,
  codexQuotaAlwaysVisible: true,
  codexShowExtraCredits: true,
  openaiApiAlwaysVisible: false,
  autoUpdateCheck: true,
  lastUpdateNotifiedVersion: '',
  codexQuotaPeriod: 'auto',
  codexQuotaLabelSize: 'compact',
  codexQuotaAppearance: 'system'
});

function normalizePresetName(raw) {
  if (typeof raw !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(raw)) return null;
  const name = raw.trim();
  return name.length > 0 && name.length <= 24 ? name : null;
}

function normalizeAppearancePresets(raw) {
  const result = [], ids = new Set(), names = new Set();
  for (const value of Array.isArray(raw) ? raw : []) {
    if (result.length === 20) break;
    const name = normalizePresetName(value?.name);
    if (!value || typeof value.id !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value.id) ||
      !name || ids.has(value.id) || names.has(name.toLowerCase()) ||
      !value.appearance || typeof value.appearance !== 'object' || Array.isArray(value.appearance)) continue;
    ids.add(value.id); names.add(name.toLowerCase());
    result.push({ id: value.id, name, appearance: normalizeAppearance(value.appearance) });
  }
  return result;
}

function findDuplicateAppearancePreset(raw, appearance) {
  if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance)) return null;
  const key = appearanceContentKey(appearance);
  return normalizeAppearancePresets(raw).find(item => appearanceContentKey(item.appearance) === key) || null;
}

function normalizeSettings(raw = {}) {
  const customization = normalizeCustomization(raw.customization);
  return {
    size: ['micro', 'tiny', 'compact', 'small', 'medium', 'large'].includes(raw.size)
      ? raw.size
      : DEFAULTS.size,
    x: Number.isFinite(raw.x) ? Math.round(raw.x) : DEFAULTS.x,
    y: Number.isFinite(raw.y) ? Math.round(raw.y) : DEFAULTS.y,
    alwaysOnTop:
      typeof raw.alwaysOnTop === 'boolean' ? raw.alwaysOnTop : DEFAULTS.alwaysOnTop,
    keepAwake:
      typeof raw.keepAwake === 'boolean' ? raw.keepAwake : DEFAULTS.keepAwake,
    bubblesEnabled:
      typeof raw.bubblesEnabled === 'boolean' ? raw.bubblesEnabled : DEFAULTS.bubblesEnabled,
    colorMode: ['standard', 'accessible'].includes(raw.colorMode) ? raw.colorMode : DEFAULTS.colorMode,
    chatModel: normalizeModelSelection(raw.chatModel),
    notesDefaultTab: ['note', 'todo'].includes(raw.notesDefaultTab) ? raw.notesDefaultTab : DEFAULTS.notesDefaultTab,
    notesAppearance: ['system', 'light', 'dark'].includes(raw.notesAppearance) ? raw.notesAppearance : DEFAULTS.notesAppearance,
    customization,
    appearancePresets: normalizeAppearancePresets(raw.appearancePresets),
    startupAppearance: raw.startupAppearance && typeof raw.startupAppearance === 'object' && !Array.isArray(raw.startupAppearance)
      ? normalizeAppearance(raw.startupAppearance) : customization.appearance,
    codexEnabled:
      typeof raw.codexEnabled === 'boolean' ? raw.codexEnabled : DEFAULTS.codexEnabled,
    codexTaskNameInAlerts:
      typeof raw.codexTaskNameInAlerts === 'boolean'
        ? raw.codexTaskNameInAlerts
        : DEFAULTS.codexTaskNameInAlerts,
    codexQuotaAlwaysVisible:
      typeof raw.codexQuotaAlwaysVisible === 'boolean'
        ? raw.codexQuotaAlwaysVisible
        : DEFAULTS.codexQuotaAlwaysVisible,
    codexShowExtraCredits: typeof raw.codexShowExtraCredits === 'boolean'
      ? raw.codexShowExtraCredits : DEFAULTS.codexShowExtraCredits,
    openaiApiAlwaysVisible: typeof raw.openaiApiAlwaysVisible === 'boolean'
      ? raw.openaiApiAlwaysVisible : DEFAULTS.openaiApiAlwaysVisible,
    autoUpdateCheck: typeof raw.autoUpdateCheck === 'boolean' ? raw.autoUpdateCheck : DEFAULTS.autoUpdateCheck,
    lastUpdateNotifiedVersion: typeof raw.lastUpdateNotifiedVersion === 'string' &&
      /^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(raw.lastUpdateNotifiedVersion) ? raw.lastUpdateNotifiedVersion : '',
    codexQuotaPeriod: ['auto', 'fiveHour', 'weekly'].includes(raw.codexQuotaPeriod)
      ? raw.codexQuotaPeriod
      : DEFAULTS.codexQuotaPeriod,
    codexQuotaLabelSize: ['standard', 'compact'].includes(raw.codexQuotaLabelSize)
      ? raw.codexQuotaLabelSize
      : DEFAULTS.codexQuotaLabelSize,
    codexQuotaAppearance: ['system', 'light', 'dark'].includes(raw.codexQuotaAppearance)
      ? raw.codexQuotaAppearance
      : DEFAULTS.codexQuotaAppearance
  };
}

function loadSettings(filePath) {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (_error) {
    return { ...DEFAULTS };
  }
}

function saveSettings(filePath, value) {
  const normalized = normalizeSettings(value);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
  return normalized;
}

module.exports = {
  DEFAULTS,
  normalizeSettings,
  normalizePresetName,
  normalizeAppearancePresets,
  findDuplicateAppearancePreset,
  loadSettings,
  saveSettings
};
