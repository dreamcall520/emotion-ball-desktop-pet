const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(){
 const messages=[];let onView;
 class Target {constructor(){this.events=new Map();this.dataset={};this.attrs={};this.capture=null;this.released=[];}addEventListener(type,fn){this.events.set(type,fn);}emit(type,props={}){this.events.get(type)?.({button:0,isPrimary:true,pointerId:7,clientX:22,clientY:22,detail:1,preventDefault(){},...props});}setPointerCapture(id){this.capture=id;}hasPointerCapture(id){return this.capture===id;}releasePointerCapture(id){this.released.push(id);this.capture=null;this.emit('lostpointercapture',{pointerId:id});}setAttribute(k,v){this.attrs[k]=v;}}
 const button=new Target(),window=new Target(),art={};window.sheepOfferingWindow={onView:fn=>{onView=fn;},pointer:v=>messages.push(v)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../sheep-offering-renderer.js'),'utf8'),{window,document:{getElementById:id=>id==='offering'?button:art}});
 return {button,window,art,messages,view:v=>onView(v)};
}
test('独立源窗触屏捕获在主进程隐藏/reset时完整释放，恢复后的下一次拖动可开始且不误发cancel',()=>{
 const h=fixture();h.view({kind:'gift'});h.button.emit('pointerdown',{pointerType:'touch',pointerId:9});h.button.emit('pointermove',{pointerId:9,clientX:-14,clientY:-4});assert.deepEqual(h.messages.map(v=>v.type),['begin','move']);
 h.view({reset:true});assert.equal(h.button.capture,null);assert.deepEqual(h.button.released,[9]);assert.equal(h.messages.some(v=>v.type==='cancel'),false,'release initiated by main must not reopen source through cancel');
 h.button.emit('pointerdown',{pointerId:10});h.button.emit('pointerup',{pointerId:10});assert.deepEqual(h.messages.map(v=>v.type),['begin','move','begin','end']);assert.equal(h.button.capture,null);
});
test('独立源窗仅主指针开始，触屏取消/失焦撤销，普通click不绕过拖放且键盘复用受控接收',()=>{
 const h=fixture();h.view({kind:'candy'});assert.equal(h.art.src,'assets/sheep/props/candy.png');h.view({kind:'unknown'});assert.equal(h.art.src,'assets/sheep/props/candy.png');
 h.button.emit('pointerdown',{button:2});h.button.emit('pointerdown',{isPrimary:false});assert.equal(h.messages.length,0);
 h.button.emit('pointerenter');h.button.emit('click',{detail:1});h.button.emit('click',{detail:0});assert.deepEqual(h.messages.map(v=>v.type),['approach','activate']);
 h.button.emit('pointerdown');h.window.emit('blur');assert.equal(h.messages.at(-1).type,'cancel');h.view({reset:true});h.button.emit('pointerdown',{pointerId:11});h.button.emit('pointercancel',{pointerId:11});assert.equal(h.messages.at(-1).type,'cancel');
});
