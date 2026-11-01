const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createQuotaCardTransitionWindow}=require('../lib/quota-card-transition-window');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const ipcMain=new EventEmitter(),windows=[],errors=[];let failLoad=false;
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.visible=false;this.opacity=1;this.dead=false;this.messages=[];this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.send=(channel,value)=>this.messages.push({channel,value});this.webContents.setWindowOpenHandler=handler=>this.openHandler=handler;windows.push(this);}
  setOpacity(value){this.opacity=value}
  getOpacity(){return this.opacity}isVisible(){return this.visible}getBounds(){return this.bounds||{x:0,y:0,width:1,height:1}}
  isDestroyed(){return this.dead}setVisibleOnAllWorkspaces(){}setIgnoreMouseEvents(value){this.ignore=value}setAlwaysOnTop(value){this.top=value}setBounds(value){this.bounds=value}showInactive(){this.visible=true}hide(){this.visible=false}destroy(){this.dead=true;this.visible=false;this.emit('closed')}loadFile(file){this.file=file;return failLoad?Promise.reject(Error('load failure')):Promise.resolve()}
 }
 const controller=createQuotaCardTransitionWindow({BrowserWindow:Window,ipcMain,onError:error=>errors.push(error)});
 const ack=(win,value,extra={})=>ipcMain.emit('pet:quota-card-transition-ack',{sender:win.webContents,senderFrame:win.webContents.mainFrame,...extra},value);
 return{controller,windows,errors,ipcMain,ack,failNextLoad:()=>failLoad=true,allowLoad:()=>failLoad=false};
}
test('overlay is local, sandboxed and pointer-transparent; only its current main frame may acknowledge',async()=>{
 const f=fixture();await f.controller.warm();const win=f.windows[0];assert.equal(win.options.show,false);assert.equal(win.options.focusable,false);assert.equal(win.options.webPreferences.sandbox,true);assert.equal(win.options.webPreferences.contextIsolation,true);assert.equal(win.ignore,true);assert.match(win.file,/quota-card-transition\.html$/);assert.deepEqual(win.openHandler(),{action:'deny'});
 let done=false;const work=f.controller.prepare({token:1,bounds:{x:0,y:0,width:128,height:152}}).then(()=>done=true);await flush();
 const response={token:1,phase:'prepared',ok:true};f.ack(win,response,{sender:{}});f.ack(win,response,{senderFrame:{}});f.ack(win,{...response,token:999});await flush();assert.equal(done,false);f.ack(win,response);await work;
 f.controller.show();assert.equal(win.visible,true);const animation=f.controller.animate({token:2,expanded:false});const rejection=assert.rejects(animation,/取消/);f.controller.hide();await rejection;assert.equal(win.visible,false);f.controller.destroy();assert.equal(f.ipcMain.listenerCount('pet:quota-card-transition-ack'),0);
});
test('hidden resize preparation keeps native compositor live at opacity zero until explicit show',async()=>{
 const f=fixture();await f.controller.warm();const w=f.windows[0];
 for(const token of [1,2]){
  const bounds={x:token*30,y:10,width:128+token*50,height:152};
  const work=f.controller.prepare({token,bounds});await flush();
  assert.equal(w.visible,true,'native window is presented so both RAFs can paint after a hidden resize');assert.equal(w.opacity,0,'preparing old or new layers never becomes visually exposed');assert.deepEqual(w.bounds,bounds);
  f.controller.show();assert.equal(w.opacity,0,'early show cannot expose unprepared pixels');
  f.ack(w,{token,phase:'prepared',ok:true});await work;assert.equal(w.opacity,0);
  f.controller.show();assert.equal(w.opacity,1);assert.equal(w.visible,true);
  f.controller.hide();assert.equal(w.visible,false);assert.equal(w.opacity,0);
 }
 f.controller.destroy();
});
test('cancelled or replaced prepare cannot reveal or hide a newer prepared overlay',async()=>{
 const f=fixture();await f.controller.warm();const w=f.windows[0];
 const old=f.controller.prepare({token:1,bounds:{x:0,y:0,width:128,height:152}});const cancelled=assert.rejects(old,/替代|取消/);await flush();
 const next=f.controller.prepare({token:2,bounds:{x:20,y:10,width:260,height:200}});await flush();await cancelled;
 f.ack(w,{token:1,phase:'prepared',ok:true});assert.equal(w.opacity,0);assert.equal(w.visible,true);
 f.ack(w,{token:2,phase:'prepared',ok:true});await next;f.controller.show();assert.equal(w.opacity,1);assert.equal(w.visible,true);
 const hidden=f.controller.prepare({token:3,bounds:{x:0,y:0,width:128,height:152}});const rejection=assert.rejects(hidden,/取消/);await flush();f.controller.hide();await rejection;f.ack(w,{token:3,phase:'prepared',ok:true});f.controller.show();assert.equal(w.visible,false);assert.equal(w.opacity,0);
 const last=f.controller.prepare({token:4,bounds:{x:0,y:0,width:128,height:152}});const destroyed=assert.rejects(last,/关闭/);await flush();f.controller.destroy();await destroyed;f.ack(w,{token:4,phase:'prepared',ok:true});assert.equal(w.dead,true);assert.equal(w.visible,false);
});
test('failed preparation stays hidden and a later successful prepare restores explicit visibility only',async()=>{
 const f=fixture();await f.controller.warm();const w=f.windows[0];
 const bad=f.controller.prepare({token:1,bounds:{x:0,y:0,width:128,height:152}});const rejected=assert.rejects(bad,/未就绪/);await flush();f.ack(w,{token:1,phase:'prepared',ok:false});await rejected;assert.equal(w.visible,false);assert.equal(w.opacity,0);
 const good=f.controller.prepare({token:2,bounds:{x:0,y:0,width:180,height:190}});await flush();f.ack(w,{token:2,phase:'prepared',ok:true});await good;assert.equal(w.opacity,0);f.controller.show();assert.equal(w.opacity,1);f.controller.destroy();
});
test('hide during initial load and same-turn newer prepare cannot revive cancelled pixels',async()=>{
 const f=fixture();const first=f.controller.prepare({token:1,bounds:{x:0,y:0,width:128,height:152}});const rejected=assert.rejects(first,/取消/);f.controller.hide();await rejected;
 const w=f.windows[0];assert.equal(w.visible,false);assert.equal(w.opacity,0);
 const old=f.controller.prepare({token:2,bounds:{x:0,y:0,width:128,height:152}});const replaced=assert.rejects(old,/替代/);
 const next=f.controller.prepare({token:3,bounds:{x:0,y:0,width:256,height:152}});await flush();await replaced;
 assert.equal(w.messages.some(row=>row.value?.token===2),false);assert.equal(w.visible,true);assert.equal(w.opacity,0);
 f.ack(w,{token:3,phase:'prepared',ok:true});await next;f.controller.show();assert.equal(w.opacity,1);f.controller.destroy();
});
test('weather source remains painted through same-bounds target prepare and animate',async()=>{
 const f=fixture();await f.controller.warm();const w=f.windows[0],bounds={x:20,y:30,width:300,height:400};
 const source=f.controller.prepare({token:1,bounds});await flush();assert.equal(w.opacity,0);f.ack(w,{token:1,phase:'prepared',ok:true});await source;f.controller.show();assert.equal(w.opacity,1);
 const target=f.controller.prepare({token:2,bounds:{...bounds}});await flush();assert.equal(w.visible,true);assert.equal(w.opacity,1,'source overlay remains painted while target layers prepare');
 f.ack(w,{token:2,phase:'prepared',ok:true});await target;assert.equal(w.opacity,1,'target prepare does not require a second explicit show');
 const animation=f.controller.animate({token:2,expanded:true});assert.equal(w.opacity,1);f.ack(w,{token:2,phase:'finished',ok:true});await animation;
 const resized=f.controller.prepare({token:3,bounds:{...bounds,width:420}});await flush();assert.equal(w.opacity,0,'a changed native surface stages invisibly');f.ack(w,{token:3,phase:'prepared',ok:true});await resized;assert.equal(w.opacity,0);f.controller.show();assert.equal(w.opacity,1);f.controller.destroy();
});
test('native send exception conceals the compositor and allows a later prepare',async()=>{
 const f=fixture();await f.controller.warm();const w=f.windows[0],send=w.webContents.send;
 w.webContents.send=(channel,value)=>{if(channel==='pet:quota-card-transition-prepare')throw Error('send failed');send(channel,value);};
 await assert.rejects(f.controller.prepare({token:1,bounds:{x:0,y:0,width:128,height:152}}),/send failed/);assert.equal(w.visible,false);assert.equal(w.opacity,0);f.controller.show();assert.equal(w.visible,false);
 w.webContents.send=send;const work=f.controller.prepare({token:2,bounds:{x:0,y:0,width:256,height:152}});await flush();f.ack(w,{token:2,phase:'prepared',ok:true});await work;f.controller.show();assert.equal(w.opacity,1);f.controller.destroy();
});
test('renderer crash rejects active work and a later request gets a fresh safe host',async()=>{
 const f=fixture();await f.controller.warm();const old=f.windows[0],work=f.controller.prepare({token:1,bounds:{x:0,y:0,width:128,height:152}});await flush();const rejection=assert.rejects(work,/退出/);old.webContents.emit('render-process-gone');await rejection;assert.equal(old.dead,true);await f.controller.warm();assert.equal(f.windows.length,2);assert.notEqual(f.controller.getWindow(),old);f.controller.destroy();
});
test('failed local load is recoverable and never leaves a visible stale overlay',async()=>{
 const f=fixture();f.failNextLoad();await f.controller.warm();assert.equal(f.windows[0].dead,true);assert.equal(f.errors.length,1);f.allowLoad();await f.controller.warm();assert.equal(f.windows.length,2);f.controller.destroy();
});
test('overlay preload accepts PNG data only and exposes no capture, network or arbitrary IPC API',()=>{
 const ipc=new EventEmitter(),sent=[];ipc.send=(...args)=>sent.push(args);let bridge;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../quota-card-transition-preload.js'),'utf8'),{require:name=>{assert.equal(name,'electron');return{contextBridge:{exposeInMainWorld:(_name,value)=>bridge=value},ipcRenderer:ipc}}});
 assert.deepEqual(Object.keys(bridge),['onPrepare','onAnimate','onClear','trace','ack']);const values=[];bridge.onPrepare(value=>values.push(value));
 const bounds={x:0,y:0,width:128,height:152},payload={token:1,bounds,anchor:{x:51,y:0,width:26,height:7},layers:[{bounds,image:'data:image/png;base64,iVBORw0KGgo='}],scale:2};
 ipc.emit('pet:quota-card-transition-prepare',{},payload);assert.equal(values.length,1);
 for(const image of ['https://example.com/snapshot.png','file:///tmp/snapshot.png','data:image/svg+xml;base64,aaa'])ipc.emit('pet:quota-card-transition-prepare',{}, {...payload,layers:[{bounds,image}]});assert.equal(values.length,1);
 sent.length=0;bridge.ack({token:1,phase:'finished',ok:true,secret:'drop'});bridge.ack({token:1,phase:'other',ok:true});assert.equal(sent.length,1);assert.deepEqual(JSON.parse(JSON.stringify(sent[0])),['pet:quota-card-transition-ack',{token:1,phase:'finished',ok:true}]);
});

test('timeout diagnostics retain only trusted fixed stages and preserve frame authorization',async()=>{
 const f=fixture();await f.controller.warm();const w=f.windows[0];
 const pending=f.controller.prepare({token:1,bounds:{x:0,y:0,width:128,height:152}});await flush();
 const own={sender:w.webContents,senderFrame:w.webContents.mainFrame};
 f.ipcMain.emit('pet:quota-card-transition-trace',own,{token:1,stage:'received'});
 f.ipcMain.emit('pet:quota-card-transition-trace',{sender:{},senderFrame:{}},{token:1,stage:'untrusted'});
 f.ipcMain.emit('pet:quota-card-transition-trace',own,{token:1,stage:'invalid-anchor'});
 f.ack(w,{token:1,phase:'prepared',ok:true},{senderFrame:{}});
 await assert.rejects(pending,/prepared; received>invalid-anchor>ack-frame-rejected/);
 f.controller.destroy();assert.equal(f.ipcMain.listenerCount('pet:quota-card-transition-trace'),0);
});
