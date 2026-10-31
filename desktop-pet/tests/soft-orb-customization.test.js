const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const C = require('../lib/customization');
const { saveSettings, loadSettings } = require('../lib/settings');

test('小宇限定材质和HEX，固定轮廓五官并与旧形态隔离', () => {
  const a = C.normalizeAppearance({ shape:'soft-orb', orbMaterial:'__proto__', orbSecondaryColor:'red', bodyColor:'bad', eyeColor:'bad', eyeScale:1.25, eyeSpacing:1.3, eyeHeight:20, shapeTuning:{width:1.25}, idleEyes:'sleepy' });
  assert.deepEqual([a.orbMaterial,a.bodyColor,a.orbSecondaryColor,a.eyeColor], ['pearl','#F9F8FF','#B7A7EC','#FDFDFD']);
  assert.deepEqual([a.eyeScale,a.eyeSpacing,a.eyeHeight,a.idleEyes], [1,1,0,'original']);
  assert.deepEqual(a.shapeTuning, C.DEFAULT_SHAPE_TUNING);
  assert.equal(Object.hasOwn(C.normalizeAppearance({shape:'blob',orbMaterial:'plush'}),'orbMaterial'), false);
  assert.equal(C.applyShapeRecommendation({bodyColor:'#111111',orbMaterial:'synth'},'soft-orb').orbMaterial,'pearl');
  for (const orbMaterial of C.ORB_MATERIALS) assert.equal(C.normalizeAppearance({...a,orbMaterial}).orbMaterial,orbMaterial);
  assert.notEqual(C.appearanceContentKey(a),C.appearanceContentKey({...a,orbSecondaryColor:'#123456'}));
  assert.notEqual(C.appearanceContentKey(a),C.appearanceContentKey({...a,orbMaterial:'synth'}));
});

test('小宇当前设置、启动外观和收藏保存重读时三色与材质保持', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-orb-settings-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'settings.json');
  const appearance=C.normalizeAppearance({shape:'soft-orb',orbMaterial:'layered',bodyColor:'#7df3be',orbSecondaryColor:'#54c6b2',eyeColor:'#ffffff'});
  saveSettings(file,{customization:{appearance},startupAppearance:appearance,appearancePresets:[{id:'00000000-0000-4000-8000-000000000001',name:'薄荷柔光',appearance}]});
  const loaded=loadSettings(file);
  for(const a of [loaded.customization.appearance,loaded.startupAppearance,loaded.appearancePresets[0].appearance]) assert.deepEqual(a,appearance);
});
