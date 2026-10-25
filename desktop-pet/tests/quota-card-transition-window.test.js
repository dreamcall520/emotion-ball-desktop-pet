const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createQuotaCardTransitionWindow}=require('../lib/quota-card-transition-window');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const ipcMain=new EventEmitter(),windows=[],errors=[];let failLoad=false;
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.visible=false;this.dead=false;this.messages=[];this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.send=(channel,value)=>this.messages.push({channel,value});this.webContents.setWindowOpenHandler=handler=>this.openHandler=handler;windows.push(this);}
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
