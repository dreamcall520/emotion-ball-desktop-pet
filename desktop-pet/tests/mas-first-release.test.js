'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {settingsForFirstRelease,filterMenu}=require('../lib/mas-first-release');
test('商店保留已启用的WorkBuddy额度和卡片顺序，仍关闭其他多家/费用能力',()=>{
 const source={codexEnabled:true,workbuddyEnabled:true,zcodeEnabled:true,apiBalanceEnabled:true,chatSource:'zcode',quotaCardOrder:['workbuddy','codex','api','weather'],quotaCardPinned:['api','weather'],customization:{appearance:{shape:'dog'}},notesDefaultTab:'note'};
 const value=settingsForFirstRelease(source);
 assert.equal(value.chatSource,'zcode');assert.equal(value.chatProvider,'zcode');assert.equal(value.workbuddyEnabled,true);assert.equal(value.apiBalanceEnabled,false);assert.equal(value.codexEnabled,true);assert.deepEqual(value.quotaCardOrder,['workbuddy','codex','weather']);assert.deepEqual(value.quotaCardPinned,['weather']);assert.equal(value.customization,source.customization);assert.equal(source.workbuddyEnabled,true);
 assert.equal(settingsForFirstRelease({}).workbuddyEnabled,false);
});
test('首发商城不注册旧工具连接命令', () => {
 const source = require('node:fs').readFileSync(require.resolve('../main.js'), 'utf8');
 assert.match(source, /if \(IS_STORE_BUILD && !FIRST_RELEASE\) registerStoreConnections\(\)/);
});
test('商店保留三种官方聊天来源偏好，不借用其他provider', () => {
  assert.equal(settingsForFirstRelease({chatSource:'workbuddy'}).chatSource,'workbuddy');
  assert.equal(settingsForFirstRelease({chatSource:'workbuddy'}).chatProvider,'workbuddy');
  assert.equal(settingsForFirstRelease({chatSource:'zcode'}).chatSource,'zcode');
  for (const chatSource of ['codex','unknown',undefined]) {
    const value=settingsForFirstRelease({chatSource,chatProvider:'workbuddy'});
    assert.equal(value.chatSource,'codex');assert.equal(value.chatProvider,'codex');
  }
});
test('设置开放WorkBuddy额度与独立聊天入口，拒绝其他旧provider命令',()=>{
 const result=filterMenu([{id:'workbuddy-enabled'},{id:'workbuddy-quota-visible'},{id:'workbuddy-quota-fun'},{id:'workbuddy-tasks'},{id:'workbuddy-chat'},{id:'api-balance-menu'},{id:'customize-open'},{id:'codex-menu',submenu:[{id:'codex-quota-visible'},{id:'openai-api-menu',submenu:[]}]},{id:'weather-open'}]);
 assert.deepEqual(result.map(x=>x.id),['workbuddy-enabled','workbuddy-quota-visible','workbuddy-chat','customize-open','codex-menu','weather-open']);assert.deepEqual(result[4].submenu.map(x=>x.id),['codex-quota-visible']);
});

test('开发沙盒验收目录只允许显式同容器QA子目录，不复用或越出用户资料',()=>{const {acceptanceDirectory}=require('../lib/mas-first-release');const base='/container/Library/Application Support';assert.equal(acceptanceDirectory(base,'Candidate',base+'/FirstRelease-QA-test'),base+'/FirstRelease-QA-test');for(const requested of ['',null,'relative','/tmp/FirstRelease-QA-test',base+'/Candidate',base+'/../FirstRelease-QA-test'])assert.equal(acceptanceDirectory(base,'Candidate',requested),base+'/Candidate');});
