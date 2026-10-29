const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEFAULT_SHORTCUT_SETTINGS: defaults, normalizeAccelerator, normalizeShortcutSettings,
  validateShortcutSettings, createShortcutRegistrar
} = require('../lib/shortcuts');
const { DEFAULTS, normalizeSettings, loadSettings, saveSettings } = require('../lib/settings');

function fakeGlobalShortcut() {
  const registered = new Map(), blocked = new Set(), throws = new Set(), calls = [];
  let suspended = false;
  return {
    registered, blocked, throws, calls,
    register(key, callback) {
      calls.push(['register', key]);
      if (throws.has(key)) throw new Error('registration failed');
      if (suspended || blocked.has(key) || registered.has(key)) return false;
      registered.set(key, callback);
      return true;
    },
    unregister(key) { calls.push(['unregister', key]); registered.delete(key); },
    setSuspended(value) { calls.push(['suspend', value]); suspended = value; },
    fire(key) { if (!suspended) registered.get(key)?.(); }
  };
}

test('组合键规范化顺序大小写，限制支持的按键和必要修饰键', () => {
  assert.equal(normalizeAccelerator(' meta + shift + alt + ctrl + q '), 'Ctrl+Alt+Shift+Meta+Q');
  for (const key of ['0', '9', 'A', 'Space', 'F1', 'F12']) assert.equal(normalizeAccelerator('alt+' + key), 'Alt+' + key);
  for (const key of ['', ' ', 'q', 'Shift+Q', 'Ctrl', 'Ctrl+Q+W', 'Ctrl+Ctrl+Q', 'Ctrl++', 'Ctrl+F0', 'Ctrl+F13', 'Ctrl+Enter', 'Ctrl+constructor+Q', 1, null]) {
    assert.equal(normalizeAccelerator(key), key === '' || key === ' ' ? '' : null, String(key));
  }
});

test('保存严格校验必填值及重复，关闭入口不关闭五个功能直达', () => {
  const valid = validateShortcutSettings({ ...defaults, enabled: false, launcher: '', chat: 'alt+c' });
  assert.equal(valid.ok, true);
  assert.equal(valid.config.chat, 'Alt+C');
  for (const patch of [{ enabled: 'true' }, { launcher: undefined }, { launcher: '' }, { shape: 'pie' }, { chat: null }]) {
    assert.equal(validateShortcutSettings({ ...defaults, ...patch }).ok, false);
  }
  const duplicate = validateShortcutSettings({ ...defaults, chat: 'alt+ctrl+q' });
  assert.equal(duplicate.ok, false);
  assert.deepEqual(duplicate.errors[0], {
    field: 'chat', code: 'duplicate', message: '这个组合已用于其他功能，请更换。',
    accelerator: 'Ctrl+Alt+Q', conflictWith: 'launcher'
  });
  assert.equal(validateShortcutSettings({ ...defaults, enabled: false, chat: defaults.launcher }).ok, false);
});

test('旧文件补齐快捷配置，无效历史值降级默认，保存无效值不覆盖原文件', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-shortcuts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  assert.deepEqual(normalizeSettings({}).shortcutSettings, defaults);
  assert.deepEqual(DEFAULTS.shortcutSettings, defaults);
  assert.deepEqual(normalizeShortcutSettings({ chat: 'Shift+C' }), defaults);
  fs.writeFileSync(file, JSON.stringify({ size: 'small', shortcutSettings: { enabled: 'yes' } }));
  assert.deepEqual(loadSettings(file).shortcutSettings, defaults);
  const saved = saveSettings(file, { ...loadSettings(file), shortcutSettings: { ...defaults, shape: 'list', note: 'meta+n' } });
  assert.equal(saved.shortcutSettings.note, 'Meta+N');
  assert.deepEqual(loadSettings(file), saved);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => saveSettings(file, { ...saved, shortcutSettings: { ...defaults, todo: defaults.launcher } }), { code: 'INVALID_SHORTCUT_SETTINGS' });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.existsSync(file + '.tmp'), false);
});

test('便签和待办启动方式独立保存，旧配置默认面板，非法枚举拒绝覆盖', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-shortcut-behavior-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  const legacy = { shape: 'list', enabled: true, launcher: 'Alt+Q', note: 'Alt+N' };
  fs.writeFileSync(file, JSON.stringify({ shortcutSettings: legacy }));
  assert.deepEqual(loadSettings(file).shortcutSettings, { ...defaults, ...legacy });
  assert.deepEqual(validateShortcutSettings(legacy).config, { ...defaults, ...legacy });
  for (const noteBehavior of ['panel', 'create']) for (const todoBehavior of ['panel', 'create']) {
    const config = { ...defaults, noteBehavior, todoBehavior };
    const saved = saveSettings(file, { shortcutSettings: config });
    assert.deepEqual(saved.shortcutSettings, config);
    assert.deepEqual(loadSettings(file).shortcutSettings, config);
  }
  const before = fs.readFileSync(file, 'utf8');
  for (const field of ['noteBehavior', 'todoBehavior']) for (const value of ['new', 'Panel', '', null, undefined, true, {}, []]) {
    const config = { ...defaults, [field]: value };
    const invalid = validateShortcutSettings(config);
    assert.equal(invalid.ok, false);
    assert.equal(invalid.errors[0].field, field);
    assert.equal(invalid.errors[0].code, 'invalid_behavior');
    assert.throws(() => saveSettings(file, { shortcutSettings: config }), { code: 'INVALID_SHORTCUT_SETTINGS' });
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.deepEqual(normalizeShortcutSettings(config), defaults);
  }
});

test('只改启动方式不重新注册全局键，持久化成功后才切换，失败保留旧行为', () => {
  const globalShortcut = fakeGlobalShortcut(), fired = [];
  const initial = { ...defaults, note: 'Alt+N', todo: 'Alt+T' };
  const registrar = createShortcutRegistrar({ globalShortcut, config: initial,
    onAction: id => fired.push([id, registrar.getConfig()[id + 'Behavior']]) });
  registrar.start();
  const count = globalShortcut.calls.length;
  const next = { ...initial, noteBehavior: 'create' };
  assert.equal(registrar.apply(next, candidate => {
    assert.deepEqual(candidate, next);
    globalShortcut.fire('Alt+N');
  }).ok, true);
  globalShortcut.fire('Alt+N'); globalShortcut.fire('Alt+T');
  assert.deepEqual(fired, [['note', 'panel'], ['note', 'create'], ['todo', 'panel']]);
  assert.equal(globalShortcut.calls.length, count);
  assert.equal(registrar.apply({ ...next, noteBehavior: 'panel', todoBehavior: 'create' }, () => { throw new Error('disk failure'); }).ok, false);
  assert.deepEqual(registrar.getConfig(), next);
  assert.equal(globalShortcut.calls.length, count);
  globalShortcut.fire('Alt+N'); globalShortcut.fire('Alt+T');
  assert.deepEqual(fired.slice(-2), [['note', 'create'], ['todo', 'panel']]);
});

test('启动有占用时只降级对应快捷键，保留配置和其他可用直达', () => {
  const globalShortcut = fakeGlobalShortcut(), actions = [];
  globalShortcut.blocked.add(defaults.launcher);
  const registrar = createShortcutRegistrar({ globalShortcut, config: { ...defaults, note: 'Alt+N' }, onAction: action => actions.push(action) });
  const state = registrar.start();
  assert.equal(state.ok, false);
  assert.equal(state.errors[0].field, 'launcher');
  assert.deepEqual(state.config, { ...defaults, note: 'Alt+N' });
  assert.deepEqual(registrar.getState().active, { launcher: false, chat: false, custom: false, note: true, todo: false, pomodoro: false, weather: false });
  globalShortcut.fire('Alt+N');
  assert.deepEqual(actions, ['note']);
  globalShortcut.blocked.clear();
  assert.equal(registrar.apply(registrar.getConfig(), () => {}).ok, true, '保存时重试启动失败的键');
  assert.equal(registrar.getAction(defaults.launcher), 'launcher');
});

test('新组合冲突会释放本次已注册的新键，旧键与配置保持可用且不写盘', () => {
  const globalShortcut = fakeGlobalShortcut(), actions = [];
  const registrar = createShortcutRegistrar({ globalShortcut, onAction: action => actions.push(action) });
  registrar.start();
  globalShortcut.blocked.add('Alt+T');
  let saves = 0;
  const state = registrar.apply({ ...defaults, launcher: 'Alt+Q', note: 'Alt+N', todo: 'Alt+T' }, () => { saves++; });
  assert.equal(state.ok, false);
  assert.equal(state.errors[0].field, 'todo');
  assert.equal(saves, 0);
  assert.deepEqual([...globalShortcut.registered.keys()], [defaults.launcher]);
  assert.deepEqual(registrar.getConfig(), defaults);
  globalShortcut.fire(defaults.launcher);
  assert.deepEqual(actions, ['launcher']);
});

test('新增注册异常同样回滚，不释放其他功能持有的快捷键', () => {
  const globalShortcut = fakeGlobalShortcut();
  globalShortcut.register('Meta+X', () => {});
  const registrar = createShortcutRegistrar({ globalShortcut });
  registrar.start();
  globalShortcut.throws.add('Alt+T');
  const state = registrar.apply({ ...defaults, note: 'Alt+N', todo: 'Alt+T' }, () => assert.fail('不应保存'));
  assert.equal(state.errors[0].code, 'registration_failed');
  assert.deepEqual([...globalShortcut.registered.keys()].sort(), ['Meta+X', defaults.launcher].sort());
  registrar.dispose();
  assert.deepEqual([...globalShortcut.registered.keys()], ['Meta+X']);
});

test('设置写入失败时保留旧回调映射，释放新键且配置快照不被外部修改', () => {
  const globalShortcut = fakeGlobalShortcut(), actions = [];
  const initial = { ...defaults, chat: 'Alt+C' };
  const registrar = createShortcutRegistrar({ globalShortcut, config: initial, onAction: action => actions.push(action) });
  registrar.start();
  const state = registrar.apply({ ...initial, chat: '', note: 'Alt+C', todo: 'Alt+T' }, () => { throw new Error('disk full'); });
  assert.equal(state.errors[0].code, 'persistence_failed');
  assert.deepEqual(registrar.getConfig(), initial);
  globalShortcut.fire('Alt+C');
  assert.deepEqual(actions, ['chat']);
  assert.equal(globalShortcut.registered.has('Alt+T'), false);
  state.config.chat = 'Alt+Z';
  state.errors[0].code = 'changed';
  assert.equal(registrar.getConfig().chat, 'Alt+C');
  assert.equal(registrar.getErrors()[0].code, 'persistence_failed');
});

test('成功保存先确保新增键可注册，持久化成功后才释放旧键和切换回调', () => {
  const globalShortcut = fakeGlobalShortcut(), actions = [];
  const registrar = createShortcutRegistrar({ globalShortcut, onAction: action => actions.push(action) });
  registrar.start();
  const next = { ...defaults, launcher: 'Alt+Q', note: 'Alt+N' };
  const state = registrar.apply(next, config => {
    assert.deepEqual(config, next);
    assert.equal(globalShortcut.registered.has(defaults.launcher), true);
    assert.equal(globalShortcut.registered.has('Alt+Q'), true);
    globalShortcut.fire(defaults.launcher);
    globalShortcut.fire('Alt+Q');
    assert.deepEqual(actions, ['launcher'], '未提交的新键尚不执行新动作');
  });
  assert.equal(state.ok, true);
  assert.equal(globalShortcut.registered.has(defaults.launcher), false);
  globalShortcut.fire('Alt+Q');
  globalShortcut.fire('Alt+N');
  assert.deepEqual(actions, ['launcher', 'launcher', 'note']);
});

test('相同组合交换功能时不重新注册，回调按最新映射执行', () => {
  const globalShortcut = fakeGlobalShortcut(), actions = [];
  const initial = { ...defaults, chat: 'Alt+C', note: 'Alt+N' };
  const registrar = createShortcutRegistrar({ globalShortcut, config: initial, onAction: action => actions.push(action) });
  registrar.start();
  const callCount = globalShortcut.calls.length;
  assert.equal(registrar.apply({ ...initial, chat: 'Alt+N', note: 'Alt+C' }, () => {}).ok, true);
  assert.equal(globalShortcut.calls.length, callCount);
  globalShortcut.fire('Alt+C');
  globalShortcut.fire('Alt+N');
  assert.deepEqual(actions, ['note', 'chat']);
});

test('关闭快捷入口只释放唤起键，直达功能仍生效；重复 dispose 无副作用', () => {
  const globalShortcut = fakeGlobalShortcut(), actions = [];
  const initial = { ...defaults, pomodoro: 'Alt+P' };
  const registrar = createShortcutRegistrar({ globalShortcut, config: initial, onAction: action => actions.push(action) });
  registrar.start();
  assert.equal(registrar.apply({ ...initial, enabled: false }, () => {}).ok, true);
  assert.equal(globalShortcut.registered.has(defaults.launcher), false);
  globalShortcut.fire('Alt+P');
  assert.deepEqual(actions, ['pomodoro']);
  registrar.dispose();
  const count = globalShortcut.calls.length;
  registrar.dispose();
  assert.equal(globalShortcut.calls.length, count);
  assert.equal(registrar.apply(initial, () => assert.fail('已关闭')).ok, false);
});

test('录键暂停现有全局组合，保存前恢复注册，取消也恢复原键', () => {
  const globalShortcut = fakeGlobalShortcut(), actions = [];
  const registrar = createShortcutRegistrar({ globalShortcut, onAction: action => actions.push(action) });
  registrar.start();
  assert.equal(registrar.setRecording(true), true);
  globalShortcut.fire(defaults.launcher);
  assert.deepEqual(actions, []);
  assert.equal(registrar.apply({ ...defaults, launcher: 'Alt+Q' }, () => {}).ok, true);
  assert.equal(registrar.getState().recording, false);
  globalShortcut.fire('Alt+Q');
  registrar.setRecording(true);
  registrar.setRecording(false);
  globalShortcut.fire('Alt+Q');
  assert.deepEqual(actions, ['launcher', 'launcher']);
});

test('非法保存请求不调用系统注册或持久化，返回字段错误且旧快捷键继续生效', () => {
  const globalShortcut = fakeGlobalShortcut(), actions = [];
  const registrar = createShortcutRegistrar({ globalShortcut, onAction: action => actions.push(action) });
  registrar.start();
  const count = globalShortcut.calls.length;
  const state = registrar.apply({ ...defaults, chat: 'Shift+C' }, () => assert.fail('不应持久化'));
  assert.equal(state.ok, false);
  assert.equal(state.errors[0].field, 'chat');
  assert.equal(globalShortcut.calls.length, count);
  globalShortcut.fire(defaults.launcher);
  assert.deepEqual(actions, ['launcher']);
});

test('weather shortcut is opt-in, persists independently and routes through the shared registrar',()=>{
 assert.equal(defaults.weather,'');assert.equal(normalizeShortcutSettings({chat:'Alt+C'}).weather,'');
 const globalShortcut=fakeGlobalShortcut(), actions=[];
 const registrar=createShortcutRegistrar({globalShortcut,config:{...defaults,weather:'Meta+W'},onAction:action=>actions.push(action)});
 registrar.start();globalShortcut.fire('Meta+W');assert.deepEqual(actions,['weather']);
 assert.equal(registrar.getConfig().weather,'Meta+W');registrar.dispose();
});
