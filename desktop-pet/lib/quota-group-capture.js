// Capture only controller-owned pages; hidden resized macOS hosts need a
// transparent native surface to let their compositor produce a fresh frame.
const surfaceLeases=new WeakMap(), throttlingLeases=new WeakMap();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer=setTimeout(()=>reject(new Error('Quota group capture timed out')),ms); })]); }
  finally { clearTimeout(timer); }
}
const sameBounds=(a,b)=>['x','y','width','height'].every(key=>a[key]===b[key]);
async function captureQuotaGroupFrames({ getTargets, isReady, isCurrent }) {
  const deadline=Date.now()+2000;
  while(!isReady()) { if(!isCurrent()||Date.now()>=deadline)throw new Error('Quota group page is not ready');await pause(16); }
  const records=getTargets().filter(Boolean).map(target=>{
    const contents=target.webContents, page=contents.mainFrame, routing=page?.routingId, process=page?.processId, url=contents.getURL?.(), bounds={...target.getBounds()};
    const valid=()=>isCurrent()&&isReady()&&!target.isDestroyed()&&!contents.isDestroyed?.()&&target.webContents===contents&&contents.mainFrame===page&&page?.routingId===routing&&page?.processId===process&&!contents.isLoading?.()&&contents.getURL?.()===url&&sameBounds(bounds,target.getBounds());
    return {target,contents,bounds,valid};
  });
  const validations=records.map(record=>record.valid);
  const results=await Promise.allSettled(records.map(async ({target,contents,bounds,valid}) => {
    let restoreThrottling=null, restoreSurface=null;
    try {
      if(typeof contents.setBackgroundThrottling==='function') {
        let lease=throttlingLeases.get(contents);
        if(!lease){lease={count:0,previous:contents.getLastWebPreferences?.().backgroundThrottling !== false};throttlingLeases.set(contents,lease);}
        lease.count++;
        restoreThrottling=()=>{if(--lease.count===0){throttlingLeases.delete(contents);if(!contents.isDestroyed?.())contents.setBackgroundThrottling(lease.previous);}};
        contents.setBackgroundThrottling(false);
      }
    if(!validations.every(check=>check()))throw new Error('Quota group capture became stale');
    const previousSurface=surfaceLeases.get(target);
    if((previousSurface || target.isVisible?.() === false) && typeof target.setOpacity === 'function' && typeof target.getOpacity === 'function' && typeof target.showInactive === 'function') {
      // A replacement capture inherits the original state, not the temporary
      // visible/opacity-zero state installed by its canceled predecessor.
      const lease={opacity:previousSurface?.opacity ?? target.getOpacity()};surfaceLeases.set(target,lease);
      restoreSurface=()=>{if(surfaceLeases.get(target)!==lease)return;surfaceLeases.delete(target);if(target.isDestroyed())return;try{if(valid())target.hide();}finally{if(!target.isDestroyed())target.setOpacity(lease.opacity);}};
      target.setOpacity(0);target.showInactive();
    }
    if(typeof contents.executeJavaScript==='function') {
      const painted=await bounded(contents.executeJavaScript(`Promise.race([Promise.all([document.fonts?.ready,...Array.from(document.images).map(image=>image.complete?Promise.resolve():image.decode().catch(()=>{}))]).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))),new Promise(resolve=>setTimeout(()=>resolve(false),1000))])`),1250);
      if(painted===false)throw new Error('Quota group paint is not ready');
    }
    if(!valid())throw new Error('Quota group capture became stale');
    let image;
    for(let attempt=0;attempt<3;attempt++) {
      image=await bounded(contents.capturePage(undefined,{stayHidden:true}),1250);
      if(!validations.every(check=>check())||image.isEmpty?.())throw new Error('Quota group capture became stale or empty');
      const bitmap=image.getBitmap?.();
      if(!bitmap||bitmap.some((value,index)=>index%4===3&&value>0))break;
      if(attempt===2)throw new Error('Quota group capture is transparent');
      if(typeof contents.executeJavaScript==='function')await bounded(contents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'),1250);
    }
    const png=image.toPNG();
    if(!Buffer.isBuffer(png)||!png.length)throw new Error('Quota group capture is empty');
    return {bounds,png};
    } finally {try{restoreSurface?.();}catch(_){}finally{try{restoreThrottling?.();}catch(_){}}}
  }));
  const failed=results.find(result=>result.status==='rejected');
  if(failed)throw failed.reason;
  if(!isCurrent()||!validations.every(check=>check()))throw new Error('Quota group capture became stale');
  return results.map(result=>result.value);
}
module.exports={captureQuotaGroupFrames};
