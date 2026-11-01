'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {settingsForFirstRelease,filterMenu,allowsCommand}=require('../lib/mas-first-release');
test('首发不恢复旧多家/费用开关，同时保留定制和本地功能设置',()=>{
 const source={codexEnabled:true,workbuddyEnabled:true,zcodeEnabled:true,apiBalanceEnabled:true,chatSource:'zcode',quotaCardOrder:['workbuddy','codex','api','weather'],quotaCardPinned:['api','weather'],customization:{appearance:{shape:'dog'}},notesDefaultTab:'note'};
 const value=settingsForFirstRelease(source);
 assert.equal(value.chatSource,'codex');assert.equal(value.workbuddyEnabled,false);assert.equal(value.apiBalanceEnabled,false);assert.equal(value.codexEnabled,true);assert.deepEqual(value.quotaCardOrder,['codex','weather']);assert.deepEqual(value.quotaCardPinned,['weather']);assert.equal(value.customization,source.customization);assert.equal(source.workbuddyEnabled,true);
});
test('主进程首发命令拒绝隐藏的其他工具、插件安装和外部服务导入',()=>{
 for(const action of ['enable-provider','enable-provider-data','revoke-provider','open-provider-chat']){assert.equal(allowsCommand(action,{provider:'codex'}),true);assert.equal(allowsCommand(action,{provider:'zcode'}),false);assert.equal(allowsCommand(action,{provider:'workbuddy'}),false);}
 for(const action of ['install-provider-plugin','workbuddy-login','import-codex-service','import-zcode-service'])assert.equal(allowsCommand(action,{provider:'codex'}),false);
});
test('设置和子菜单移除未开放功能，保留Codex大小卡和天气入口',()=>{
 const result=filterMenu([{id:'workbuddy-enabled'},{id:'api-balance-menu'},{id:'customize-open'},{id:'codex-menu',submenu:[{id:'codex-quota-visible'},{id:'openai-api-menu',submenu:[]}]},{id:'weather-open'}]);
 assert.deepEqual(result.map(x=>x.id),['customize-open','codex-menu','weather-open']);assert.deepEqual(result[1].submenu.map(x=>x.id),['codex-quota-visible']);
});
