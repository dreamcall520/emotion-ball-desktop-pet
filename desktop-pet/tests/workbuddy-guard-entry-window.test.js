const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { entryBounds, createWorkBuddyGuardEntryWindow } = require('../lib/workbuddy-guard-entry-window');
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
