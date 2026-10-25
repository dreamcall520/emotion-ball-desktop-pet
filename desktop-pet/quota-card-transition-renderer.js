(() => {
  const bridge=window.quotaCardTransition,canvas=document.getElementById('group');
  if(!bridge||!canvas)return;
  const context=canvas.getContext('2d');
  let serial=0,token=0,model=null,animations=[];
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');
  function stop(){for(const animation of animations)animation.cancel();animations=[];}
  function folded(){const b=model.bounds,a=model.anchor;return `matrix(${a.width/b.width},0,0,${a.height/b.height},${a.x-b.x},${a.y-b.y})`;}
  function clear(){serial++;token=0;stop();model=null;context.clearRect(0,0,canvas.width,canvas.height);canvas.width=canvas.height=1;}
  const image=src=>new Promise((resolve,reject)=>{const item=new Image();item.onload=()=>resolve(item);item.onerror=()=>reject(Error('snapshot decode failed'));item.src=src;});
  const removePrepare=bridge.onPrepare(async value=>{
    const revision=++serial;token=value.token;stop();model=value;
    try{
      const pictures=await Promise.all(value.layers.map(layer=>image(layer.image)));
      if(revision!==serial||token!==value.token)return;
      const scale=value.scale,b=value.bounds;
      if(b.width*b.height*scale*scale>32*1024*1024)throw Error('canvas limit');
      canvas.width=Math.ceil(b.width*scale);canvas.height=Math.ceil(b.height*scale);canvas.style.width=b.width+'px';canvas.style.height=b.height+'px';
      context.setTransform(scale,0,0,scale,0,0);context.clearRect(0,0,b.width,b.height);
      pictures.forEach((picture,index)=>{const r=value.layers[index].bounds;context.drawImage(picture,r.x-b.x,r.y-b.y,r.width,r.height);});
      canvas.style.transform=value.expanded?folded():'matrix(1,0,0,1,0,0)';canvas.style.opacity=value.expanded?'0':'1';canvas.style.filter='blur(0px)';
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      if(revision===serial&&token===value.token)bridge.ack({token,phase:'prepared',ok:true});
    }catch(_){if(revision===serial)bridge.ack({token:value.token,phase:'prepared',ok:false});}
  });
  const removeAnimate=bridge.onAnimate(async value=>{
    if(!model||value.token<token)return;
    token=value.token;const revision=++serial;
    const style=getComputedStyle(canvas),from={transform:style.transform,opacity:style.opacity,filter:style.filter};stop();
    const target=value.expanded?'matrix(1,0,0,1,0,0)':folded(),opacity=value.expanded?'1':'0';
    if(media.matches){canvas.style.transform=target;canvas.style.opacity=opacity;canvas.style.filter='blur(0px)';bridge.ack({token,phase:'finished',ok:true});return;}
    const duration=value.expanded?200:220;
    canvas.style.transform=from.transform;canvas.style.opacity=from.opacity;canvas.style.filter=from.filter;
    const geometry=canvas.animate([{transform:from.transform},{transform:target}],{duration,easing:'cubic-bezier(.32,0,.2,1)',fill:'both'});
    const paint=canvas.animate(value.expanded?[{opacity:from.opacity,filter:from.filter},{opacity:1,filter:'blur(0px)'}]:[{opacity:from.opacity,filter:from.filter},{opacity:from.opacity,filter:'blur(.8px)',offset:.65},{opacity:0,filter:'blur(1.2px)'}],{duration,easing:'linear',fill:'both'});
    animations=[geometry,paint];
    try{await Promise.all(animations.map(animation=>animation.finished));if(revision!==serial||token!==value.token)return;canvas.style.transform=target;canvas.style.opacity=opacity;canvas.style.filter=value.expanded?'blur(0px)':'blur(1.2px)';stop();bridge.ack({token:value.token,phase:'finished',ok:true});}catch(_){}
  });
  const removeClear=bridge.onClear(clear);
  const reduce=()=>{if(media.matches)for(const animation of animations)animation.finish();};media.addEventListener('change',reduce);
  window.addEventListener('beforeunload',()=>{clear();removePrepare();removeAnimate();removeClear();media.removeEventListener('change',reduce);},{once:true});
})();
