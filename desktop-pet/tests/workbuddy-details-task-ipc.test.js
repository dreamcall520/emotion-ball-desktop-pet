const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { createWorkBuddyDetailsWindow } = require('../lib/workbuddy-details-window');
test('task open and clear IPC require owned main frame, valid ID and task action', () => {
  const opened=[];let cleared=0,win;
  class Window extends EventEmitter {
    constructor(){super();this.dead=false;this.visible=false;this.webContents=Object.assign(new EventEmitter(),{mainFrame:{},setWindowOpenHandler(){},send(){},getURL:()=>this.url});win=this;}
    isDestroyed(){return this.dead;}isVisible(){return this.visible;}setAlwaysOnTop(){}setBounds(){}show(){this.visible=true;}hide(){this.visible=false;}destroy(){this.dead=true;this.emit('closed');}loadFile(file){this.url=pathToFileURL(file).href;return Promise.resolve();}
  }
  const controller=createWorkBuddyDetailsWindow({BrowserWindow:Window,screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:1200,height:900}})},getAnchor:()=>({x:400,y:300,width:80,height:80}),onOpenTask:id=>opened.push(id),onClearTasks:()=>cleared++});
  controller.open({action:'results'});win.webContents.emit('did-finish-load');
  const event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
  win.webContents.emit('ipc-message',{...event,senderFrame:{}},'pet:workbuddy-details-open-task','task-one');
  win.webContents.emit('ipc-message',event,'pet:workbuddy-details-open-task','../bad');assert.deepEqual(opened,[]);
  win.webContents.emit('ipc-message',event,'pet:workbuddy-details-open-task','task-one');assert.deepEqual(opened,['task-one']);
  win.webContents.emit('ipc-message',event,'pet:workbuddy-details-clear-tasks');assert.equal(cleared,1);
  controller.open({action:'trend'});win.webContents.emit('ipc-message',event,'pet:workbuddy-details-open-task','task-two');win.webContents.emit('ipc-message',event,'pet:workbuddy-details-clear-tasks');assert.equal(opened.length,1);assert.equal(cleared,1);
  controller.close();win.webContents.emit('ipc-message',event,'pet:workbuddy-details-clear-tasks');assert.equal(cleared,1);
});
