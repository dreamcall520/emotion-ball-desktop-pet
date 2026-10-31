const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Customization = require('../lib/customization');
const SheepSkin = require('../lib/sheep-skin');
const SheepTheme = require('../lib/sheep-theme');

const renderer = fs.readFileSync(path.join(__dirname,'../renderer.js'),'utf8');
const main = fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
function declaration(source, name) {
  const match = new RegExp(`^([ \\t]*)function ${name}\\([^\\n]*\\) \\{`,'m').exec(source);
  assert.ok(match, `${name} 入口存在`);
  const end = source.indexOf(`\n${match[1]}}`,match.index);
  assert.ok(end > match.index, `${name} 结束边界存在`);
  return source.slice(match.index,end+match[1].length+2);
}
function registration(pattern) {
  const match = renderer.match(pattern);
  assert.ok(match, '实际事件注册存在');
  return match[0];
}
function fixture({ realClick = false } = {}) {
  const calls = [], options = [], instances = [], windowEvents = new Map();
  function makeBall() {
    const handlers = new Map();
    const ball = { emotionId:'50',
      on(event,callback) { handlers.set(event,callback); },
      emit(event,payload={}) { handlers.get(event)?.(payload); },
      setEmotion(id) { this.emotionId=id; calls.push(['emotion',id]); this.emit('change',{id}); },
      setMotionAction(id,owner) { calls.push(['action',id,owner]); },
      stopMotion() { calls.push(['ball-stop']); }, setFacing() {}, clearGaze() {},
      bounce() { calls.push(['ball-bounce']); }, spin(value) { calls.push(['ball-spin',value]); },
      setActive(value) { calls.push(['active',value]); }, renderStatic() { calls.push(['static']); },
      destroy() { calls.push(['destroy',instances.indexOf(this)]); }
    };
    instances.push(ball); return ball;
  }
  const appearance = Customization.normalizeAppearance({shape:'new-year-sheep',sheepTheme:'christmas'});
  const context = vm.createContext({
    uploadedAction:null, ball:null, weatherEffects:null, sheepOffering:null, sheepActionBall:null, actionTimer:null, actionUntil:0,
    customization:{appearance}, companion:{manualSleep:false,
      update:()=>({mode:'sleep',emotionId:'00',gaze:null}), setKeepAwake(){}, setManualSleep(value){this.manualSleep=Boolean(value);}},
    edgeSlidePacket:null, edgeSlideTimer:null, presentationSuppressed:false, presentationMode:'free', presentationPaused:false, presentationFrozen:false,
    lastSample:{locked:false}, currentState:{mode:'awake',emotionId:'50',gaze:null},
    activeMotion:null, dragState:null, facing:null, focusQuiet:false, codexEnabled:false,
    lastSheepClick:null,lastAuroraClick:null,nextSheepAmbientAt:0,lastSheepAmbient:null,sheepAutoNap:false,sheepLastInteractionAt:0,sheepLastNapAt:null,sheepAutomaticWakeUntil:0,lastWorkAttempt:0,singleClickTimer:null,helloTimer:null,petHovered:false,wakeOnDoubleClick:false,Math:Object.assign(Object.create(Math),{random:()=>0.01}),
    codexActiveTaskCount:0, codexThinking:false, codexThinkingVisible:false, codexThinkingTimer:null, quotaEffects:null, quotaPacket:{config:{}},
    compactMode:null, officialAurora:null, clickVisual:null, codexPet:null, listeners:[],
    petElement:{dataset:{},style:{setProperty(){},removeProperty(){}},querySelector:()=>null,replaceChildren(){},setAttribute(){}},
    petting:{reset:()=>calls.push(['petting-reset'])},
    document:{hidden:false},window:{innerWidth:180,EB_CUSTOM_SHAPES:{createShape:()=>null}},
    EmotionBall:{create(target,value){options.push(value);return makeBall();}},
    PetCustomization:Customization, SheepSkin, SheepTheme,
    performance:{now:()=>100},PetBehavior:require('../lib/pet-behavior'),reducedMotion:()=>false,
    playEmotion:(...args)=>calls.push(['play-emotion',...args]),
    clearTimeout:id=>calls.push(['clear-timeout',id]),
    setTimeout(){throw new Error('专属动作不能以固定计时器代替真实结束');},
    cancelPendingInteraction:()=>calls.push(['pending-cancel']),
    noteInteraction:()=>calls.push(['interaction']),
    restoreState:()=>calls.push(['restore']),
    syncQuotaEffects(){},syncFacing(){},visualFacing:()=> 'right',syncSuppressedAnimation(){},setBallGaze(){},
    registerIdleAppearance(){}, stopCodexThinkingCadence(){},startCodexThinkingCadence(){calls.push(['thinking']);},
    desktop:{say:(...args)=>calls.push(['say',...args]),bounce:()=>calls.push(['host-bounce']),stopMotion:()=>calls.push(['host-stop']),
      onSettings(callback){context.settingsHandler=callback;return ()=>{};}},
    onWindow:(event,callback)=>windowEvents.set(event,callback), observe:callback=>callback,
    playReaction:(...args)=>calls.push(['reaction',...args]),runRandomEmotion:()=>calls.push(['random']),
    sleep:()=>calls.push(['sleep']),wake:()=>calls.push(['wake']),
    runSingleClickAction:(...args)=>calls.push(['single',...args]),
    cancelCodex:command=>calls.push(['codex-cancel',command]),startCodex:command=>calls.push(['codex',command])
  });
  context.PetCustomization={...Customization,auroraReferenceTexture:()=>null};
  const functions=['syncEdgePeekStyle','startSheepInteraction','runBuddyClick','wakeSheep','clearSheepAutoNap','wakeSheepAutomaticSleep','resetSheepAmbient','maybePlaySheepAmbient','clearAction','stopMotion','showEmotion','createBall','runCommand','sheepOfferingState','playSheepOffering','updatePresentation','updateActivity'];
  vm.runInContext(`'use strict';\n${functions.map(name=>declaration(renderer,name)).join('\n')}`,context);
  vm.runInContext(registration(/listeners\.push\(desktop\.onSettings\(observe\(settings => \{[\s\S]*?\n  \}\)\)\);/),context);
  vm.runInContext(registration(/onWindow\('beforeunload', \(\) => \{[\s\S]*?\n  \}\);/),context);
  if(realClick)vm.runInContext(declaration(renderer,'runSingleClickAction'),context);
  context.createBall('50'); calls.length=0;
  return {context,calls,options,instances,windowEvents,
    start(...args){context.runCommand({command:'sheep-action',action:args.length ? args[0] : 'greet'});},
    restores:()=>calls.filter(call=>call[0]==='restore').length,
    actions:()=>calls.filter(call=>call[0]==='action')};
}

test('真实createBall传递节日配置，专属动作由当前实例结束释放，重复结束不重复恢复', () => {
  const h=fixture(); assert.equal(h.options[0].sheepTheme,'christmas');
  for(const action of Object.keys(SheepSkin.ACTIONS)) {
    h.start(action);
    assert.equal(h.context.sheepActionBall,h.context.ball); assert.equal(h.context.actionUntil,Infinity);
    assert.deepEqual(h.actions().at(-1),['action',action,undefined]);
    const restores=h.restores(); assert.equal(h.context.actionTimer,null);
    h.context.ball.emit('motionend',{action});
    assert.equal(h.context.actionUntil,0); assert.equal(h.context.sheepActionBall,null); assert.equal(h.restores(),restores+1);
    h.context.ball.emit('motionend',{action}); assert.equal(h.restores(),restores+1);
  }
});

test('旧实例motionend不影响新实例，新动作与旧完成回调不串台', () => {
  const h=fixture(); h.start('greet'); const old=h.context.ball;
  h.context.createBall('50'); const current=h.context.ball;
  old.emit('motionend',{action:'greet'}); assert.equal(h.restores(),0);
  h.start('joy'); old.emit('motionend',{action:'greet'});
  assert.equal(h.context.sheepActionBall,current); assert.equal(h.context.actionUntil,Infinity); assert.equal(h.restores(),0);
  current.emit('motionend',{action:'joy'}); assert.equal(h.restores(),1);
});

test('真实stop、隐藏、锁屏与关闭均作废guard，迟到完成不能恢复被中断的状态', () => {
  const actions=[
    h=>h.context.runCommand('stop'),
    h=>h.context.updatePresentation({mode:'hidden',suppressed:true}),
    h=>h.context.updateActivity({locked:true}),
    h=>h.windowEvents.get('beforeunload')()
  ];
  for(const interrupt of actions) {
    const h=fixture(); h.start(); interrupt(h); const count=h.restores();
    assert.equal(h.context.sheepActionBall,null); assert.equal(h.context.actionUntil,0);
    h.context.ball.emit('motionend',{action:'greet'}); assert.equal(h.restores(),count);
    assert.ok(h.calls.some(call=>call[0]==='ball-stop'));
  }
});

test('真实外观设置变更取消专属占用，再创建皮肤，旧完成不恢复新外观', () => {
  for(const appearance of [{shape:'blob'},{shape:'new-year-sheep',sheepTheme:'halloween'}]) {
    const h=fixture(); h.start(); const old=h.context.ball; h.context.lastSample=null;
    h.context.settingsHandler({customization:{appearance},keepAwake:false});
    assert.notEqual(h.context.ball,old);
    assert.equal(h.context.actionUntil,0); assert.equal(h.context.sheepActionBall,null);
    old.emit('motionend',{action:'greet'}); assert.equal(h.restores(),0);
  }
});

test('非法动作严格拒绝数组或对象伪装，其他皮肤、睡眠与抑制状态不能抢占动作', () => {
  const h=fixture();
  for(const action of ['packet','lantern','fortune','__proto__','constructor','toString','',null,undefined,123,{},[],['greet'],new String('greet'),{toString:()=> 'greet'}]) {
    h.start(action); assert.equal(h.context.actionUntil,0,String(action)); assert.equal(h.actions().length,0);
  }
  for(const change of [c=>{c.customization.appearance.shape='blob';},c=>{c.companion.manualSleep=true;},c=>{c.lastSample={locked:true};},c=>{c.presentationSuppressed=true;}]) {
    const f=fixture(); change(f.context); f.start(); assert.equal(f.context.actionUntil,0); assert.equal(f.actions().length,0);
  }
});

test('普通指令沿用原路径，rest与stop不会残留主题占用', () => {
  const h=fixture();
  h.context.runCommand({command:'again',motion:'hop'}); assert.deepEqual(h.calls.at(-1),['reaction','hop',false]);
  for(const command of ['random','sleep','wake']) {h.context.runCommand(command);assert.deepEqual(h.calls.at(-1),[command]);}
  h.context.runCommand('again'); assert.deepEqual(h.calls.at(-1),['single',false]);
  h.start(); h.context.runCommand('rest'); assert.equal(h.context.actionUntil,0); assert.equal(h.context.sheepActionBall,null);
  assert.equal(h.context.petElement.dataset.lastAction,'rest');
});

test('主进程真实发送入口拒绝非字符串动作，保留合法专属动作及普通命令', () => {
  const sent=[];
  const context=vm.createContext({screenLocked:false,isQuitting:false,edgeTuck:{getPresentation:()=>({mode:'free'})},SheepSkin,SheepTheme,effectiveCustomization:value=>value,settings:{customization:{appearance:{shape:'new-year-sheep'}}},
    petWindow:{isDestroyed:()=>false,isVisible:()=>true,webContents:{send:(channel,value)=>sent.push([channel,value])}},
    getMotion:require('../lib/interaction-motion').getMotion,stopMotion(){}});
  vm.runInContext(declaration(main,'sendCommand'),context);
  for(const action of Object.keys(SheepSkin.ACTIONS)) context.sendCommand({command:'sheep-action',action});
  assert.equal(sent.length,4); sent.length=0;
  for(const action of [['greet'],new String('walk'),{toString:()=> 'joy'},'proud','__proto__',null]) context.sendCommand({command:'sheep-action',action});
  assert.equal(sent.length,0);
  context.sendCommand('wake'); assert.equal(sent[0][1],'wake');
});

test('主进程真实showDialogue按本地日期解析auto，手动配置保持不变', () => {
  let calendar=new Date(2026,9,26).getTime();
  class LocalDate extends Date {constructor(){super(calendar);}}
  const offered=[];
  const appearance={shape:'new-year-sheep',sheepTheme:'auto'};
  const context=vm.createContext({Date:LocalDate,SheepTheme,performance:{now:()=>0},
    weatherDialogue:()=>'',pomodoroQuiet:false,shortcutDialogueSuppressed:()=>false,screenLocked:false,chatWindow:null,presentationSuppressed:()=>false,
    petWindow:{isDestroyed:()=>false,isVisible:()=>true},settings:{customization:{appearance}},effectiveCustomization:value=>value,
    dialogue:{offer(event,now,details){offered.push(details);return {id:1};},hasBubble:()=>false},
    dismissCodexPresentation(){},showBubble(){},hideBubble(){}});
  vm.runInContext(declaration(main,'showDialogue'),context);
  context.showDialogue('hello'); assert.equal(offered.at(-1).sheepTheme,'halloween');
  calendar=new Date(2026,11,25).getTime(); context.showDialogue('hello'); assert.equal(offered.at(-1).sheepTheme,'christmas');
  calendar=new Date(2026,11,26).getTime(); context.showDialogue('hello'); assert.equal(offered.at(-1).sheepTheme,'none');
  calendar=new Date(2027,1,1).getTime(); context.showDialogue('hello'); assert.equal(offered.at(-1).sheepTheme,'spring-festival');
  calendar=new Date(2027,1,20,23,59).getTime(); context.showDialogue('hello'); assert.equal(offered.at(-1).sheepTheme,'spring-festival');
  calendar=new Date(2027,1,21).getTime(); context.showDialogue('hello'); assert.equal(offered.at(-1).sheepTheme,'none');
  appearance.sheepTheme='halloween'; context.showDialogue('hello'); assert.equal(offered.at(-1).sheepTheme,'halloween');
  assert.equal(appearance.sheepTheme,'halloween');
});

test('春节三个真实动作释放占用，其他主题拒绝而不打断当前动作', () => {
  for(const theme of ['none','halloween','christmas','spring-festival']) {
    for(const action of ['fortune','firecrackers','dumplings']) {
      const h=fixture(); h.context.customization.appearance.sheepTheme=theme;
      h.start(action);
      if(theme==='spring-festival') {
        assert.equal(h.context.actionUntil,Infinity); assert.equal(h.actions().at(-1)[1],action);
        h.context.ball.emit('motionend',{action}); assert.equal(h.context.actionUntil,0); assert.equal(h.restores(),1);
      } else {
        assert.equal(h.context.actionUntil,0); assert.equal(h.actions().length,0);
        h.start('walk'); const count=h.actions().length;
        h.start(action); assert.equal(h.context.actionUntil,Infinity); assert.equal(h.actions().length,count);
      }
    }
  }
});

test('主进程动作和实际菜单按自动主题的当前日期限制春节互动', () => {
  let calendar=new Date(2027,1,1).getTime();
  class LocalDate extends Date {constructor(){super(calendar);}}
  const sent=[], spoken=[], appearance={shape:'new-year-sheep',sheepTheme:'auto'};
  const context=vm.createContext({Date:LocalDate,SheepSkin,SheepTheme,effectiveCustomization:value=>value,
    settings:{customization:{appearance}},
    petWindow:{isDestroyed:()=>false,isVisible:()=>true,webContents:{send:(channel,value)=>sent.push(value)}},
    showDialogue:(...args)=>spoken.push(args),getMotion:require('../lib/interaction-motion').getMotion,stopMotion(){}});
  vm.runInContext(declaration(main,'sendCommand'),context);
  const start=main.indexOf("{ label: '咩咩互动'"), end=main.indexOf('] : []),',start);
  const menu=start>=0 && end>start ? main.slice(start,end) : null;
  assert.ok(menu,'提取实际菜单而非复述实现');
  const readMenu=()=>vm.runInContext(`(${menu})`,context).submenu;
  for(const action of ['fortune','firecrackers','dumplings']) context.sendCommand({command:'sheep-action',action});
  assert.equal(sent.length,3); assert.equal(readMenu().length,7);
  readMenu().find(item=>item.label==='吃饺子').click(); assert.deepEqual(spoken.at(-1),['play','dumplings']);
  sent.length=0; calendar=new Date(2027,1,20,23,59).getTime();
  context.sendCommand({command:'sheep-action',action:'dumplings'}); assert.equal(sent.length,1, '十五仍可春节互动');
  sent.length=0; calendar=new Date(2027,1,21).getTime();
  for(const action of ['fortune','firecrackers','dumplings']) context.sendCommand({command:'sheep-action',action});
  assert.equal(sent.length,0); assert.equal(readMenu().length,7);
  appearance.sheepTheme='spring-festival'; assert.equal(readMenu().length,7);
  context.sendCommand({command:'sheep-action',action:'dumplings'}); assert.equal(sent.length,1);
});

test('咩咩Codex提醒等当前原画加载再确认，旧请求或换外观后不会迟到开播', async()=>{
  for(const scenario of ['ready','stale','replace','failed','ordinary']) {
    let resolveReady;
    const sent=[], actions=[];
    const ready=new Promise(resolve=>{resolveReady=resolve;});
    const player={setEmotion(){},setMotionAction:(...args)=>actions.push(args),setMotionFrame(){},whenMotionReady:()=>ready};
    const context=vm.createContext({InteractionMotion:require('../lib/interaction-motion'),
      focusQuiet:false,presentationSuppressed:false,codexEnabled:true,lastSample:{locked:false},
      companion:{manualSleep:false},currentState:{mode:'awake'},dragState:null,sheepOffering:null,singleClickTimer:null,helloTimer:null,
      performance:{now:()=>1000},actionUntil:0,
      codexGeneration:2,codexPageEpoch:3,lastCodexAlertId:0,nextMotionToken:0,activeMotion:null,ball:player,
      petElement:{dataset:{}},customization:{appearance:{shape:scenario==='ordinary'?'blob':'new-year-sheep'}},
      desktop:{codexMotionReady:packet=>sent.push(packet)},cancelCodex:()=>sent.push('cancel')});
    vm.runInContext(declaration(renderer,'canShowCodex')+'\n'+declaration(renderer,'startCodex'),context);
    context.startCodex({motion:'hop',generation:2,pageEpoch:3,alertId:1});
    assert.equal(sent.length,scenario==='ordinary'?1:0);
    assert.equal(context.canShowCodex(),false,'准备中的动作仍阻止其他提醒抢占');
    assert.deepEqual(actions,[['hop','codex']]);
    if(scenario==='stale')context.activeMotion=null;
    if(scenario==='replace')context.ball={};
    resolveReady(scenario!=='failed'); await ready; await Promise.resolve();
    if(scenario==='stale'||scenario==='replace')assert.equal(sent.length,0);
    else if(scenario==='failed')assert.deepEqual(sent,['cancel']);
    else {assert.equal(sent.length,1);assert.equal(sent[0].action,'hop');assert.equal(sent[0].alertId,1);}
  }
});


test('咩咩真实单击入口按四主题完整轮换5动作，相邻不重复且无宿主bounce/spin', () => {
  const extras={none:['ear','bell','stretch'],halloween:['candy','magic','pumpkin'],christmas:['gift','scarf','snow'],'spring-festival':['fortune','firecrackers','dumplings']};
  for(const [theme,special] of Object.entries(extras)) {
    const h=fixture({realClick:true});h.context.customization.appearance.sheepTheme=theme;
    const selected=[];
    for(let i=0;i<10;i++) {
      h.context.runSingleClickAction();const action=h.actions().at(-1)[1];selected.push(action);
      assert.equal(h.context.actionUntil,Infinity);assert.equal(h.context.sheepActionBall,h.context.ball);
      if(i%2)h.context.runCommand('stop');else h.context.ball.emit('motionend',{action});
      assert.equal(h.context.actionUntil,0);assert.equal(h.context.sheepActionBall,null);
    }
    const expected=['greet','joy',...special].sort();
    assert.deepEqual(selected.slice(0,5).sort(),expected,theme);assert.deepEqual(selected.slice(5).sort(),expected,theme);
    assert.ok(selected.every((action,i)=>i===0||action!==selected[i-1]),theme);
    assert.ok(selected.every(action=>!['idle','walk','sleep','working','complete'].includes(action)),theme);
    assert.equal(h.calls.filter(c=>['host-bounce','ball-bounce','ball-spin','reaction'].includes(c[0])).length,0,theme);
    assert.equal(h.calls.filter(c=>c[0]==='say'&&c[1]?.event==='play').length,10);
  }
});

test('咩咩单击被抑制或锁屏时零动作，恢复后仍能点击', () => {
  for(const [field,value] of [['presentationSuppressed',true],['lastSample',{locked:true}]]) {
    const h=fixture({realClick:true}),original=h.context[field];h.context[field]=value;
    h.context.runSingleClickAction();assert.equal(h.actions().length,0);assert.equal(h.context.lastSheepClick,null);assert.equal(h.calls.length,0,field);
    h.context[field]=original;h.context.runSingleClickAction();assert.equal(h.actions().length,1,field);
  }
});

test('Codex执行中的真实单击保留thought回应，静默与speak=false沿用既有规则', () => {
  const h=fixture({realClick:true});h.context.codexEnabled=true;h.context.codexActiveTaskCount=2;
  h.context.runSingleClickAction();assert.equal(h.actions().length,0);assert.equal(h.context.petElement.dataset.lastAction,'thought');
  assert.ok(h.calls.some(c=>c[0]==='thinking'));assert.deepEqual(h.calls.filter(c=>c[0]==='say'),[['say','thought']]);assert.equal(h.context.lastSheepClick,null);
  h.context.focusQuiet=true;h.context.runSingleClickAction();assert.equal(h.actions().length,1,'专注静默时不进入Codex thought分支');
  h.context.runCommand('stop');h.context.focusQuiet=false;const spoken=h.calls.filter(c=>c[0]==='say').length;
  h.context.runSingleClickAction(false);assert.equal(h.actions().length,2,'again的无文案点击仍走羊动作');assert.equal(h.calls.filter(c=>c[0]==='say').length,spoken);
});

test('咩咩单击切换主题或打断旧动作仍释放真实guard，其他形态保留原单击行为', () => {
  const h=fixture({realClick:true});h.context.runSingleClickAction();h.context.customization.appearance.sheepTheme='halloween';h.context.runSingleClickAction();
  assert.ok(['greet','joy','candy','magic','pumpkin'].includes(h.actions().at(-1)[1]));
  h.context.ball.emit('motionend',{action:h.actions().at(-1)[1]});assert.equal(h.context.actionUntil,0);
  for(const shape of ['blob','cloud','square']) {
    const f=fixture({realClick:true});f.context.customization.appearance.shape=shape;f.context.runSingleClickAction();
    assert.equal(f.actions().length,0);assert.ok(f.calls.some(c=>c[0]==='play-emotion'));assert.ok(f.calls.some(c=>['host-bounce','ball-bounce','ball-spin'].includes(c[0])));
  }
  const a=fixture({realClick:true});a.context.customization.appearance.shape='aurora-cloud';a.context.runSingleClickAction();a.context.runSingleClickAction();
  assert.deepEqual(a.calls.filter(c=>c[0]==='reaction'),[['reaction','dizzy',false],['reaction','turn',false]]);assert.equal(a.actions().length,0);
  const o=fixture({realClick:true});o.context.officialAurora={click:()=>true};o.context.customization.appearance.shape='aurora-cloud';o.context.runSingleClickAction();
  assert.equal(o.context.petElement.dataset.lastAction,'official');assert.equal(o.actions().length,0);
});


function ambientFixture(theme='none') {
  const h=fixture({realClick:true});let now=0;
  h.context.customization.appearance.sheepTheme=theme;
  h.context.sheepLastInteractionAt=Infinity; // These tests isolate light gestures; nap gets its own clock tests.
  h.context.performance.now=()=>now;
  h.context.currentState={mode:'awake',emotionId:'50',gaze:null};
  h.context.companion.update=()=>h.context.currentState;
  h.context.companion.noteInteraction=()=>h.calls.push(['human-activity']);
  vm.runInContext(declaration(renderer,'noteInteraction'),h.context);
  return {...h,at(value){now=value;return h.context.maybePlaySheepAmbient(now);}};
}

test('羊安静自动动作45–75秒后才开始，四主题池正确、无连续重复且不发话或伪造用户活动',()=>{
  const pools={none:['ear','bell','stretch','joy'],halloween:['magic','joy','greet'],christmas:['scarf','snow','joy'],'spring-festival':['fortune','greet','joy']};
  for(const [theme,pool] of Object.entries(pools)) {
    const h=ambientFixture(theme);let now=0;const selected=[];
    assert.equal(h.at(0),false);assert.ok(h.context.nextSheepAmbientAt>=45000&&h.context.nextSheepAmbientAt<=75000);
    for(let i=0;i<8;i++) {
      const deadline=h.context.nextSheepAmbientAt;assert.equal(h.at(deadline-1),false);
      assert.equal(h.at(deadline),true);const action=h.actions().at(-1)[1];selected.push(action);assert.ok(pool.includes(action),theme);
      assert.equal(h.context.actionUntil,Infinity);h.context.ball.emit('motionend',{action});assert.equal(h.context.actionUntil,0);
      now=deadline;assert.ok(h.context.nextSheepAmbientAt>=now+45000&&h.context.nextSheepAmbientAt<=now+75000);
    }
    assert.ok(selected.every((a,i)=>!i||a!==selected[i-1]),theme);
    assert.equal(h.calls.filter(c=>['say','human-activity','host-bounce','ball-bounce','ball-spin'].includes(c[0])).length,0,theme);
  }
  const h=ambientFixture();h.context.Math.random=()=>0;h.context.resetSheepAmbient(100);assert.equal(h.context.nextSheepAmbientAt,45100);
  h.context.Math.random=()=>0.999999;h.context.resetSheepAmbient(100);assert.equal(h.context.nextSheepAmbientAt,75100);
});

test('自动动作所有忙碌或安静场景不排队，恢复必须重新等待完整间隔',()=>{
  const cases=[
    c=>{c.customization.appearance.shape='blob';},c=>{c.currentState.mode='focus';},c=>{c.currentState.mode='sleep';},
    c=>{c.codexActiveTaskCount=1;},c=>{c.focusQuiet=true;},c=>{c.presentationSuppressed=true;},c=>{c.presentationPaused=true;},
    c=>{c.lastSample.locked=true;},c=>{c.companion.manualSleep=true;},c=>{c.dragState={dragged:false};},
    c=>{c.singleClickTimer=1;},c=>{c.helloTimer=1;},c=>{c.activeMotion={token:1};},c=>{c.actionUntil=Infinity;},c=>{c.reducedMotion=()=>true;}
  ];
  for(const block of cases) {
    const h=ambientFixture();h.at(0);block(h.context);assert.equal(h.at(100000),false);assert.equal(h.actions().length,0);
    if(h.context.customization.appearance.shape==='new-year-sheep')assert.ok(h.context.nextSheepAmbientAt>=145000);
    Object.assign(h.context,{presentationSuppressed:false,presentationPaused:false,focusQuiet:false,lastSample:{locked:false},dragState:null,singleClickTimer:null,helloTimer:null,activeMotion:null,actionUntil:0,codexActiveTaskCount:0,reducedMotion:()=>false});
    h.context.customization.appearance.shape='new-year-sheep';h.context.currentState.mode='awake';h.context.companion.manualSleep=false;
    assert.equal(h.at(100001),false,'恢复时不补发刚才错过的动作');assert.ok(h.context.nextSheepAmbientAt>=145000);
    assert.equal(h.at(h.context.nextSheepAmbientAt),true);assert.equal(h.actions().length,1);
  }
});

test('主动互动重新计时；自动动作经真实updateActivity接线并能stop/换主题释放',()=>{
  const h=ambientFixture();h.at(0);h.at(40000);h.context.noteInteraction();assert.ok(h.context.nextSheepAmbientAt>=85000);
  const deadline=h.context.nextSheepAmbientAt;h.at(deadline);assert.equal(h.actions().length,1);h.context.runCommand('stop');assert.equal(h.context.actionUntil,0);
  h.context.customization.appearance.sheepTheme='christmas';h.context.resetSheepAmbient();h.at(h.context.nextSheepAmbientAt);assert.ok(['scarf','snow','joy'].includes(h.actions().at(-1)[1]));
  h.context.ball.emit('motionend',{action:h.actions().at(-1)[1]});assert.equal(h.context.sheepActionBall,null);
  const r=ambientFixture('halloween');r.context.lastWorkAttempt=1000000;r.at(0);const due=r.context.nextSheepAmbientAt;r.at(due-1);r.context.performance.now=()=>due;r.context.updateActivity({locked:false});assert.equal(r.actions().length,1,'现有activity周期真正调用自动动作');
  assert.equal(r.calls.filter(c=>c[0]==='human-activity'||c[0]==='say').length,0);
});

test('羊双击清醒时也沿用原画轮换，睡着双击仍只唤醒且不走宿主跳跃',()=>{
  const h=fixture({realClick:true});vm.runInContext(declaration(renderer,'runDoubleClickAction'),h.context);
  h.context.runDoubleClickAction();assert.equal(h.actions().length,1);assert.equal(h.calls.filter(c=>c[0]==='reaction'||c[0]==='host-bounce').length,0);
  h.context.runCommand('stop');h.context.companion.manualSleep=true;h.context.runDoubleClickAction();assert.equal(h.actions().length,2);assert.equal(h.actions().at(-1)[1],'greet');assert.equal(h.context.companion.manualSleep,false);assert.equal(h.calls.filter(c=>c[0]==='host-bounce').length,0);
});

test('自动小动作不重置真实CompanionState的人类活动，自然空闲仍可进入睡眠',()=>{
  const h=ambientFixture();const {CompanionState}=require('../lib/companion-behavior');const companion=new CompanionState();companion.noteInteraction(0);h.context.companion=companion;h.at(0);
  for(const now of [76000,152000,228000]) {
    h.context.currentState=companion.update({idleSeconds:now/1000,locked:false},now);h.at(now);h.context.ball.emit('motionend',{action:h.actions().at(-1)?.[1]});
  }
  assert.ok(h.actions().length>=2);assert.equal(companion.update({idleSeconds:900,locked:false},900000).mode,'sleep');
  assert.equal(h.calls.filter(c=>c[0]==='human-activity').length,0);
});


function napFixture() {
  const h=ambientFixture('none');const {CompanionState}=require('../lib/companion-behavior');h.context.companion=new CompanionState({keepAwake:true});h.context.companion.noteInteraction(0);h.context.sheepLastInteractionAt=0;h.context.lastSample={idleSeconds:300,locked:false};h.context.lastWorkAttempt=0;
  vm.runInContext(declaration(renderer,'restoreState'),h.context);
  return h;
}

test('保持清醒复现：电脑持续操作但五分钟未点宠物不小睡，关闭选项保留原规则',()=>{
 for(const keepAwake of [true,false]){
  const h=napFixture();h.context.companion.setKeepAwake(keepAwake);h.context.lastSample={idleSeconds:0,locked:false};h.at(0);
  h.context.nextSheepAmbientAt=300000;h.at(300000);
  assert.equal(h.context.sheepAutoNap,!keepAwake,'OS active and pet untouched');
 }
});

test('保持清醒仍在系统连续闲置五分钟后休息，系统键鼠恢复只自动唤醒自动小睡且不频繁重睡',()=>{
 const h=napFixture();h.at(0);h.context.lastSample={idleSeconds:299,locked:false};h.context.nextSheepAmbientAt=300000;h.at(300000);
 assert.equal(h.context.sheepAutoNap,false);h.context.ball.emit('motionend',{action:h.actions().at(-1)?.[1]});
 h.context.lastSample={idleSeconds:300,locked:false};h.context.nextSheepAmbientAt=301000;h.at(301000);assert.equal(h.context.sheepAutoNap,true);
 h.context.updateActivity({idleSeconds:0,locked:false});assert.equal(h.context.sheepAutoNap,false);assert.equal(h.actions().at(-1)[1],'stretch');
 const count=h.actions().length;h.context.ball.emit('motionend',{action:'stretch'});
 for(const now of [302000,600000,900000,1200000]){h.context.nextSheepAmbientAt=now;h.at(now);h.context.updateActivity({idleSeconds:0,locked:false});assert.equal(h.context.sheepAutoNap,false);h.context.ball.emit('motionend',{action:h.actions().at(-1)?.[1]});}
 assert.equal(h.actions().filter(row=>row[1]==='stretch').length>=1,true);assert.ok(h.actions().length>=count);
 const manual=napFixture();manual.context.companion.setManualSleep(true,0);manual.context.currentState={mode:'sleep',emotionId:'00',gaze:null};manual.context.ball.setEmotion('00');manual.context.updateActivity({idleSeconds:0,locked:false});
 assert.equal(manual.context.companion.manualSleep,true);assert.equal(manual.context.ball.emotionId,'00');assert.equal(manual.actions().length,0);
 const task=napFixture();task.context.sheepAutoNap=true;task.context.codexActiveTaskCount=1;task.context.updateActivity({idleSeconds:0,locked:false});assert.equal(task.context.sheepAutoNap,false);assert.equal(task.actions().length,0,'Codex owns work, no wake gesture');
});

test('五分钟未互动首次小睡安静开始并保持，hover轻唤醒不说话不跳且不立刻重睡',()=>{
  const h=napFixture();h.at(0);h.context.nextSheepAmbientAt=299999;h.at(299999);assert.equal(h.context.sheepAutoNap,false);h.context.ball.emit('motionend',{action:h.actions().at(-1)?.[1]});
  h.context.nextSheepAmbientAt=300000;assert.equal(h.at(300000),true);assert.equal(h.context.sheepAutoNap,true);assert.equal(h.context.ball.emotionId,'00');assert.equal(h.context.companion.manualSleep,false);
  h.at(310000);h.context.updateActivity(h.context.lastSample);assert.equal(h.context.ball.emotionId,'00');assert.equal(h.context.sheepAutoNap,true);
  const enters=new Map();h.context.onPet=(event,fn)=>enters.set(event,fn);vm.runInContext(registration(/onPet\('pointerenter', \(\) => \{[\s\S]*?\n  \}\);/),h.context);enters.get('pointerenter')();
  assert.equal(h.context.sheepAutoNap,false);assert.equal(h.context.ball.emotionId,'50');assert.equal(h.context.currentState.mode,'awake');assert.equal(h.context.helloTimer,null);assert.equal(h.context.sheepLastInteractionAt,310000);
  assert.equal(h.at(310001),false);assert.equal(h.context.ball.emotionId,'50');assert.equal(h.calls.filter(c=>['say','reaction','host-bounce','human-activity'].includes(c[0])).length,0);
});

test('自动/自然/手动睡眠单击均播真实唤醒，400ms内后续双击不补动作',()=>{
  for(const natural of [false,true]) {
    const h=napFixture();if(natural){h.context.companion.setKeepAwake(false);h.context.currentState=h.context.companion.update({idleSeconds:900,locked:false},900000);h.at(900000);h.context.ball.setEmotion('00');}
    else{h.at(0);h.context.nextSheepAmbientAt=300000;h.at(300000);}
    vm.runInContext(declaration(renderer,'runDoubleClickAction'),h.context);const before=h.actions().length;h.context.runSingleClickAction();assert.equal(h.context.ball.emotionId,'50');assert.equal(h.context.sheepAutoNap,false);assert.equal(h.context.currentState.mode,'awake');assert.equal(h.actions().length,before+1);assert.equal(h.actions().at(-1)[1],'stretch');
    h.context.runDoubleClickAction();assert.equal(h.actions().length,before+1);assert.equal(h.calls.filter(c=>['say','reaction','host-bounce','human-activity'].includes(c[0])).length,0);
    h.at((natural?900000:300000)+401);h.context.runSingleClickAction();assert.equal(h.actions().length,before+2);
  }
  const m=napFixture();m.context.companion.setManualSleep(true,0);m.context.currentState={mode:'sleep',emotionId:'00',gaze:null};m.context.ball.setEmotion('00');m.context.runSingleClickAction();assert.equal(m.context.ball.emotionId,'50');assert.equal(m.context.companion.manualSleep,false);assert.equal(m.actions().at(-1)[1],'stretch');
});

test('后续小睡至少十分钟且低概率，任务/锁屏/隐藏取消，不补播；hover和其它形态不自动睡',()=>{
  const h=napFixture();h.at(0);h.context.nextSheepAmbientAt=300000;h.at(300000);h.context.wakeSheepAutomaticSleep();
  h.context.nextSheepAmbientAt=600000;h.at(600000);assert.equal(h.context.sheepAutoNap,false,'距上次小睡还不足十分钟');h.context.ball.emit('motionend',{action:h.actions().at(-1)?.[1]});
  h.context.Math.random=()=>.9;h.context.nextSheepAmbientAt=900000;h.at(900000);assert.equal(h.context.sheepAutoNap,false,'低概率未命中');h.context.ball.emit('motionend',{action:h.actions().at(-1)?.[1]});
  h.context.Math.random=()=>0;h.context.nextSheepAmbientAt=976000;h.at(976000);assert.equal(h.context.sheepAutoNap,true);
  for(const scenario of ['task','lock','hidden']) {
    const f=napFixture();f.at(0);f.context.nextSheepAmbientAt=300000;f.at(300000);
    if(scenario==='task'){f.context.codexActiveTaskCount=1;f.context.updateActivity(f.context.lastSample);}
    if(scenario==='lock')f.context.updateActivity({idleSeconds:120,locked:true});
    if(scenario==='hidden')f.context.updatePresentation({mode:'hidden',suppressed:true});
    assert.equal(f.context.sheepAutoNap,false,scenario);assert.equal(f.context.petElement.dataset.autoNap,'false',scenario);
  }
  for(const block of [c=>{c.petHovered=true;},c=>{c.customization.appearance.shape='blob';},c=>{c.companion.manualSleep=true;},c=>{c.currentState.mode='focus';}]) {
    const f=napFixture();f.at(0);block(f.context);f.context.nextSheepAmbientAt=300000;f.at(300000);assert.equal(f.context.sheepAutoNap,false);
  }
  const c=napFixture();c.context.sheepAutoNap=true;c.context.sheepLastNapAt=300000;c.context.createBall('50');assert.equal(c.context.sheepAutoNap,false);assert.equal(c.context.sheepLastNapAt,null);
});

test('真实系统空闲五分钟进入spacing后仍可安静小睡，轻醒恢复awake',()=>{
  const h=napFixture();h.context.companion.setKeepAwake(false);h.at(0);h.context.currentState=h.context.companion.update({idleSeconds:300,locked:false},300001);
  assert.equal(h.context.currentState.mode,'spacing');h.context.nextSheepAmbientAt=300001;h.at(300001);assert.equal(h.context.sheepAutoNap,true);assert.equal(h.context.ball.emotionId,'00');
  h.context.runSingleClickAction();assert.equal(h.context.currentState.mode,'awake');assert.equal(h.context.ball.emotionId,'50');assert.equal(h.calls.filter(c=>c[0]==='say'||c[0]==='host-bounce'||c[0]==='reaction').length,0);
});


test('桌面送糖与礼物真实命令调用对应接收片段，完成/取消清guard，忙碌与非节日拒收',()=>{
  for(const [theme,kind,clip] of [['halloween','candy','candy'],['christmas','gift','receive-gift']]) {
    const h=fixture(),c=h.context;c.customization.appearance.sheepTheme=theme;let playing=false;
    c.sheepOffering={isPlaying:()=>playing,cancel(){playing=false;},update(){},offer(kind){if(c.playSheepOffering(kind)){playing=true;return true;}return false;}};
    c.runCommand({command:'sheep-offer',kind});assert.equal(h.actions().at(-1)[1],clip);assert.equal(c.actionUntil,Infinity);assert.ok(playing);
    c.ball.emit('motionend');assert.equal(c.actionUntil,0);assert.equal(playing,false);
    for(const change of [x=>{x.codexActiveTaskCount=1;},x=>{x.companion.manualSleep=true;},x=>{x.currentState.mode='sleep';},x=>{x.currentState.mode='focus';},x=>{x.lastSample.locked=true;},x=>{x.presentationMode='hidden';},x=>{x.focusQuiet=true;},x=>{x.customization.appearance.sheepTheme='none';}]) {
      const f=fixture();f.context.customization.appearance.sheepTheme=theme;change(f.context);assert.equal(f.context.playSheepOffering(kind),false);assert.equal(f.actions().length,0);
    }
  }
});
test('真实鼠标问好等待不隐藏送物入口，靠近入口取消问好而不伪造点击或动作',()=>{
  for(const theme of ['halloween','christmas']) {
    const h=fixture(),c=h.context;c.customization.appearance.sheepTheme=theme;
    c.sheepOffering={isPlaying:()=>false,blocksHover:()=>false};
    c.setTimeout=()=>901;c.onPet=(name,fn)=>{c.enter=fn;};
    vm.runInContext(registration(/onPet\('pointerenter', \(\) => \{[\s\S]*?\n  \}\);/),c);
    c.enter();assert.equal(c.helloTimer,901);assert.equal(c.sheepOfferingState().eligible,true,'pending hello must not make the source vanish');
    const approach=renderer.match(/onApproach\(\) \{[^}]+\}/)[0];
    vm.runInContext(`({${approach}}).onApproach()`,c);
    assert.equal(c.helloTimer,null);assert.ok(h.calls.some(row=>row[0]==='clear-timeout'&&row[1]===901));
    assert.equal(c.sheepOfferingState().eligible,true);assert.equal(h.actions().length,0);
  }
});
test('原生咩咩菜单以同一送物命令接收，圣诞与给用户礼物分开且不发桌面气泡',()=>{
  const sent=[],spoken=[],appearance={shape:'new-year-sheep',sheepTheme:'halloween'};
  const c=vm.createContext({SheepSkin,SheepTheme,effectiveCustomization:v=>v,settings:{customization:{appearance}},petWindow:{isDestroyed:()=>false,isVisible:()=>true,webContents:{send:(_ch,v)=>sent.push(v)}},showDialogue:(...v)=>spoken.push(v),getMotion:()=>null,stopMotion(){}});
  vm.runInContext(declaration(main,'sendCommand'),c);const start=main.indexOf("{ label: '咩咩互动'"),end=main.indexOf('] : []),',start);const menu=()=>vm.runInContext(`(${main.slice(start,end)})`,c).submenu;
  menu().find(v=>v.label==='送咩咩一颗糖').click();assert.equal(sent.at(-1).command,'sheep-offer');assert.equal(sent.at(-1).kind,'candy');
  appearance.sheepTheme='christmas';menu().find(v=>v.label==='送咩咩一份礼物').click();assert.equal(sent.at(-1).kind,'gift');assert.ok(menu().find(v=>v.label==='咩咩递一份礼物'));
  assert.equal(spoken.length,0);sent.length=0;for(const kind of ['candy','bad',{},['gift']])c.sendCommand({command:'sheep-offer',kind});assert.equal(sent.length,0);
});

test('道具拖放与自动小动作及小睡互斥，忙碌不积压、释放后重新等待',()=>{
  for(const theme of ['halloween','christmas']) for(const scenario of ['ambient','nap']) {
    const h=scenario==='ambient'?ambientFixture(theme):napFixture();h.context.customization.appearance.sheepTheme=theme;let dragging=true,cancelled=0;
    h.context.sheepOffering={isDragging:()=>dragging,isPlaying:()=>false,cancel(){dragging=false;cancelled++;},update(){}};
    h.context.nextSheepAmbientAt=scenario==='ambient'?60000:300000;const deadline=h.context.nextSheepAmbientAt;
    assert.equal(h.at(deadline),false);assert.equal(dragging,true);assert.equal(cancelled,0);assert.equal(h.actions().length,0);assert.equal(h.context.sheepAutoNap,false);
    assert.ok(h.context.nextSheepAmbientAt>=deadline+45000);dragging=false;assert.equal(h.at(deadline+1),false);
    assert.equal(h.at(h.context.nextSheepAmbientAt),true);assert.equal(h.context.sheepAutoNap,scenario==='nap');
    assert.equal(h.calls.filter(c=>['say','human-activity','host-bounce'].includes(c[0])).length,0);
  }
});
test('真实道具按下接noteInteraction，重置自动计时和自然睡眠时钟且不直接发话',()=>{
  const h=ambientFixture('christmas');let dragging=true;h.context.sheepOffering={isDragging:()=>dragging,isPlaying:()=>false,cancel(){dragging=false;},update(){}};
  h.context.lastWorkAttempt=0;h.at(200000);h.context.noteInteraction();
  assert.equal(h.context.sheepLastInteractionAt,200000);assert.ok(h.context.nextSheepAmbientAt>=245000);assert.equal(dragging,true);
  assert.equal(h.calls.filter(c=>c[0]==='human-activity').length,1);assert.equal(h.calls.filter(c=>c[0]==='say').length,0);
  assert.match(renderer,/onReceive: playSheepOffering, onInteract: noteInteraction/);
});

test('从发呆或疲倦状态开始拖道具，真实互动恢复清醒但不触发welcome伸展或到期work气泡',()=>{
 for(const idle of [400000,700000]){
  const h=ambientFixture('halloween'),{CompanionState}=require('../lib/companion-behavior');h.context.companion=new CompanionState();h.context.companion.noteInteraction(0);h.context.lastSample={idleSeconds:idle/1000,locked:false};h.context.currentState=h.context.companion.update(h.context.lastSample,idle);
  assert.ok(['spacing','tired'].includes(h.context.currentState.mode));let dragging=true;h.context.sheepOffering={isDragging:()=>dragging,isPlaying:()=>false,cancel(){dragging=false;},update(){}};
  h.context.lastWorkAttempt=0;h.at(idle);h.context.noteInteraction();
  assert.equal(h.context.currentState.mode,'awake');assert.equal(h.context.companion._lastInteraction,idle);assert.equal(dragging,true);assert.equal(h.context.sheepLastInteractionAt,idle);
  assert.equal(h.calls.filter(c=>['say','reaction','host-bounce'].includes(c[0])).length,0);assert.equal(h.actions().length,0);
 }
});

test('拖道具时Codex完成可用性与思考让行，异步原画就绪后再次检查拖放且不ACK抢播',async()=>{
 const h=fixture(),c=h.context;let dragging=true,readyResolve;const ready=new Promise(r=>{readyResolve=r;}),ack=[],availability=[];
 c.sheepOffering={isDragging:()=>dragging,isPlaying:()=>false,cancel(){dragging=false;},update(){}};
 Object.assign(c,{InteractionMotion:require('../lib/interaction-motion'),codexEnabled:true,codexGeneration:2,codexPageEpoch:3,lastCodexAlertId:0,nextMotionToken:0,lastAvailability:null,codexThinking:false,codexThinkingVisible:true});
 c.syncThought=()=>{};c.desktop.codexMotionReady=p=>ack.push(p);c.desktop.codexAvailability=p=>availability.push(p.available);c.ball.setMotionFrame=()=>{};c.ball.whenMotionReady=()=>ready;
 vm.runInContext(['canShowCodex','reportCodexAvailability','cancelCodex','startCodex','syncCodexWorking'].map(n=>declaration(renderer,n)).join('\n'),c);
 assert.equal(c.canShowCodex(),false);c.reportCodexAvailability();assert.deepEqual(availability,[false]);
 const request={motion:'hop',generation:2,pageEpoch:3,alertId:1};c.startCodex(request);assert.equal(h.actions().length,0);assert.equal(c.lastCodexAlertId,0);
 dragging=false;c.startCodex(request);assert.equal(h.actions().length,1);assert.equal(c.activeMotion.owner,'codex');dragging=true;readyResolve(true);await ready;await Promise.resolve();
 assert.equal(ack.length,0);assert.equal(c.activeMotion,null);assert.equal(dragging,true);
 c.codexActiveTaskCount=1;c.syncCodexWorking();assert.equal(c.petElement.dataset.codexWorking,'false');assert.equal(c.codexThinking,false);
 dragging=false;c.reportCodexAvailability();assert.deepEqual(availability,[false,true]);
});


test('四款手动hover/菜单/自然welcome唤醒复用本地真实动作到motionend，不启动旧宿主计时与位移',()=>{
  for(const theme of ['none','halloween','christmas','spring-festival'])for(const trigger of ['hover','menu','welcome']) {
    const h=napFixture(),c=h.context;c.customization.appearance.sheepTheme=theme;
    c.companion.setManualSleep(true,0);c.currentState={mode:'sleep',emotionId:'00',gaze:null};c.ball.setEmotion('00');
    c.CompanionMotion=require('../lib/companion-motion');
    vm.runInContext(declaration(renderer,'wake')+'\n'+declaration(renderer,'playCompanionReaction'),c);
    const baseline=h.actions().length;
    if(trigger==='hover') {
      c.onPet=(name,fn)=>{c.enter=fn};vm.runInContext(registration(/onPet\('pointerenter', \(\) => \{[\s\S]*?\n  \}\);/),c);c.enter();
    } else if(trigger==='menu')c.runCommand('wake');else c.playCompanionReaction('stretch','wake');
    assert.equal(c.companion.manualSleep,false);assert.equal(c.sheepAutoNap,false);assert.equal(c.ball.emotionId,'50');
    assert.equal(h.actions().length,baseline+1);assert.equal(h.actions().at(-1)[1],theme==='none'?'stretch':'greet');
    assert.equal(c.actionUntil,Infinity,'本地真实APNG完成前不提前结束');
    assert.equal(h.calls.filter(row=>['host-play','host-bounce'].includes(row[0])).length,0);
    c.ball.emit('motionend');assert.equal(c.actionUntil,0);assert.equal(c.sheepActionBall,null);
    assert.equal(h.calls.filter(row=>row[0]==='say').length,trigger==='hover'?0:1);
  }
});

test('任务看纸时普通hover不创建问候定时器、不noteInteraction或换状态，主动单击仍响应',()=>{
  const h=fixture({realClick:true}),c=h.context;c.codexEnabled=true;c.codexActiveTaskCount=1;c.ball.emotionId='51';
  c.onPet=(name,fn)=>{c.enter=fn};vm.runInContext(registration(/onPet\('pointerenter', \(\) => \{[\s\S]*?\n  \}\);/),c);
  c.enter();assert.equal(c.helloTimer,null);assert.equal(c.ball.emotionId,'51');assert.equal(h.calls.filter(row=>row[0]==='interaction').length,0);
  c.startCodexThinkingCadence=()=>h.calls.push(['cadence']);c.runSingleClickAction();assert.ok(h.calls.some(row=>row[0]==='cadence'));assert.ok(h.calls.some(row=>row[0]==='say'&&row[1]==='thought'));
});

test('普通单击记忆本次羊动作，greet/joy与专属动作的气泡再来一次都重播原动作',()=>{
  const {DialogueDirector}=require('../lib/dialogue');
  for(const theme of ['none','halloween','christmas','spring-festival']) {
    const h=fixture({realClick:true}),c=h.context;c.customization.appearance.sheepTheme=theme;
    const actions=Object.keys(SheepSkin.getActions(theme)).filter(a=>!['walk','sleep','working','complete','receive-gift'].includes(a));
    for(const expected of actions) {
      c.lastSheepClick=actions[(actions.indexOf(expected)+actions.length-1)%actions.length];c.runSingleClickAction();
      const request=h.calls.filter(row=>row[0]==='say').at(-1)[1];assert.equal(request.event,'play');assert.equal(request.sheepAction,expected);
      const d=new DialogueDirector({random:()=>0});const bubble=d.offer('play',0,{shape:'new-year-sheep',sheepTheme:theme,sheepAction:request.sheepAction});
      const reply=d.respond(bubble.id,'again',100);assert.equal(reply.command,'sheep-action');assert.equal(reply.action,expected);
      c.runCommand(reply);assert.equal(h.actions().at(-1)[1],expected);
    }
  }
});


test('羊play文案跨preload与主进程仅透传当前主题合法动作，greet/joy也保留重播身份',()=>{
  let api;const sent=[];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../preload.js'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld(_n,a){api=a;}},ipcRenderer:{send:(...p)=>sent.push(p)}})});
  const replies=[],sender={};const appearance={shape:'new-year-sheep',sheepTheme:'none'};
  const c=vm.createContext({ipcMain:{on(_channel,fn){c.receive=fn;}},fromPetWindow:e=>e.sender===sender,
    showDialogue:(...p)=>replies.push(p),settings:{customization:{appearance}},effectiveCustomization:v=>v,SheepSkin,SheepTheme});
  const registration=main.match(/ipcMain\.on\('pet:say', \(event, scene\) => \{[\s\S]*?\n  \}\);/)[0];vm.runInContext(registration,c);
  for(const action of ['ear','greet','joy']) {
    api.say({event:'play',sheepAction:action,secret:'discard'});const [channel,payload]=sent.at(-1);
    assert.equal(channel,'pet:say');assert.deepEqual(Object.keys(payload).sort(),['event','sheepAction']);
    c.receive({sender},payload);assert.deepEqual(replies.at(-1),['play',action]);
  }
  const before=sent.length;for(const sheepAction of [[],{},new String('ear'),'constructor','__proto__',null])api.say({event:'play',sheepAction});assert.equal(sent.length,before);
  const count=replies.length;for(const sheepAction of ['magic','constructor',[],{}])c.receive({sender},{event:'play',sheepAction});
  c.receive({sender:{}},{event:'play',sheepAction:'ear'});appearance.shape='blob';c.receive({sender},{event:'play',sheepAction:'ear'});assert.equal(replies.length,count);
});

test('羊唤醒及专属互动不缓存基础时长，前缀/加载延后时一直保留guard直至当前实例motionend',()=>{
  const h=napFixture(),c=h.context;c.ball.getActionDuration=()=>{throw Error('不能以过期duration提前回收');};
  c.companion.setManualSleep(true,0);c.currentState={mode:'sleep',emotionId:'00'};c.runSingleClickAction();
  assert.equal(c.actionUntil,Infinity);const owner=c.sheepActionBall;h.at(1000000);assert.equal(c.sheepActionBall,owner);assert.equal(c.actionUntil,Infinity);
  c.ball.emit('motionend');assert.equal(c.sheepActionBall,null);assert.equal(c.actionUntil,0);
});


test('睡眠pointerdown和刚hover唤醒后的同次点击不取消刚开始的真实wake片段',()=>{
  for(const hoverFirst of [false,true]) {
    const h=napFixture(),c=h.context;c.companion.setManualSleep(true,0);c.currentState={mode:'sleep',emotionId:'00'};c.ball.setEmotion('00');
    c.petElement.setPointerCapture=()=>{};c.petElement.hasPointerCapture=()=>false;c.petElement.classList={remove(){}};
    c.desktop.beginDrag=()=>{};c.desktop.endDrag=()=>{};c.scheduleSingleClick=()=>{throw Error('同次轻醒不得再安排普通动作');};
    const handlers=new Map();c.onPet=(name,fn)=>handlers.set(name,fn);
    vm.runInContext(declaration(renderer,'eventPoint')+'\n'+declaration(renderer,'finishPointer'),c);
    vm.runInContext(registration(/onPet\('pointerdown', event => \{[\s\S]*?\n  \}\);/),c);
    if(hoverFirst)assert.equal(c.wakeSheepAutomaticSleep(),true);
    handlers.get('pointerdown')({button:0,pointerId:1,screenX:100,screenY:100});
    assert.equal(c.sheepActionBall,c.ball);assert.equal(c.actionUntil,Infinity);assert.equal(h.actions().length,1);
    c.finishPointer({button:0,pointerId:1},false);assert.equal(c.sheepActionBall,c.ball);assert.equal(c.actionUntil,Infinity);
    c.ball.emit('motionend');assert.equal(c.actionUntil,0);
  }
});

test('Codex ACK只在whenMotionReady后读取含前缀的真实时长，保持准备期不提前计时',async()=>{
  const h=fixture(),c=h.context;let resolve,reads=0,duration=1000;const ready=new Promise(r=>resolve=r),acks=[];
  Object.assign(c,{InteractionMotion:require('../lib/interaction-motion'),codexEnabled:true,codexGeneration:2,codexPageEpoch:3,lastCodexAlertId:0,nextMotionToken:0});
  c.ball.setMotionFrame=()=>{};c.ball.whenMotionReady=()=>ready;c.ball.getActionDuration=()=>{reads++;return duration;};c.desktop.codexMotionReady=p=>acks.push(p);
  vm.runInContext(declaration(renderer,'canShowCodex')+'\n'+declaration(renderer,'startCodex'),c);
  c.startCodex({motion:'hop',generation:2,pageEpoch:3,alertId:1});assert.equal(reads,0);assert.equal(acks.length,0);
  duration=1340;resolve(true);await ready;await Promise.resolve();assert.equal(reads,1);assert.equal(acks[0].durationMs,1340);
});

test('完成宿主时长仅接受本地manifest推导的全段/中途中转前缀，仍拒绝伪造任意时长',()=>{
  const begin=main.indexOf("    const sheepTheme = sheepAction && require('./assets/sheep/manifest.json').themes[theme];");
  const end=main.indexOf('    if (!windowMotion.start(',begin);assert.ok(begin>0&&end>begin);
  const manifest={themes:{none:{actions:{complete:{durations:[100,1000],startsAtIdle:true}},idleTransition:{durations:[60,70,80,70,60]}}}};
  for(const [requested,expected] of [[1340,1340],[1280,1280],[1100,1100],[60000,1100],[1300,1100]]) {
    const c=vm.createContext({sheepAction:'complete',theme:'none',request:{durationMs:requested},require:()=>manifest});
    assert.equal(vm.runInContext(main.slice(begin,end)+'\ndurationMs',c),expected);
  }
});


test('完成ACK严格匹配A/B/拿收纸有限拓扑，端点hold全计入且不接受无前缀裁首帧或跨错桥',()=>{
  const begin=main.indexOf("    const sheepTheme = sheepAction && require('./assets/sheep/manifest.json').themes[theme];");
  const end=main.indexOf('    if (!windowMotion.start(',begin);
  function evaluate(clip,requested,hasWork=true,action='complete') {
    const theme={actions:{[action]:clip},idleTransition:{durations:[60,70,80,70,60]},
      ...(hasWork?{workingTransition:{durations:[90,110,130,150]}}:{})};
    const c=vm.createContext({sheepAction:action,theme:'none',request:{durationMs:requested},require:()=>({themes:{none:theme}})});
    return vm.runInContext(main.slice(begin,end)+'\ndurationMs',c);
  }
  const base={durations:[100,1000]};
  // targetA: idle reverse prefixes 130/210/280/340; work reverse 200/330/480.
  const a={...base,startsAtIdle:true};
  for(const requested of [1100,1130,1210,1280,1340,1200,1330,1480])assert.equal(evaluate(a,requested),requested);
  for(const requested of [1000,1060,1090,1590,1820,60000])assert.equal(evaluate(a,requested),1100,'A不能用单帧、双桥相加或任意时长');
  // targetWorking: work suffixes 280/390/480, or idle reverse prefix + full work480.
  const w={...base,startsAtWorking:true};
  for(const requested of [1100,1280,1390,1480,1610,1690,1760,1820])assert.equal(evaluate(w,requested),requested);
  for(const requested of [1000,1130,1200,1330,1340,1611,60000])assert.equal(evaluate(w,requested),1100,'working不能只逆idle或逆work');
  assert.equal(evaluate(w,1480,false),1100,'缺拿纸桥时不能伪造拿纸时长');
  // Merely selecting action working chooses that target even without a startsAtWorking flag.
  assert.equal(evaluate(base,1580,true,'working'),1580);
  assert.equal(evaluate(base,1480,true,'working'),1100,'无兼容first标志不能删首帧');
  assert.equal(evaluate(a,1580,true,'working'),1580,'working目标只读取startsAtWorking，不能拿startsAtIdle错删首hold');
  assert.equal(evaluate(a,1480,true,'working'),1100);
  // Without either exact-RGBA starts flag, a non-empty prefix does not subtract first hold.
  assert.equal(evaluate(base,1230),1230);assert.equal(evaluate(base,1130),1100);
});


function actualPlayerHarness(sleepBridge = false) {
  const testSource=fs.readFileSync(path.join(__dirname,'sheep-skin.test.js'),'utf8');
  const build=vm.runInNewContext(declaration(testSource,'testManifest')+'\n'+declaration(testSource,'rendererHarness')+'\nrendererHarness',{
    vm,path,pathToFileURL:require('node:url').pathToFileURL,root:path.resolve(__dirname,'../..'),
    source:fs.readFileSync(path.join(__dirname,'../lib/sheep-skin.js'),'utf8'),fs,URL,queueMicrotask,setImmediate,getActions:SheepSkin.getActions
  });
  const manifest={version:1,width:320,height:320,themes:{}};
  for(const theme of ['none','halloween','christmas','spring-festival']) {
    const actions={};for(const action of ['idle',...Object.keys(SheepSkin.getActions(theme))])actions[action]={file:`${theme}/${action}.png`,columns:2,durations:[100,200,300]};
    actions.working.startsAtWorking=true;actions.complete.startsAtWorking=true;actions.greet.startsAtIdle=true;
    manifest.themes[theme]={actions,workingTransition:{file:`${theme}/working-transition.png`,columns:2,durations:[60,70,80]}};
    if(sleepBridge){actions.sleep.startsAtIdle=false;actions.sleep.startsAtWorking=false;manifest.themes[theme].sleepTransition={file:`${theme}/sleep-transition.png`,columns:2,durations:[60,70,80]};}
  }
  return build({manifest});
}

test('真实renderer接真实SheepSkin：working→Codex完成直接交接不先收/重拿，done只选一次idle',async()=>{
  const player=actualPlayerHarness();await player.flush();player.api.setEmotion('51');await player.flush();player.advance(210);assert.equal(player.node.dataset.transition,'');
  const h=fixture(),c=h.context;Object.assign(c,{ball:player.api,InteractionMotion:require('../lib/interaction-motion'),codexEnabled:true,codexGeneration:2,codexPageEpoch:3,lastCodexAlertId:0,nextMotionToken:0});
  const ack=[];c.desktop.codexMotionReady=p=>ack.push(p);c.syncThought=()=>{};c.currentState={mode:'awake',emotionId:'50'};
  vm.runInContext(declaration(renderer,'canShowCodex')+'\n'+declaration(renderer,'startCodex')+'\n'+declaration(renderer,'onMotion'),c);
  c.startCodex({motion:'hop',generation:2,pageEpoch:3,alertId:1});await player.flush();
  assert.equal(player.node.dataset.action,'complete');assert.equal(player.node.dataset.transition,'');assert.equal(player.api.getActionDuration('hop','codex'),600);assert.equal(ack[0].durationMs,600);
  c.onMotion({token:c.activeMotion.token,action:'hop',frame:{done:true}});await player.flush();assert.equal(player.node.dataset.action,'idle');assert.equal(player.node.dataset.transition,'');
  player.api.destroy();
});

test('真实renderer用户专属动作直接选择当前pose，不用emotion50抹掉收纸前缀',async()=>{
  const player=actualPlayerHarness();await player.flush();player.api.setEmotion('51');await player.flush();player.advance(210);
  const h=fixture(),c=h.context;c.ball=player.api;
  c.noteInteraction=()=>c.restoreState();c.restoreState=()=>{if(c.actionUntil===0)c.ball.setEmotion('50');};
  c.startSheepInteraction('greet');await player.flush();assert.equal(player.node.dataset.action,'greet');assert.equal(player.node.dataset.transition,'from-working');assert.equal(player.api.getActionDuration('greet'),710);
  assert.equal(c.actionUntil,Infinity);player.api.destroy();
});

test('睡眠桥真实wakeSheep的同轮restore/greet链路先反放醒来，不被加载中idle覆盖',async()=>{
  const player=actualPlayerHarness(true);await player.flush();player.api.setEmotion('00');await player.flush();player.advance(210);
  const h=fixture(),c=h.context;c.ball=player.api;c.currentState={mode:'sleep',emotionId:'00'};
  c.companion={manualSleep:true,setManualSleep(value){this.manualSleep=value;}};
  c.noteInteraction=()=>c.restoreState();c.restoreState=()=>{if(c.actionUntil===0)c.ball.setEmotion('50');};
  c.wakeSheep();await player.flush();assert.equal(player.node.dataset.action,'greet');
  assert.equal(player.node.dataset.transition,'from-sleep');assert.equal(player.node.dataset.frame,'2');
  player.api.destroy();
});

test('睡眠桥完成ACK只接受反放醒来加目标桥的有限时长，拒绝任意延长',()=>{
  const begin=main.indexOf("    const sheepTheme = sheepAction && require('./assets/sheep/manifest.json').themes[theme];");
  const end=main.indexOf('    if (!windowMotion.start(',begin);
  function evaluate(startsAtWorking,requested){
    const theme={actions:{complete:{durations:[100,1000],startsAtIdle:!startsAtWorking,startsAtWorking}},
      workingTransition:{durations:[90,110,130,150]},sleepTransition:{durations:[70,80,90]}};
    const c=vm.createContext({sheepAction:'complete',theme:'none',request:{durationMs:requested},require:()=>({themes:{none:theme}})});
    return vm.runInContext(main.slice(begin,end)+'\ndurationMs',c);
  }
  for(const requested of [1100,1150,1240])assert.equal(evaluate(false,requested),requested);
  for(const requested of [1100,1630,1720])assert.equal(evaluate(true,requested),requested);
  for(const requested of [1150,1240,1721,60000])assert.equal(evaluate(true,requested),1100);
});

test('真正主动点击只有动画加载成功且实例仍有效才抽元素；菜单和环境动作不抽',async()=>{
  for(const ready of [true,false]){
    const h=fixture({realClick:true}),c=h.context;let resolve,clicks=0;
    c.ball.whenMotionReady=()=>new Promise(r=>{resolve=r;});c.ball.notifySuccessfulClick=()=>clicks++;
    c.runSingleClickAction();assert.equal(clicks,0);resolve(ready);await Promise.resolve();
    assert.equal(clicks,ready?1:0);
    c.runCommand({command:'sheep-action',action:'snow'});assert.equal(clicks,ready?1:0);
    c.startSheepInteraction('snow',true);assert.equal(clicks,ready?1:0);
  }
  for(const stale of ['instance','action']){
    const h=fixture({realClick:true}),c=h.context;let resolve,clicks=0;
    c.ball.whenMotionReady=()=>new Promise(r=>{resolve=r;});c.ball.notifySuccessfulClick=()=>clicks++;
    c.runSingleClickAction();if(stale==='instance')c.ball={};else c.sheepActionBall=null;
    resolve(true);await Promise.resolve();assert.equal(clicks,0,stale);
  }
});

test('四伙伴点击复用各自专属动作，拒绝睡眠/其他主题且不抽走当前伙伴',()=>{
  for(const [buddy,action]of Object.entries({reindeer:'greet',tree:'joy',santa:'gift',snowman:'snow'})){
    const h=fixture(),c=h.context;let switches=0;c.ball.notifySuccessfulClick=()=>switches++;
    assert.equal(c.runBuddyClick(buddy),true);assert.equal(h.actions().at(-1)[1],action);
    assert.equal(c.petElement.dataset.lastAction,`buddy:${buddy}`);assert.equal(switches,0);
  }
  for(const change of [c=>c.companion.manualSleep=true,c=>c.lastSample.locked=true,c=>c.customization.appearance.sheepTheme='halloween']){
    const h=fixture();change(h.context);assert.equal(h.context.runBuddyClick('santa'),false);assert.equal(h.actions().length,0);
  }
});

test('原画礼盒点击直接走接收礼物，随机入口未出现也能投喂',()=>{
  const h=fixture(),c=h.context;
  c.petElement.classList={remove(){}};c.petElement.hasPointerCapture=()=>false;c.desktop.endDrag=()=>{};
  c.ball.hitBuddy=()=> 'gift';c.dragState={pointerId:1,dragged:false,wokeSheep:false};
  let offered=null;c.sheepOffering={isPlaying:()=>false,cancel(){},offer(kind){offered=kind;return c.playSheepOffering(kind);}};
  c.scheduleSingleClick=()=>{throw Error('礼盒不能走普通随机点击');};
  vm.runInContext(declaration(renderer,'finishPointer'),c);
  c.finishPointer({pointerId:1,button:0,clientX:60,clientY:275},false);
  assert.equal(offered,'gift');assert.equal(h.actions().at(-1)[1],'receive-gift');
});

test('原画礼物不阻断随机投喂入口，保持接收与实时墨迹/settled发布',()=>{
  const h=fixture(),c=h.context;
  c.petElement.querySelector=()=>({dataset:{action:'idle',ready:'true',transition:'',buddy:'gift'}});
  const state=c.sheepOfferingState();assert.equal(state.hideSource,false);assert.equal(state.eligible,true);assert.equal(state.settled,true);
  c.petElement.querySelector=()=>({dataset:{action:'idle',ready:'true',transition:'',buddy:'tree'}});
  assert.equal(c.sheepOfferingState().hideSource,false);
});

test('实际renderer短动作及加载期发布transient，睡眠/工作/隐藏/锁屏始终硬停',()=>{
 const h=fixture(),c=h.context;
 c.window.SheepOffering={measureInk:()=>null};
 c.petElement.querySelector=()=>({dataset:{action:'greet',ready:'loading',transition:''}});
 c.sheepActionBall=c.ball;c.actionUntil=Infinity;
 assert.equal(c.sheepOfferingState().transient,true);assert.equal(c.sheepOfferingState().eligible,false);
 const changes=[()=>c.companion.manualSleep=true,()=>c.sheepAutoNap=true,()=>c.currentState.mode='sleep',()=>c.currentState.mode='focus',()=>c.codexActiveTaskCount=1,()=>c.document.hidden=true,()=>c.lastSample.locked=true,()=>c.presentationPaused=true];
 for(const change of changes){c.companion.manualSleep=false;c.sheepAutoNap=false;c.currentState.mode='awake';c.codexActiveTaskCount=0;c.document.hidden=false;c.lastSample.locked=false;c.presentationPaused=false;change();assert.equal(c.sheepOfferingState().transient,false);assert.equal(c.sheepOfferingState().eligible,false);}
});
