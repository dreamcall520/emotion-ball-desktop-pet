'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {settingsForFirstRelease,filterMenu}=require('../lib/mas-first-release');
test('首发不恢复旧多家/费用开关，同时保留定制和本地功能设置',()=>{
 const source={codexEnabled:true,workbuddyEnabled:true,zcodeEnabled:true,apiBalanceEnabled:true,chatSource:'zcode',quotaCardOrder:['workbuddy','codex','api','weather'],quotaCardPinned:['api','weather'],customization:{appearance:{shape:'dog'}},notesDefaultTab:'note'};
 const value=settingsForFirstRelease(source);
 assert.equal(value.chatSource,'codex');assert.equal(value.workbuddyEnabled,false);assert.equal(value.apiBalanceEnabled,false);assert.equal(value.codexEnabled,true);assert.deepEqual(value.quotaCardOrder,['codex','weather']);assert.deepEqual(value.quotaCardPinned,['weather']);assert.equal(value.customization,source.customization);assert.equal(source.workbuddyEnabled,true);
});
test('首发商城不注册旧工具连接命令', () => {
 const source = require('node:fs').readFileSync(require.resolve('../main.js'), 'utf8');
 assert.match(source, /if \(IS_STORE_BUILD && !FIRST_RELEASE\) registerStoreConnections\(\)/);
});
test('设置和子菜单移除未开放功能，保留Codex大小卡和天气入口',()=>{
 const result=filterMenu([{id:'workbuddy-enabled'},{id:'api-balance-menu'},{id:'customize-open'},{id:'codex-menu',submenu:[{id:'codex-quota-visible'},{id:'openai-api-menu',submenu:[]}]},{id:'weather-open'}]);
 assert.deepEqual(result.map(x=>x.id),['customize-open','codex-menu','weather-open']);assert.deepEqual(result[1].submenu.map(x=>x.id),['codex-quota-visible']);
});

test('开发沙盒验收目录只允许显式同容器QA子目录，不复用或越出用户资料',()=>{const {acceptanceDirectory}=require('../lib/mas-first-release');const base='/container/Library/Application Support';assert.equal(acceptanceDirectory(base,'Candidate',base+'/FirstRelease-QA-test'),base+'/FirstRelease-QA-test');for(const requested of ['',null,'relative','/tmp/FirstRelease-QA-test',base+'/Candidate',base+'/../FirstRelease-QA-test'])assert.equal(acceptanceDirectory(base,'Candidate',requested),base+'/Candidate');});
