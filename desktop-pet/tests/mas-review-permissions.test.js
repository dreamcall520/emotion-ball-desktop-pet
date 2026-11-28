'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const distribution = require('../scripts/package-mas');
const development = require('../scripts/package-mas-development');
const scripts = [
  'desktop-pet/assets/workbuddy-desktop-hook/plugins/qiuqiu-task-events/scripts/emit-metadata.sh',
  'desktop-pet/assets/zcode-desktop-hook/plugins/qiuqiu-zcode-task-events/scripts/emit-metadata.sh'
];
const config = {teamId:'ABCDEF1234',bundleId:'com.example.qiuqiu.masdevelopment',releaseProfile:'mas-first',arch:'arm64',version:'1.0.3',marketingVersion:'1.0.3',electronVersion:'43.4.1',buildVersion:'1'};

test('both MAS signing paths omit the rejected executable-write permission and retain the actual sandbox rights', () => {
  for (const api of [distribution, development]) {
    const rights = api.entitlementsFor(config);
    assert.equal(Object.hasOwn(rights.main, 'com.apple.security.files.user-selected.executable'), false);
    for (const key of ['app-sandbox','files.user-selected.read-write','files.bookmarks.app-scope','network.client','network.server','personal-information.location']) {
      assert.equal(rights.main['com.apple.security.'+key], true, key);
    }
    assert.deepEqual(rights.child, {'com.apple.security.app-sandbox':true,'com.apple.security.inherit':true});
  }
});

test('both MAS packagers keep exactly the two fixed event scripts as physical resources inside the signed App', async t => {
  const asar = await import('@electron/asar');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-review-bundle-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const source = path.join(directory,'source');
  for (const name of [...scripts,'desktop-pet/native/example.node','desktop-pet/assets/unrelated.sh','desktop-pet/main.js']) {
    const file = path.join(source,name);fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,'synthetic archive content only\n');
  }
  for (const [index,api] of [distribution,development].entries()) {
    const options=api.packagerOptions(directory,config,source,'/synthetic/icon');
    const target=path.join(directory,'app-'+index+'.asar');
    await asar.createPackageWithOptions(source,target,options.asar);
    for (const name of [...scripts,'desktop-pet/native/example.node']) {
      assert.equal(asar.statFile(target,name).unpacked,true,name);
      assert.deepEqual(fs.readFileSync(path.join(target+'.unpacked',name)),fs.readFileSync(path.join(source,name)));
    }
    for (const name of ['desktop-pet/assets/unrelated.sh','desktop-pet/main.js']) {
      assert.notEqual(asar.statFile(target,name).unpacked,true,name+' remains sealed in ASAR');
      assert.equal(fs.existsSync(path.join(target+'.unpacked',name)),false);
    }
  }
});
