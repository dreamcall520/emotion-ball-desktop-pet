(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SoftOrbModel=factory();})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const PRESETS=Object.freeze({
    pearl:{name:'白紫柔光',colors:['#F9F8FF','#B7A7EC','#FDFDFD']},glass:{name:'月光冰晶',colors:['#E7F5FA','#9DBCD4','#FFFFFF']},
    onyx:{name:'午夜蓝',colors:['#374365','#17223D','#F5F5FF']},layered:{name:'薄荷柔光',colors:['#7DF3BE','#54C6B2','#FFFFFF']},
    felt:{name:'蓝色绒感',colors:['#9ABFFF','#526CE8','#FFFFFF']},pixel:{name:'蓝黄颗粒',colors:['#4387ED','#375BD0','#FFED67']},
    plush:{name:'立体蓝绒',colors:['#6B87FF','#3D54BC','#F8F8F2']},synth:{name:'霓虹星河',colors:['#231537','#0B1025','#C3FCFF']}
  });
  const ACTIONS=Object.freeze({draw:[0,3],fan:[3,6],flip:[6,9],scan:[9,12],beam:[12,15],fold:[15,18],shock:[18,22],flight:[22,26],ship:[26,30],love:[30,34],complete:[34,38]});
  const LOVE={pearl:'#A24F81',glass:'#397F99',onyx:'#DFB88C',layered:'#C96E80',felt:'#E6B1D8',pixel:'#F2CF67',plush:'#C4A8E6',synth:'#EB83D7'};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const ease=x=>{x=clamp(x,0,1);return x*x*x*(x*(x*6-15)+10);};
  const ramp=(t,a,b)=>ease((t-a)/(b-a));
  const validHex=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
  const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  function palette(raw={}){
    const id=Object.hasOwn(PRESETS,raw.orbMaterial)?raw.orbMaterial:'pearl',defaults=PRESETS[id].colors;
    return {id,colors:[raw.bodyColor,raw.orbSecondaryColor,raw.eyeColor].map((v,i)=>validHex(v)?v.toUpperCase():defaults[i])};
  }
  function colors(raw={},dark=false){
    const {id,colors}=palette(raw),[primary,secondary,eyes]=colors.map(rgb),base=PRESETS[id].colors;
    let affection=rgb(LOVE[id]);
    if(colors[0]!==base[0]||colors[1]!==base[1]){
      const c=secondary.map((v,i)=>v*.65+primary[i]*.35),max=Math.max(...c),min=Math.min(...c),d=max-min;
      let h=d===0?260:max===c[0]?60*(((c[1]-c[2])/d+6)%6):max===c[1]?60*((c[2]-c[0])/d+2):60*((c[0]-c[1])/d+4);
      h=(h+(h>=90&&h<180?190:h>=180&&h<280?55:-30)+360)%360;
      const l=c[0]*.2126+c[1]*.7152+c[2]*.0722<.3?.76:.48,chroma=(1-Math.abs(2*l-1))*.52,x=chroma*(1-Math.abs((h/60)%2-1)),m=l-chroma/2;
      affection=(h<60?[chroma,x,0]:h<120?[x,chroma,0]:h<180?[0,chroma,x]:h<240?[0,x,chroma]:h<300?[x,0,chroma]:[chroma,0,x]).map(v=>v+m);
    }
    const affectionLight=affection.map(v=>v+(1-v)*.38),seed=secondary.map((v,i)=>v*.72+affection[i]*.28),luma=seed[0]*.2126+seed[1]*.7152+seed[2]*.0722;
    const effectColor=seed.map(v=>Math.min(1,dark?v+(1-v)*.48:v*(luma>.55?.62:luma<.25?1.35:1)));
    return {primary,secondary,eyes,primary2:primary,secondary2:secondary,eyes2:eyes,material:Object.keys(PRESETS).indexOf(id),material2:Object.keys(PRESETS).indexOf(id),affection,affectionLight,effectColor,effectLight:effectColor.map(v=>v+(1-v)*.55)};
  }
  function actionForMotion(id,owner,kind){
    if(owner==='codex'){
      if(kind==='completed')return 'complete';
      if(kind==='failed')return 'shock';
      if(kind==='active')return 'working';
      if(kind==='waiting')return 'scan';
      // Quota warnings may also use jelly; do not turn them into task failures.
      return {hop:'fan',spin:'flip',jelly:'fan',sway:'flip',peek:'draw',bow:'draw'}[id]||'draw';
    }
    return {hop:'fan',jelly:'shock',sway:'flip',peek:'draw',bow:'fan',spin:'flight',dizzy:'shock',turn:'flip',nuzzle:'love',land:'flip',stretch:'wake'}[id]||'draw';
  }
  function duration(id){return id==='working'?3000:id==='wake'?800:Object.hasOwn(ACTIONS,id)?(ACTIONS[id][1]-ACTIONS[id][0])*1000:0;}
  function stateForEmotion(id){return ['00','56'].includes(id)?'sleep':id==='51'?'working':'idle';}
  const defaultIdleLook={cycle:-1,index:-1};
  const glanceDirections=[{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}];
  function idleDirection(t,look){
    const cycle=Math.floor(t/10);
    if(cycle!==look.cycle){
      const choices=[0,1,2,3].filter(index=>index!==look.index);
      look.index=choices[Math.floor(Math.random()*choices.length)];look.cycle=cycle;
    }
    return glanceDirections[look.index];
  }
  function statePose(motion,state,t,gaze={x:0,y:0},stateAge=t,idleLook=defaultIdleLook){
    const p=motion.at(0);t=Math.max(0,t);
    if(state==='sleep'){
      p.eyelid=1-.93*ease(stateAge/.65);p.lift=-.025*ease(stateAge/.65);
      const phase=t%35;p.dream=ramp(phase,3,4)*(1-ramp(phase,7,8));
    }else{
      p.lookX=clamp(Number(gaze.x)||0,-1,1)*.075;p.lookY=-clamp(Number(gaze.y)||0,-1,1)*.04;
      p.lift=Math.sin(t*.9)*.009;
      if(state==='idle'){
        const phase=t*2*Math.PI/3.6;
        p.lift=.047*Math.sin(phase+.16*Math.sin(phase))+.006*Math.sin(t*.63);
        p.roll=.018*Math.sin(phase-.65);p.yaw=.012*Math.sin(t*.72);
        const q=t%10,direction=idleDirection(t,idleLook);
        const glance=ramp(q,2.4,3.1)*(1-ramp(q,4.3,5.2));
        const follow=1-Math.min(1,Math.hypot(Number(gaze.x)||0,Number(gaze.y)||0)*2);
        p.lookX+=.085*direction.x*glance*follow;p.lookY+=.065*direction.y*glance*follow;
        p.yaw+=.065*direction.x*glance*follow;p.pitch+=.045*direction.y*glance*follow;
      }
      const blink=t%4.9;p.eyelid=1-.94*ramp(blink,4.45,4.52)*(1-ramp(blink,4.54,4.66));
      if(state==='working'){p.orbit=.28;p.lookY=.03;p.yaw=.025*Math.sin(t*.6);}
    }
    return p;
  }
  return Object.freeze({PRESETS,ACTIONS,colors,palette,ease,ramp,actionForMotion,duration,stateForEmotion,statePose});
});
