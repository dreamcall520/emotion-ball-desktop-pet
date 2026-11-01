(function(root){
  'use strict';
  function frameAt(clip,elapsed){const total=clip.durations.reduce((a,b)=>a+b,0);let time=Math.max(0,elapsed)%total;for(let i=0;i<clip.durations.length;i++){if(time<clip.durations[i])return i;time-=clip.durations[i];}return 0;}
  function resolveClip(pet,action,elapsed){
    if(pet.id==='chuge'&&action==='sleep'&&elapsed>=2000&&(elapsed-2000)%10000<3000)return{clip:pet.clips.kfc,elapsed:(elapsed-2000)%10000,action:'kfc'};
    return{clip:pet.clips[action]||pet.clips.idle,elapsed,action};
  }
  function create({canvas,loadImage,requestFrame=requestAnimationFrame,cancelFrame=cancelAnimationFrame,now=()=>performance.now(),onError=()=>{},onReady=()=>{}}){
    let epoch=0,raf=null,pet=null,action='idle',paused=false,elapsed=0,started=0,active=false,readyEpoch=-1;
    const images=new Map(),ctx=canvas.getContext('2d');
    function stop(){epoch++;if(raf!==null)cancelFrame(raf);raf=null;active=false;}
    function image(url){if(!images.has(url))images.set(url,Promise.resolve().then(()=>loadImage(url)).catch(error=>{images.delete(url);throw error;}));return images.get(url);}
    async function paint(token,time){
      const selected=resolveClip(pet,action,time),clip=selected.clip;
      try{
        const img=await image(clip.image);if(token!==epoch||!active)return;
        const cw=img.naturalWidth/clip.columns,ch=img.naturalHeight/clip.rows,frame=frameAt(clip,selected.elapsed),cell=clip.start+frame;
        if(canvas.width!==Math.round(cw))canvas.width=Math.round(cw);if(canvas.height!==Math.round(ch))canvas.height=Math.round(ch);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();if(clip.flipX){ctx.translate(cw,0);ctx.scale(-1,1);}ctx.drawImage(img,cell%clip.columns*cw,Math.floor(cell/clip.columns)*ch,cw,ch,0,0,cw,ch);ctx.restore();
        canvas.dataset.promotionCase=pet.id;canvas.dataset.promotionAction=selected.action;canvas.dataset.promotionFrame=String(frame);canvas.dataset.promotionReady='true';if(readyEpoch!==token){readyEpoch=token;onReady({pet,action:selected.action});}
        if(!paused)raf=requestFrame(()=>paint(token,elapsed+now()-started));
      }catch(error){if(token===epoch&&active){canvas.dataset.promotionReady='error';ctx.clearRect(0,0,canvas.width,canvas.height);onError(error);}}
    }
    function play(nextPet,nextAction='idle',isPaused=paused){stop();pet=nextPet;action=nextAction;paused=isPaused;elapsed=0;started=now();active=true;canvas.dataset.promotionReady='loading';paint(epoch,0);}
    function setPaused(value){if(paused===value)return;if(!paused)elapsed+=now()-started;paused=value;if(raf!==null)cancelFrame(raf);raf=null;if(active){const token=++epoch;started=now();paint(token,elapsed);}}
    return{play,setPaused,stop,getState:()=>({active,paused,epoch,action,caseId:pet?.id})};
  }
  const api={frameAt,resolveClip,create};if(typeof module==='object'&&module.exports)module.exports=api;else root.SkinPromotionPlayer=api;
})(typeof globalThis==='object'?globalThis:this);
