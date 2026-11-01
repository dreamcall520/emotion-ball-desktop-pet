const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {createPopupQuotaVisibility,createQuotaDialogProxy}=require('../lib/popup-quota-visibility');
const root=path.resolve(__dirname,'..'),url=(file,query='')=>pathToFileURL(path.join(root,file)).href+query;
function fixture({onChange=()=>{}}={}){const ipc=new EventEmitter(),events=[],scheduled=[];const registry=createPopupQuotaVisibility({root,ipcMain:ipc,onChange:value=>{events.push(value);onChange(value)},schedule:fn=>{scheduled.push(fn);return fn},cancel:fn=>{const i=scheduled.indexOf(fn);if(i>=0)scheduled.splice(i,1)}});
 function win(file,preload=file.replace('.html','-preload.js')){const w=Object.assign(new EventEmitter(),{dead:false,visible:false,minimized:false,opacity:1,getOpacity(){return this.opacity},setOpacity(v){this.opacity=v},shows:0,hides:0,isDestroyed(){return this.dead},isVisible(){return this.visible},isMinimized(){return this.minimized}});const wc=w.webContents=Object.assign(new EventEmitter(),{mainFrame:{url:''},getLastWebPreferences:()=>({preload:path.join(root,preload)}),getURL:()=>wc.mainFrame.url});w.loadFile=(file,options={})=>{wc.mainFrame.url=pathToFileURL(file).href+(options.query?'?'+new URLSearchParams(options.query):'');return Promise.resolve()};w.loadURL=u=>{wc.mainFrame.url=u;return Promise.resolve()};w.show=w.showInactive=()=>{w.shows++;w.visible=true;w.emit('show')};w.hide=()=>{w.hides++;w.visible=false;w.emit('hide')};w.close=()=>{const e={defaultPrevented:false,preventDefault(){this.defaultPrevented=true}};w.emit('close',e);if(!e.defaultPrevented){w.dead=true;w.emit('closed')}};registry.track(w);return w;}
 const flush=()=>{while(scheduled.length)scheduled.shift()()};return{registry,ipc,events,win,flush};}
test('opening intent hides cards before first native show, blocks late show and restores only after last popup',async()=>{
 const f=fixture(),card=f.win('quota-label.html');await card.loadFile(path.join(root,'quota-label.html'));card.show();assert.equal(card.visible,true);
 const a=f.win('chat.html');const before=a.show;a.show=()=>{assert.equal(card.visible,false);assert.equal(f.registry.isBlocked(),true);before()};await a.loadFile(path.join(root,'chat.html'));assert.equal(card.visible,false);card.show();assert.equal(card.visible,false);a.show();
 const b=f.win('api-usage.html');await b.loadFile(path.join(root,'api-usage.html'));b.show();a.hide();f.flush();assert.equal(f.registry.isBlocked(),true);b.close();assert.equal(f.registry.isBlocked(),true,'release waits to coalesce handoff');f.flush();assert.equal(f.registry.isBlocked(),false);assert.deepEqual(f.events,[true,false]);
});
test('cancelled close, minimized/restored windows and async handoff preserve exact ownership',async()=>{
 const f=fixture(),a=f.win('about.html');await a.loadFile(path.join(root,'about.html'));a.show();a.on('close',e=>e.preventDefault());a.close();f.flush();assert.equal(f.registry.isBlocked(),true);
 a.minimized=true;a.emit('minimize');f.flush();assert.equal(f.registry.isBlocked(),false);a.minimized=false;a.emit('restore');assert.equal(f.registry.isBlocked(),true);
 a.hide();const b=f.win('api-usage.html');const loading=b.loadFile(path.join(root,'api-usage.html'));f.flush();assert.equal(f.registry.isBlocked(),true,'pending real panel holds the handoff');await loading;b.show();b.hide();f.flush();assert.equal(f.registry.isBlocked(),false);
});
test('desktop note/reminder and timer mini/message coexist; only validated actual modal state blocks',async()=>{
 const f=fixture();for(const [file,query]of [['notes.html',{mode:'note'}],['notes.html',{mode:'reminder'}],['pomodoro.html',{view:'mini'}],['pomodoro.html',{view:'message'}]]){const w=f.win(file);await w.loadFile(path.join(root,file),{query});w.show();assert.equal(f.registry.isBlocked(),false);
 const emit=(extra,value)=>{const event={sender:w.webContents,senderFrame:w.webContents.mainFrame,...extra};f.ipc.emit('pet:quota-modal',event,value);return event.returnValue};assert.equal(emit({senderFrame:{}},true),false);assert.equal(f.registry.isBlocked(),false);assert.equal(emit({},true),true);assert.equal(f.registry.isBlocked(),true);emit({},false);f.flush();assert.equal(f.registry.isBlocked(),false);}
 const foreign=f.win('notes.html');await foreign.loadURL('file:///tmp/notes.html?mode=note');foreign.show();f.ipc.emit('pet:quota-modal',{sender:foreign.webContents,senderFrame:foreign.webContents.mainFrame},true);assert.equal(f.registry.isBlocked(),false);
});
test('panel roles use own path and preload, not title; failed and cancelled first load cannot retain leases',async()=>{
 const f=fixture(),foreign=f.win('global-settings.html','preload.js');foreign.title='设置中心';await foreign.loadURL('https://example.com/global-settings.html');foreign.show();assert.equal(f.registry.isBlocked(),false);
 const a=f.win('chat.html');await a.loadFile(path.join(root,'chat.html'));assert.equal(f.registry.isBlocked(),true);a.hide();f.flush();assert.equal(f.registry.isBlocked(),false);a.webContents.emit('did-finish-load');assert.equal(f.registry.isBlocked(),false,'late load must not resurrect intent');
 const b=f.win('about.html');b.loadFile(path.join(root,'about.html'));b.webContents.emit('did-fail-load',{},-2,'failed',url('about.html'),true);f.flush();assert.equal(f.registry.isBlocked(),false);
});
test('shortcuts lease lasts through native hide until the controller ends its closing presentation',()=>{
 const f=fixture();f.registry.setShortcutPresenting(true);assert.equal(f.registry.isBlocked(),true);f.registry.setShortcutPresenting(false);assert.equal(f.registry.isBlocked(),true);f.registry.setShortcutPresenting(true);f.flush();assert.equal(f.registry.isBlocked(),true);f.registry.setShortcutPresenting(false);f.flush();assert.equal(f.registry.isBlocked(),false);
});
test('local dialog proxy leases cover resolve/reject/throw/nested sync and async calls without changing native module',async()=>{
 const f=fixture();let finish;const native={showOpenDialog(){assert.equal(f.registry.isBlocked(),true);return new Promise(r=>finish=r)},showMessageBox(){return Promise.reject(Error('reject'))},showSaveDialogSync(){assert.equal(f.registry.isBlocked(),true);throw Error('sync failure')}};const proxy=createQuotaDialogProxy(native,f.registry);assert.notEqual(proxy,native);
 const wait=proxy.showOpenDialog();await assert.rejects(proxy.showMessageBox(),/reject/);assert.throws(()=>proxy.showSaveDialogSync(),/sync failure/);f.flush();assert.equal(f.registry.isBlocked(),true);finish({canceled:true});await wait;f.flush();assert.equal(f.registry.isBlocked(),false);assert.equal(native.showOpenDialog===proxy.showOpenDialog,false);
});
test('hidden desktop modal keeps its ownership on reshow; stale failed load cannot cancel a newer popup',async()=>{
 const f=fixture(),note=f.win('notes.html');await note.loadFile(path.join(root,'notes.html'),{query:{mode:'note'}});note.show();
 f.ipc.emit('pet:quota-modal',{sender:note.webContents,senderFrame:note.webContents.mainFrame},true);assert.equal(f.registry.isBlocked(),true);
 note.hide();f.flush();assert.equal(f.registry.isBlocked(),false);note.show();assert.equal(f.registry.isBlocked(),true,'dialog remains modal without any new DOM mutation');note.close();f.flush();
 const p=f.win('chat.html');await p.loadFile(path.join(root,'chat.html'),{query:{load:'old'}});await p.loadFile(path.join(root,'chat.html'),{query:{load:'new'}});p.webContents.emit('did-fail-load',{},-2,'old load',url('chat.html','?load=old'),true);f.flush();assert.equal(f.registry.isBlocked(),true);p.hide();f.flush();assert.equal(f.registry.isBlocked(),false);
});
test('transparent capture keeps its native compositor while blocked without exposing pixels or stranding opacity',async()=>{
 const f=fixture(),w=f.win('quota-card-transition.html');await w.loadFile(path.join(root,'quota-card-transition.html'));
 const release=f.registry.acquire();w.setOpacity(0);w.showInactive();assert.equal(w.visible,true,'transparent compositor is available for real capture RAF');assert.equal(w.opacity,0);
 w.setOpacity(1);assert.equal(w.opacity,0,'late capture or overlay restore cannot expose pixels');
 release();f.flush();assert.equal(f.registry.isBlocked(),false);assert.equal(w.visible,false,'release hides the native stage before restoring opacity');assert.equal(w.opacity,1);w.showInactive();assert.equal(w.visible,true);
});
test('native hide destroying its transparent stage cannot abort release of remaining cards',async()=>{
 const f=fixture(),a=f.win('quota-label.html'),b=f.win('api-usage-label.html');await a.loadFile(path.join(root,'quota-label.html'));await b.loadFile(path.join(root,'api-usage-label.html'));
 const release=f.registry.acquire();for(const w of [a,b]){w.setOpacity(0);w.showInactive();w.setOpacity(1);}
 a.on('hide',()=>{a.dead=true;a.setOpacity=()=>{throw Error('destroyed native target')};});release();assert.doesNotThrow(f.flush);assert.equal(f.registry.isBlocked(),false);assert.equal(b.opacity,1);assert.equal(b.visible,false);assert.deepEqual(f.events,[true,false]);
});

// Settings, customization, both notes tabs, and the timer panel are persistent
// working surfaces: opening them must not hide the card layout being edited.
for(const [file,query] of [['global-settings.html',{}],['customize.html',{}],['notes.html',{mode:'panel',tab:'note'}],['notes.html',{mode:'panel',tab:'todo'}],['pomodoro.html',{view:'panel'}]])test(`${file} ${JSON.stringify(query)} keeps quota cards available through load, show, refresh and close`,async()=>{
 const f=fixture(),card=f.win('quota-label.html');await card.loadFile(path.join(root,'quota-label.html'));card.show();
 const panel=f.win(file);await panel.loadFile(path.join(root,file),{query});assert.equal(f.registry.isBlocked(),false);assert.equal(card.visible,true);
 panel.show();card.showInactive();assert.equal(card.visible,true);
 await panel.loadFile(path.join(root,file),{query});panel.show();assert.equal(f.registry.isBlocked(),false);assert.equal(card.hides,0,'refresh must not interrupt the live quota preview');
 panel.close();f.flush();assert.equal(card.visible,true);assert.deepEqual(f.events,[]);
});
test('persistent panels retain hidden modal ownership and release the final modal into current card preferences',async()=>{
 let wanted=true,card;const f=fixture({onChange:blocked=>{if(!blocked&&wanted)card.show()}});card=f.win('quota-label.html');await card.loadFile(path.join(root,'quota-label.html'));card.show();
 const settings=f.win('global-settings.html'),custom=f.win('customize.html');for(const [w,file]of [[settings,'global-settings.html'],[custom,'customize.html']]){await w.loadFile(path.join(root,file));w.show();}
 const modal=(w,value)=>{const e={sender:w.webContents,senderFrame:w.webContents.mainFrame};f.ipc.emit('pet:quota-modal',e,value);assert.equal(e.returnValue,true)};
 modal(custom,true);assert.equal(card.visible,false);custom.hide();f.flush();assert.equal(card.visible,true,'hidden modal does not block the still-open settings preview');
 custom.show();assert.equal(card.visible,false,'reshow retains its actual modal state');modal(settings,true);modal(custom,false);f.flush();assert.equal(f.registry.isBlocked(),true,'second visible modal still blocks');
 wanted=false;modal(settings,false);f.flush();assert.equal(f.registry.isBlocked(),false);assert.equal(card.visible,false,'release respects the preference changed during the modal');
 modal(custom,true);wanted=true;modal(custom,false);f.flush();assert.equal(card.visible,true,'last release restores the latest enabled preference with both base panels open');
});
test('native dialog and temporary popup ownership compose while a passive preview remains open',async()=>{
 let card;const f=fixture({onChange:blocked=>{if(!blocked)card.show()}});card=f.win('quota-label.html');await card.loadFile(path.join(root,'quota-label.html'));card.show();
 const settings=f.win('global-settings.html');await settings.loadFile(path.join(root,'global-settings.html'));settings.show();
 let finish;const dialog=createQuotaDialogProxy({showMessageBox:()=>new Promise(resolve=>finish=resolve)},f.registry),pending=dialog.showMessageBox();
 const chat=f.win('chat.html');await chat.loadFile(path.join(root,'chat.html'));chat.show();finish({response:0});await pending;f.flush();assert.equal(card.visible,false);assert.equal(f.registry.isBlocked(),true);
 chat.close();f.flush();assert.equal(card.visible,true);assert.equal(settings.visible,true);assert.deepEqual(f.events,[true,false]);
});
test('popup blocking skips native hide only for an actually hidden card and still hides transparent capture surfaces',async()=>{
 const f=fixture(),hidden=f.win('quota-label.html'),transparent=f.win('weather.html'),unknown=f.win('quota-card-group.html');
 for(const[w,file]of [[hidden,'quota-label.html'],[transparent,'weather.html'],[unknown,'quota-card-group.html']])await w.loadFile(path.join(root,file));
 transparent.showInactive();transparent.setOpacity(0);delete unknown.isVisible;
 const release=f.registry.acquire();
 assert.equal(hidden.hides,0,'hidden card needs no native compositor transaction');
 assert.equal(transparent.hides,1,'opacity-zero visible capture remains a native surface and must be hidden');
 assert.equal(transparent.visible,false);
 assert.equal(unknown.hides,1,'missing visibility introspection remains conservative');
 release();f.flush();assert.equal(f.registry.isBlocked(),false);
});
for(const file of ['customize.html','chat.html'])test(`${file} ignores contradictory late hide/minimize but releases genuine native state`,async()=>{
 const f=fixture(),w=f.win(file);await w.loadFile(path.join(root,file));w.show();
 if(file==='customize.html'){const e={sender:w.webContents,senderFrame:w.webContents.mainFrame};f.ipc.emit('pet:quota-modal',e,true);assert.equal(e.returnValue,true)}
 assert.equal(f.registry.isBlocked(),true);
 w.emit('hide');f.flush();assert.equal(f.registry.isBlocked(),true,'late hide must not release an actually visible modal or popup');
 w.emit('minimize');f.flush();assert.equal(f.registry.isBlocked(),true,'late minimize must not release a native non-minimized owner');assert.deepEqual(f.events,[true]);
 w.hide();f.flush();assert.equal(f.registry.isBlocked(),false,'actual hide releases ownership');
 w.show();assert.equal(f.registry.isBlocked(),true,'reshow retains the modal lease without a new modal IPC');
 w.minimized=true;w.emit('minimize');f.flush();assert.equal(f.registry.isBlocked(),false,'genuine native minimize releases ownership');
 w.minimized=false;w.emit('restore');assert.equal(f.registry.isBlocked(),true);
 w.close();f.flush();assert.equal(f.registry.isBlocked(),false);
});
test('hide/minimize events without native introspection retain conservative release behavior',async()=>{
 const f=fixture(),w=f.win('customize.html');await w.loadFile(path.join(root,'customize.html'));w.show();f.ipc.emit('pet:quota-modal',{sender:w.webContents,senderFrame:w.webContents.mainFrame},true);
 w.isVisible=undefined;w.emit('hide');f.flush();assert.equal(f.registry.isBlocked(),false);
 w.show();assert.equal(f.registry.isBlocked(),true);w.isMinimized=undefined;w.emit('minimize');f.flush();assert.equal(f.registry.isBlocked(),false);
});
