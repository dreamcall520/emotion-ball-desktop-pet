const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setTimeout:wait}=require('node:timers/promises');const {containsSpriteEdgeInk}=require('../lib/sprite-edge-ink');
async function verifyLegacySmallSpriteEdge({pet,edgeTuck,setSize,screen,getMask}){
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


const {app}=require('electron'),crypto=require('node:crypto');
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
async function verifyDeclaredSpriteEdge({pet,getSettings,setSize,getMenu,edgeTuck,sendCommand,screen,getMask,monitor}) {
  const execute=(code)=>pet.webContents.executeJavaScript(code,true);
  const poll=async (read,test,label,timeout=6500)=>{
    const end=performance.now()+timeout;let result;
    do{result=await read();if(test(result))return result;await wait(20);}while(performance.now()<end);
    assert.fail(`${label} ${JSON.stringify(result)}`);
  };
  const state=()=>execute(`(()=>{const p=document.querySelector('#pet'),c=p.querySelector('canvas.codex-pet-sprite'),r=c?.getBoundingClientRect();return {mode:p.dataset.presentation,edge:p.dataset.edge,facing:p.dataset.facing,codexWorking:p.dataset.codexWorking,codexActiveTasks:p.dataset.codexActiveTasks,dragging:p.classList.contains('dragging'),angle:p.style.getPropertyValue('--drag-tilt'),rootTransform:getComputedStyle(p).transform,canvasTransform:c?getComputedStyle(c).transform:null,canvas:{...c?.dataset},framePixels:c?[c.width,c.height]:null,css:r?{width:r.width,height:r.height,x:r.x,y:r.y}:null}})()`);
  const source=process.env.PET_LOCAL_PET_QA_FOLDER,output=process.env.PET_CODEX_PETS_QA_OUT;
  assert(path.isAbsolute(source)&&path.isAbsolute(output));
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'pet.json'),'utf8'));
  assert(['left','right'].includes(manifest.idleFacing)); assert.equal(manifest.edgeTuck,'half');
  fs.mkdirSync(output,{recursive:true});
  const id=getSettings().customization.appearance.codexPetId;
  await poll(state,v=>v.canvas.codexPetId===id&&v.canvas.codexReady==='ready','saved declared skin is ready');
  monitor?.stop();
  const initialSettings=structuredClone(getSettings());
  assert.notEqual(setSize('small'),false);
  pet.webContents.setBackgroundThrottling(false);
  const unit=pet.webContents.debugger;
  if(!unit.isAttached()) unit.attach('1.3');
  const reduce=async (enabled)=>unit.sendCommand('Emulation.setEmulatedMedia',{features:enabled?[{name:'prefers-reduced-motion',value:'reduce'}]:[]});
  const sendMouse=(type,x,y,pressed=false)=>unit.sendCommand('Input.dispatchMouseEvent',{type,x,y,button:pressed||type==='mouseReleased'?'left':'none',buttons:pressed?1:0,clickCount:type==='mouseMoved'?0:1});
  let activeMask=getMask();
  const activeInk=()=>{activeMask=getMask();return activeMask;};
  let ignored=null;
  const nativeIgnore=pet.setIgnoreMouseEvents;
  pet.setIgnoreMouseEvents=function(value,options){ignored=value;return nativeIgnore.call(this,value,options);};
  const bounds=await poll(()=>pet.getBounds(),b=>b.width===120&&b.height===120,'native 120px bounds'),area=screen.getDisplayMatching(bounds).workArea;
  const y=screen.getCursorScreenPoint().y<area.y+area.height/2?area.y+area.height-160:area.y+40;
  pet.setPosition(area.x+230,Math.round(y),false);
  const capture=async name=>{
    await wait(250);
    const image=await pet.webContents.capturePage(undefined,{stayAwake:true});
    const {width,height}=image.getSize(), pixels=image.toBitmap(), file=name+'.png';
    fs.writeFileSync(path.join(output,file),image.toPNG());
    let minX=width,minY=height,maxX=0,maxY=0,count=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(pixels[(y*width+x)*4+3]>24){count++;minX=Math.min(x,minX);minY=Math.min(y,minY);maxX=Math.max(x,maxX);maxY=Math.max(y,maxY);}
    assert(count>0);
    return{width,height,pixels,metrics:{file,alphaArea:count,visibleWidth:maxX-minX+1,visibleHeight:maxY-minY+1,bounds:[minX,minY,maxX,maxY]}};
  };
  const alphaAt=(shot,x,y)=>shot.pixels[(Math.floor(y)*shot.width+Math.floor(x))*4+3];
  const imagePoint=(shot,b,x,y)=>({x:b.x+(x+.5)/shot.width*b.width,y:b.y+(y+.5)/shot.height*b.height});
  function gripPoint(shot,b,delta){
    const [left,top,right,bottom]=shot.metrics.bounds,cx=(left+right)/2,cy=(top+bottom)/2;
    let best;
    for(let py=1;py<shot.height-1;py++)for(let px=1;px<shot.width-1;px++){
      if(alphaAt(shot,px,py)<236)continue;
      const point=imagePoint(shot,b,px,py),x=Math.floor(point.x-b.x),y=Math.floor(point.y-b.y);
      if(x<=delta+2||x>=b.width-delta-2)continue;
      const dist=(px-cx)**2+(py-cy)**2;
      if(!best||dist<best.dist)best={x,y,dist};
    }
    assert(best,'sprite alpha supports a real drag within window');return best;
  }
  const matrix=value=>value==='none'?[1,0,0,1,0,0]:value.match(/^matrix\((.*)\)$/)?.[1].split(',').map(Number);
  const cases=[];
  const outside={x:area.x+area.width/2,y:area.y+8};
  const sample=()=>pet.webContents.send('pet:activity',{idleSeconds:0,cursor:outside,sameDisplay:true,petBounds:pet.getBounds(),workArea:area,locked:false});
  const filename=path.join(output,'actual-drag-into-edge.json');
  const save=(ok)=>fs.writeFileSync(filename,JSON.stringify({ok,appearanceTarget:manifest.idleFacing,expectedTuck:manifest.edgeTuck,appSource:process.resourcesPath,clockAdvanced:false,actualPhysicalWindowMoves:true,realAppDragIPCThroughTrustedChromiumPointer:true,formalWindowUntouched:true,nativeIdentity:{execPath:process.execPath,packaged:app.isPackaged,mas:process.mas===true,resourcesPath:process.resourcesPath,userData:app.getPath('userData')},initialSettings,packageSHA256:process.env.PET_LION_ZIP_SHA,manifestSHA256:sha(fs.readFileSync(path.join(source,'pet.json'))),cases},null,2)+'\n');
  await execute(`(()=>{window.__dragWitness=[];for(const type of ['pointerdown','pointermove','pointerup'])document.addEventListener(type,event=>window.__dragWitness.push({type,eventTrusted:event.isTrusted,buttons:event.buttons,screenX:event.screenX}),true);})()`);
  async function dragToEdge(side,sizeName,mode){
    const stop=getMenu().getMenuItemById('edge-leave');
    if(edgeTuck.getPresentation().side){assert(stop?.enabled);stop.click(stop,pet,{});}
    assert.notEqual(setSize(sizeName),false);
    const awake=mode!=='sleep';
    sendCommand(awake?'wake':'sleep');
    await reduce(true);
    const expectedSize=({small:120,tiny:80,large:260})[sizeName];
    const start=await poll(state,v=>v.mode==='free'&&v.canvas.codexReady==='ready'&&Math.round(v.css?.height)===expectedSize&&(awake?v.canvas.codexAction==='idle':v.canvas.codexAction==='sleep'),'free '+mode+' '+expectedSize+'px');
    const size=Math.round(start.css.height),b0=await poll(()=>pet.getBounds(),b=>b.width===expectedSize&&b.height===expectedSize,'native resized '+expectedSize+'px'),delta=Math.min(38,Math.max(18,Math.floor(size*.27)));
    assert.equal(b0.width,size);
    const edgeX=side==='left'?area.x:area.x+area.width-size;
    const towards=side==='left'?-1:1;
    const xStart=edgeX-towards*(delta+7);
    const safeY=Math.max(area.y+35,Math.min(y,area.y+area.height-size-35));
    pet.setPosition(xStart,safeY,false);
    await poll(()=>pet.getBounds(),b=>b.x===xStart,'ready native position near edge');
    sample();
    await execute('window.__dragWitness=[];true');
    const prefix=mode+'-'+size+'-'+side;
    const before=await capture(prefix+'-free');
    const sign=(side==='left')===(manifest.idleFacing==='left')?-1:1;
    const stableBefore=await state();
    assert.equal(matrix(stableBefore.canvasTransform)[0],sign,'free state matches physical half before drag');
    const grip=gripPoint(before,pet.getBounds(),delta);
    await sendMouse('mouseMoved',grip.x,grip.y);
    await sendMouse('mousePressed',grip.x,grip.y,true);
    const dropX=grip.x+towards*delta;
    await sendMouse('mouseMoved',dropX,grip.y,true);
    let dragged,near;
    try{
      near=await poll(()=>pet.getBounds(),b=>Math.abs(b.x-edgeX)<=16&&Math.abs(b.x-xStart)>=15,'native drag near edge before release');
      if(awake)dragged=await poll(state,v=>v.dragging&&v.canvas.codexAction==='run-'+side&&v.canvas.codexReady==='ready','inward/outward drag actively uses authored run '+side);
      await sendMouse('mouseReleased',dropX,grip.y);
    }finally{if((await state()).dragging)await sendMouse('mouseReleased',dropX,grip.y);}
    const afterAction=awake?'idle':'sleep';
    const docked=await poll(state,v=>v.mode==='tucked'&&v.edge===side&&v.canvas.codexReady==='ready'&&v.canvas.codexAction===afterAction,'drag-end tucked '+side+' '+mode);
    const after=await capture(prefix+'-tucked');
    const final=await state();
    assert.equal(pet.getBounds().x,edgeX);
    assert.equal(matrix(final.canvasTransform)[0],sign);
    const actualTuck=Math.abs(matrix(final.rootTransform)[4])/size;
    assert(actualTuck>0&&actualTuck<1,'valid computed tuck fraction');
    if(awake)assert(matrix(dragged.canvasTransform)[0]>0,'no CSS mirroring during held drag');
    const events=await execute('window.__dragWitness');
    assert(events.some(e=>e.type==='pointerdown'&&e.eventTrusted)&&events.some(e=>e.type==='pointermove'&&e.eventTrusted&&e.buttons===1)&&events.some(e=>e.type==='pointerup'&&e.eventTrusted));
    const scale=after.width/size;
    const result={side,mode,desktopSizePx:size,initialFreeFacing:stableBefore.canvasTransform,initialFreeAction:stableBefore.canvas.codexAction,windowDistanceFromEdgeBeforePressPx:Math.abs(xStart-edgeX),windowDistanceFromEdgeWhileHeldPx:Math.abs(near.x-edgeX),windowSnappedToEdgeAfterRelease:true,dragSelectedAction:dragged?.canvas.codexAction||null,dragRestingAction:docked.canvas.codexAction,rootTransform:final.rootTransform,canvasTransform:final.canvasTransform,framePixels:final.framePixels,visibleFreeLogicalPx:[before.metrics.visibleWidth/scale,before.metrics.visibleHeight/scale],visibleTuckedLogicalPx:[after.metrics.visibleWidth/scale,after.metrics.visibleHeight/scale],visibleTuckedWidthFraction:after.metrics.visibleWidth/before.metrics.visibleWidth,trustedEvents:events.filter(e=>e.type!=='pointermove'||e.buttons===1),screenshots:[before.metrics.file,after.metrics.file]};
    if(mode==='idle'||mode==='sleep')
      assert(Math.abs(result.visibleTuckedWidthFraction-.50)<=.045, 'art visible width is about half ' + JSON.stringify(result));
    if(mode==='idle'&&size===120){
      await poll(activeInk,Boolean,'actual renderer alpha hit map before hover');
      const current=pet.getBounds(), [minX,minY,maxX,maxY]=after.metrics.bounds;
      const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
      const inMask = point=>containsSpriteEdgeInk(activeInk(),{bounds:current,side,point,tuckFraction:actualTuck,idleFacing:manifest.idleFacing});
      let anchor,blank;
      for(let py=2;py<after.height-2;py++)for(let px=2;px<after.width-2;px++){
        const alpha=alphaAt(after,px,py);
        const point=imagePoint(after,current,px,py);
        const hit=inMask(point);
        const dist=(px-cx)**2+(py-cy)**2;
        if(alpha>=247&&hit&&(!anchor||dist<anchor.dist))anchor={px,py,dist,point};
        if(alpha===0&&!hit&&(!blank||dist<blank.dist))blank={px,py,dist,point};
      }
      assert(anchor,'opaque hover point agrees with the production edge hit map');
      assert(blank,'transparent pixel outside production hit map');
      edgeTuck.sampleCursor(blank.point);
      await poll(()=>ignored,v=>v===true,'transparent area enables native mouse pass-through');
      assert.equal((await state()).mode,'tucked');
      edgeTuck.sampleCursor(anchor.point);
      const peeked=await poll(state,v=>v.mode==='peeked'&&v.edge===side,'actual tucked ink hover reveals');
      assert.equal(matrix(peeked.canvasTransform)[0],sign);
      const reveal=await capture(prefix+'-peeked');
      assert.deepEqual(pet.getBounds(),current,'hover reveal keeps its native anchor');
      assert.equal(matrix((await state()).rootTransform)[4],0);
      const inPeeked=point=>containsSpriteEdgeInk(activeInk(),{bounds:current,side,mode:'peeked',point,tuckFraction:actualTuck,idleFacing:manifest.idleFacing});
      const originalAnchorHit=inPeeked(anchor.point);
      edgeTuck.sampleCursor(anchor.point);
      await poll(()=>ignored,value=>value===!originalAnchorHit,'revealed original anchor follows current alpha');
      let painted,retainedBlank,unretainedBlank;
      for(let py=2;py<reveal.height-2;py++)for(let px=2;px<reveal.width-2;px++){
        const point=imagePoint(reveal,current,px,py),alpha=alphaAt(reveal,px,py),hit=inPeeked(point),tuckedHit=inMask(point);
        const dist=(px-reveal.width/2)**2+(py-reveal.height/2)**2;
        if(alpha>=247&&hit&&(!painted||dist<painted.dist))painted={point,dist};
        if(alpha===0&&!hit&&tuckedHit&&alphaAt(after,px,py)>=247&&(!retainedBlank||dist<retainedBlank.dist))retainedBlank={point,dist};
        if(alpha===0&&!hit&&!tuckedHit&&(!unretainedBlank||dist<unretainedBlank.dist))unretainedBlank={point,dist};
      }
      assert(painted,'peeked screenshot includes currently painted native hit point');
      assert(retainedBlank,'original tucked ink contains a now-transparent retained anchor');
      assert(unretainedBlank,'peeked screenshot includes transparent point outside retained anchor');
      edgeTuck.sampleCursor(retainedBlank.point);
      await poll(()=>ignored,value=>value===true,'peeked transparent retained anchor enables mouse pass-through');
      for(let sample=0;sample<15;sample++){
        edgeTuck.sampleCursor(retainedBlank.point);await wait(60);
        assert.equal((await state()).mode,'peeked','transparent tucked anchor retains reveal beyond tuck delay');
      }
      edgeTuck.sampleCursor(painted.point);
      await poll(()=>ignored,value=>value===false,'currently painted peeked ink accepts native pointer');
      assert.equal((await state()).mode,'peeked');
      edgeTuck.sampleCursor(unretainedBlank.point);
      await poll(()=>ignored,value=>value===true,'peeked transparent area outside anchor enables mouse pass-through');
      const afterHover=await poll(state,v=>v.mode==='tucked'&&v.edge===side,'actual tuck after pointer leaves painted and retained ink');
      assert.equal(matrix(afterHover.canvasTransform)[0],sign);
      result.hover={revealed:true,retucked:true,transparentMaskHit:false,transparentNativeMouseIgnored:true,
        opaqueMaskHit:true,opaqueNativeMouseAccepted:true,originalAnchorHitAfterReveal:originalAnchorHit,
        transparentRetainedAnchor:retainedBlank.point,transparentRetainedAnchorIgnored:true,retainedBeyondTuckDelay:true,
        peekedPaintedPoint:painted.point,peekedPaintedPointAccepted:true,peekedUnretainedTransparentPoint:unretainedBlank.point,
        peekedUnretainedTransparentIgnored:true,visibleLogicalPx:[reveal.metrics.visibleWidth/scale,reveal.metrics.visibleHeight/scale],screenshot:reveal.metrics.file};
    }
    cases.push(result);save(false);console.log('PET_DRAG_IN_CASE '+JSON.stringify({side,mode,size,tuck:final.rootTransform,mirror:sign,retained:result.visibleTuckedWidthFraction}));
    return{prefix,after};
  }
  try{
    for(const sizeName of ['small','tiny','large'])for(const side of ['left','right'])await dragToEdge(side,sizeName,'idle');
    for(const side of ['left','right'])await dragToEdge(side,'small','sleep');
    sendCommand('wake');
    for(const side of ['left','right']) {
      await dragToEdge(side,'small','idle');
      const b=pet.getBounds(),shot=await capture('drag-away-'+side+'-tucked');
      const fraction=Math.abs(matrix((await state()).rootTransform)[4])/b.width;
      let point;
      for(let py=2;py<shot.height-2&&!point;py++)for(let px=2;px<shot.width-2;px++) {
        const candidate=imagePoint(shot,b,px,py);
        if(alphaAt(shot,px,py)>240&&containsSpriteEdgeInk(activeInk(),{bounds:b,side,point:candidate,tuckFraction:fraction,idleFacing:manifest.idleFacing})){point=candidate;break;}
      }
      assert(point,'drag-away begins on visible ink');edgeTuck.sampleCursor(point);
      await poll(state,v=>v.mode==='peeked','drag-away recalls '+side);await wait(280);
      const full=await capture('drag-away-'+side+'-peeked'),grip=gripPoint(full,pet.getBounds(),20),towards=side==='left'?1:-1;
      await sendMouse('mouseMoved',grip.x,grip.y);await sendMouse('mousePressed',grip.x,grip.y,true);
      await sendMouse('mouseMoved',grip.x+towards*65,grip.y,true);
      const moving=await poll(state,v=>v.dragging&&v.canvas.codexAction==='run-'+(towards>0?'right':'left'),'drag-away uses movement action');
      assert(matrix(moving.canvasTransform)[0]>0,'drag-away has no outer sprite mirror');
      await sendMouse('mouseReleased',grip.x+towards*65,grip.y);
      const released=await poll(state,v=>v.mode==='free'&&v.canvas.codexAction==='idle','drag-away returns to free idle');
      const expectedSign=side==='left'?(manifest.idleFacing==='left'?-1:1):(manifest.idleFacing==='left'?1:-1);
      assert.equal(matrix(released.canvasTransform)[0],expectedSign,'drag-away returns to half-screen facing');
      cases.push({side,mode:'drag-away',moving,released,bounds:pet.getBounds()});
    }
    save(true);
  }finally{if(!pet.isDestroyed())pet.setIgnoreMouseEvents=nativeIgnore;}
  console.log('PET_CAT_DRAG_IN_EDGE_OK'); console.log('PET_SMALL_SPRITE_EDGE_OK');
}

async function verifySmallSpriteEdge(options){
 if(process.env.PET_EDGE_DECLARED_QA==='1')return verifyDeclaredSpriteEdge(options);
 return verifyLegacySmallSpriteEdge(options);
}
module.exports={verifySmallSpriteEdge};
