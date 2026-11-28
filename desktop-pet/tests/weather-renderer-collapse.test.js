const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { setImmediate: flush } = require('node:timers/promises');
function fixture() {
 const elements=new Map(),calls=[],collapseRequests=[],animations=[],listeners=new Map();let observe,forcedCollapse,chooseCity,details,stateUpdate;
 const media={matches:false,addEventListener(name,callback){this.change=callback;}};
 const element=id=>{
  if(!elements.has(id))elements.set(id,{id,dataset:{},hidden:false,style:{},classList:{add(){},remove(){}},
   addEventListener(){},setAttribute(){},replaceChildren(){},getBoundingClientRect:()=>({height:500}),focus(){this.focused=true;},blur(){},querySelectorAll:()=>[],
   animate(frames,options){let finish;const animation={target:id,frames,options,finished:new Promise(resolve=>{finish=resolve;}),finish(){finish();},cancel(){this.canceled=true;finish();}};animations.push(animation);return animation;}});
  return elements.get(id);
 };
 const api={resize:async value=>{calls.push(JSON.parse(JSON.stringify(value)));},collapse:value=>new Promise(resolve=>collapseRequests.push({value,resolve})),onCollapse:callback=>{forcedCollapse=callback;},onChooseCity:callback=>{chooseCity=callback;},onDetails:callback=>{details=callback;},onState(callback){stateUpdate=callback;},get:()=>new Promise(()=>{}),onPointerReset(){}};
 const document={getElementById:element,createElement:tag=>element('created:'+tag),createTextNode:text=>({textContent:text}),documentElement:{dataset:{}},querySelector:selector=>element(selector),querySelectorAll:()=>[],addEventListener(name,callback){listeners.set(name,callback);}};
 const window={qiuqiuWeather:api,matchMedia:()=>media,addEventListener(name,callback){listeners.set('window:'+name,callback);}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../weather-renderer.js'),'utf8'),{window,document,setTimeout,clearTimeout,ResizeObserver:class{constructor(callback){observe=callback;}observe(){}disconnect(){}}});
 return{api,publish:value=>stateUpdate(value),element,calls,collapseRequests,animations,media,observe:()=>observe(),force:()=>forcedCollapse(),choose:()=>chooseCity(),details:()=>details(),open:()=>element('folded').onclick(),close:()=>element('collapse').onclick()};
}
test('weather collapse delegates continuous geometry to one main request, not a renderer fade or resize loop',async()=>{
 const f=fixture();f.open();assert.equal(f.calls.length,1);for(let i=0;i<10;i++)f.observe();assert.equal(f.calls.length,1);
 f.close();assert.equal(f.collapseRequests.length,1);assert.equal(f.animations.some(a=>a.target==='quota-label'),false,'surface must morph, not fade away');
 for(let i=0;i<10;i++)f.observe();f.close();assert.equal(f.calls.length,1);assert.equal(f.collapseRequests.length,1,'no duplicate collapse during capture');
 f.force();f.collapseRequests[0].resolve({collapsed:true,animated:true});await flush();assert.deepEqual(f.calls.at(-1),{width:128,height:32,expanded:false});assert.equal(f.calls.length,2);assert.equal(f.element('folded').hidden,false);
});
test('rapid reopen explicitly notifies main even at the same expanded size, and old completion cannot close it',async()=>{
 const f=fixture();f.open();f.close();f.open();assert.equal(f.calls.length,2,'same size reopen must cancel pending main capture');assert.equal(f.calls.at(-1).expanded,true);
 f.collapseRequests[0].resolve({canceled:true});await flush();assert.equal(f.element('quota-label').dataset.expanded,'true');assert.equal(f.calls.filter(c=>!c.expanded).length,0);
 f.close();f.force();f.open();f.collapseRequests[1].resolve({collapsed:true});await flush();assert.equal(f.element('quota-label').dataset.expanded,'true');
});
test('reduced motion commits immediately and cancels a pending main morph request',async()=>{
 const f=fixture();f.open();f.close();f.media.matches=true;f.media.change();assert.equal(f.element('quota-label').dataset.expanded,'false');assert.equal(f.collapseRequests.at(-1).value.reducedMotion,true);assert.equal(f.calls.filter(c=>!c.expanded).length,1);
 f.open();f.collapseRequests[0].resolve({canceled:true});await flush();assert.equal(f.element('quota-label').dataset.expanded,'true');f.close();assert.equal(f.element('quota-label').dataset.expanded,'false');assert.equal(f.calls.at(-1).expanded,false);
});


test('closing the city picker informs main while keeping the weather details expanded', () => {
 const f = fixture();
 f.choose(); assert.equal(f.calls.at(-1).picker, true);
 f.element('close-picker').onclick();
 assert.equal(f.calls.at(-1).picker, false);
 assert.equal(f.calls.at(-1).expanded, true);
});

test('a main details request expands existing weather and exits the city picker without fetching or locating', () => {
 const f = fixture(); let externalCalls = 0;
 f.api.refresh = f.api.search = f.api.useLocation = () => { externalCalls++; throw Error('details must only reuse state'); };
 f.publish({ status: 'ready', city: { name: '北京', timezone: 'Asia/Shanghai' }, current: { temperature: 8 }, daily: [], hourly: [] });
 f.choose(); assert.equal(f.calls.at(-1).picker, true);
 f.details();
 assert.equal(f.element('quota-label').dataset.expanded, 'true');
 assert.equal(f.element('weather-details').hidden, false); assert.equal(f.element('city-picker').hidden, true);
 assert.equal(f.calls.at(-1).picker, false); assert.equal(f.calls.at(-1).expanded, true);
 assert.equal(f.element('temperature').textContent, '8°'); assert.equal(externalCalls, 0);
});


test('a late location loading acknowledgement cannot replace already delivered live weather', async () => {
 const f = fixture(); let completeLocation;
 f.api.useLocation = () => new Promise(resolve => { completeLocation = resolve; });
 const pending = f.element('use-location').onclick();
 const city = { name: '当前位置', mode: 'current', timezone: 'Asia/Shanghai' };
 f.publish({ status: 'ready', city, current: { temperature: 20 }, daily: [], hourly: [] });
 assert.equal(f.element('small-temperature').textContent, '20°');
 completeLocation({ status: 'loading', city });
 await pending;
 assert.equal(f.element('small-temperature').textContent, '20°');
 assert.equal(f.element('refresh').disabled, false);
 assert.equal(f.element('city-picker').hidden, true);
});
