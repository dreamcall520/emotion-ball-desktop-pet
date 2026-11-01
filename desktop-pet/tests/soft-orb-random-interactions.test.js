const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('随机表情覆盖小宇十种互动，不通过单独动作菜单触发',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../renderer.js'),'utf8');const begin=src.indexOf('  function runRandomEmotion()'),end=src.indexOf('\n  function startSheepInteraction',begin);
 const selected=[];let random=0;const math=Object.create(Math);math.random=()=>random;
 const c=vm.createContext({Math:math,performance:{now:()=>0},cancelPendingInteraction(){},stopMotion(){},companion:{setManualSleep(){}},customization:{appearance:{shape:'soft-orb'}},startSoftOrbInteraction:action=>selected.push(action)});
 vm.runInContext(src.slice(begin,end),c);
 for(let i=0;i<10;i++){random=(i+.5)/10;vm.runInContext('runRandomEmotion()',c);}
 assert.deepEqual(selected,['draw','fan','flip','scan','beam','shock','flight','ship','love','complete']);
});
