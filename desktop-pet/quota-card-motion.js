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
  if(typeof module!=='undefined' && module.exports) module.exports={createQuotaCardMotion};
  if(typeof window==='undefined')return;
  const bridge=window.petQuotaLabel||window.qiuqiuApiUsageLabel||window.qiuqiuWorkBuddyLabel;
  const element=document.getElementById('quota-beam');
  if(!element||!bridge?.onMotion)return;
  const motion=createQuotaCardMotion(element,window.matchMedia?.('(prefers-reduced-motion: reduce)'));
  const remove=bridge.onMotion(motion.update);
  window.addEventListener('beforeunload',()=>{remove?.();motion.destroy();},{once:true});
})();
