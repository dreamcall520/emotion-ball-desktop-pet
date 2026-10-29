const test=require('node:test');const assert=require('node:assert/strict');
const {createQuotaCardGroup,normalizeQuotaCards}=require('../lib/quota-card-group');
const {quotaCardBarBounds,createQuotaCardGroupWindow}=require('../lib/quota-card-group-window');
function fixture(){let input={config:{order:['workbuddy','codex','api','zcode'],pinned:['codex']},eligible:['codex','api','zcode','workbuddy'],suppressed:false},cursor={x:500,y:500},time=0,job,changes=[],liveBounds=null;
const group=createQuotaCardGroup({getState:()=>input,getCursor:()=>cursor,getBounds:expanded=>liveBounds||[{x:0,y:0,width:48,height:20},...(expanded?[{x:0,y:28,width:128,height:100}]:[])],onChange:s=>changes.push(s),schedule:fn=>(job=fn,1),cancel(){job=null;},now:()=>time});
return {group,changes,input,setBounds(value){liveBounds=value;},move(p,ms=80){cursor=p;time+=ms;job();},tick(ms){time+=ms;job();}};}
test('collects multiple eligible cards while preserving pinned order and one-card direct visibility',()=>{const f=fixture();f.group.start();assert.deepEqual(f.group.getState().visible,['codex']);assert.equal(f.group.getState().bar,true);f.input.eligible=['api'];f.group.sync();assert.deepEqual(f.group.getState().visible,['api']);assert.equal(f.group.getState().bar,false);f.group.close();});
test('hover bar expands every unpinned card, whole group hover maintains it and bridge delay closes',()=>{const f=fixture();f.group.start();f.move({x:10,y:10});assert.deepEqual(f.group.getState().visible,['workbuddy','codex','api','zcode']);f.move({x:20,y:80},300);assert.equal(f.group.getState().expanded,true);f.move({x:500,y:500});f.tick(219);assert.equal(f.group.getState().expanded,true);f.tick(1);assert.equal(f.group.getState().expanded,false);f.group.close();});
test('click keyboard hold is dismissible and external suppression overrides pinned/expanded',()=>{const f=fixture();f.group.start();f.group.activate();f.tick(1000);assert.equal(f.group.getState().expanded,true);f.input.suppressed=true;f.group.sync();assert.deepEqual(f.group.getState().visible,[]);assert.equal(f.group.getState().bar,false);f.input.suppressed=false;f.group.sync();assert.deepEqual(f.group.getState().visible,['codex']);f.group.activate();f.group.dismiss();assert.equal(f.group.getState().expanded,false);f.input.config.pinned=f.input.eligible;assert.equal(f.group.sync().bar,false);f.group.close();});
test('bar remains in each display corner with left/right peek alignment',()=>{const area={x:-1000,y:20,width:1000,height:700};for(const x of [-1000,-80])for(const y of [20,640])for(const side of ['left','right']){const b=quotaCardBarBounds({x,y,width:80,height:80},area,{mode:'peeked',side});assert(b.x>=area.x&&b.x+b.width<=0&&b.y>=20&&b.y+b.height<=720);assert.equal(b.x,Math.round(Math.max(area.x,Math.min(x+16,area.x+area.width-48))));}});
test('invalid ordering and pin ids cannot become arbitrary paths or actions',()=>{assert.deepEqual(normalizeQuotaCards({order:['api','api','url'],pinned:['api','url']}),{order:['api','codex','zcode','workbuddy','balance'],pinned:['api']});});

test('null primitive and array IPC payloads normalize to a fixed safe config',()=>{for(const input of [null,1,'bad',[],undefined])assert.deepEqual(normalizeQuotaCards(input),{order:['codex','api','zcode','workbuddy','balance'],pinned:[]});});
test('第五张余额卡追加到旧顺序，旧固定项原序保留，展开与收起仍按用户选择',()=>{
 const legacy={order:['workbuddy','api','codex','zcode'],pinned:['workbuddy','api']},original=JSON.stringify(legacy);
 assert.deepEqual(normalizeQuotaCards(legacy),{order:['workbuddy','api','codex','zcode','balance'],pinned:['workbuddy','api']});
 assert.equal(JSON.stringify(legacy),original);
 const f=fixture();f.input.config=legacy;f.input.eligible=['codex','api','zcode','workbuddy','balance'];f.group.start();
 assert.deepEqual(f.group.getState().visible,['workbuddy','api']);f.group.activate();
 assert.deepEqual(f.group.getState().visible,['workbuddy','api','codex','zcode','balance']);
 f.group.dismiss();assert.deepEqual(f.group.getState().visible,['workbuddy','api']);
 f.input.config.pinned=['balance'];f.group.sync();assert.deepEqual(f.group.getState().visible,['balance']);
 f.input.eligible=['balance'];assert.deepEqual(f.group.sync().visible,['balance']);assert.equal(f.group.getState().bar,false);f.group.close();
});
test('bar defaults below pet and loaded window gets the latest expanded state and live topmost setting',()=>{
 const {EventEmitter}=require('node:events');let created,top=true;
 class Win extends EventEmitter{constructor(){super();created=this;this.visible=false;this.webContents=Object.assign(new EventEmitter(),{send:(_channel,state)=>{this.state=state;},isLoading:()=>true});}isDestroyed(){return false;}setVisibleOnAllWorkspaces(){}loadFile(){}setBounds(b){this.bounds=b;}setAlwaysOnTop(v){this.top=v;}setIgnoreMouseEvents(v){this.ignore=v;}showInactive(){this.visible=true;}hide(){this.visible=false;}isVisible(){return this.visible;}getBounds(){return this.bounds;}destroy(){this.visible=false;}}
 const area={x:0,y:0,width:800,height:600},pet={getBounds:()=>({x:200,y:100,width:80,height:80}),isDestroyed:()=>false};
 const bar=createQuotaCardGroupWindow({BrowserWindow:Win,screen:{getDisplayMatching:()=>({workArea:area})},getPetWindow:()=>pet,getPresentation:()=>({mode:'free'}),getAlwaysOnTop:()=>top,ipcMain:new EventEmitter(),onActivate(){},onDismiss(){}});
 bar.show({expanded:false,eligible:['codex','api']});bar.show({expanded:true,eligible:['codex','api','zcode']});created.webContents.emit('did-finish-load');
 assert.deepEqual(created.state,{expanded:true,count:3});assert.equal(created.bounds.y,181);assert.equal(created.top,true);assert.equal(created.ignore,true);const frozen={...created.bounds};pet.getBounds=()=>({x:300,y:200,width:80,height:80});bar.show({expanded:true,eligible:['api','codex']});assert.deepEqual(created.bounds,frozen,'hidden expanded bar retains logical hover bridge');bar.show({expanded:false,eligible:['api','codex']});assert.notDeepEqual(created.bounds,frozen);assert.equal(created.ignore,false);top=false;bar.show({expanded:true,eligible:['api','codex']});assert.equal(created.top,false);bar.destroy();
});

test('real sheep ink anchors the capsule paint 7px below feet and fixed stack anchors it below cards',()=>{const pet={x:200,y:100,width:80,height:80},area={x:0,y:0,width:800,height:600};const b=quotaCardBarBounds(pet,area,{shape:'new-year-sheep',sheepInk:{ink:{x:.1,y:.05,width:.8,height:.7}}});assert(Math.abs(b.y+6.5-160-7)<=.5);const pinned=quotaCardBarBounds(pet,area,{cardStackBounds:[{x:180,y:200,width:128,height:32},{x:180,y:240,width:128,height:58}]});assert(Math.abs(pinned.y+6.5-298-7)<=.5);});
test('drag clears held expansion and shows only pins, ending drag does not reopen',()=>{const f=fixture();f.group.start();f.group.activate();f.input.dragging=true;f.group.sync();assert.equal(f.group.getState().expanded,false);assert.deepEqual(f.group.getState().visible,['codex']);assert.equal(f.group.getState().bar,false);f.input.dragging=false;f.group.sync();assert.deepEqual(f.group.getState().visible,['codex']);assert.equal(f.group.getState().expanded,false);f.group.close();});

test('peeked capsule centers on real sheep body and bottom fallback is 7px from painted head',()=>{
 const area={x:0,y:0,width:1000,height:600},ink={x:.1,y:.2,width:.6,height:.6};
 for(const side of ['left','right']){const pet={x:side==='left'?0:920,y:520,width:80,height:80};const b=quotaCardBarBounds(pet,area,{mode:'peeked',side,shape:'new-year-sheep',sheepInk:{ink}});
 assert.equal(b.x+24,Math.max(24,Math.min(976,pet.x+80*.4)));
 assert(Math.abs((pet.y+80*.2)-(b.y+13.5)-7)<=.5);}
});

test('bottom pinned stack keeps capsule above the whole stack instead of overlapping the blob',()=>{
 const pet={x:400,y:520,width:80,height:80},area={x:0,y:0,width:1000,height:600},card={x:376,y:484,width:128,height:28};
 const b=quotaCardBarBounds(pet,area,{shape:'blob',cardStackBounds:[card]});assert(b.y+13.5<=card.y-6);assert(b.y+b.height<=pet.y);
});

test('pointer click opens without a hold, while keyboard hold and Escape remain accessible',()=>{
 const f=fixture();f.group.start();f.group.activate({keyboard:false});assert.equal(f.group.getState().expanded,true);f.tick(1);f.tick(220);assert.equal(f.group.getState().expanded,false,'pointer activation closes after leaving group');
 f.group.activate({keyboard:true});f.tick(1000);assert.equal(f.group.getState().expanded,true);f.group.dismiss();f.move({x:10,y:10});assert.equal(f.group.getState().expanded,false,'Escape blocks immediate hover reopen');f.move({x:500,y:500});f.move({x:10,y:10});assert.equal(f.group.getState().expanded,true);f.group.close();
});

test('predicted upper stack places an otherwise fitting capsule above the live sheep head',()=>{
 const pet={x:400,y:650,width:80,height:80},area={x:0,y:0,width:1000,height:900},ink={x:.2,y:.3,width:.6,height:.6};
 const b=quotaCardBarBounds(pet,area,{shape:'new-year-sheep',sheepInk:{ink},quotaPreferredPlacement:'above'});assert(Math.abs((pet.y+pet.height*ink.y)-(b.y+13.5)-7)<=.51);
});

test('inline resize keeps the original click and full relocation bridge alive, then leaves with the usual 220ms delay',()=>{
 for(const id of ['codex','api','zcode','workbuddy']){
  const f=fixture();f.group.start();f.group.activate({keyboard:false});
  const before={cards:{[id]:{x:0,y:28,width:128,height:32}}},after={cards:{[id]:{x:0,y:-260,width:220,height:240}}};
  f.group.retainLayout(before,before,'same-pet');f.group.retainLayout(before,after,'same-pet');f.setBounds([after.cards[id]]);
  f.move({x:20,y:45},500);assert.equal(f.group.getState().expanded,true,'pointer stays at old clicked short card beyond 220ms');
  f.move({x:100,y:-30},500);assert.equal(f.group.getState().expanded,true,'pointer can cross to new upper large card');
  f.move({x:500,y:500});f.tick(219);assert.equal(f.group.getState().expanded,true);f.tick(1);assert.equal(f.group.getState().expanded,false);
  f.group.close();
 }
});
test('ordinary movement cannot create a bridge and changed layout context or drag/suppression clears it',()=>{
 const f=fixture();f.group.start();f.group.activate({keyboard:false});const a={cards:{zcode:{x:0,y:28,width:128,height:32}}},b={cards:{zcode:{x:0,y:-260,width:220,height:240}}};
 f.group.retainLayout(a,a,'pet-a');f.group.retainLayout(a,{cards:{zcode:{x:300,y:28,width:128,height:32}}},'pet-a');f.move({x:350,y:40});f.tick(220);assert.equal(f.group.getState().expanded,false,'ordinary movement does not retain empty old area');f.group.activate({keyboard:false});
 f.group.retainLayout(a,b,'pet-a');f.group.retainLayout(b,b,'pet-b');f.move({x:100,y:-100});f.tick(220);assert.equal(f.group.getState().expanded,false,'pet context change clears old interactive region');f.group.activate({keyboard:false});
 f.group.retainLayout(a,b,'pet-b');f.input.dragging=true;f.group.sync();f.input.dragging=false;f.group.activate({keyboard:false});f.group.retainLayout(a,b,'pet-b');f.input.suppressed=true;f.group.sync();f.group.close();
});
