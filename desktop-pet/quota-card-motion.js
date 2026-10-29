(function () {
  function createQuotaCardMotion(element, media) {
    let animation = null, contentAnimations = [], visible = null;
    const contents = () => {
      const rows=Array.from(element.querySelector?.('#quota-label')?.children || element.children || []);
      const guard=element.ownerDocument?.getElementById('quota-guard-entry');
      if(guard&&!element.contains(guard))rows.push(guard);
      return rows;
    };
    function cancel() { animation?.cancel(); animation = null; for (const item of contentAnimations) item.cancel(); contentAnimations=[]; }
    function update(value) {
      if (!value || typeof value.visible !== 'boolean') return;
      const showing = value.visible;
      if (visible === showing && value.animate === true) return;
      visible = showing;
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(element) : null;
      const current = style?.transform || 'none';
      const children = contents(), painted = children.map(child => {
        const state = typeof getComputedStyle === 'function' ? getComputedStyle(child) : null;
        return { opacity:state?.opacity || '1', filter:state?.filter || 'none' };
      });
      cancel();
      if (!value.animate || media?.matches || typeof element.animate !== 'function') { element.style.transform = ''; return; }
      const resting = 'scale(1, 1)', folded = 'scale(.22, .18)';
      const from = current && current !== 'none' ? current : showing ? folded : resting;
      const delay = showing ? Math.min(3,Math.max(0,value.index|0))*8 : 0;
      animation = element.animate([{transform:from},{transform:showing?resting:folded}], {
        duration:showing?200:220, delay,
        easing:'cubic-bezier(.32,0,.2,1)', fill:'both'
      });
      contentAnimations = children.filter(child=>typeof child.animate==='function').map((child,index) => child.animate(showing
        ? [{opacity:current==='none'?0:painted[index].opacity,filter:current==='none'?'blur(2px)':painted[index].filter},{opacity:1,filter:'blur(0px)'}]
        : [{opacity:painted[index].opacity,filter:painted[index].filter},{opacity:0,filter:'blur(2px)',offset:.5},{opacity:0,filter:'blur(2px)'}],
        {duration:showing?170:220,delay,easing:'cubic-bezier(.2,.7,.2,1)',fill:'both'}));
    }
    const reduce = () => { if(media?.matches){cancel();element.style.transform='';} };
    media?.addEventListener?.('change',reduce);
    return {update,destroy(){cancel();media?.removeEventListener?.('change',reduce);}};
  }
  function createQuotaExpandMotion(label, media) {
    const beam = label.parentElement;
    let guardLayout=document.body.dataset.guardEntry==='true', transition=null, transitionFrame=0, transitionTimer=0, guardVisibility=null, viewport=null, transitionEpoch=0;
    const clearGeometry=()=>{beam.style.inset='';beam.style.left='';beam.style.width='';beam.style.height='';};
    let expanded = label.dataset.expanded === 'true', animations = [], frame = 0, pending = null, disposed = false;
    const compact = () => label.dataset.size === 'compact' ? {width:128,height:32} : {width:168,height:58};
    const rect = () => { const r=beam.getBoundingClientRect(); return {width:r.width,height:r.height,left:r.left}; };
    const cancel = () => { for (const item of animations) item.cancel(); animations=[]; label.style.position=''; beam.style.clipPath=''; };
    const clearTransition=()=>{
      transition=null;clearTimeout(transitionTimer);transitionTimer=0; cancelAnimationFrame(transitionFrame); transitionFrame=0;
      label.style.width='';label.style.height='';
      const role=document.getElementById('quota-guard-entry');
      if(role && guardVisibility!==null)role.style.visibility=guardVisibility;
      guardVisibility=null;
    };
    const box=b=>b&&['left','top','width','height'].every(k=>Number.isFinite(b[k])&&Math.abs(b[k])<=4096)&&b.width>0&&b.height>0;
    const place=b=>{beam.style.inset='auto';for(const key of ['left','top','width','height'])beam.style[key]=b[key]+'px';};
    const finishCarrier=()=>{cancel();clearTransition();if(viewport)place(viewport.face);};
    function update(model){
      const next=model?.cardViewport,value=model?.cardTransition;
      if(!next || !box(next.face) || !Number.isFinite(next.host?.width) || !Number.isFinite(next.host?.height)){
        if(viewport){viewport=null;transitionEpoch++;cancel();clearTransition();clearGeometry();}
        return;
      }
      const previous=viewport?beam.getBoundingClientRect():null;
      viewport=next;pending=null;cancelAnimationFrame(frame);frame=0;
      if(!value || !box(value.from) || !box(value.to)){
        if(transition && ['left','top','width','height'].every(k=>transition.to[k]===next.face[k]))return;
        transitionEpoch++;finishCarrier();return;
      }
      const from=previous?{left:previous.left,top:previous.top,width:previous.width,height:previous.height}:value.from;
      cancel();clearTransition();transition={from,to:next.face};
      const epoch=++transitionEpoch;
      // Freeze before the other model subscribers change compact/guard CSS in this turn.
      place(from);
      const role=document.getElementById('quota-guard-entry');
      if(role){guardVisibility=role.style.visibility;role.style.visibility='hidden';}
      queueMicrotask(()=>{
        if(disposed || epoch!==transitionEpoch || !transition)return;
        const to=transition.to;place(to);
        label.style.position='';label.style.width='';label.style.height='';
        const style=getComputedStyle(label);label.style.width=style.width;label.style.height=style.height;
        if(media?.matches || document.hidden || typeof beam.animate!=='function'){finishCarrier();return;}
        const key=b=>({left:b.left+'px',top:b.top+'px',width:b.width+'px',height:b.height+'px'});
        const edge=beam.animate([key(from),key(to)],{duration:180,easing:'cubic-bezier(.2,.7,.2,1)',fill:'none'});
        animations=[edge];
        edge.finished.then(()=>{if(epoch===transitionEpoch)finishCarrier();},()=>{});
      });
    }
    function run() {
      frame=0;
      if(disposed || !pending) return;
      if(guardLayout || document.body.dataset.guardEntry==='true'){pending=null;cancel();clearGeometry();return;}
      if(document.hidden){pending=null;cancel();beam.style.inset='';beam.style.width='';beam.style.height='';beam.style.clipPath='';label.style.position='';return;}
      // The host grows immediately but retains its larger bounds until collapse completes.
      if(expanded && window.innerWidth < 190) return;
      const from=pending, to=expanded?{width:window.innerWidth,height:window.innerHeight}:compact();
      from.left ??= Math.max(0,(window.innerWidth-from.width)/2);
      to.left=Math.max(0,(window.innerWidth-to.width)/2);
      pending=null; cancel();
      label.style.position=expanded?'fixed':'';
      beam.style.clipPath='inset(0 round '+getComputedStyle(beam).borderRadius+')';
      beam.style.inset='0 auto auto '+to.left+'px'; beam.style.width=to.width+'px'; beam.style.height=to.height+'px';
      if(media?.matches || document.hidden || typeof beam.animate!=='function') return;
      // Only the glass boundary changes geometry; final-size text is clipped by its parent.
      const edge=beam.animate([{width:from.width+'px',height:from.height+'px',left:from.left+'px'},{width:to.width+'px',height:to.height+'px',left:to.left+'px'}],
        {duration:180,easing:'cubic-bezier(.2,.7,.2,1)',fill:'none'});
      animations=[edge];
      edge.finished.then(()=>{if(animations[0]===edge){label.style.position='';beam.style.clipPath='';if(expanded || window.innerWidth===compact().width)clearGeometry();}},()=>{});
      if(expanded) animations.push(...Array.from(label.children).filter(child=>
        typeof child.animate==='function' && !child.hidden && getComputedStyle(child).display!=='none'
      ).map(child=>child.animate([{opacity:0},{opacity:1}],{duration:120,easing:'ease-out',fill:'none'})));
    }
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(run);};
    const observer=new MutationObserver(()=>{
      const next=label.dataset.expanded==='true';
      if(viewport||transition){expanded=next;return;}
      if(next===expanded)return;
      if(guardLayout || document.body.dataset.guardEntry==='true'){expanded=next;pending=null;cancel();clearGeometry();return;}
      pending=animations.some(a=>a.playState==='running'||a.playState==='paused')?rect():expanded?rect():compact(); expanded=next; cancel(); schedule();
    });
    observer.observe(label,{attributes:true,attributeFilter:['data-expanded']});
    const resize=()=>{if(viewport)return;if(transition){if(window.innerWidth===transition.host.width&&window.innerHeight===transition.host.height)return;cancel();clearTransition();clearGeometry();return;}if(pending)schedule();else{cancel();clearGeometry();}};
    const guardObserver=new MutationObserver(()=>{guardLayout=document.body.dataset.guardEntry==='true';if(guardLayout&&!transition&&!viewport){pending=null;cancel();clearGeometry();}});
    guardObserver.observe(document.body,{attributes:true,attributeFilter:['data-guard-entry']});
    const reduce=()=>{if(media?.matches){if(viewport){transitionEpoch++;finishCarrier();return;}cancel();if(pending)run();}};
    const hidden=()=>{if(document.hidden){if(viewport){transitionEpoch++;finishCarrier();return;}cancel();if(pending)run();}};
    window.addEventListener('resize',resize); document.addEventListener('visibilitychange',hidden);
    media?.addEventListener?.('change',reduce);
    return {update,destroy(){disposed=true;clearTransition();observer.disconnect();guardObserver.disconnect();clearGeometry();cancelAnimationFrame(frame);cancel();window.removeEventListener('resize',resize);document.removeEventListener('visibilitychange',hidden);media?.removeEventListener?.('change',reduce);}};
  }
  if(typeof module!=='undefined' && module.exports) module.exports={createQuotaCardMotion, createQuotaExpandMotion};
  if(typeof window==='undefined')return;
  const bridge=window.petQuotaLabel||window.qiuqiuApiUsageLabel||window.qiuqiuWorkBuddyLabel||window.qiuqiuApiBalanceLabel;
  const element=document.getElementById('quota-beam');
  const label=document.getElementById('quota-label');
  const expansion=label?createQuotaExpandMotion(label,window.matchMedia?.('(prefers-reduced-motion: reduce)')):null;
  const removeExpansion=bridge?.onModel?.(value=>expansion?.update(value));
  window.addEventListener('beforeunload',()=>{removeExpansion?.();expansion?.destroy();},{once:true});
  if(!element||!bridge?.onMotion)return;
  // Native focus restoration is not keyboard navigation. A drag starts in the
  // separate, non-focusable pet window, so its pointer reset must reach every card.
  const pointerMode=()=>{document.documentElement.dataset.keyboard='false';};
  const keyboardMode=event=>{
    if(['Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Enter','Escape',' '].includes(event.key))document.documentElement.dataset.keyboard='true';
  };
  pointerMode();
  document.addEventListener('keydown',keyboardMode,true);
  document.addEventListener('pointerdown',pointerMode,true);
  window.addEventListener('blur',pointerMode);
  const removePointer=bridge.onPointerReset?.(pointerMode);
  const motion=createQuotaCardMotion(element,window.matchMedia?.('(prefers-reduced-motion: reduce)'));
  const remove=bridge.onMotion(motion.update);
  window.addEventListener('beforeunload',()=>{
    remove?.();removePointer?.();motion.destroy();
    document.removeEventListener('keydown',keyboardMode,true);
    document.removeEventListener('pointerdown',pointerMode,true);
    window.removeEventListener('blur',pointerMode);
  },{once:true});
})();
