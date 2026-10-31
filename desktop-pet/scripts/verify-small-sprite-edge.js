const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setTimeout:wait}=require('node:timers/promises');const {containsSpriteEdgeInk}=require('../lib/sprite-edge-ink');
async function verifySmallSpriteEdge({pet,edgeTuck,setSize,screen,getMask}){
 assert.equal(process.env.PET_SMOKE_TEST,'1');const out=process.env.PET_CODEX_PETS_QA_OUT;assert(path.isAbsolute(out));fs.mkdirSync(out,{recursive:true});
 const page=code=>pet.webContents.executeJavaScript(code,true),errors=[];pet.webContents.on('console-message',e=>{if(e.level>=3||e.level==='error')errors.push(e.message)});
 const poll=async(read,test,label)=>{let value;const end=Date.now()+7000;do{value=await read();if(test(value))return value;await wait(25)}while(Date.now()<end);assert.fail(label+JSON.stringify(value))};
 const state=()=>page(`(()=>{const p=document.getElementById('pet'),c=p.querySelector('canvas');return{mode:p.dataset.presentation,side:p.dataset.edge,action:c?.dataset.codexAction,frame:c?.dataset.codexFrame,ready:c?.dataset.codexReady,transform:c?getComputedStyle(c).transform:null,rootTransform:getComputedStyle(p).transform}})()`);
 await poll(state,v=>v.ready==='ready','preselected sprite');setSize('large');await wait(150);
 const area=screen.getDisplayMatching(pet.getBounds()).workArea,cursor=screen.getCursorScreenPoint();const y=cursor.y<area.y+area.height/2?area.y+area.height-280:area.y+20;pet.setPosition(area.x+200,Math.round(y),false);
 const dbg=pet.webContents.debugger;if(!dbg.isAttached())dbg.attach('1.3');await dbg.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 async function capture(name){await wait(300);await page('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const image=await pet.webContents.capturePage(undefined,{stayAwake:true}),bitmap=image.toBitmap(),size=image.getSize();fs.writeFileSync(path.join(out,name+'.png'),image.toPNG());
  let count=0,left=size.width,right=-1,top=size.height,bottom=-1;const opaque=[];
  for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++){const a=bitmap[(y*size.width+x)*4+3];if(a>24){count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}if(a>240)opaque.push([x,y]);}
  return{metrics:{alphaArea:count,visibleWidth:right-left+1,visibleHeight:bottom-top+1,bbox:{left,right,top,bottom},size},opaque};
 }
 const comparisons=[];
 for(const side of ['left','right']){
  edgeTuck.dock(side);edgeTuck.pin(true,'edge-qa');await poll(state,v=>v.mode==='tucked'&&v.side===side,'dock '+side);await poll(()=>getMask(),Boolean,'actual alpha mask');
  await page(`document.getElementById('pet').style.setProperty('transform','translateX(${side==='left'?'-':''}50%)','important')`);
  const baselineState=await state();assert.equal(Number(baselineState.rootTransform.split(',')[4]),side==='left'?-130:130,'old 50% transform applied');
  const before=(await capture('before-'+side)).metrics;await page("document.getElementById('pet').style.removeProperty('transform')");const after=await capture('after-'+side),bounds=pet.getBounds();
  const blank={x:bounds.x+bounds.width*(side==='left'?.45:.55),y:bounds.y+bounds.height*.5};
  assert.equal(containsSpriteEdgeInk(getMask(),{bounds,side,point:blank}),false);edgeTuck.sampleCursor(blank);assert.equal(edgeTuck.getPresentation().mode,'tucked','transparent part of former half-window must not reveal');
  const center=[(after.metrics.bbox.left+after.metrics.bbox.right)/2,(after.metrics.bbox.top+after.metrics.bbox.bottom)/2];let best=null,bestDistance=Infinity;
  for(const [x,y]of after.opaque){const point={x:bounds.x+(x+.5)/after.metrics.size.width*bounds.width,y:bounds.y+(y+.5)/after.metrics.size.height*bounds.height};const d=(x-center[0])**2+(y-center[1])**2;if(d<bestDistance&&containsSpriteEdgeInk(getMask(),{bounds,side,point})){best=point;bestDistance=d;}}
  assert(best);edgeTuck.sampleCursor(best);await poll(state,v=>v.mode==='peeked','opaque sliver hover reveals');edgeTuck.pin(false,'edge-qa');for(let i=0;i<14;i++){edgeTuck.sampleCursor(best);await wait(60)}assert.equal(edgeTuck.getPresentation().mode,'peeked','original opaque anchor retains reveal');await capture('peek-'+side);
  comparisons.push({side,before,after:after.metrics,widthRatio:after.metrics.visibleWidth/before.visibleWidth,areaRatio:after.metrics.alphaArea/before.alphaArea,blank,opaquePoint:best,transparentIgnored:true,opaqueReveals:true});edgeTuck.pin(false,'edge-qa');
 }
 assert(Math.abs(comparisons[0].after.alphaArea-comparisons[1].after.alphaArea)/comparisons[0].after.alphaArea<.02,'both mirrored sides remain consistent');
 for(const c of comparisons)assert(c.widthRatio>.43&&c.widthRatio<.57,'actual visible width is approximately halved');
 edgeTuck.dock('left');const b=pet.getBounds(),point=comparisons[0].opaquePoint;edgeTuck.sampleCursor({x:b.x+(point.x-comparisons[0].blank.x+b.width*.45),y:point.y});edgeTuck.pin(true,'drag-qa');
 await poll(state,v=>v.mode==='peeked','recall before drag');
 const input=(type,x,pressed)=>dbg.sendCommand('Input.dispatchMouseEvent',{type,x,y:130,button:pressed||type==='mouseReleased'?'left':'none',buttons:pressed?1:0,clickCount:type==='mouseMoved'?0:1});
 await input('mouseMoved',130,false);await input('mousePressed',130,true);await input('mouseMoved',170,true);const dragging=await poll(state,v=>v.action==='run-right','real drag after recall');assert(Number(dragging.transform.match(/^matrix\(([^,]+)/)?.[1]??1)>0);await input('mouseReleased',170,false);edgeTuck.pin(false,'drag-qa');edgeTuck.restore();
 await poll(state,v=>v.mode==='free'&&['none','matrix(1, 0, 0, 1, 0, 0)'].includes(v.transform),'original orientation restored');assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'smaller-edge.json'),JSON.stringify({ok:true,tuckFraction:.672,thresholdAlpha:24,maskGrid:[64,64],comparisons,dragging,errors,meaning:'visible width approximately halved; alpha area ratio reported separately, not claimed exactly one half'},null,2));process.stdout.write('PET_SMALL_SPRITE_EDGE_OK\n');
}
module.exports={verifySmallSpriteEdge};
