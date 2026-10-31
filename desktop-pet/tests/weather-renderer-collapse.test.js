const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { setImmediate: flush } = require('node:timers/promises');
function fixture() {
 const elements=new Map(),calls=[],animations=[],listeners=new Map();let observe,forcedCollapse,chooseCity;
 const media={matches:false,addEventListener(name,callback){this.change=callback;}};
 const element=id=>{
  if(!elements.has(id))elements.set(id,{id,dataset:{},hidden:false,style:{},classList:{add(){},remove(){}},
   addEventListener(){},setAttribute(){},getBoundingClientRect:()=>({height:500}),focus(){this.focused=true;},blur(){},querySelectorAll:()=>[],
   animate(frames,options){let finish;const animation={target:id,frames,options,finished:new Promise(resolve=>{finish=resolve;}),finish(){finish();},cancel(){this.canceled=true;finish();}};animations.push(animation);return animation;}});
  return elements.get(id);
 };
 const api={resize:async value=>{calls.push(JSON.parse(JSON.stringify(value)));},onCollapse:callback=>{forcedCollapse=callback;},onChooseCity:callback=>{chooseCity=callback;},onState(){},get:()=>new Promise(()=>{}),onPointerReset(){}};
 const document={getElementById:element,documentElement:{dataset:{}},querySelector:selector=>element(selector),querySelectorAll:()=>[],addEventListener(name,callback){listeners.set(name,callback);}};
 const window={qiuqiuWeather:api,matchMedia:()=>media,addEventListener(name,callback){listeners.set('window:'+name,callback);}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../weather-renderer.js'),'utf8'),{window,document,setTimeout,clearTimeout,ResizeObserver:class{constructor(callback){observe=callback;}observe(){}disconnect(){}}});
 return{element,calls,animations,media,observe:()=>observe(),force:()=>forcedCollapse(),choose:()=>chooseCity(),open:()=>element('folded').onclick(),close:()=>element('collapse').onclick()};
}
test('weather collapse holds one native size during compositor animation and commits compact bounds once',async()=>{
 const f=fixture();f.open();assert.equal(f.calls.length,1);for(let i=0;i<10;i++)f.observe();assert.equal(f.calls.length,1);
 f.close();const fade=f.animations.find(a=>a.target==='quota-label');assert.equal(fade.options.duration,90);assert.equal(f.element('quota-label').dataset.collapsing,'true');
 for(let i=0;i<10;i++)f.observe();assert.equal(f.calls.length,1,'no intermediate native resize while fading');
 fade.finish();await flush();assert.deepEqual(f.calls.at(-1),{width:128,height:32,expanded:false});assert.equal(f.calls.length,2);assert.equal(f.element('folded').hidden,false);
 for(let i=0;i<10;i++)f.observe();assert.equal(f.calls.length,2,'compact observer repeat is a no-op');
});
test('rapid reopen and forced collapse cancel old completion without closing a newer expanded panel',async()=>{
 const f=fixture();f.open();f.close();const first=f.animations.find(a=>a.target==='quota-label');f.open();first.finish();await flush();assert.equal(f.element('quota-label').dataset.expanded,'true');assert.equal(f.calls.filter(c=>!c.expanded).length,0);
 f.close();const second=f.animations.filter(a=>a.target==='quota-label').at(-1);f.force();assert.equal(f.element('quota-label').dataset.expanded,'false');assert.equal(f.calls.filter(c=>!c.expanded).length,1);
 f.open();second.finish();await flush();assert.equal(f.element('quota-label').dataset.expanded,'true');assert.equal(f.calls.at(-1).expanded,true);
});
test('reduced motion is immediate and changing it during a fade cancels the delayed completion',async()=>{
 const f=fixture();f.open();f.close();const fade=f.animations.find(a=>a.target==='quota-label');f.media.matches=true;f.media.change();assert.equal(f.element('quota-label').dataset.expanded,'false');assert.equal(f.calls.filter(c=>!c.expanded).length,1);
 f.open();fade.finish();await flush();assert.equal(f.element('quota-label').dataset.expanded,'true');f.close();assert.equal(f.element('quota-label').dataset.expanded,'false');assert.equal(f.calls.at(-1).expanded,false);
});
