(() => {
  const bridge=window.quotaCardTransition,canvas=document.getElementById('group');
  if(!bridge||!canvas)return;
  const context=canvas.getContext('2d');let compact=null,compactContext=null;function compactCanvas(){if(!compact){compact=document.createElement('canvas');compact.id='compact';compact.style.opacity='0';compact.setAttribute('aria-hidden','true');document.body.appendChild(compact);compactContext=compact.getContext('2d');}return compact;}
  let serial=0,token=0,model=null,animations=[];
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');
  function stop(){for(const animation of animations)animation.cancel();animations=[];}
  function folded(){const b=model.bounds,a=model.anchor;return `matrix(${a.width/b.width},0,0,${a.height/b.height},${a.x-b.x},${a.y-b.y})`;}
  function clear(){serial++;token=0;stop();model=null;context.clearRect(0,0,canvas.width,canvas.height);canvas.width=canvas.height=1;if(compact){compact.width=compact.height=1;compact.style.opacity='0';}delete canvas.dataset.kind;}
  const image=src=>new Promise((resolve,reject)=>{const item=new Image();item.onload=()=>resolve(item);item.onerror=()=>reject(Error('snapshot decode failed'));item.src=src;});
  const removePrepare=bridge.onPrepare(async value=>{
    const revision=++serial;token=value.token;stop();model=value;
    try{
      const [pictures,compactPicture]=await Promise.all([Promise.all(value.layers.map(layer=>image(layer.image))),value.weatherMorph?image(value.weatherMorph.compactImage):Promise.resolve(null)]);
      if(revision!==serial||token!==value.token)return;
      bridge.trace?.({token:value.token,stage:'decoded'});
      const scale=value.scale,b=value.bounds;
      if(b.width*b.height*scale*scale>32*1024*1024)throw Error('canvas limit');
      canvas.width=Math.ceil(b.width*scale);canvas.height=Math.ceil(b.height*scale);canvas.style.width=b.width+'px';canvas.style.height=b.height+'px';
      context.setTransform(scale,0,0,scale,0,0);context.clearRect(0,0,b.width,b.height);
      pictures.forEach((picture,index)=>{const r=value.layers[index].bounds;context.drawImage(picture,r.x-b.x,r.y-b.y,r.width,r.height);});
      canvas.dataset.kind=value.weatherMorph?'weather-morph':'quota-group';canvas.dataset.token=String(value.token);
      if(compact)compact.style.opacity='0';delete canvas.dataset.source;delete canvas.dataset.target;delete canvas.dataset.targetKind;
      if(compactPicture){compactCanvas();const r=value.weatherMorph.target;compact.width=Math.ceil(r.width*scale);compact.height=Math.ceil(r.height*scale);compact.style.left=(r.x-b.x)+'px';compact.style.top=(r.y-b.y)+'px';compact.style.width=r.width+'px';compact.style.height=r.height+'px';compactContext.setTransform(scale,0,0,scale,0,0);compactContext.clearRect(0,0,r.width,r.height);compactContext.drawImage(compactPicture,0,0,r.width,r.height);canvas.dataset.source=JSON.stringify(value.weatherMorph.source);canvas.dataset.target=JSON.stringify(r);canvas.dataset.targetKind=value.weatherMorph.targetKind||'compact';}
      else if(compact){compact.remove();compact=null;compactContext=null;}
      canvas.style.transform=value.expanded?folded():'matrix(1,0,0,1,0,0)';canvas.style.opacity=value.expanded?'0':'1';canvas.style.filter='blur(0px)';
      await new Promise(resolve=>requestAnimationFrame(()=>{bridge.trace?.({token:value.token,stage:'raf1'});requestAnimationFrame(()=>{bridge.trace?.({token:value.token,stage:'raf2'});resolve();});}));
      if(revision===serial&&token===value.token)bridge.ack({token,phase:'prepared',ok:true});
    }catch(_){if(revision===serial)bridge.ack({token:value.token,phase:'prepared',ok:false});}
  });
  const removeAnimate=bridge.onAnimate(async value=>{
    if(!model||value.token<token)return;
    token=value.token;const revision=++serial;
    const style=getComputedStyle(canvas),from={transform:style.transform,opacity:style.opacity,filter:style.filter};stop();
    if(model.weatherMorph){
      const b=model.bounds,s=model.weatherMorph.source,t=model.weatherMorph.target,sx=t.width/s.width,sy=t.height/s.height;
      const target=`matrix(${sx},0,0,${sy},${t.x-b.x-(s.x-b.x)*sx},${t.y-b.y-(s.y-b.y)*sy})`;
      if(media.matches){canvas.style.transform=target;canvas.style.opacity='0';compact.style.opacity='1';bridge.ack({token,phase:'finished',ok:true});return;}
      bridge.trace?.({token:value.token,stage:'animating'});
      const options={duration:220,easing:'cubic-bezier(.32,0,.2,1)',fill:'both'};
      animations=[canvas.animate([{transform:from.transform},{transform:target}],options),canvas.animate([{opacity:1},{opacity:1,offset:.45},{opacity:0}],{...options,easing:'linear'}),compact.animate([{opacity:0},{opacity:0,offset:.45},{opacity:1}],{...options,easing:'linear'})];
      try{await Promise.all(animations.map(a=>a.finished));if(revision!==serial||token!==value.token)return;canvas.style.transform=target;canvas.style.opacity='0';compact.style.opacity='1';stop();bridge.ack({token:value.token,phase:'finished',ok:true});}catch(_){}return;
    }
    const target=value.expanded?'matrix(1,0,0,1,0,0)':folded(),opacity=value.expanded?'1':'0';
    if(media.matches){canvas.style.transform=target;canvas.style.opacity=opacity;canvas.style.filter='blur(0px)';bridge.ack({token,phase:'finished',ok:true});return;}
    bridge.trace?.({token:value.token,stage:'animating'});
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
