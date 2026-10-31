const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {setTimeout:wait}=require('node:timers/promises');
const Model=require('../lib/soft-orb-model');

async function verifySoftOrb({pet,monitor,save,getSettings,readSettings,command,setSize,openCustomizer,getCustomizer,prepare,setEnabled,getController,canPresent,getMotionOwner,clearDialogue,dock,restore,bubble,screen}){
  const artifacts=process.env.PET_SMOKE_ARTIFACT_DIR;const results=[];
  const page=code=>pet.webContents.executeJavaScript(code);
  async function poll(read,predicate,label,timeout=7000){const deadline=Date.now()+timeout;let value;do{value=await read();if(predicate(value))return value;await wait(25);}while(Date.now()<deadline);throw Error(label+'超时 '+JSON.stringify(value));}
  const view=()=>page(`(()=>{const p=document.getElementById('pet'),c=p.querySelector('canvas.soft-orb-canvas');return {pet:{...p.dataset},canvas:c?{...c.dataset}:null,width:innerWidth,height:innerHeight,opacity:c?.style.opacity}})()`);
  const ready=()=>poll(view,v=>v.pet.engine==='soft-orb'&&v.canvas?.ready==='true','柔光团主窗口ready');
  const record=(name,detail)=>{results.push({name,...detail});process.stdout.write('SOFT_ORB_'+name+'\n');};
  async function capture(name){if(!artifacts)return;fs.mkdirSync(artifacts,{recursive:true});fs.writeFileSync(path.join(artifacts,name+'.png'),(await pet.webContents.capturePage()).toPNG());}
  monitor.stop();pet.webContents.setBackgroundThrottling(false);clearDialogue();
  const sample=()=>pet.webContents.send('pet:activity',{idleSeconds:0,cursor:{x:pet.getBounds().x-200,y:pet.getBounds().y},sameDisplay:true,petBounds:pet.getBounds(),workArea:{x:0,y:0,width:2000,height:1200},locked:false});
  const make=id=>({shape:'soft-orb',orbMaterial:id,bodyColor:Model.PRESETS[id].colors[0],orbSecondaryColor:Model.PRESETS[id].colors[1],eyeColor:Model.PRESETS[id].colors[2]});
  for(const id of Object.keys(Model.PRESETS)){
    assert(save({appearance:make(id)},true));sample();await ready();
    assert.equal(readSettings().customization.appearance.orbMaterial,id);
    const pixels=await page(`(()=>{const c=document.querySelector('.soft-orb-canvas'),g=c.getContext('webgl2'),a=new Uint8Array(4);g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,a);return {corner:[...a],gl:g.getError(),alpha:g.getContextAttributes().alpha}})()`);
    assert.equal(pixels.gl,0);assert.equal(pixels.alpha,true);assert.equal(pixels.corner[3],0,'原生桌面不能有预览底色');
  }
  record('EIGHT_MATERIALS_TRANSPARENT',{count:8});
  assert(save({appearance:make('pearl')},true));sample();await ready();setSize('medium');await ready();
  for(const side of ['left','right']){
    const b=pet.getBounds();pet.webContents.send('pet:activity',{idleSeconds:0,cursor:{x:b.x+(side==='left'?-200:b.width+200),y:b.y},sameDisplay:true,petBounds:{...b,x:side==='left'?1500:100},workArea:{x:0,y:0,width:2000,height:1200},locked:false});
    await poll(()=>page(`(()=>{const c=document.querySelector('.soft-orb-canvas');return {facing:c.dataset.facing,scale:getComputedStyle(c).scale}})()`),v=>v.facing===side&&(side==='right'?v.scale==='-1 1':['1','1 1'].includes(v.scale)),'原生左右镜像 '+side);
    await wait(150);await capture('desktop-facing-'+side);
  }
  record('NATIVE_FACING_MIRROR',{});sample();
  for(const action of Object.keys(Model.ACTIONS)){
    command({command:'soft-orb-action',action});await poll(view,v=>v.canvas?.action===action,'互动 '+action);
    await wait(action==='ship'?1450:120);command('rest');await poll(view,v=>v.canvas?.action==='idle','动作复位 '+action);
  }
  record('ELEVEN_ACTIONS_RESTORE',{count:11});
  command('sleep');await poll(view,v=>v.canvas?.state==='sleep','进入持续睡眠');await wait(3500);assert.equal((await view()).canvas.state,'sleep');
  command('wake');await poll(view,v=>v.canvas?.action==='wake','独立唤醒');await poll(view,v=>v.canvas?.action==='idle','醒来复位');record('PERSISTENT_SLEEP_WAKE',{});
  for(const [name,pixels] of [['micro',60],['tiny',80],['compact',108],['small',120],['medium',180],['large',260]]){setSize(name);await ready();assert.equal((await view()).width,pixels);}
  setSize('medium');await ready();record('SIX_NATIVE_SIZES',{});
  const bubbleCases=[],originalBounds=pet.getBounds(),area=screen.getDisplayMatching(originalBounds).workArea;
  for(const [sizeName,size] of [['micro',60],['tiny',80],['compact',108],['small',120],['medium',180],['large',260]]){
    setSize(sizeName);await ready();
    for(const edge of ['top','middle']){
      pet.setBounds({x:Math.round(area.x+area.width/2-size/2),y:edge==='top'?area.y:Math.round(area.y+area.height/2-size/2),width:size,height:size});
      bubble.show({id:'orb-bubble-'+size+'-'+edge,text:'脚踏实地的感觉。',actions:[],durationMs:10000});
      const win=await poll(()=>Promise.resolve(bubble.getWindow()),w=>w&&!w.isDestroyed()&&w.isVisible(),'原生气泡显示');await wait(180);bubble.reposition();
      const b=pet.getBounds(),v=require('../lib/pet-visual-bounds').petVisualBounds(b,'soft-orb'),q=win.getBounds();
      const above=q.y+q.height<=v.y;const gap=above?v.y-q.y-q.height:q.y-v.y-v.height;
      assert.ok(Math.abs(gap-8)<=1,'原生气泡相对可见身体间距 '+size+' '+edge+' '+gap);
      const dom=await win.webContents.executeJavaScript(`(()=>{const b=document.getElementById('bubble');return {placement:b.dataset.placement,anchor:parseFloat(b.style.getPropertyValue('--anchor-x'))}})()`);
      assert.ok(Math.abs(q.x+dom.anchor-v.x-v.width/2)<=1,'气泡箭头对应身体中心');
      bubbleCases.push({size,edge,body:v,bubble:q,gap,...dom});
      if(size===180&&artifacts){fs.writeFileSync(path.join(artifacts,'bubble-'+edge+'.png'),(await win.webContents.capturePage()).toPNG());await capture('pet-bubble-'+edge);}
      bubble.hide();
    }
  }
  setSize('medium');pet.setBounds(originalBounds);sample();clearDialogue();record('NATIVE_BUBBLE_VISIBLE_BODY_ANCHOR',{cases:bubbleCases});
  dock('left');await poll(view,v=>v.pet.presentation==='tucked','靠左');restore();await poll(view,v=>v.pet.presentation==='free','离边');
  dock('right');await poll(view,v=>v.pet.presentation==='tucked','靠右');restore();await poll(view,v=>v.pet.presentation==='free','离边');record('EDGE_RESTORE',{});
  openCustomizer();await poll(async()=>{const w=getCustomizer();return w&&!w.isDestroyed()&&w.webContents.executeJavaScript('window.__customizerReady===true');},Boolean,'定制页');
  const editor=getCustomizer();
  await editor.webContents.executeJavaScript(`(()=>{document.querySelector('[data-shape="soft-orb"]').click();return true})()`);
  await wait(150);
  await editor.webContents.executeJavaScript(`(()=>{for(const [id,value] of [['body-hex','#B8C5EF'],['orb-secondary-hex','#785EA4'],['eye-hex','#FFF7ED']]){const field=document.getElementById(id);if(!field)throw Error('Missing '+id);field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}document.getElementById('startup-default').checked=true;document.getElementById('save').click();return true})()`);
  await poll(()=>Promise.resolve(readSettings()),v=>v.customization.appearance.bodyColor==='#B8C5EF'&&v.customization.appearance.orbSecondaryColor==='#785EA4','真实IPC保存');
  assert.equal(readSettings().startupAppearance.orbSecondaryColor,'#785EA4');editor.close();await wait(100);record('CUSTOMIZER_REAL_IPC_SAVE',{});
  assert(save({appearance:make('pearl')},true));sample();await ready();clearDialogue();
  // Synthetic policy transport only: native app/preload/IPC/renderer and motion timing remain real.
  let now=Date.now(),serial=0,callbacks;const timers=new Map();
  const advance=ms=>{const end=now+ms;for(let i=0;i<1000;i++){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;timers.delete(next[0]);now=next[1].at;next[1].callback();}now=end;};
  const quotaResetAt=now+86400000;
  prepare({now:()=>now,random:()=>0,schedule(fn,ms){timers.set(++serial,{at:now+ms,callback:fn});return serial;},cancel(id){timers.delete(id);},createConnection(next){callbacks=next;return {async start(){next.onAccount({accountKey:'soft-orb-isolated-fixture'});next.onStatus({channel:'quota',state:'connected'});next.onStatus({channel:'tasks',state:'connected'});next.onQuota({windows:[{id:'codex:soft-orb-fixture',label:'Codex',windowMinutes:300,remaining:92,resetsAt:quotaResetAt}],updatedAt:now});},async refresh(){},async retry(){},close(){}};}});
  await setEnabled(true);sample();clearDialogue();await poll(()=>Promise.resolve(canPresent()),Boolean,'合成任务原生入口可见');
  callbacks.onTask({id:'11111111-1111-4111-8111-999999999999',title:'进行中隔离验收',turnId:'working-fixture',state:'active',baseline:true,updatedAt:now});
  await poll(view,v=>v.canvas?.state==='working','进行中轨道状态');
  callbacks.onTask({id:'11111111-1111-4111-8111-999999999999',title:'进行中隔离验收',turnId:'working-fixture',state:'idle',baseline:true,updatedAt:now});
  await poll(view,v=>v.canvas?.state==='idle','进行中结束恢复待机');record('TASK_RUNNING_STATE',{});
  let taskSerial=0;
  async function task(kind){
    clearDialogue();advance(31000);await poll(()=>Promise.resolve(canPresent()),Boolean,'任务前可呈现');
    const row={id:'11111111-1111-4111-8111-'+String(++taskSerial).padStart(12,'0'),title:'柔光团隔离验收',turnId:'orb-turn-'+taskSerial,updatedAt:now};
    callbacks.onTask({...row,state:'active',baseline:true});callbacks.onTask({...row,state:kind});advance(5000);
    await poll(view,v=>v.pet.motionOwner==='codex','原生任务通知 '+kind);return getController().getSnapshot().currentAlert;
  }
  const anchor=pet.getBounds();const completed=await task('completed');
  assert.equal(completed.kind,'completed');await poll(view,v=>v.canvas?.action==='complete','任务完成庆祝');
  await wait(2100);assert.equal((await view()).pet.motionOwner,'codex','4秒庆祝不能在默认hop的1.8秒被截断');assert.deepEqual(pet.getBounds(),anchor,'自身动作不能再叠加原生hop位移');await capture('desktop-completed');
  await poll(view,v=>v.pet.motionOwner==='none','完整庆祝结束',6000);getController().dismiss(completed.id,completed.generation);clearDialogue();record('TASK_COMPLETED_FULL_DURATION',{});
  const failed=await task('failed');await poll(view,v=>v.canvas?.action==='shock','任务失败正确动作');getController().dismiss(failed.id,failed.generation);clearDialogue();await poll(view,v=>v.pet.motionOwner==='none','失败取消');record('TASK_FAILED_KIND',{});
  advance(31000);await poll(()=>Promise.resolve(canPresent()),Boolean,'额度前可呈现');callbacks.onQuota({windows:[{id:'codex:soft-orb-fixture',label:'Codex',windowMinutes:300,remaining:10,resetsAt:quotaResetAt}],updatedAt:now});advance(5000);
  const quota=await poll(()=>Promise.resolve(getController().getSnapshot().currentAlert),a=>a?.kind==='quota','真实额度提醒语义');if(quota?.kind==='quota'){await poll(view,v=>v.pet.motionOwner==='codex','额度提醒');assert.notEqual((await view()).canvas.action,'shock');getController().dismiss(quota.id,quota.generation);clearDialogue();}
  record('QUOTA_WARNING_NOT_FAILURE',{});await setEnabled(false);prepare();command('rest');sample();record('SYNTHETIC_TRANSPORT_ONLY',{realConnections:0});
  await ready();await capture('desktop-idle');
  if(artifacts)fs.writeFileSync(path.join(artifacts,'native-integration.json'),JSON.stringify({ok:true,source:'real-app-native-windows-and-IPC',taskSource:'synthetic-transport',results},null,2));
  process.stdout.write('PET_SOFT_ORB_NATIVE_OK\n');
}
module.exports={verifySoftOrb};
