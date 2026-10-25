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
  const windows=[]; let refresh=0,trend=0,tasks=0,layouts=0;
  class Window extends EventEmitter {
    constructor(options){super();this.options=options;this.visible=false;this.dead=false;this.sent=[];this.webContents=Object.assign(new EventEmitter(),{mainFrame:{},isDestroyed:()=>false,setWindowOpenHandler:h=>{this.open=h;},send:(_c,s)=>this.sent.push(s)});windows.push(this);}
    isDestroyed(){return this.dead;} isVisible(){return this.visible;} setAlwaysOnTop(){} setVisibleOnAllWorkspaces(){} setHiddenInMissionControl(){} setBounds(b){this.bounds=b;} showInactive(){this.visible=true;} hide(){this.visible=false;} destroy(){this.dead=true;this.emit('closed');} loadFile(){return Promise.resolve();}
  }
  const pet={isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>({x:100,y:100,width:80,height:80})};
  const controller=createWorkBuddyLabelWindow({BrowserWindow:Window,screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:220,height:200}})},getPetWindow:()=>pet,getPresentation:()=>({mode:'peeked'}),onRefresh:()=>refresh++,onTrend:()=>trend++,onTasks:()=>tasks++,onLayout:()=>layouts++});
  assert.equal(windows.length,0);controller.show({enabled:false});assert.equal(windows.length,0);
  controller.show({enabled:true}); await Promise.resolve(); const w=windows[0];
  assert.deepEqual(controller.getLayoutMetrics(),{width:128,height:32,inset:2});
  assert.ok(layouts>0);const beforeLayout=layouts;controller.reposition();assert.equal(layouts,beforeLayout);
  assert.equal(w.options.width,128);assert.equal(w.options.height,32);
  assert.equal(w.options.webPreferences.sandbox,true);assert.equal(w.options.webPreferences.contextIsolation,true);assert.deepEqual(w.open(),{action:'deny'});
  let prevented=false;w.webContents.emit('will-navigate',{preventDefault(){prevented=true;}});assert.equal(prevented,true);
  const event={sender:w.webContents,senderFrame:w.webContents.mainFrame};
  w.webContents.emit('ipc-message',{sender:{},senderFrame:event.senderFrame},'pet:workbuddy-label-refresh');assert.equal(refresh,0);
  w.webContents.emit('ipc-message',{sender:w.webContents,senderFrame:{}},'pet:workbuddy-label-refresh');assert.equal(refresh,0);
  w.webContents.emit('ipc-message',event,'pet:workbuddy-label-refresh');assert.equal(refresh,1);
  w.webContents.emit('ipc-message',{sender:{},senderFrame:event.senderFrame},'pet:workbuddy-label-trend');assert.equal(trend,0);
  w.webContents.emit('ipc-message',event,'pet:workbuddy-label-trend');assert.equal(trend,1);
  w.webContents.emit('ipc-message',event,'pet:workbuddy-label-toggle');assert.equal(w.sent.at(-1).expanded,false);assert.equal(w.sent.at(-1).spaceError,true);
  controller.hide();assert.equal(controller.getLayoutMetrics(),null);w.webContents.emit('ipc-message',event,'pet:workbuddy-label-refresh');assert.equal(refresh,1);
  w.webContents.emit('ipc-message',event,'pet:workbuddy-label-trend');assert.equal(trend,1);
  w.webContents.emit('ipc-message',event,'pet:workbuddy-label-tasks','tasks');assert.equal(tasks,0);
  controller.show({enabled:true});
  w.webContents.emit('ipc-message',{...event,senderFrame:{}},'pet:workbuddy-label-tasks','tasks');assert.equal(tasks,0);
  w.webContents.emit('ipc-message',event,'pet:workbuddy-label-tasks','unknown');assert.equal(tasks,0);
  w.webContents.emit('ipc-message',event,'pet:workbuddy-label-tasks','tasks');assert.equal(tasks,1);
  w.webContents.emit('ipc-message',event,'pet:workbuddy-label-tasks','results');assert.equal(tasks,2);
  w.setOpacity=value=>{w.opacity=value;};
  controller.hide({animate:true});assert.equal(w.visible,true);
  await new Promise(resolve=>setTimeout(resolve,220));assert.equal(w.visible,false);
  controller.show({enabled:true});assert.equal(w.opacity,0);
  controller.hide();assert.equal(w.visible,false);assert.equal(w.opacity,1);
  controller.destroy();assert.equal(controller.getWindow(),null);
});

test('WorkBuddy card follows the pet horizontal center before avoiding obstacles', () => {
  const pet = {x:400,y:300,width:80,height:80};
  const area = {x:0,y:0,width:1000,height:800};
  for (const expanded of [false,true]) {
    const first = workBuddyLabelBounds(pet,area,[],expanded);
    assert.equal(first.x + first.width / 2, pet.x + pet.width / 2);
    assert.equal(first.height, expanded ? 120 : 32);
    const moved = workBuddyLabelBounds({...pet,x:500},area,[],expanded);
    assert.equal(moved.x-first.x,100);
    const avoided = workBuddyLabelBounds(pet,area,[first],expanded);
    assert.equal(avoided.x + avoided.width / 2, pet.x + pet.width / 2);
    assert.equal(intersects(avoided, first),false);
  }
});

test('WorkBuddy stacks below the Codex card and stays centered without changing it', () => {
  const pet={x:400,y:300,width:80,height:80},area={x:0,y:0,width:1000,height:900};
  for(const height of [32,58,131,144]) for(const expanded of [false,true]) {
    const codex={x:342,y:388,width:196,height};
    const before={...codex},card=workBuddyLabelBounds(pet,area,[codex],expanded,codex);
    assert(card);assert.equal(card.x+card.width/2,440);assert.equal(card.y,codex.y+height+8);
    assert.equal(intersects(card,codex),false);assert.deepEqual(codex,before);
  }
});

test('history IPC whitelists samples, deduplicates and sorts; history errors stay safe', () => {
  const state=safeState({history:[{at:30,total:7399.91,token:'secret'},{at:10,total:7400},{at:30,total:7399.8},{at:20,total:-1},{at:NaN,total:7}],historyError:'secret'});
  assert.deepEqual(state.history,[{at:10,total:7400},{at:30,total:7399.8}]);
  assert.equal(state.historyError,'趋势记录暂未保存');
  assert.equal(JSON.stringify(state).includes('secret'),false);
});

test('edge-tucked cards share a near-edge column across compact and expanded states', () => {
  const area={x:-1000,y:0,width:1000,height:800};
  for (const side of ['left','right']) for (const expanded of [false,true]) for (const y of [50,400,740]) {
    const pet={x:side==='left'?-1050:-30,y:Math.min(y,720),width:80,height:80};
    const codex={x:side==='left'?-998:-186,y,width:184,height:50};
    const before={...codex};
    const card=workBuddyLabelBounds(pet,area,[codex],expanded,codex,{side,mode:'peeked'});
    if (!card) {
      const width=expanded?196:128,height=expanded?120:32;
      const x=side==='left'?codex.x:codex.x+codex.width-width;
      assert([codex.y+codex.height+8,codex.y-height-8].every(y=>y<area.y||y+height>area.y+area.height||intersects({x,y,width,height},pet)));
      continue;
    }
    assert.equal(intersects(card,codex),false);assert.equal(intersects(card,pet),false);
    if(side==='left') assert.equal(card.x,codex.x);
    else assert.equal(card.x+card.width,codex.x+codex.width);
    assert.deepEqual(codex,before);
  }
});
test('blocked anchor column never jumps to the opposite screen edge', () => {
  const area={x:0,y:0,width:1200,height:800};
  const pet={x:-50,y:300,width:80,height:80}, codex={x:0,y:400,width:184,height:50};
  const wall={x:0,y:0,width:220,height:800};
  assert.equal(workBuddyLabelBounds(pet,area,[codex,wall],true,codex,{side:'left'}),null);
  const alone=workBuddyLabelBounds({x:1180,y:300,width:80,height:80},area,[],true);
  assert(alone.x>900);
});

test('history metadata stays optional and only validated balance/expiry fields cross IPC', () => {
  const state=safeState({history:[{at:1,total:10},{at:2,total:9,basic:2,reward:7,purchased:0,nextRefreshAt:30,expires:[{amount:1,at:20,token:'secret'}]},{at:3,total:8,basic:NaN,reward:-1,nextRefreshAt:Infinity,expires:[{amount:1,at:Infinity}]}]});
  assert.deepEqual(state.history[0],{at:1,total:10});
  assert.deepEqual(state.history[1],{at:2,total:9,basic:2,reward:7,purchased:0,nextRefreshAt:30,expires:[{amount:1,at:20}]});
  assert.deepEqual(state.history[2],{at:3,total:8});
});

test('activity count whitelist preserves unknown running instead of inventing global zero', () => {
  assert.deepEqual(safeState({activity:{runningCount:null,unreadCount:0,token:'secret'}}).activity,{runningCount:null,unreadCount:0,scope:'本机已同步任务'});
  assert.deepEqual(safeState({activity:{runningCount:-1,unreadCount:'3'}}).activity,{runningCount:null,unreadCount:null,scope:'本机已同步任务'});
});

test('corner bubble stays above the Codex/WB stack; expanded fallback never jumps above bubble', () => {
  const area={x:0,y:0,width:1200,height:890};
  for(const side of ['left','right']) {
    const x=side==='left'?2:1002;
    const pet={x:side==='left'?-50:1170,y:500,width:80,height:80};
    const bubble={x,y:650,width:196,height:80},codex={x,y:738,width:196,height:32};
    const before={...codex};
    const compact=workBuddyLabelBounds(pet,area,[bubble,codex],false,codex,{side},bubble);
    assert(compact);assert.equal(compact.y,codex.y+codex.height+8);assert(compact.y>=bubble.y+bubble.height+8);
    assert.equal(workBuddyLabelBounds(pet,area,[bubble,codex],true,codex,{side},bubble),null);
    assert.deepEqual(codex,before);
  }
});
test('with a stack anchor WB only uses adjacent positions, never an arbitrary obstacle edge', () => {
  const area={x:0,y:0,width:1000,height:900},pet={x:0,y:600,width:80,height:80};
  const codex={x:2,y:800,width:196,height:32},bubble={x:2,y:700,width:196,height:70};
  assert.equal(workBuddyLabelBounds(pet,area,[codex,bubble],true,codex,{side:'left'},bubble),null);
  const compact=workBuddyLabelBounds(pet,area,[codex,bubble],false,codex,{side:'left'},bubble);
  assert(compact);assert.equal(compact.y,840);
});
test('bubble priority also prevents single WB card from appearing above a visible same-column bubble', () => {
  const area={x:0,y:0,width:1000,height:900},pet={x:400,y:500,width:80,height:80},bubble={x:342,y:588,width:196,height:70};
  const card=workBuddyLabelBounds(pet,area,[bubble],false,null,null,bubble);
  assert(card);assert.equal(card.y,bubble.y+bubble.height+8);
});

test('WorkBuddy consumes a coordinated group rectangle and honors hidden overflow', () => {
  const pet={x:400,y:300,width:80,height:80},area={x:0,y:0,width:1000,height:800};
  const group={x:376,y:600,width:128,height:32,placement:'below',face:{x:378,y:602,width:124,height:28}};
  assert.deepEqual(workBuddyLabelBounds(pet,area,[],false,null,{mode:'free',quotaGroupLayout:group}),group);
  assert.equal(workBuddyLabelBounds(pet,area,[],false,null,{mode:'free',quotaGroupHidden:true}),null);
});

test('WorkBuddy freezes its expanded native bounds when the tucked anchor disappears', async t => {
  let presentation={mode:'peeked',side:'left'},bounds={x:300,y:100,width:80,height:80},anchor={x:276,y:188,width:128,height:32};
  class Window extends EventEmitter {
    constructor(){super();this.visible=false;this.dead=false;this.webContents=Object.assign(new EventEmitter(),{mainFrame:{},isDestroyed:()=>false,setWindowOpenHandler(){},send(){}});}
    isDestroyed(){return this.dead;} isVisible(){return this.visible;} setAlwaysOnTop(){} setVisibleOnAllWorkspaces(){} setHiddenInMissionControl(){}
    setOpacity(value){this.opacity=value;} setIgnoreMouseEvents(value){this.ignored=value;} setBounds(value){this.bounds={...value};} getBounds(){return {...this.bounds};}
    showInactive(){this.visible=true;} hide(){this.visible=false;} destroy(){this.dead=true;this.emit('closed');} loadFile(){return Promise.resolve();}
  }
  const controller=createWorkBuddyLabelWindow({BrowserWindow:Window,screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:1200,height:900}})},
    getPetWindow:()=>({isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>bounds}),getPresentation:()=>presentation,getStackAnchor:()=>anchor});
  t.after(()=>controller.destroy());controller.show({enabled:true});await Promise.resolve();const win=controller.getWindow();
  win.webContents.emit('ipc-message',{sender:win.webContents,senderFrame:win.webContents.mainFrame},'pet:workbuddy-label-toggle');
  const before=win.getBounds();assert.equal(before.height,120);
  presentation={mode:'tucked',side:'left',quotaAnimateHide:true};anchor=null;bounds={...bounds,x:700};controller.reposition();
  assert.deepEqual(win.getBounds(),before);assert.equal(win.ignored,true);
  controller.show({enabled:true});assert.deepEqual(win.getBounds(),before,'late refresh cannot choose a new pet anchor');
  await new Promise(resolve=>setTimeout(resolve,220));assert.equal(win.visible,false);
  presentation={mode:'peeked',side:'left'};controller.show({enabled:true});assert.equal(win.visible,true);assert.notDeepEqual(win.getBounds(),before);
  controller.hide();assert.equal(win.visible,false);
});

test('WorkBuddy stacked card exposes its own allowed game entry and hides it immediately when disabled', async t => {
  let allowed=true,opened=0;
  class Window extends EventEmitter {
    constructor(options){super();this.bounds={x:0,y:0,width:options.width,height:options.height};this.visible=false;this.dead=false;this.webContents=Object.assign(new EventEmitter(),{mainFrame:{},isDestroyed:()=>false,setWindowOpenHandler(){},send(){},getURL:()=>require('node:url').pathToFileURL(this.file).href});}
    isDestroyed(){return this.dead;}isVisible(){return this.visible;}setAlwaysOnTop(){}setVisibleOnAllWorkspaces(){}setHiddenInMissionControl(){}
    setBounds(value){this.bounds={...value};}getBounds(){return {...this.bounds};}showInactive(){this.visible=true;}hide(){this.visible=false;}
    destroy(){this.dead=true;this.emit('closed');}loadFile(file){this.file=file;return Promise.resolve();}
  }
  const pet={x:300,y:100,width:80,height:80},anchor={x:276,y:188,width:128,height:32};
  const controller=createWorkBuddyLabelWindow({BrowserWindow:Window,screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:1200,height:900}})},
    getPetWindow:()=>({isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>pet}),getStackAnchor:()=>anchor,getObstacles:()=>[anchor],getGuardEntry:()=>allowed,onGuard:()=>opened++});
  t.after(()=>controller.destroy());controller.show({enabled:true});await new Promise(resolve=>setImmediate(resolve));
  const card=controller.getWindow().getBounds(),entry=controller.getGuardWindow();
  assert.equal(card.y,anchor.y+anchor.height+8);assert(entry?.isVisible(),'a predecessor card must not suppress the independent WorkBuddy game entry');
  for(const obstacle of [card,anchor,pet])assert.equal(intersects(entry.getBounds(),obstacle),false);
  const event={sender:entry.webContents,senderFrame:entry.webContents.mainFrame};entry.webContents.emit('ipc-message',event,'pet:workbuddy-guard-entry-open');assert.equal(opened,1);
  allowed=false;controller.reposition();assert.equal(entry.isVisible(),false);entry.webContents.emit('ipc-message',event,'pet:workbuddy-guard-entry-open');assert.equal(opened,1);
  allowed=true;controller.reposition();assert.equal(entry.isVisible(),true);
});
