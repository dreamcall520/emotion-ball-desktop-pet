(function(root){
  'use strict';
  const M=root.SoftOrbModel,motion=root.MGMotion;
  const assets=new URL('../assets/soft-orb/',document.currentScript.src).href;
  function create(target,options={}){
    let appearance={...(options.appearance||{})},active=options.autostart!==false,disposed=false,raf=0,clock=0,last=0,action=null,actionStart=0,stateStart=0,state='idle',emotionId='50',ready=false,lost=false,draw,renderRevision=0;
    let firstReadyResolve;const firstReady=new Promise(resolve=>{firstReadyResolve=resolve;});
    let facing='left',quotaScale=1,quotaMode='card',faceCanvas=null,bodyCanvas=null;
    let gaze={x:0,y:0},smoothGaze={x:0,y:0},paused=false,events=new Map(),reduced=root.matchMedia?.('(prefers-reduced-motion: reduce)');
    const canvas=document.createElement('canvas');canvas.className='soft-orb-canvas';canvas.setAttribute('aria-label',options.label||'小宇');canvas.setAttribute('role','img');canvas.style.cssText='display:block;width:100%;height:100%;pointer-events:none;';canvas.style.opacity=String(1-Math.min(60,Math.max(0,Number(appearance.auroraTransparency)||0))/100);target.append(canvas);
    const notify=(name,value)=>{for(const fn of events.get(name)||[])fn(value);};
    function size(){const rect=target.getBoundingClientRect();const side=Math.max(24,Math.min(720,Math.round(Math.max(rect.width||80,rect.height||80)*Math.min(root.devicePixelRatio||1,2))));if(canvas.width!==side||canvas.height!==side){canvas.width=side;canvas.height=side;}}
    const idleLook={cycle:-1,index:-1};
    function pose(){
      const localGaze={x:smoothGaze.x*(facing==='right'?-1:1),y:smoothGaze.y};
      let p=M.statePose(motion,state,clock,localGaze,clock-stateStart,idleLook);
      if(action){
        const age=clock-actionStart,total=M.duration(action)/1000;
        if(age>=total){action=null;canvas.dataset.action=state;notify('motionend');}
        else if(action==='working')p=M.statePose(motion,'working',age,localGaze,age);
        else if(action==='wake'){p=motion.at(0);const progress=M.ease(age/.8);p.eyelid=.07+.93*progress;p.lift=-.025*(1-progress);}
        else{const interval=M.ACTIONS[action];p=motion.at(interval[0]+age);}
      }
      if(reduced?.matches){p=M.statePose(motion,state,0,{x:0,y:0},state==='sleep'?1:0);p.lift=0;p.orbit=0;p.dream=0;if(action==='complete'||action==='fan')p.smile=.98;if(action==='love')p.love=1;}
      return p;
    }
    function renderState(){const p=pose();if(options.lite||quotaMode!=='card')p.shadowAlpha=0;const dark=document.documentElement?.dataset.appearance==='dark'||document.documentElement?.dataset.theme==='dark';return {...p,...M.colors(appearance,dark),time:action?((M.ACTIONS[action]?.[0]||0)+clock-actionStart):clock,dark:dark?1:0};}
    function syncScale(){canvas.style.scale=String((facing==='right'?-1:1)*quotaScale)+' '+quotaScale;if(fallback)fallback.style.scale=canvas.style.scale;}
    function render(){
      if(disposed||lost||!ready)return;
      size();draw(renderState());
      canvas.dataset.state=state;canvas.dataset.action=action||state;if(canvas.dataset.ready!=='true')canvas.dataset.ready='true';
    }
    function frame(now){raf=0;if(disposed||lost||paused||(!active&&!action)||document.hidden||reduced?.matches)return;
      if(last&&now-last<(options.lite?33:16)-.5){schedule();return;}
      const dt=Math.min(.05,Math.max(0,(now-(last||now))/1000));last=now;clock+=dt;
      const blend=1-Math.exp(-dt*9);smoothGaze.x+=(gaze.x-smoothGaze.x)*blend;smoothGaze.y+=(gaze.y-smoothGaze.y)*blend;
      render();schedule();
    }
    function schedule(){if(!raf&&!disposed&&!lost&&!paused&&ready&&!document.hidden&&!reduced?.matches&&(active||action))raf=root.requestAnimationFrame(frame);}
    function pause(){if(raf)root.cancelAnimationFrame(raf);raf=0;last=0;}
    function playAction(id,explicit=true){if(!M.duration(id)||disposed||state==='sleep'&&id!=='wake'&&id!=='fold')return false;action=id;actionStart=clock;if(explicit&&options.autostart===false)paused=false;canvas.dataset.action=id;render();schedule();return true;}
    function preference(){pause();render();schedule();}
    function visibility(){pause();if(!document.hidden){render();schedule();}}
    let readyPromise,fallback;
    function staticFallback(){
      if(disposed||fallback)return;
      fallback=document.createElement('img');fallback.alt='小宇静态外观（当前设备无法播放立体动画）';fallback.src=assets+'fallback-'+M.palette(appearance).id+'.png';
      fallback.style.cssText='display:block;position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;';fallback.style.opacity=canvas.style.opacity;
      canvas.style.visibility='hidden';fallback.style.scale=canvas.style.scale;target.append(fallback);
    }
    function initialize(){
      const revision=++renderRevision;
      try{draw=root.createSoftOrbRenderer(canvas,assets);}
      catch(error){canvas.dataset.error='webgl';canvas.setAttribute('aria-label','小宇渲染不可用');staticFallback();notify('error',error);readyPromise=Promise.resolve(false);firstReadyResolve(false);return;}
      readyPromise=draw.ready.then(ok=>{if(disposed||revision!==renderRevision)return false;ready=ok;if(ok){fallback?.remove();fallback=null;canvas.style.visibility='';firstReadyResolve(true);render();schedule();}else{firstReadyResolve(false);canvas.dataset.error='assets';staticFallback();notify('error',new Error('小宇素材加载失败'));}return ok;});
    }
    const onLost=event=>{event.preventDefault();lost=true;ready=false;renderRevision++;draw?.destroy(false);pause();canvas.dataset.ready='false';};
    const onRestored=()=>{if(disposed)return;lost=false;initialize();};
    canvas.addEventListener('webglcontextlost',onLost);canvas.addEventListener('webglcontextrestored',onRestored);
    document.addEventListener('visibilitychange',visibility);reduced?.addEventListener?.('change',preference);
    function snapshot(surface,current,kind){if(!surface)surface=document.createElement('canvas');if(surface.width!==canvas.width||surface.height!==canvas.height){surface.width=canvas.width;surface.height=canvas.height;}const ctx=surface.getContext('2d');if(!ctx)return null;draw({...current,[kind]:1});ctx.clearRect(0,0,surface.width,surface.height);ctx.drawImage(canvas,0,0);return surface;}
    // Quota fitting composes with facing; neither owner may overwrite the other.
    canvas.softOrbQuota={
      setMode(value){const next=['pool','ring','duo','split','stages'].includes(value)?value:'card';if(quotaMode===next)return;quotaMode=next;canvas.dataset.quotaMode=next;render();},
      setScale(value){quotaScale=Math.max(.001,Math.min(1,Number(value)||1));syncScale();},
      getFaceCanvas(){if(!ready||lost||disposed)return null;size();const current=renderState();faceCanvas=snapshot(faceCanvas,current,'quotaFaceOnly');draw(current);return faceCanvas;},
      getPoolCanvases(){if(!ready||lost||disposed)return null;size();const current=renderState();bodyCanvas=snapshot(bodyCanvas,current,'quotaBodyOnly');faceCanvas=snapshot(faceCanvas,current,'quotaFaceOnly');draw(current);return bodyCanvas&&faceCanvas?{body:bodyCanvas,face:faceCanvas}:null;}
    };
    const api={
      get emotionId(){return emotionId;},set emotionId(value){emotionId=value;},
      setEmotion(id){const previous=state;emotionId=String(id);state=M.stateForEmotion(emotionId);if(state!==previous){stateStart=clock;action=null;}if(['03','10','52','53','54'].includes(emotionId))playAction({'03':'draw','10':'fan','52':'love','53':'fan','54':'draw'}[emotionId],false);target.dataset.emotion=emotionId;render();schedule();return api;},
      setMotionAction(id,owner,kind){playAction(M.actionForMotion(id,owner,kind));return api;},
      playAction,
      getActionDuration(id,owner,kind){return M.duration(M.actionForMotion(id,owner,kind));},
      whenReady(){return firstReady;},whenMotionReady(){return readyPromise;},
      setMotionFrame(){return api;},
      stopMotion(){action=null;render();return api;},
      setGaze(x,y){gaze={x:Number(x)||0,y:Number(y)||0};schedule();return api;},clearGaze(){gaze={x:0,y:0};return api;},
      setFacing(side){if(!['left','right'].includes(side))return api;facing=side;if(canvas.dataset.facing!==side)canvas.dataset.facing=side;syncScale();render();return api;},setDragDirection(){return api;},
      setActive(value){const next=Boolean(value);if(active===next&&paused===!next)return api;active=next;paused=!active;pause();render();schedule();return api;},
      renderStatic(){paused=true;pause();render();return api;},
      resize(){size();render();return api;},
      spin(){playAction('flip');return api;},bounce(){playAction('fan');return api;},
      on(name,fn){if(typeof fn==='function'){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);}return api;},
      destroy(){if(disposed)return;disposed=true;firstReadyResolve(false);pause();canvas.removeEventListener('webglcontextlost',onLost);canvas.removeEventListener('webglcontextrestored',onRestored);document.removeEventListener('visibilitychange',visibility);reduced?.removeEventListener?.('change',preference);draw?.destroy();delete canvas.softOrbQuota;faceCanvas=bodyCanvas=null;events.clear();fallback?.remove();canvas.remove();}
    };
    initialize();render();schedule();return api;
  }
  root.SoftOrb=Object.freeze({create,PRESETS:M.PRESETS,ACTIONS:M.ACTIONS});
})(window);
