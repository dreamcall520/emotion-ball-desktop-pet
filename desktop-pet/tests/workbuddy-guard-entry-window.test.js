const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { entryBounds, createWorkBuddyGuardEntryWindow } = require('../lib/workbuddy-guard-entry-window');
const {primary}=require('../quota-guard-renderer');
test('practice entry uses only nearby free side, respects screen and obstacles', () => {
  const area={x:0,y:0,width:1000,height:700};
  assert.deepEqual(entryBounds({x:0,y:300,width:128,height:32},area,[],'left'),{bounds:{x:136,y:294,width:48,height:44},side:'right'});
  assert.equal(entryBounds({x:872,y:300,width:128,height:32},area,[],'right').side,'left');
  const card={x:400,y:300,width:128,height:32};
  assert.equal(entryBounds(card,area,[{x:340,y:290,width:60,height:60},{x:530,y:290,width:60,height:60}]),null);
});
test('entry stays lazy, sends only practice model, validates IPC and closes cleanly', async () => {
  const windows=[];let opened=0;
  class Window extends EventEmitter {
    constructor(){super();this.visible=false;this.dead=false;this.bounds={x:0,y:0,width:48,height:44};this.sent=[];this.webContents=Object.assign(new EventEmitter(),{isDestroyed:()=>false,mainFrame:{},setWindowOpenHandler:fn=>{this.open=fn;},send:(_channel,value)=>this.sent.push(value),getURL:()=>this.url});windows.push(this);}
    isDestroyed(){return this.dead;} isVisible(){return this.visible;} getBounds(){return this.bounds;} setBounds(b){this.bounds=b;} setAlwaysOnTop(){} setVisibleOnAllWorkspaces(){} setHiddenInMissionControl(){} showInactive(){this.visible=true;} hide(){this.visible=false;} destroy(){this.dead=true;this.emit('closed');} loadFile(file){this.url=pathToFileURL(file).href;return Promise.resolve();}
  }
  const entry=createWorkBuddyGuardEntryWindow({BrowserWindow:Window,onGuard:()=>opened++});
  assert.equal(windows.length,0);
  entry.show({x:400,y:300,width:128,height:32},{x:0,y:0,width:1000,height:700},[]);
  await Promise.resolve(); const win=windows[0];
  assert.equal(win.isVisible(),true);assert.equal(win.sent[0].practice,true);assert.deepEqual(win.sent[0].items,[]);
  assert.deepEqual(win.open(),{action:'deny'});
  const event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
  win.webContents.emit('ipc-message',{...event,senderFrame:{}},'pet:workbuddy-guard-entry-open');assert.equal(opened,0);
  win.webContents.emit('ipc-message',event,'pet:workbuddy-guard-entry-open');assert.equal(opened,1);
  entry.hide();win.webContents.emit('ipc-message',event,'pet:workbuddy-guard-entry-open');assert.equal(opened,1);
  entry.destroy();assert.equal(entry.getWindow(),null);
});
test('shared entry projects a real Codex percentage while WorkBuddy/API keep practice energy independent',async()=>{
 const windows=[];
 class Window extends EventEmitter{
  constructor(){super();this.visible=false;this.dead=false;this.bounds={x:0,y:0,width:48,height:44};this.sent=[];this.webContents=Object.assign(new EventEmitter(),{isDestroyed:()=>false,mainFrame:{},setWindowOpenHandler(){},send:(_,value)=>this.sent.push(value),getURL:()=>this.url});windows.push(this);}
  isDestroyed(){return this.dead;}isVisible(){return this.visible;}getBounds(){return this.bounds;}setBounds(value){this.bounds=value;}setAlwaysOnTop(){}setVisibleOnAllWorkspaces(){}setHiddenInMissionControl(){}showInactive(){this.visible=true;}hide(){this.visible=false;}destroy(){this.dead=true;this.emit('closed');}loadFile(file){this.url=pathToFileURL(file).href;return Promise.resolve();}
 }
 const entry=createWorkBuddyGuardEntryWindow({BrowserWindow:Window}),card={x:400,y:300,width:128,height:32},area={x:0,y:0,width:1000,height:700};
 entry.show(card,area,[],null,{sourceId:'codex',state:'ready',practice:false,token:'private',items:[{remaining:0,windowMinutes:300,token:'private'},{remaining:99,windowMinutes:10080}]});await Promise.resolve();
 const win=windows[0],model=win.sent.at(-1);assert.equal(model.practice,false);assert.equal(model.sourceId,'codex');assert.deepEqual(model.items,[{remaining:0,windowMinutes:300}]);assert.equal(primary(model).remaining,0);assert.equal(JSON.stringify(model).includes('private'),false);
 for(const sourceId of ['workbuddy','api','balance']){entry.show(card,area,[],null,{sourceId,state:'ready',practice:true,items:[{remaining:2,windowMinutes:300}],credits:8351});const current=win.sent.at(-1);assert.equal(current.sourceId,sourceId);assert.equal(current.practice,true);assert.deepEqual(current.items,[]);assert.equal(primary(current).remaining,100);}
 entry.show(card,area,[],null,{sourceId:'codex',state:'ready',items:[{remaining:200,windowMinutes:300}]});assert.equal(win.isVisible(),false);
 entry.show(card,area,[],null,{sourceId:'codex',state:'stale',items:[{remaining:10,windowMinutes:300}]});assert.equal(win.isVisible(),false);entry.destroy();
});
