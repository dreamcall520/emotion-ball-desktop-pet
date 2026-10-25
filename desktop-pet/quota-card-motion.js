(function () {
  function createQuotaCardMotion(element, media) {
    let animation = null, visible = null;
    function cancel() { if (animation) animation.cancel(); animation = null; }
    function update(value) {
      if (!value || typeof value.visible !== 'boolean') return;
      const showing = value.visible;
      if (visible === showing && value.animate === true) return;
      visible = showing;
      const current = typeof getComputedStyle === 'function' ? getComputedStyle(element).transform : 'none';
      cancel();
      if (!value.animate || media?.matches || typeof element.animate !== 'function') { element.style.transform = ''; return; }
      const resting = 'translateY(0px) scale(1)', folded = 'translateY(-.5px) scale(.97)';
      const from = current && current !== 'none' ? current : showing ? folded : resting;
      animation = element.animate([{transform:from},{transform:showing?resting:folded}], {
        duration:showing?160:130, delay:showing ? Math.min(3,Math.max(0,value.index|0))*8:0,
        easing:showing?'cubic-bezier(.2,.8,.2,1)':'cubic-bezier(.4,0,.8,1)', fill:'both'
      });
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
