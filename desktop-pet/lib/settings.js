const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  size: 'tiny',
  x: null,
  y: null,
  alwaysOnTop: true,
  keepAwake: false,
  bubblesEnabled: true,
  codexEnabled: false,
  codexTaskNameInAlerts: false,
  codexQuotaAlwaysVisible: false,
  codexQuotaPeriod: 'auto',
  codexQuotaLabelSize: 'compact'
});

function normalizeSettings(raw = {}) {
  return {
    size: ['micro', 'tiny', 'small', 'medium', 'large'].includes(raw.size)
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
    codexQuotaPeriod: ['auto', 'fiveHour', 'weekly'].includes(raw.codexQuotaPeriod)
      ? raw.codexQuotaPeriod
      : DEFAULTS.codexQuotaPeriod,
    codexQuotaLabelSize: ['standard', 'compact'].includes(raw.codexQuotaLabelSize)
      ? raw.codexQuotaLabelSize
      : DEFAULTS.codexQuotaLabelSize
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
  loadSettings,
  saveSettings
};
