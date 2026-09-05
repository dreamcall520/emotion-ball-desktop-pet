/* 已确认的 V5 头顶短光迹：复用原生渐变和彩带轮廓语言。 */
(function(root){
  'use strict';
  const NS='http://www.w3.org/2000/svg';
  const DURATION=6000, LIFE=1800, BIRTHS=[0,700,1400,2100,2800,3500,4200];
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
  let uid=0;
  const r=v=>Number(v.toFixed(3));
  function point(p,k,side,variant){
    const starts=[[63,-2],[66,-3],[64,-2]];
    const bends=[[[75,-27],[107,-30],[110,-8]],[[73,-29],[97,-37],[105,-17]],[[69,-34],[101,-39],[106,-9]]];
    const [a,b,c]=bends[k];const s=starts[k];
    const q=1-p;
    let x=q*q*q*s[0]+3*q*q*p*a[0]+3*q*p*p*b[0]+p*p*p*c[0];
    let y=q*q*q*s[1]+3*q*q*p*a[1]+3*q*p*p*b[1]+p*p*p*c[1];
    y+=Math.sin(p*Math.PI)*(variant%3-1)*2;
    return {x:side==='left'?100-x:x,y};
  }
  // Head-wide / tail-fine, round end caps: original renderer's silhouette principle.
  function outline(points,width){
    if(points.length<2 || width<.05)return '';
    const normals=points.map((p,i)=>{
      const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)];
      const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
      const w=width*(.16+.84*i/(points.length-1))/2;
      return {x:-dy/length*w,y:dx/length*w,w};
    });
    const left=points.map((p,i)=>`${i?'L':'M'}${r(p.x+normals[i].x)} ${r(p.y+normals[i].y)}`).join(' ');
    const last=points.length-1,n=normals[last],h=points[last];
    const cap=`A${r(n.w)} ${r(n.w)} 0 0 0 ${r(h.x-n.x)} ${r(h.y-n.y)}`;
    const right=points.slice().reverse().map((p,j)=>{const i=last-j;return `L${r(p.x-normals[i].x)} ${r(p.y-normals[i].y)}`;}).join(' ');
    const t=normals[0],first=points[0];
    return `${left} ${cap} ${right} A${r(t.w)} ${r(t.w)} 0 0 0 ${r(first.x+t.x)} ${r(first.y+t.y)}Z`;
  }
  function sample(elapsed,side='right',variant=0){
    if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=DURATION)return [];
    return BIRTHS.flatMap((born,i)=>{
      const age=elapsed-born;
      if(age<=0 || age>=LIFE)return [];
      const u=age/LIFE,p=smooth(u);
      const grow=smooth(age/240),ret=smooth((age-1180)/620);
      const opacity=grow*(1-ret);
      const width=(7.8+(i%3)*.65)*grow*(1-.75*ret);
      const span=.24*(1-ret*.7),tail=Math.max(0,p-span);
      const pts=Array.from({length:15},(_,j)=>point(tail+(p-tail)*j/14,i%3,side,variant));
      const head=pts[pts.length-1];
      return [{id:i,age,opacity,width,head,tail:pts[0],path:outline(pts,width),hue:190+(i%3)*48+age*.017+variant*8}];
    });
  }
  function el(name,attrs={}){const e=document.createElementNS(NS,name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;}
  function create(host){
    if(!host)throw new Error('缺少思绪预览容器');
    const id='thought-flow-'+(++uid)+'-';
    const svg=el('svg',{viewBox:'0 0 100 100','aria-hidden':'true'});
    const defs=el('defs');svg.append(defs);
    const slots=BIRTHS.map((_,i)=>{
      const grad=el('linearGradient',{id:id+i,gradientUnits:'userSpaceOnUse'});
      const stops=Array.from({length:5},(_,j)=>{const e=el('stop',{offset:j/4});grad.append(e);return e;});defs.append(grad);
      const path=el('path',{fill:`url(#${id+i})`,opacity:0,'data-flow-particle':i});svg.append(path);
      return {grad,stops,path};
    });
    host.replaceChildren(svg);
    let raf=0,started=0,elapsed=0,running=false,side='right',variant=0,drawn=[],destroyed=false;
    function draw(t){
      drawn=sample(t,side,variant);
      slots.forEach(s=>s.path.setAttribute('opacity','0'));
      for(const p of drawn){
        const s=slots[p.id];s.path.setAttribute('d',p.path);s.path.setAttribute('opacity',r(p.opacity));
        s.grad.setAttribute('x1',r(p.tail.x));s.grad.setAttribute('y1',r(p.tail.y));
        s.grad.setAttribute('x2',r(p.head.x));s.grad.setAttribute('y2',r(p.head.y));
        s.stops.forEach((st,j)=>st.setAttribute('stop-color',`hsl(${r(p.hue+j*16)} 56% ${56+j*2.75}%)`));
      }
      elapsed=t;
    }
    function stop(){if(raf)cancelAnimationFrame(raf);raf=0;running=false;draw(DURATION);}
    function tick(now){
      raf=0;if(destroyed||!running)return;
      const t=now-started;if(t>=DURATION){stop();return;}draw(t);raf=requestAnimationFrame(tick);
    }
    function play(options={}){
      if(destroyed)return;stop();side=options.side==='left'?'left':'right';variant=(variant+1)%3;
      svg.setAttribute('viewBox', options.viewBox || '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      slots.forEach(s=>s.path.setAttribute('transform', options.rotation ? `rotate(${options.rotation} 50 50)` : ''));
      const offset=Number.isFinite(options.elapsedMs)?clamp(options.elapsedMs,0,DURATION):0;
      started=performance.now()-offset;elapsed=offset;
      if(options.reducedMotion){draw(1750);return;}
      running=true;draw(elapsed);raf=requestAnimationFrame(tick);
    }
    function destroy(){stop();destroyed=true;svg.remove();}
    return {play,stop,destroy,getState:()=>({running,elapsed,side,variant,particles:drawn.map(p=>({id:p.id,head:p.head,opacity:p.opacity}))})};
  }
  root.ThoughtFlow=Object.freeze({create,sample,durationMs:DURATION});
})(window);

