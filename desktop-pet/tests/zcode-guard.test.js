const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const { GuardGame, primary, remainingText } = require('../quota-guard-renderer');
const { guardModel } = require('../lib/quota-guard-window');
const { normalizeSettings } = require('../lib/settings');
const { quotaLabelSize, quotaLabelBounds } = require('../lib/quota-label-placement');
const quota = (remaining = 1, windowMinutes = 2195.35) => ({ sourceId: 'zcode', state: 'ready', visible: true, items: [{
 label: 'GLM-5.3', model: 'GLM-5.3', bucketId: 'zcode:real:bucket', remaining, windowMinutes, periodStart: 1900000000000, resetsAt: 2000000000000 }] });
test('ZCode guard uses the real first bucket, fractional or unknown period and independent cycle identity', () => {
 const game = new GuardGame(); game.setModel(quota()); assert.equal(game.quota, 1); assert.equal(game.period, 2195.35);
 const first = game.round; game.setModel(quota()); assert.equal(game.round, first);
 const changed = quota(); changed.items[0].bucketId += ':other'; game.setModel(changed); assert.equal(game.round, first + 1);
 changed.items[0].resetsAt++; game.setModel(changed); assert.equal(game.round, first + 2);
 game.setModel(quota(99.8706, null)); assert.equal(game.quota, 99.8706); assert.equal(game.period, null);
 game.setModel(quota(0)); assert.equal(game.outcome, 'zombie'); assert.equal(game.quota, 0);
 for (const bad of [NaN, -1, 101, '1']) assert.equal(primary(quota(bad)), null);
 const invalid = quota(); invalid.items[0].bucketId = 'foreign'; assert.equal(primary(invalid), null);
 assert.equal(primary({ ...quota(), sourceId: 'codex' }), null, 'Codex still rejects fractional periods');
});
test('ZCode guard percent format matches the card without rounding consumed quota to 100%', () => {
 for (const [value, expected] of [[0,'0%'],[1,'1%'],[99.8706,'99.9%'],[99.99,'<100%'],[.01,'<0.1%'],[100,'100%']]) assert.equal(remainingText(value,'zcode'),expected);
 assert.equal(remainingText(99.8706,'codex'),'100%');
});
test('an official ZCode bucket with an unknown reset stays playable across entry, native model and preload',()=>{
 const {safeGuardEntryModel}=require('../lib/workbuddy-guard-entry-window');
 const value=quota(99,300);value.items[0].resetsAt=null;value.items[0].periodStart=null;
 const entry=safeGuardEntryModel(value);assert.ok(entry);assert.equal(entry.items[0].resetsAt,null);
 const safe=guardModel(value);assert.equal(safe.items.length,1);assert.equal(safe.items[0].resetsAt,null);
 for(const [preload,channel]of [['quota-guard','pet:quota-guard-model'],['quota-label','pet:zcode-quota-label']]){
  let bridge;const listeners=new Map();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../'+preload+'-preload.js'),'utf8'),{process:{argv:['--pet-source=zcode']},require:()=>({contextBridge:{exposeInMainWorld:(_key,value)=>{bridge=value;}},ipcRenderer:{on:(key,fn)=>listeners.set(key,fn),removeListener(){},send(){}}})});
  let received;bridge.onModel(value=>{received=value;});listeners.get(channel)({},safe);
  assert.equal(received.items[0].resetsAt,null);assert.equal(primary(received).remaining,99);
  const game=new GuardGame();game.setModel(received);assert.equal(game.available,true);assert.equal(game.quota,99);assert.equal(game.period,300);
 }
 for(const resetsAt of [undefined,0,-1,'2000000000000',NaN]){const invalid=structuredClone(value);invalid.items[0].resetsAt=resetsAt;assert.equal(safeGuardEntryModel(invalid),null);assert.equal(guardModel(invalid).items.length,0);assert.equal(primary(invalid),null);}
});

test('actual MAS wiring uses one shared entry and skips exhausted Codex for usable ZCode or WorkBuddy',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
 const functions=source.slice(source.indexOf('function canShowQuotaGuard()'),source.indexOf('\nasync function openCodexDetailThread'));
 const zcodeWiring=source.slice(source.indexOf('  zcodeLink = createZcodeLink('),source.indexOf('    getCardSuppressed:',source.indexOf('  zcodeLink = createZcodeLink(')));
 const callback=zcodeWiring.match(/getGuardEntry:\s*([^\n]+),\s*$/m)?.[1];assert.ok(callback);
 const bounds={x:100,y:200,width:168,height:58},shows=[];let hides=0;
 const zcode=quota(99,300);zcode.items[0].resetsAt=null;
 let current=zcode,visible={codex:bounds,zcode:{...bounds,y:270},workbuddy:{...bounds,y:340}},codexEntry=false;
 const context=vm.createContext({FIRST_RELEASE:true,settings:{quotaFunEnabled:true,codexEnabled:true,codexQuotaAlwaysVisible:true,zcodeEnabled:true,zcodeQuotaAlwaysVisible:true,workbuddyEnabled:true,workbuddyQuotaAlwaysVisible:true},
  isQuitting:false,screenLocked:false,pomodoroQuiet:false,shortcutWindow:null,chatWindow:null,codexDetails:null,workbuddyDetails:null,apiBalanceDetails:null,
  quotaGuardSource:'codex',quotaGuard:{isVisible:()=>false},quotaCardGroupTransition:null,quotaFunCarrier:null,quotaPopups:{isBlocked:()=>false},presentationSuppressed:()=>false,
  petWindow:{isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>({x:100,y:100,width:80,height:80})},
  quotaLabel:{isGuardEntryVisible:()=>codexEntry},quotaLabelModel:()=>({state:'ready',items:[{label:'Codex',remaining:0,windowMinutes:10080}]}),
  zcodeLink:{getSnapshot:()=>current},buildZcodeQuotaLabelModel:value=>value,quotaCardConfig:()=>({order:['codex','zcode','workbuddy']}),
  quotaCardControllers:()=>Object.fromEntries(Object.entries(visible).map(([id,bounds])=>[id,{getVisibleBounds:()=>bounds}])),quotaCardCollected:()=>false,
  quotaFunEntry:{show:(_card,_area,_obstacles,_side,model)=>shows.push(model),hide:()=>hides++},quotaObstacleBounds:()=>null,edgeTuck:null,
  screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:1000,height:700}})},require:name=>require(name.replace('./lib/','../lib/'))});
 vm.runInContext(functions,context);
 const inline=vm.runInContext('('+callback+')',context);
 assert.equal(inline(),false,'MAS leaves the card-embedded entry off while the shared entry owns the interaction');
 context.syncQuotaFunEntry();assert.equal(context.quotaFunCarrier,'zcode');assert.equal(shows.at(-1).sourceId,'zcode');assert.equal(primary(shows.at(-1)).remaining,99);
 current={...zcode,state:'stale'};context.syncQuotaFunEntry();assert.equal(context.quotaFunCarrier,'workbuddy');assert.equal(shows.at(-1).practice,true);assert.equal(primary(shows.at(-1)).remaining,100);
 visible={codex:bounds};context.syncQuotaFunEntry();assert.equal(context.quotaFunCarrier,'codex');assert.equal(primary(shows.at(-1)).remaining,0);
 context.settings.quotaFunEnabled=false;context.syncQuotaFunEntry();assert.equal(context.quotaFunCarrier,null);assert.equal(hides,1);
 context.FIRST_RELEASE=false;assert.equal(inline(),true,'website keeps the established ZCode card entry');codexEntry=true;assert.equal(inline(),false,'website Codex priority remains intact');
});
test('guard and preload preserve only the sanitized first ZCode bucket and never pass secrets', () => {
 const source = quota(); source.secret = 'DO_NOT_PASS'; source.items.push({ ...source.items[0], remaining: 90 });
 const safe = guardModel(source); assert.equal(safe.sourceId,'zcode'); assert.equal(safe.items.length,1);
 assert.equal(safe.items[0].bucketId,'zcode:real:bucket'); assert.equal(safe.items[0].model,'GLM-5.3');
 assert.equal(safe.items[0].remaining,1); assert.equal(JSON.stringify(safe).includes('DO_NOT_PASS'),false);
 let bridge; const listeners = new Map();
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../quota-guard-preload.js'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_key,value)=>{bridge=value;}},ipcRenderer:{on:(key,fn)=>listeners.set(key,fn),removeListener(){},send(){}}})});
 let received; bridge.onModel(value=>{received=value;}); listeners.get('pet:quota-guard-model')({},safe);
 assert.equal(received.sourceId,'zcode'); assert.equal(received.items[0].remaining,1); assert.equal(received.items[0].windowMinutes,2195.35);
 listeners.get('pet:quota-guard-model')({},guardModel(quota(99.8706,null))); assert.equal(received.items[0].windowMinutes,null);
});
test('ZCode fun preference defaults true and normalizes independently from Codex', () => {
  assert.equal(normalizeSettings({}).zcodeQuotaFunEnabled, true);
  const settings = normalizeSettings({ zcodeQuotaFunEnabled: false, codexQuotaFunEnabled: true });
  assert.equal(settings.zcodeQuotaFunEnabled, false); assert.equal(settings.codexQuotaFunEnabled, true);
});
test('ZCode expanded one/two/four buckets reserve their complete source heading', () => {
  for (const size of ['compact', 'standard']) for (const [count, height] of [[1,154],[2,166],[4,256]]) {
    assert.equal(quotaLabelSize(size, true, count, false, false, null, 'zcode').height, height);
  }
});
test('ZCode bottom-aligned collapsed card reserves a bounded adjacent guard target', () => {
  const area = { x: -1200, y: -100, width: 1200, height: 800 };
  for (const x of [-1200, -700, -80]) for (const y of [-100, 600]) {
    const bounds = quotaLabelBounds({ x, y, width: 80, height: 80 }, area, null, 'compact', false, 4,
      { mode: 'free', quotaSourceId: 'zcode', quotaBottomAligned: true, quotaRoleWidth: 50 }, false, true);
    assert.ok(['left','right'].includes(bounds.guardSide)); assert.ok(bounds.cardInset);
    assert.ok(bounds.width >= 192); assert.ok(bounds.x >= area.x && bounds.x + bounds.width <= area.x + area.width);
    assert.ok(bounds.y >= area.y && bounds.y + bounds.height <= area.y + area.height);
  }
});

test('main binds the shared guard to its source: Codex sync cannot close or overwrite ZCode real quota', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const functions = source.slice(source.indexOf('function canShowQuotaGuard()'), source.indexOf('\nasync function openCodexDetailThread'));
  let visible = false, available = true, codexEntry = false, leases = 0; const calls = [];
  const context = vm.createContext({ FIRST_RELEASE: false, quotaGuardSource: 'codex', isQuitting: false, screenLocked: false,
    shortcutWindow: null, chatWindow: null, codexDetails: null, workbuddyDetails: null, apiBalanceDetails: null, presentationSuppressed: () => false,
    petWindow: { isDestroyed: () => false, isVisible: () => true },
    settings: { codexEnabled: false, zcodeEnabled: true, zcodeQuotaAlwaysVisible: true, zcodeQuotaFunEnabled: true, codexQuotaAlwaysVisible: true },
    quotaPopups: { acquire: () => { leases++; return () => { leases--; }; } },
    quotaLabel: { isGuardEntryVisible: () => codexEntry }, quotaLabelModel: () => ({ state: 'ready', items: [{ remaining: 64, windowMinutes: 300 }] }), buildZcodeQuotaLabelModel: value => value,
    zcodeLink: { isDetailsVisible: () => false, isEnabled: () => true, isCardAvailable: () => available, getSnapshot: () => quota() },
    quotaGuard: { isVisible: () => visible, open: value => { visible = true; calls.push(['open', value]); return true; },
      update: value => calls.push(['update', value]), close: () => { visible = false; calls.push(['close']); } } });
  vm.runInContext(functions, context);
  assert.equal(context.openQuotaGuard('zcode'), true); assert.equal(context.quotaGuardSource, 'zcode');
  assert.equal(calls.at(-1)[1].sourceId,'zcode'); assert.equal(calls.at(-1)[1].items[0].remaining,1);
  context.closeCodexQuotaGuard(); assert.equal(visible, true);
  context.syncZcodeQuotaGuard(); assert.equal(calls.at(-1)[0], 'update'); assert.equal(calls.at(-1)[1].sourceId,'zcode');
  for (const key of ['zcodeEnabled', 'zcodeQuotaAlwaysVisible', 'zcodeQuotaFunEnabled']) {
    context.settings[key] = false; context.syncZcodeQuotaGuard(); assert.equal(visible, false);
    assert.equal(context.openQuotaGuard('zcode'), false); context.settings[key] = true;
    assert.equal(context.openQuotaGuard('zcode'), true);
  }
  available = false; context.syncZcodeQuotaGuard(); assert.equal(visible, false); available = true;
  codexEntry = true; assert.equal(context.openQuotaGuard('zcode'), false); codexEntry = false;
  context.settings.codexEnabled = true; assert.equal(context.openQuotaGuard(), true);
  assert.equal(context.quotaGuardSource, 'codex'); assert.equal(calls.at(-1)[1].sourceId,undefined);
  context.closeCodexQuotaGuard(); assert.equal(visible, false);
  context.settings.workbuddyEnabled = true;
  assert.equal(context.openQuotaGuard('workbuddy'), true);
  assert.equal(context.quotaGuardSource, 'workbuddy');
  assert.equal(calls.at(-1)[1].practice, true);
  assert.equal(calls.at(-1)[1].items.length, 0);
  context.closeCodexQuotaGuard(); assert.equal(visible, true);
  context.workbuddyDetails = { isVisible: () => true };
  assert.equal(context.canShowQuotaGuard(), false);
  context.workbuddyDetails = null;
  context.apiBalanceDetails = { isVisible: () => true };
  assert.equal(context.canShowQuotaGuard(), false);
  context.apiBalanceDetails = null; context.settings.workbuddyEnabled = false;
  assert.equal(context.canShowQuotaGuard(), false);
  visible = false;
  for (const key of ['screenLocked','isQuitting']) {
    context[key] = true; assert.equal(context.openQuotaGuard('zcode'), false); context[key] = false;
  }
  assert.equal(leases, 0, 'every attempted source releases its own opening lease');
});

test('ZCode guard ignores transparent top gutter when choosing the default below anchor', () => {
  const { petVisualBounds } = require('../lib/pet-visual-bounds');
  const area = { x: 0, y: 24, width: 1440, height: 876 };
  const pet = { x: 600, y: 300, width: 80, height: 80 };
  const presentation = { mode: 'free', shape: 'blob', quotaSourceId: 'zcode', quotaBottomAligned: true, quotaRoleWidth: 50 };
  const visual = petVisualBounds(pet, 'blob', { ...presentation, quotaAnchor: true, quotaGuard: true });
  for (const size of ['compact', 'standard']) {
    const result = quotaLabelBounds(pet, area, null, size, false, 1, presentation, false, true);
    assert.equal(result.placement, 'below'); assert.equal(result.y + result.cardInset.y, visual.y + visual.height + 8);
  }
  const rightPet = { ...pet, x: area.width - pet.width };
  const right = quotaLabelBounds(rightPet, area, null, 'compact', false, 1, presentation, false, true);
  assert.equal(right.guardSide, 'left'); assert.equal(right.x + right.cardInset.x + 128, area.x + area.width);
});
