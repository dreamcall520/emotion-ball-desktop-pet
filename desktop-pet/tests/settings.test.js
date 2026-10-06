const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEFAULTS,
  normalizeSettings,
  loadSettings,
  saveSettings
} = require('../lib/settings');

test('无效设置回退默认值', () => {
  assert.deepEqual(
    normalizeSettings({ size: 'huge', x: 'bad', alwaysOnTop: 0 }),
    DEFAULTS
  );
});

test('主题色兼容旧设置且独立持久化，不改写形象及既有外观偏好', t => {
  assert.equal(DEFAULTS.uiTheme, 'green');
  assert.equal(normalizeSettings({}).uiTheme, 'green');
  for (const uiTheme of [undefined, null, '', 'Green', 'blue ', 'mint', 1, true, {}, []]) {
    assert.equal(normalizeSettings({ uiTheme }).uiTheme, 'green');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-ui-theme-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  const legacy = {
    notesAppearance: 'dark', notesDefaultTab: 'todo', codexQuotaAppearance: 'light', colorMode: 'accessible',
    customization: { appearance: { shape: 'square', bodyColor: '#123456', eyeColor: '#ABCDEF' } },
    startupAppearance: { shape: 'cloud', bodyColor: '#654321' },
    appearancePresets: [
      { id: '00000000-0000-4000-8000-000000000001', name: '原有方糖', appearance: { shape: 'square', bodyColor: '#234567' } },
      { id: '00000000-0000-4000-8000-000000000002', name: '原有幻彩', appearance: { shape: 'aurora-cloud', auroraStyle: 'simple', auroraTransparency: 42 } }
    ]
  };
  fs.writeFileSync(file, JSON.stringify(legacy));
  const original = loadSettings(file), before = JSON.stringify(original);
  assert.equal(original.uiTheme, 'green', '旧文件没有主题色字段时沿用薄荷绿');
  for (const uiTheme of ['green', 'blue']) for (const colorMode of ['standard', 'accessible']) for (const codexQuotaAppearance of ['system', 'light', 'dark']) {
    const saved = saveSettings(file, { ...original, uiTheme, colorMode, codexQuotaAppearance });
    const loaded = loadSettings(file);
    assert.deepEqual(loaded, saved);
    assert.equal(loaded.uiTheme, uiTheme);
    assert.equal(loaded.colorMode, colorMode);
    assert.equal(loaded.codexQuotaAppearance, codexQuotaAppearance);
    for (const key of ['customization', 'startupAppearance', 'appearancePresets', 'notesAppearance', 'notesDefaultTab']) {
      assert.deepEqual(loaded[key], original[key], '切换主题保留 ' + key);
    }
  }
  assert.equal(JSON.stringify(original), before, '保存主题不修改传入的原设置');
  assert.equal(fs.existsSync(file + '.tmp'), false);
});

test('便签待办默认页面只接受两个页签，保存后可回读', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-notes-default-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  assert.equal(DEFAULTS.notesDefaultTab, 'note');
  for (const notesDefaultTab of ['note', 'todo']) {
    saveSettings(file, { notesDefaultTab, x: 42 });
    assert.equal(loadSettings(file).notesDefaultTab, notesDefaultTab);
    assert.equal(loadSettings(file).x, 42);
  }
  for (const notesDefaultTab of [undefined, null, '', 'notes', 'note ', 1, {}, []]) {
    assert.equal(normalizeSettings({ notesDefaultTab }).notesDefaultTab, 'note');
  }
  saveSettings(file, { notesDefaultTab: 'invalid' });
  assert.equal(loadSettings(file).notesDefaultTab, 'note');
});

test('API 常驻开关只接受布尔值，独立持久化且不保存报表或密钥', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-api-label-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  assert.equal(normalizeSettings({ openaiApiAlwaysVisible: 'true' }).openaiApiAlwaysVisible, false);
  saveSettings(file, { openaiApiAlwaysVisible: true, key: 'SECRET_KEY', report: { costs: 99 } });
  const saved = loadSettings(file);
  assert.equal(saved.openaiApiAlwaysVisible, true);
  assert.equal(saved.codexEnabled, false);
  assert.equal(saved.codexQuotaAlwaysVisible, true);
  assert.equal(fs.readFileSync(file, 'utf8').includes('SECRET_KEY'), false);
  assert.equal(Object.hasOwn(saved, 'report'), false);
});

test('损坏文件回退且有效设置可回读', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-pet-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');

  fs.writeFileSync(file, '{bad json');
  assert.deepEqual(loadSettings(file), DEFAULTS);

  saveSettings(file, { size: 'tiny', x: 12, y: 20, alwaysOnTop: false });
  assert.deepEqual(loadSettings(file), {
    size: 'tiny',
    x: 12,
    y: 20,
    alwaysOnTop: false,
    keepAwake: true,
    bubblesEnabled: true,
    colorMode: 'standard',
    uiTheme: 'green',
    chatModel: 'auto',
    notesDefaultTab: 'note', notesAppearance: 'light',
    customization: DEFAULTS.customization,
    startupAppearance: DEFAULTS.startupAppearance,
    appearancePresets: [],
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
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('旧配置保留尺寸位置置顶并补齐陪伴开关默认值', () => {
  assert.deepEqual(normalizeSettings({ size: 'small', x: -102.3, y: 81.8, alwaysOnTop: false }), {
    size: 'small', x: -102, y: 82, alwaysOnTop: false,
    keepAwake: true, bubblesEnabled: true, colorMode: 'standard', uiTheme: 'green', chatModel: 'auto', notesDefaultTab: 'note', notesAppearance: 'light', customization: DEFAULTS.customization,
    startupAppearance: DEFAULTS.startupAppearance,
    appearancePresets: [], codexEnabled: false,
    codexTaskNameInAlerts: true, codexQuotaAlwaysVisible: true,
    codexShowExtraCredits: true,
    openaiApiAlwaysVisible: false,
    autoUpdateCheck: true, lastUpdateNotifiedVersion: '',
    codexQuotaPeriod: 'auto', codexQuotaLabelSize: 'compact', codexQuotaAppearance: 'system'
  });
});

test('旧外观沿用为启动默认，临时换装不覆盖已选启动外观', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-pet-startup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  const legacy = normalizeSettings({ customization: { appearance: { shape: 'cloud' } } });
  assert.equal(legacy.startupAppearance.shape, 'cloud');
  const saved = saveSettings(file, { ...legacy,
    customization: { appearance: { shape: 'square' } } });
  assert.equal(saved.customization.appearance.shape, 'square');
  assert.equal(loadSettings(file).startupAppearance.shape, 'cloud');
});

test('额外点数默认显示，明确关闭可持久化，余额不进入设置文件', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-pro-credits-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  assert.equal(DEFAULTS.codexShowExtraCredits, true);
  for (const value of [undefined, null, 0, 'false', {}]) {
    assert.equal(normalizeSettings({ codexShowExtraCredits: value }).codexShowExtraCredits, true);
  }
  saveSettings(file, { codexShowExtraCredits: false, credits: { balance: '62485.1547310000' } });
  assert.equal(loadSettings(file).codexShowExtraCredits, false);
  assert.equal(fs.readFileSync(file, 'utf8').includes('62485'), false);
});

test('陪伴开关只接受布尔值且不保存输入信息', () => {
  assert.deepEqual(normalizeSettings({
    keepAwake: true, bubblesEnabled: false, inputText: '不保存', cursor: { x: 1, y: 2 }, idleSeconds: 99
  }), { ...DEFAULTS, keepAwake: true, bubblesEnabled: false });
  assert.deepEqual(normalizeSettings({ keepAwake: 'true', bubblesEnabled: 0 }), DEFAULTS);
});

test('模型选择独立持久化，旧配置默认自动，非法id不进入设置', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-pet-model-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  assert.equal(normalizeSettings({}).chatModel, 'auto');
  for (const chatModel of ['auto', 'gpt-6-luna', 'gpt-6-astra']) {
    saveSettings(file, { chatModel, x: 42, colorMode: 'accessible' });
    assert.equal(loadSettings(file).chatModel, chatModel);
    assert.equal(loadSettings(file).x, 42);
    assert.equal(loadSettings(file).colorMode, 'accessible');
  }
  for (const chatModel of [' bad ', {}, 'x\nmodel', '<script>', null]) assert.equal(normalizeSettings({ chatModel }).chatModel, 'auto');
});

test('首次使用默认保持清醒和互动气泡，但保留用户明确关闭的选择', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-explicit-defaults-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  for (const key of ['keepAwake', 'bubblesEnabled', 'codexTaskNameInAlerts', 'codexQuotaAlwaysVisible']) {
    assert.equal(DEFAULTS[key], true); assert.equal(normalizeSettings({})[key], true);
    assert.equal(normalizeSettings({ [key]: false })[key], false);
  }
  const explicitOff = { keepAwake: false, bubblesEnabled: false, codexTaskNameInAlerts: false, codexQuotaAlwaysVisible: false };
  saveSettings(file, explicitOff);
  for (const key of Object.keys(explicitOff)) assert.equal(loadSettings(file)[key], false, '重启保留 ' + key);
  assert.equal(loadSettings(file).codexEnabled, false, '总开关仍默认关闭');
});

test('陪伴开关保存后可回读且仅写入允许设置', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-pet-companion-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  const saved = saveSettings(file, { keepAwake: true, bubblesEnabled: false, inputText: '不保存' });
  assert.deepEqual(saved, { ...DEFAULTS, keepAwake: true, bubblesEnabled: false });
  assert.deepEqual(loadSettings(file), saved);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), saved);
  assert.equal(fs.readFileSync(file, 'utf8').includes('inputText'), false);
});

test('Codex 联动默认关闭且只接受布尔值', () => {
  assert.equal(DEFAULTS.codexEnabled, false);
  assert.equal(normalizeSettings({}).codexEnabled, false);
  for (const codexEnabled of ['true', 1, null, {}, []]) {
    assert.equal(normalizeSettings({ codexEnabled }).codexEnabled, false);
  }
  assert.deepEqual(normalizeSettings({ size: 'tiny', x: 12, y: 34, keepAwake: true, codexEnabled: true }), {
    ...DEFAULTS, size: 'tiny', x: 12, y: 34, keepAwake: true, codexEnabled: true
  });
});

test('额度显示默认开启、显式关闭保留且周期只接受三个枚举', () => {
  assert.equal(DEFAULTS.codexQuotaAlwaysVisible, true);
  assert.equal(DEFAULTS.codexQuotaPeriod, 'auto');
  for (const period of ['auto', 'fiveHour', 'weekly']) {
    assert.equal(normalizeSettings({ codexQuotaPeriod: period }).codexQuotaPeriod, period);
  }
  for (const period of ['', 'daily', 300, null, {}]) {
    assert.equal(normalizeSettings({ codexQuotaPeriod: period }).codexQuotaPeriod, 'auto');
  }
  assert.equal(normalizeSettings({ codexQuotaAlwaysVisible: true }).codexQuotaAlwaysVisible, true);
  assert.equal(normalizeSettings({ codexQuotaAlwaysVisible: false }).codexQuotaAlwaysVisible, false);
  for (const value of ['true', 'false', 1, null, {}, []]) {
    assert.equal(normalizeSettings({ codexQuotaAlwaysVisible: value }).codexQuotaAlwaysVisible, true);
  }
});

test('球球默认极小 80×80，同时接受超小和紧凑尺寸', () => {
  assert.equal(DEFAULTS.size, 'tiny');
  assert.equal(normalizeSettings({ size: 'micro' }).size, 'micro');
  assert.equal(normalizeSettings({ size: 'compact' }).size, 'compact');
});

test('额度卡片默认为小巧，只接受标准和小巧两档', () => {
  assert.equal(DEFAULTS.codexQuotaLabelSize, 'compact');
  for (const size of ['standard', 'compact']) {
    assert.equal(normalizeSettings({ codexQuotaLabelSize: size }).codexQuotaLabelSize, size);
  }
  for (const size of ['', 'small', 'large', 168, null, {}]) {
    assert.equal(normalizeSettings({ codexQuotaLabelSize: size }).codexQuotaLabelSize, 'compact');
  }
});

test('额度卡片外观默认跟随系统，只接受跟随系统、浅色和深色', () => {
  assert.equal(DEFAULTS.codexQuotaAppearance, 'system');
  for (const appearance of ['system', 'light', 'dark']) {
    assert.equal(normalizeSettings({ codexQuotaAppearance: appearance }).codexQuotaAppearance, appearance);
  }
  for (const appearance of ['', 'auto', 'night', 1, null, {}]) {
    assert.equal(normalizeSettings({ codexQuotaAppearance: appearance }).codexQuotaAppearance, 'system');
  }
});

test('任务名称提醒默认开启但保留显式关闭，仅接受布尔值', () => {
  assert.equal(DEFAULTS.codexTaskNameInAlerts, true);
  assert.equal(normalizeSettings({}).codexTaskNameInAlerts, true);
  for (const codexTaskNameInAlerts of ['true', 'false', 1, null, {}, []]) {
    assert.equal(normalizeSettings({ codexTaskNameInAlerts }).codexTaskNameInAlerts, true);
  }
  assert.equal(normalizeSettings({ codexTaskNameInAlerts: true }).codexTaskNameInAlerts, true);
  assert.equal(normalizeSettings({ codexTaskNameInAlerts: false }).codexTaskNameInAlerts, false);
});

test('Codex 只持久化开关，不保存账号额度快照阈值或任务信息', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-pet-codex-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  const saved = saveSettings(file, {
    codexEnabled: true,
    codexQuotaAlwaysVisible: true,
    codexQuotaPeriod: 'weekly',
    codexQuotaLabelSize: 'compact',
    codexQuotaAppearance: 'dark',
    account: { email: 'private@example.com' },
    quotaSnapshot: { remaining: 1 },
    quotaThresholds: { warning: 80 },
    tasks: ['private'],
    taskBody: 'PRIVATE_BODY',
    body: 'PRIVATE_GENERIC_BODY'
  });
  assert.deepEqual(saved, {
    ...DEFAULTS,
    codexEnabled: true,
    codexQuotaAlwaysVisible: true,
    codexQuotaPeriod: 'weekly',
    codexQuotaLabelSize: 'compact',
    codexQuotaAppearance: 'dark'
  });
  assert.deepEqual(loadSettings(file), saved);
  const persisted = fs.readFileSync(file, 'utf8');
  assert.equal(persisted.includes('private@example.com'), false);
  assert.equal(persisted.includes('"private"'), false);
  assert.equal(persisted.includes('PRIVATE_BODY'), false);
  assert.equal(persisted.includes('PRIVATE_GENERIC_BODY'), false);
  for (const key of ['account', 'quotaSnapshot', 'quotaThresholds', 'tasks', 'taskBody', 'body']) {
    assert.equal(Object.hasOwn(JSON.parse(persisted), key), false);
  }
});

test('任务名称提醒只持久化隐私开关，不保存任务信息', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emotion-pet-task-name-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  const saved = saveSettings(file, {
    codexTaskNameInAlerts: true,
    taskTitle: 'PRIVATE_TITLE',
    taskBody: 'PRIVATE_BODY'
  });
  assert.equal(saved.codexTaskNameInAlerts, true);
  const persisted = fs.readFileSync(file, 'utf8');
  assert.equal(persisted.includes('PRIVATE_TITLE'), false);
  assert.equal(persisted.includes('PRIVATE_BODY'), false);
  assert.equal(Object.hasOwn(JSON.parse(persisted), 'taskTitle'), false);
  assert.equal(Object.hasOwn(JSON.parse(persisted), 'taskBody'), false);
});

test('旧便签外观字段保持兼容，保存不覆盖已有全局外观，非法值保留旧回退', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qiu-notes-appearance-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'settings.json');
  for(const notesAppearance of ['system','light','dark']) {saveSettings(file,{notesAppearance,codexQuotaAppearance:'dark',notesDefaultTab:'note'});assert.equal(loadSettings(file).notesAppearance,notesAppearance);assert.equal(loadSettings(file).codexQuotaAppearance,'dark');assert.equal(loadSettings(file).notesDefaultTab,'note')}
  for(const notesAppearance of [undefined,null,'bad',1,{}])assert.equal(normalizeSettings({notesAppearance}).notesAppearance,'light');
});


test('形象收藏只保存ID、名称和规范外观，名称与数量有明确边界', () => {
  const { normalizePresetName, normalizeAppearancePresets } = require('../lib/settings');
  const id = index => '00000000-0000-4000-8000-' + String(index).padStart(12, '0');
  assert.equal(normalizePresetName('  薄荷奶糖  '), '薄荷奶糖');
  for (const name of ['', '   ', 'a'.repeat(25), 'a\nb', 'a\u0000b', null]) assert.equal(normalizePresetName(name), null);
  const records = [
    { id:id(1), name:' 薄荷 ', appearance:{shape:'square',bodyColor:'#123456',auroraTransparency:42}, extra:'drop' },
    { id:id(2), name:'薄荷', appearance:{shape:'cloud'} },
    { id:id(1), name:'重复ID', appearance:{shape:'blob'} },
    { id:'path', name:'无效ID', appearance:{shape:'blob'} },
    { id:id(3), name:'无外观', appearance:null }
  ];
  const result = normalizeAppearancePresets(records);
  assert.equal(result.length,1);
  assert.deepEqual(Object.keys(result[0]), ['id','name','appearance']);
  assert.equal(result[0].name,'薄荷'); assert.equal(result[0].appearance.auroraTransparency,42);
  assert.equal(normalizeAppearancePresets(Array.from({length:25},(_,index)=>({id:id(index+1),name:'形象'+index,appearance:{shape:'blob'}}))).length,20);
});


test('形象内容比较按规范化的可见字段，忽略隐藏内光且不修改输入', () => {
  const { appearanceContentKey, normalizeAppearance, SHAPES } = require('../lib/customization');
  const { findDuplicateAppearancePreset } = require('../lib/settings');
  const id = '00000000-0000-4000-8000-000000000001';
  const appearance = { shape:'square',bodyColor:'#abcdef',eyeColor:'#FEDCBA',
    eyeScale:1.004,eyeSpacing:1.104,eyeHeight:2.4,auroraTransparency:20.4,
    shapeTuning:{width:1.104,height:1,softness:0.5,asymmetry:0},idleEyes:'happy' };
  const records = [{ id,name:'薄荷',appearance }];
  const before = JSON.stringify(records);
  const equivalent = { idleEyes:'happy',shapeTuning:{asymmetry:0,softness:0.5,height:1,width:1.1},
    auroraTransparency:20,eyeHeight:2,eyeSpacing:1.1,eyeScale:1,
    eyeColor:'#fedcba',bodyColor:'#ABCDEF',shape:'square',
    glowPinkColor:'#111111',glowGoldColor:'#222222',auroraStyle:'simple',auroraContour:'six-lobe' };
  assert.equal(findDuplicateAppearancePreset(records,equivalent)?.name,'薄荷');
  assert.equal(JSON.stringify(records),before);
  for (const value of [null,[],1]) assert.equal(findDuplicateAppearancePreset(records,value),null);
  for (const shape of SHAPES.filter(value=>value!=='aurora-cloud')) {
    const base = { ...appearance,shape };
    assert.equal(appearanceContentKey(base),appearanceContentKey({
      ...base,glowPinkColor:'#111111',glowGoldColor:'#222222',auroraStyle:'simple',auroraContour:'six-lobe'
    }),shape+' 忽略不可见的幻彩字段');
  }
  const visibleChanges = [
    {shape:'cloud'}, {bodyColor:'#123456'}, {eyeColor:'#123456'}, {eyeScale:0.8},
    {eyeSpacing:0.9}, {eyeHeight:8}, {auroraTransparency:40}, {idleEyes:'sleepy'},
    ...Object.entries({width:0.8,height:0.8,softness:0.2,asymmetry:0.5}).map(([key,value])=>({
      shapeTuning:{...appearance.shapeTuning,[key]:value}
    }))
  ];
  for (const change of visibleChanges) {
    assert.notEqual(appearanceContentKey(appearance),appearanceContentKey({...appearance,...change}),JSON.stringify(change));
  }
  const simple = { shape:'aurora-cloud',auroraStyle:'simple',auroraContour:'six-lobe' };
  assert.equal(appearanceContentKey(simple),appearanceContentKey({
    ...simple,glowPinkColor:'#111111',glowGoldColor:'#222222'
  }),'简色不使用两种内光');
  assert.notEqual(appearanceContentKey(simple),appearanceContentKey({...simple,auroraStyle:'dimensional'}));
  const dimensional = { ...simple,auroraStyle:'dimensional' };
  for (const change of [{glowPinkColor:'#111111'},{glowGoldColor:'#222222'},{auroraTransparency:30},
    {bodyColor:'#123456'},{eyeColor:'#123456'}]) {
    assert.notEqual(appearanceContentKey(dimensional),appearanceContentKey({...dimensional,...change}));
  }
  const original = { ...dimensional,auroraContour:'original' };
  assert.equal(appearanceContentKey(original)===appearanceContentKey(dimensional),
    normalizeAppearance(original).auroraContour===normalizeAppearance(dimensional).auroraContour);
});

test('已有同内容不同名收藏在保存重启后保留，不进行自动合并', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'emotion-existing-presets-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = path.join(dir,'settings.json');
  const records = [
    {id:'00000000-0000-4000-8000-000000000001',name:'旧名称',appearance:{shape:'square',bodyColor:'#2A8B6F'}},
    {id:'00000000-0000-4000-8000-000000000002',name:'旧副本',appearance:{shape:'square',bodyColor:'#2A8B6F'}}
  ];
  saveSettings(file,{appearancePresets:records});
  assert.deepEqual(loadSettings(file).appearancePresets.map(({id,name})=>({id,name})),
    records.map(({id,name})=>({id,name})));
});

test('命名形象原子保存与重启回读，独立于桌面及启动外观快照', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'emotion-appearance-presets-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'settings.json');
  const { normalizeAppearance } = require('../lib/customization');
  const appearance=normalizeAppearance({shape:'aurora-cloud',bodyColor:'#123456',eyeColor:'#FEDCBA',auroraStyle:'simple',auroraTransparency:42});
  const settings=saveSettings(file,{customization:{appearance:{shape:'square'}},startupAppearance:{shape:'cloud'},
    appearancePresets:[{id:'00000000-0000-4000-8000-000000000001',name:'幻彩薄荷',appearance}]});
  assert.deepEqual(loadSettings(file),settings);
  assert.deepEqual(loadSettings(file).appearancePresets[0].appearance,appearance);
  assert.equal(loadSettings(file).customization.appearance.shape,'square');
  assert.equal(loadSettings(file).startupAppearance.shape,'cloud');
  assert.equal(fs.existsSync(file+'.tmp'),false);
});
