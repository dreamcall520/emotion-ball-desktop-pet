'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {selectQuotaFunCarrier}=require('../lib/quota-fun-carrier');
const codex={x:10,y:20,width:128,height:32},workbuddy={x:10,y:60,width:128,height:32};
test('public game follows the first actually visible quota card in the configured order',()=>{
 const visible={codex,workbuddy,weather:{x:10,y:0,width:128,height:32}};
 assert.deepEqual(selectQuotaFunCarrier({enabled:true,order:['weather','workbuddy','codex'],visible}),{source:'workbuddy',bounds:workbuddy});
 assert.deepEqual(selectQuotaFunCarrier({enabled:true,order:['codex','workbuddy'],visible}),{source:'codex',bounds:codex});
 assert.deepEqual(selectQuotaFunCarrier({enabled:true,order:['codex','workbuddy'],visible:{workbuddy}}),{source:'workbuddy',bounds:workbuddy});
});
test('all quota sources are eligible while weather and absent/hidden cards never carry the game',()=>{
 for(const source of ['codex','workbuddy','api','balance','zcode'])assert.equal(selectQuotaFunCarrier({enabled:true,order:['weather',source],visible:{weather:codex,[source]:workbuddy}}).source,source);
 assert.equal(selectQuotaFunCarrier({enabled:true,order:['weather','codex'],visible:{weather:codex}}),null);
 for(const enabled of [false,undefined,1,'true'])assert.equal(selectQuotaFunCarrier({enabled,order:['codex'],visible:{codex}}),null);
});
test('bounds must be finite visible rectangles and output is a fresh geometry-only projection',()=>{
 for(const bad of [null,{...codex,width:0},{...codex,height:-1},{...codex,x:NaN},{...codex,y:Infinity}])assert.deepEqual(selectQuotaFunCarrier({enabled:true,order:['codex','workbuddy'],visible:{codex:bad,workbuddy}}),{source:'workbuddy',bounds:workbuddy});
 const input={...codex,token:'private'},value=selectQuotaFunCarrier({enabled:true,order:['codex'],visible:{codex:input}});assert.deepEqual(value,{source:'codex',bounds:codex});value.bounds.x=999;assert.equal(input.x,10);
 assert.equal(selectQuotaFunCarrier({enabled:true,order:['codex'],visible:Object.create({codex})}),null);
});
