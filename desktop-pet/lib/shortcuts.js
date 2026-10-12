const DIRECT_ACTIONS = Object.freeze(['chat', 'custom', 'note', 'todo', 'pomodoro']);
const SHORTCUT_ACTIONS = Object.freeze(['launcher', ...DIRECT_ACTIONS]);
const DEFAULT_SHORTCUT_SETTINGS = Object.freeze({
  shape: 'floating', enabled: true, launcher: 'Ctrl+Alt+Q',
  chat: '', custom: '', note: '', todo: '', pomodoro: '',
  noteBehavior: 'panel', todoBehavior: 'panel'
});
const MODIFIERS = Object.freeze({ ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta' });
const MODIFIER_ORDER = Object.freeze(['Ctrl', 'Alt', 'Shift', 'Meta']);

function normalizeAccelerator(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return '';
  const modifiers = new Set();
  let key = null;
  for (const token of value.split('+').map(part => part.trim())) {
    const lower = token.toLowerCase();
    const modifier = Object.hasOwn(MODIFIERS, lower) ? MODIFIERS[lower] : null;
    if (modifier) {
      if (modifiers.has(modifier)) return null;
      modifiers.add(modifier);
    } else {
      if (key !== null) return null;
      if (/^[a-z0-9]$/i.test(token)) key = token.toUpperCase();
      else if (lower === 'space') key = 'Space';
      else if (/^f(?:[1-9]|1[0-2])$/i.test(token)) key = token.toUpperCase();
      else return null;
    }
  }
  if (!key || !['Ctrl', 'Alt', 'Meta'].some(modifier => modifiers.has(modifier))) return null;
  return [...MODIFIER_ORDER.filter(modifier => modifiers.has(modifier)), key].join('+');
}

function issue(field, code, message, accelerator) {
  return { field, code, message, ...(accelerator ? { accelerator } : {}) };
}

// Saving is strict; loading a missing or invalid historical object uses defaults.
function validateShortcutSettings(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: [issue('shortcutSettings', 'invalid_config', '快捷键设置格式无效。')] };
  }
  const config = { shape: raw.shape, enabled: raw.enabled };
  if (!['floating', 'list'].includes(raw.shape)) errors.push(issue('shape', 'invalid_shape', '请选择悬浮按钮或列表。'));
  if (typeof raw.enabled !== 'boolean') errors.push(issue('enabled', 'invalid_enabled', '快捷入口开关必须为布尔值。'));
  for (const field of ['noteBehavior', 'todoBehavior']) {
    const value = Object.hasOwn(raw, field) ? raw[field] : DEFAULT_SHORTCUT_SETTINGS[field];
    if (!['panel', 'create'].includes(value)) errors.push(issue(field, 'invalid_behavior', '请选择打开面板或直接新建。'));
    else config[field] = value;
  }
  const seen = new Map();
  for (const action of SHORTCUT_ACTIONS) {
    const value = action === 'launcher' || Object.hasOwn(raw, action) ? raw[action] : '';
    const accelerator = normalizeAccelerator(value);
    if (accelerator === null) {
      errors.push(issue(action, 'invalid_accelerator', '请使用 Ctrl、Alt 或 Meta，加字母、数字、Space 或 F1–F12。'));
      continue;
    }
    config[action] = accelerator;
    if (action === 'launcher' && raw.enabled === true && !accelerator) {
      errors.push(issue(action, 'required', '开启快捷入口时，请设置唤起快捷键。'));
    }
    if (!accelerator) continue;
    if (seen.has(accelerator)) errors.push({
      ...issue(action, 'duplicate', '这个组合已用于其他功能，请更换。', accelerator),
      conflictWith: seen.get(accelerator)
    });
    else seen.set(accelerator, action);
  }
  return errors.length ? { ok: false, errors } : { ok: true, config, errors: [] };
}

function normalizeShortcutSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SHORTCUT_SETTINGS };
  const result = validateShortcutSettings({ ...DEFAULT_SHORTCUT_SETTINGS, ...raw });
  return result.ok ? result.config : { ...DEFAULT_SHORTCUT_SETTINGS };
}

function actionMap(config) {
  const entries = DIRECT_ACTIONS.filter(action => config[action]).map(action => [config[action], action]);
  if (config.enabled && config.launcher) entries.unshift([config.launcher, 'launcher']);
  return new Map(entries);
}

function createShortcutRegistrar({ globalShortcut, config: initialConfig, onAction = () => {} }) {
  if (!globalShortcut || typeof globalShortcut.register !== 'function' || typeof globalShortcut.unregister !== 'function') {
    throw new TypeError('globalShortcut.register/unregister are required');
  }
  let config = normalizeShortcutSettings(initialConfig);
  let actions = actionMap(config);
  let errors = [];
  let started = false, disposed = false, recording = false, applying = false;
  const owned = new Set();
  const getConfig = () => ({ ...config });
  const getErrors = () => errors.map(error => ({ ...error }));
  const getAction = raw => {
    const accelerator = normalizeAccelerator(raw);
    return accelerator && owned.has(accelerator) ? actions.get(accelerator) || null : null;
  };
  const result = ok => ({ ok, config: getConfig(), errors: getErrors() });
  const getState = () => ({ ...result(errors.length === 0), recording, active: Object.fromEntries(
    SHORTCUT_ACTIONS.map(action => [action, Boolean(config[action] && getAction(config[action]) === action)])
  ) });

  function register(accelerator, action) {
    try {
      const registered = globalShortcut.register(accelerator, () => {
        if (disposed || recording) return;
        // Resolve from the committed map so swapping actions never uses a stale closure.
        const currentAction = getAction(accelerator);
        if (currentAction) onAction(currentAction, accelerator);
      });
      if (!registered) return issue(action, 'conflict', '该快捷键无法注册，可能已被其他应用占用。', accelerator);
      owned.add(accelerator);
      return null;
    } catch (_error) {
      return issue(action, 'registration_failed', '注册快捷键失败，原设置已保留。', accelerator);
    }
  }

  function unregister(accelerator) {
    try {
      globalShortcut.unregister(accelerator);
      owned.delete(accelerator);
      return null;
    } catch (_error) {
      return issue('shortcutSettings', 'unregister_failed', '释放快捷键失败，请重试。', accelerator);
    }
  }

  function setRecording(value) {
    const next = Boolean(value);
    if (disposed || next === recording) return !disposed;
    try {
      // Electron 43 supports suspension, retaining registrations while the field records.
      if (typeof globalShortcut.setSuspended === 'function') globalShortcut.setSuspended(next);
      recording = next;
      return true;
    } catch (_error) {
      errors = [issue('shortcutSettings', 'recording_failed', '暂时无法切换快捷键录入状态。')];
      return false;
    }
  }

  function start() {
    if (disposed) {
      errors = [issue('shortcutSettings', 'disposed', '快捷键服务已关闭。')];
      return result(false);
    }
    if (started) return result(errors.length === 0);
    started = true;
    errors = [];
    for (const [accelerator, action] of actions) {
      const error = register(accelerator, action);
      if (error) errors.push(error);
    }
    return result(errors.length === 0);
  }

  function apply(next, persist) {
    if (disposed || !started || applying) {
      errors = [issue('shortcutSettings', disposed ? 'disposed' : (!started ? 'not_started' : 'busy'), '快捷键服务暂时不可用，请重试。')];
      return result(false);
    }
    const validated = validateShortcutSettings(next);
    if (!validated.ok) {
      errors = validated.errors;
      return result(false);
    }
    if (typeof persist !== 'function') {
      errors = [issue('shortcutSettings', 'persistence_required', '无法保存快捷键设置。')];
      return result(false);
    }
    // New registrations fail while Electron is suspended; leave recording before applying.
    if (!setRecording(false)) return result(false);
    applying = true;
    const nextActions = actionMap(validated.config);
    const added = [];
    const rollback = error => {
      errors = [error];
      for (const accelerator of added) {
        const cleanupError = unregister(accelerator);
        if (cleanupError) errors.push(cleanupError);
      }
      return result(false);
    };
    try {
      for (const [accelerator, action] of nextActions) {
        if (owned.has(accelerator)) continue;
        const error = register(accelerator, action);
        if (error) return rollback(error);
        added.push(accelerator);
      }
      try {
        const saved = persist({ ...validated.config });
        if (saved === false || (saved && typeof saved.then === 'function')) throw new Error('Persistence must succeed synchronously');
      } catch (_error) {
        return rollback(issue('shortcutSettings', 'persistence_failed', '保存失败，原快捷键和设置已保留。'));
      }
      config = { ...validated.config };
      actions = nextActions;
      errors = [];
      for (const accelerator of [...owned]) if (!actions.has(accelerator)) {
        const error = unregister(accelerator);
        if (error) errors.push(error);
      }
      return result(true);
    } finally {
      applying = false;
    }
  }

  function dispose() {
    if (disposed) return;
    setRecording(false);
    disposed = true;
    for (const accelerator of [...owned]) unregister(accelerator);
  }

  return { start, apply, getConfig, getErrors, getState, getAction, setRecording, dispose };
}

module.exports = {
  DIRECT_ACTIONS, SHORTCUT_ACTIONS, DEFAULT_SHORTCUT_SETTINGS,
  normalizeAccelerator, validateShortcutSettings, normalizeShortcutSettings, createShortcutRegistrar
};
