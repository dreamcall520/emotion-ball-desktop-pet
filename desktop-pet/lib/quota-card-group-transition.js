const {createQuotaCardTransitionWindow}=require('./quota-card-transition-window');
const { QUOTA_CARD_SOURCES: IDS } = require('./quota-card-group');
const rect=b=>b&&[b.x,b.y,b.width,b.height].every(Number.isFinite)&&b.width>0&&b.height>0&&b.width<=8192&&b.height<=8192;
function unionBounds(rows){const x=Math.floor(Math.min(...rows.map(r=>r.x))),y=Math.floor(Math.min(...rows.map(r=>r.y))),right=Math.ceil(Math.max(...rows.map(r=>r.x+r.width))),bottom=Math.ceil(Math.max(...rows.map(r=>r.y+r.height)));const b={x,y,width:right-x,height:bottom-y};if(!rect(b)||b.width*b.height>8*1024*1024)throw Error('额度区过渡范围过大');return b;}
function createQuotaCardGroupTransition(options){
  const {isContextCurrent=()=>true,onSettled=()=>{},onError=()=>{}}=options;
  const overlay=options.createOverlay?options.createOverlay():createQuotaCardTransitionWindow(options);
  const modeOwners=new Map();
  let generation=0,current=null,destroyed=false;
  const valid=s=>!destroyed&&current===s&&s.token===generation&&isContextCurrent(s.contextKey)!==false;
  function report(error){try{onError(error);}catch(_){}}
  function fallback(s,error){report(error);let canceled=true;try{canceled=isContextCurrent(s.contextKey)===false;}catch(_){}release(s,canceled);}
  function mode(cards,value,token){let failure;for(const row of cards){if(value!==null&&generation!==token)throw Error('额度区过渡已替换');if(value===null){if(modeOwners.get(row.controller)!==token)continue;modeOwners.delete(row.controller);}else modeOwners.set(row.controller,token);try{row.controller.setGroupTransitionMode(value);}catch(error){report(error);if(value!==null)failure ||= error;}}if(value!==null&&generation!==token)throw Error('额度区过渡已替换');if(failure)throw failure;}
  // Claim the whole set before a controller callback can synchronously replace it.
  function claimModes(s){for(const row of [...s.cards,...s.pinnedCards])modeOwners.set(row.controller,s.token);}
  function releaseModes(s){mode(s.cards,null,s.token);mode(s.pinnedCards,null,s.token);}
  function release(s,canceled){
    if(current!==s)return;
    const finishToken=generation;current=null;releaseModes(s);if(generation!==finishToken)return;
    try{onSettled({expanded:s.expanded,contextKey:s.contextKey,canceled});}catch(error){report(error);}
    // Reveal staged real windows before removing the full-size entry snapshot.
    if(current===null&&generation===finishToken)overlay.hide();
  }
  function cancel(){const canceledGeneration=++generation;const s=current;current=null;overlay.hide();if(s){releaseModes(s);if(generation===canceledGeneration)try{onSettled({expanded:s.expanded,contextKey:s.contextKey,canceled:true});}catch(error){report(error);}}return canceledGeneration;}
  async function animate(s){
    await overlay.animate({token:s.token,expanded:s.expanded});
    if(valid(s))release(s,false);else if(current===s)release(s,true);
  }
  async function request(input){
    if(destroyed)return {ok:false,canceled:true};
    const cards=(Array.isArray(input.cards)?input.cards:[]).filter((row,index,all)=>IDS.includes(row?.id)&&!row.pinned&&row.controller&&all.findIndex(other=>other.id===row.id)===index);
    const pinnedCards=(Array.isArray(input.pinnedCards)?input.pinnedCards:[]).filter((row,index,all)=>IDS.includes(row?.id)&&row.controller&&!cards.some(card=>card.id===row.id||card.controller===row.controller)&&all.findIndex(other=>other.id===row.id||other.controller===row.controller)===index);
    const sameRows=(a,b)=>a.length===b.length&&a.every((row,i)=>row.id===b[i].id&&row.controller===b[i].controller);
    const expanded=input.expanded===true;
    const previous=current;
    if(previous&&previous.expanded===expanded&&previous.contextKey===input.contextKey&&sameRows(cards,previous.cards)&&sameRows(pinnedCards,previous.pinnedCards)&&JSON.stringify(input.anchor)===JSON.stringify(previous.anchor)&&!input.reducedMotion)return {ok:true,pending:true};
    if(previous?.phase==='animating'&&previous.contextKey===input.contextKey&&sameRows(cards,previous.cards)&&sameRows(pinnedCards,previous.pinnedCards)&&rect(input.anchor)&&JSON.stringify(input.anchor)===JSON.stringify(previous.anchor)&&!input.reducedMotion){
      const s={...previous,token:++generation,expanded};current=s;
      try{claimModes(s);mode(pinnedCards,'hold',s.token);mode(cards,'masked',s.token);input.prepare?.();if(!valid(s)){if(current===s)release(s,true);return {ok:false,canceled:true};}if(expanded)mode(pinnedCards,null,s.token);await animate(s);return {ok:valid(s)||current===null};}catch(error){if(current===s)fallback(s,error);return {ok:false,canceled:true};}
    }
    const canceledGeneration=cancel();if(destroyed||generation!==canceledGeneration)return {ok:false,canceled:true};
    const s={token:++generation,expanded,cards,pinnedCards,contextKey:input.contextKey,anchor:input.anchor,phase:'capturing',bounds:null};current=s;
    try{
      if(!isContextCurrent(s.contextKey))throw Error('额度区场景已变化');
      if(previous?.phase==='capturing'&&previous.expanded!==expanded&&previous.contextKey===input.contextKey){input.prepare?.();release(s,false);return {ok:true,immediate:true};}
      if(input.reducedMotion||!cards.length){input.prepare?.();release(s,false);return {ok:true,immediate:true};}
      if(!rect(input.anchor))throw Error('额度区收纳锚点无效');
      // Fixed cards stay painted at their old bounds while hidden cards are captured
      // at the final layout. Otherwise a fixed card below them exposes a blank gap.
      claimModes(s);
      mode(pinnedCards,'hold',s.token);
      mode(cards,expanded?'stage':'hold',s.token);
      input.prepare?.();
      let timer;
      const layers=await Promise.race([Promise.all(cards.map(row=>row.controller.captureGroupTransitionFrames())).then(rows=>rows.flat()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('额度区快照超时')),700);})]).finally(()=>clearTimeout(timer));
      if(!valid(s)){if(current===s)release(s,true);return {ok:false,canceled:true};}
      if(!layers.length||layers.length>8)throw Error('额度区快照数量不合法');
      let bytes=0;
      const checked=layers.map(layer=>{if(!rect(layer.bounds)||!Buffer.isBuffer(layer.png)||layer.png.length<8||!layer.png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('额度区快照无效');bytes+=layer.png.length;if(bytes>32*1024*1024)throw Error('额度区快照过大');return {bounds:{...layer.bounds},image:`data:image/png;base64,${layer.png.toString('base64')}`};});
      s.bounds=unionBounds([...checked.map(layer=>layer.bounds),input.anchor]);
      await overlay.prepare({token:s.token,bounds:s.bounds,layers:checked,anchor:input.anchor,expanded,scale:options.screen?.getDisplayMatching(s.bounds)?.scaleFactor||1});
      if(!valid(s)){if(current===s)release(s,true);return {ok:false,canceled:true};}
      overlay.show();if(expanded)mode(pinnedCards,null,s.token);mode(cards,'masked',s.token);s.phase='animating';
      await animate(s);return {ok:true};
    }catch(error){if(current===s)fallback(s,error);return {ok:false,canceled:true};}
  }
  return {request,cancel,destroy(){cancel();destroyed=true;overlay.destroy();},isActive:()=>current!==null,getRetentionBounds:()=>current?.bounds?[{...current.bounds}]:[],warm:()=>overlay.warm?.()};
}
module.exports={createQuotaCardGroupTransition,unionBounds};
