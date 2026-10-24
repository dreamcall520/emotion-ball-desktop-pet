const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { workBuddyLabelBounds, safeState, createWorkBuddyLabelWindow } = require('../lib/workbuddy-label-window');
const intersects = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
test('WorkBuddy geometry remains inside scaled/negative displays and avoids all cards', () => {
  for (const scale of [0.75,1,1.5,2]) for (const [x,y] of [[0,0],[900,0],[0,600],[900,600],[450,300]]) for (const expanded of [false,true]) {
    const area = { x:-1200,y:-400,width:Math.round(1200*scale),height:Math.round(800*scale) };
    const pet = {x:area.x+Math.min(x,area.width-80),y:area.y+Math.min(y,area.height-80),width:80,height:80};
    const obstacles = [{x:pet.x-180,y:pet.y-60,width:170,height:42},{x:pet.x+85,y:pet.y,width:180,height:90}];
    const b = workBuddyLabelBounds(pet,area,obstacles,expanded);
    assert.ok(b);
    assert.ok(b.x>=area.x && b.y>=area.y && b.x+b.width<=area.x+area.width && b.y+b.height<=area.y+area.height);
    for (const obstacle of [pet,...obstacles]) assert.equal(intersects(b,obstacle),false);
  }
});
test('WorkBuddy no room yields null, never overlaps',()=> {
  assert.equal(workBuddyLabelBounds({x:0,y:0,width:200,height:200},{x:0,y:0,width:200,height:200}),null);
});
test('state whitelist preserves zero and old reports, strips credentials and raw errors',()=> {
  const state=safeState({enabled:true,error:'secret-token',stale:true,token:'secret',report:{total:0,basic:0,reward:0,purchased:0,plan:'体验版',updatedAt:10,nextRefreshAt:20,token:'secret',expires:[{amount:2,at:30,account:'secret'}]}});
  assert.equal(state.report.total,0); assert.equal(state.stale,true);
  assert.equal(JSON.stringify(state).includes('secret'),false);
  assert.deepEqual(state.report.expires,[{amount:2,at:30}]);
  assert.equal(safeState({report:{total:0}}).report,null);
});
test('constructor is lazy; IPC verifies sender and frame; expansion falls back; navigation denied',async()=> {
  const windows=[]; let refresh=0,chat=0;
  class Window extends EventEmitter {
    constructor(options){super();this.options=options;this.visible=false;this.dead=false;this.sent=[];this.webContents=Object.assign(new EventEmitter(),{mainFrame:{},isDestroyed:()=>false,setWindowOpenHandler:h=>{this.open=h;},send:(_c,s)=>this.sent.push(s)});windows.push(this);}
    isDestroyed(){return this.dead;} isVisible(){return this.visible;} setAlwaysOnTop(){} setVisibleOnAllWorkspaces(){} setHiddenInMissionControl(){} setBounds(b){this.bounds=b;} showInactive(){this.visible=true;} hide(){this.visible=false;} destroy(){this.dead=true;this.emit('closed');} loadFile(){return Promise.resolve();}
  }
  const pet={isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>({x:100,y:100,width:80,height:80})};
  const controller=createWorkBuddyLabelWindow({BrowserWindow:Window,screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:220,height:200}})},getPetWindow:()=>pet,onRefresh:()=>refresh++,onChat:()=>chat++});
  assert.equal(windows.length,0);controller.show({enabled:false});assert.equal(windows.length,0);
  controller.show({enabled:true}); await Promise.resolve(); const w=windows[0];
  assert.equal(w.options.width,128);assert.equal(w.options.height,32);
  assert.equal(w.options.webPreferences.sandbox,true);assert.equal(w.options.webPreferences.contextIsolation,true);assert.deepEqual(w.open(),{action:'deny'});
  let prevented=false;w.webContents.emit('will-navigate',{preventDefault(){prevented=true;}});assert.equal(prevented,true);
  const event={sender:w.webContents,senderFrame:w.webContents.mainFrame};
  w.webContents.emit('ipc-message',{sender:{},senderFrame:event.senderFrame},'pet:workbuddy-label-chat');assert.equal(chat,0);
  w.webContents.emit('ipc-message',{sender:w.webContents,senderFrame:{}},'pet:workbuddy-label-chat');assert.equal(chat,0);
  w.webContents.emit('ipc-message',event,'pet:workbuddy-label-chat');assert.equal(chat,1);
  w.webContents.emit('ipc-message',event,'pet:workbuddy-label-refresh');assert.equal(refresh,1);
  w.webContents.emit('ipc-message',event,'pet:workbuddy-label-toggle');assert.equal(w.sent.at(-1).expanded,false);assert.equal(w.sent.at(-1).spaceError,true);
  controller.hide();w.webContents.emit('ipc-message',event,'pet:workbuddy-label-chat');assert.equal(chat,1);
  controller.destroy();assert.equal(controller.getWindow(),null);
});
