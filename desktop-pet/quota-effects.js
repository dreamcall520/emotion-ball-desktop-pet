/* Approved quota materials; original pet DOM remains the source of body and eyes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else root.QuotaEffects = factory(root);
}(typeof window === 'object' ? window : this, function (root) {
  'use strict';
  const SIZE = 340, CENTER = 170, TAU = Math.PI * 2;
  let serial = 0;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const color = (hex, fallback) => /^#[0-9a-f]{6}$/i.test(hex || '')
    ? [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) : fallback;
  function palette(appearance = {}) {
    const body = color(appearance.bodyColor, [238, 235, 228]);
    if (Math.max(...body) - Math.min(...body) < 35) {
      return { base: [69, 162, 227], light: [171, 226, 255], accent: [122, 157, 247], family: 'ice-blue' };
    }
    return { base: mix(body, [255,255,255], .24), light: mix(body, [255,255,255], .64),
      accent: appearance.shape === 'aurora-cloud' ? color(appearance.glowPinkColor, [208,94,214]) : mix(body, [255,255,255], .42),
      family: 'body-hue' };
  }
  function dualPalettes(input) {
    const first = input.family === 'ice-blue' ? [66,175,238] : input.base;
    const second = input.family === 'ice-blue' ? [234,161,89] : [first[1],first[2],first[0]];
    return [first, second].map(base => ({ base, light: mix(base, [255,255,255], .64), accent: mix(base, [255,255,255], .22) }));
  }
  function quota(value) { return typeof value === 'number' && Number.isFinite(value) ? clamp(value, 0, 100) : null; }
  function model(input = {}) {
    const config = input.config || {}, quotas = input.quotas || {};
    const style = ['card','pool','ring','duo','split','stages'].includes(config.style) ? config.style : 'card';
    const values = { fiveHour: quota(quotas.fiveHour), weekly: quota(quotas.weekly) };
    return { style, material: config.material === 'glass' ? 'glass' : 'soft',
      period: config.period === 'weekly' ? 'weekly' : 'fiveHour', values,
      available: style !== 'duo' || Object.values(values).every(value => value !== null),
      palette: palette(input.appearance), dark: input.theme === 'dark', still: Boolean(input.reducedMotion),
      visible: input.visible !== false && input.appearance?.shape !== 'codex-pet' };
  }
  function quotaStages(value) { return value === null ? null : Array.from({ length: 5 }, (_, i) => clamp(value / 20 - i, 0, 1)); }
  function create(host) {
    const document = host.ownerDocument;

// One analytic glass cross-section; fixed geometry, light intensity breathes.
// Previous Iridescence-derived candidates and their license remain in reference/.
function createColorRing(size){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=size*2;
 const gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true,antialias:false});
 if(!gl)throw Error('当前浏览器无法显示液态动效，请使用支持 WebGL 的浏览器。');
 const vertex='attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}';
 const fragment=`precision highp float;
 uniform float seconds,dark;
 uniform vec3 tint,shine;
 float gaussian(float d,float width){return exp(-d*d/(width*width));}
 void main(){
  vec2 uv=(gl_FragCoord.xy*.5-vec2(170.))/170.;
  float d=length(uv)*170.-139.;
  if(d<-10.||d>29.){gl_FragColor=vec4(0.);return;}
  float angle=atan(uv.y,uv.x),breath=.5-.5*cos(seconds*1.122);
  float drift=.5+.5*sin(angle*2.+.45*sin(angle*3.-seconds*.32)+seconds*.24);
  vec3 blue=tint,ice=shine;
  vec3 color=mix(blue,ice,.10+.22*drift);
  // All profiles share one center: the glow decays continuously out of the glass.
  float core=gaussian(d,1.15)*(.66+.055*breath);
  float glass=gaussian(d,2.7)*.15;
  float glow=gaussian(d,10.)*mix(.042,.075,dark)*(.82+.32*breath);
  glow*=smoothstep(-10.,-6.,d)*(1.-smoothstep(23.,29.,d));
  float alpha=1.-(1.-core)*(1.-glass)*(1.-glow);
  gl_FragColor=vec4(mix(ice,color,(core+glass)/max(core+glass+glow,.001)),alpha);
 }`;
 const compile=(type,code)=>{const shader=gl.createShader(type);gl.shaderSource(shader,code);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
 const program=gl.createProgram(),vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);
 gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
 gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
 gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
 const uniforms=Object.fromEntries(['seconds','dark','tint','shine'].map(key=>[key,gl.getUniformLocation(program,key)]));
 const caches=[false,true].map(()=>{const c=document.createElement('canvas');c.width=c.height=size;return {canvas:c,ctx:c.getContext('2d'),key:null};});
 return {
  frame(t,isDark,isAurora,still,palette){
   const cache=caches[Number(still)],seconds=still?0:t,key=[seconds,isDark,...palette.base,...palette.light].join(':');
   if(cache.key!==key){
    gl.uniform1f(uniforms.seconds,seconds);gl.uniform1f(uniforms.dark,Number(isDark));
    gl.uniform3fv(uniforms.tint,palette.base.map(v=>v/255));gl.uniform3fv(uniforms.shine,palette.light.map(v=>v/255));
    gl.viewport(0,0,size*2,size*2);gl.drawArrays(gl.TRIANGLES,0,3);
    cache.ctx.clearRect(0,0,size,size);cache.ctx.drawImage(canvas,0,0,size,size);cache.key=key;
   }
   return cache.canvas;
  },
  destroy(){gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);gl.getExtension('WEBGL_lose_context')?.loseContext();}
 };
}



// The download button's short rainbow edge, with the same colours and 6s travel.
function drawRingFlow(ctx, t, radius, width, start = 0, end = Math.PI * 2) {
  const flow = ctx.createConicGradient(-Math.PI / 2 + t * Math.PI / 3, 170, 170);
  for (const [deg, color] of [
    [0, 'transparent'], [222, 'transparent'], [238, 'rgba(51,224,226,.1)'],
    [251, '#3fdbec'], [261, '#8fa7ff'], [272, '#ef93de'], [281, '#ffd18b'],
    [291, 'rgba(72,220,255,.45)'], [308, 'transparent'], [360, 'transparent']
  ]) flow.addColorStop(deg / 360, color);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = flow;
  ctx.beginPath();
  ctx.arc(170, 170, radius, start, end);
  ctx.stroke();
  ctx.restore();
}

/**
 * Reference B: one glass housing, one quota track, and one remaining-quota arc.
 * Coordinates: 340 × 340; draw the original radius-125 body afterwards.
 * q is remaining quota (0..1); t is seconds; palette channels are 0..255.
 * No animation loop or body rendering is owned by this helper.
 */
function drawReferenceRing(ctx, q, t, palette, dark, still) {
  const C = 170, SIZE = 340, TAU = Math.PI * 2;
  const GLASS_R = 151, TRACK_R = 139, TRACK_W = 7.6;
  const TOP = -Math.PI / 2, END = TOP + TAU;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const finite = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const channel = (value, fallback) => clamp(finite(value, fallback), 0, 255);
  const rgb = (value, fallback) => fallback.map((v, i) => channel(value?.[i], v));
  const base = rgb(palette?.base, [47, 159, 237]);
  const light = rgb(palette?.light, base.map(v => v + (255 - v) * .62));
  const accent = rgb(palette?.accent, base);
  const mix = (a, b, weight) => a.map((v, i) => v + (b[i] - v) * weight);
  const rgba = (color, alpha) => 'rgba(' + color.map(v => Math.round(v)).join(',') + ',' + clamp(alpha, 0, 1) + ')';
  const white = [248, 253, 255];
  const neutral = dark ? [176, 190, 204] : [153, 166, 180];
  q = clamp(finite(q, 0), 0, 1);
  t = still ? 0 : finite(t, 0);
  const breath = .5 - .5 * Math.cos(t * TAU / 5.6);

  const strokeArc = (target, radius, width, style, start, end) => {
    target.beginPath();
    target.arc(C, C, radius, start, end);
    target.lineWidth = width;
    target.strokeStyle = style;
    target.stroke();
  };
  const annulus = (target, inner, outer) => {
    target.beginPath();
    target.arc(C, C, outer, 0, TAU);
    target.arc(C, C, inner, TAU, 0, true);
    target.closePath();
    target.clip();
  };

  ctx.save();
  try {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
    ctx.lineCap = 'round';
    if ('filter' in ctx) ctx.filter = 'none';

    // The glass stays neutral even at zero; quota colour is a separate layer.
    ctx.save();
    annulus(ctx, 128.6, 153.2);
    const glass = ctx.createRadialGradient(C, C, 128.6, C, C, 153.2);
    glass.addColorStop(0, rgba(white, 0));
    glass.addColorStop(.16, rgba(white, dark ? .018 : .009));
    glass.addColorStop(.46, rgba(neutral, dark ? .035 : .025));
    glass.addColorStop(.76, rgba(white, dark ? .026 : .012));
    glass.addColorStop(.91, rgba(neutral, dark ? .11 : .09));
    glass.addColorStop(.975, rgba(white, dark ? .14 : .12));
    glass.addColorStop(1, rgba(white, 0));
    ctx.fillStyle = glass;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.restore();

    // Shallow grey track: complete circumference, same width as the lit arc.
    const track = ctx.createRadialGradient(C, C, TRACK_R - 4.3, C, C, TRACK_R + 4.3);
    track.addColorStop(0, rgba(neutral, 0));
    track.addColorStop(.13, rgba(neutral, dark ? .105 : .14));
    track.addColorStop(.40, rgba(neutral, dark ? .17 : .21));
    track.addColorStop(.60, rgba(neutral, dark ? .17 : .21));
    track.addColorStop(.87, rgba(neutral, dark ? .10 : .13));
    track.addColorStop(1, rgba(neutral, 0));
    ctx.save();
    annulus(ctx, TRACK_R - 4.3, TRACK_R + 4.3);
    ctx.fillStyle = track;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.restore();

    if (q > 0) {
      // Cache just the scratch surface. Every frame is cleared, including masks.
      const cache = drawReferenceRing._layers || (drawReferenceRing._layers = new WeakMap());
      let layer = cache.get(ctx.canvas);
      if (!layer) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIZE;
        layer = {canvas, ctx: canvas.getContext('2d')};
        cache.set(ctx.canvas, layer);
      }
      const lc = layer.ctx;
      lc.save();
      try {
        lc.setTransform(1, 0, 0, 1, 0, 0);
        lc.clearRect(0, 0, SIZE, SIZE);
        lc.globalAlpha = 1;
        lc.globalCompositeOperation = 'source-over';
        lc.shadowBlur = 0;
        lc.shadowOffsetX = lc.shadowOffsetY = 0;
        lc.lineCap = 'round';
        const used = 1 - q, start = TOP + TAU * used, span = TAU * q;
        const sheenPhase = .5 + .5 * Math.sin(t * .26);
        const colour = lc.createConicGradient(TOP, C, C);
        for (const [at, color] of [
          [0, mix(base, accent, .28)],
          [.20, base],
          [.43, mix(base, light, .25 + .12 * sheenPhase)],
          [.62, mix(light, base, .24)],
          [.80, mix(base, accent, .45)],
          [1, mix(base, accent, .28)]
        ]) colour.addColorStop(at, rgba(color, .93));

        // Fixed spread; gentle breathing changes intensity rather than ring size.
        lc.shadowColor = rgba(light, .18 + .07 * breath);
        lc.shadowBlur = 7;
        strokeArc(lc, TRACK_R, TRACK_W + 1, rgba(base, .15 + .035 * breath), start, END);
        lc.shadowBlur = 0;
        strokeArc(lc, TRACK_R, TRACK_W, colour, start, END);

        const face = lc.createConicGradient(TOP, C, C);
        for (const [at, alpha] of [[0, .10], [.12, .38], [.30, .07], [.48, .12], [.62, .48], [.77, .10], [1, .10]]) {
          face.addColorStop(at, rgba(mix(light, white, .45), alpha));
        }
        strokeArc(lc, TRACK_R - 1.65, .9, face, start, END);
        strokeArc(lc, TRACK_R + 2.8, .65, rgba(mix(base, accent, .4), .26), start, END);

        drawRingFlow(lc, t, TRACK_R + 2.2, 1.7, start, END);

        // Native round caps stay intact; clipping by angle would cut them flat.
        const pearlR = Math.min(2.75, span * TRACK_R * .15);
        for (const angle of q === 1 ? [] : [start, END]) {
          const px = C + Math.cos(angle) * TRACK_R, py = C + Math.sin(angle) * TRACK_R;
          const haloR = Math.max(pearlR + .01, Math.min(9, span * TRACK_R * .32));
          const halo = lc.createRadialGradient(px, py, pearlR * .2, px, py, haloR);
          halo.addColorStop(0, rgba(light, .25 + .07 * breath));
          halo.addColorStop(.35, rgba(light, .12));
          halo.addColorStop(1, rgba(light, 0));
          lc.fillStyle = halo;
          lc.fillRect(px - haloR, py - haloR, haloR * 2, haloR * 2);
          const pearl = lc.createRadialGradient(px - pearlR * .27, py - pearlR * .32, 0, px, py, pearlR);
          pearl.addColorStop(0, rgba(mix(light, white, .64), .98));
          pearl.addColorStop(.52, rgba(light, .98));
          pearl.addColorStop(1, rgba(mix(base, light, .52), .94));
          lc.beginPath();
          lc.arc(px, py, pearlR, 0, TAU);
          lc.fillStyle = pearl;
          lc.fill();
        }
      } finally {
        lc.restore();
      }
      ctx.drawImage(layer.canvas, 0, 0, SIZE, SIZE);
    }

    // Environment reflections are last: they continue across lit and used sectors.
    // These are surface reflections, with no coloured emission or pearl at zero.
    strokeArc(ctx, GLASS_R, 1.1, rgba(neutral, dark ? .10 : .21), 0, TAU);
    const edge = ctx.createConicGradient(TOP, C, C);
    for (const [at, alpha] of [
      [0, .58], [.07, .84], [.16, .18], [.29, .10], [.42, .16],
      [.52, .86], [.61, .30], [.73, .11], [.86, .34], [.94, .72], [1, .58]
    ]) edge.addColorStop(at, rgba(white, alpha * (dark ? .84 : .62)));
    strokeArc(ctx, GLASS_R, .85, edge, 0, TAU);

    // Short feathered glints, not a second complete bright outline.
    const glints = ctx.createConicGradient(TOP, C, C);
    for (const [at, alpha] of [
      [0, 0], [.025, 0], [.055, .92], [.085, 0], [.43, 0],
      [.505, .78], [.555, 0], [.86, 0], [.925, .52], [.965, 0], [1, 0]
    ]) glints.addColorStop(at, rgba(white, alpha * (dark ? .90 : .68)));
    strokeArc(ctx, GLASS_R - .65, .65, glints, 0, TAU);
    ctx.shadowColor = rgba(white, dark ? .13 : .045);
    ctx.shadowBlur = 3;
    strokeArc(ctx, GLASS_R + .15, .45, glints, 0, TAU);
  } finally {
    ctx.restore();
  }
}


// Reuse the single-quota materials at their native 340px size, then place two tracks.
const dualLayer = document.createElement('canvas');dualLayer.width=dualLayer.height=340;
const dualContext = dualLayer.getContext('2d');
const dualLight = document.createElement('canvas');dualLight.width=dualLight.height=340;
const dualLightContext = dualLight.getContext('2d');
const dualShell = document.createElement('canvas');dualShell.width=dualShell.height=340;
const dualShellContext = dualShell.getContext('2d');
function drawDualShell(ctx,dark){
 const c=dualShellContext;c.clearRect(0,0,340,340);
 drawReferenceRing(c,0,0,null,dark,true);
 c.globalCompositeOperation='destination-in';
 const mask=c.createRadialGradient(170,170,148,170,170,154);
 mask.addColorStop(0,'transparent');mask.addColorStop(.25,'white');mask.addColorStop(.8,'white');mask.addColorStop(1,'transparent');
 c.fillStyle=mask;c.fillRect(0,0,340,340);c.globalCompositeOperation='source-over';
 const scale=157/151;ctx.drawImage(dualShell,170-170*scale,170-170*scale,340*scale,340*scale);
}
function drawDualTrack(ctx,mode,value,t,palette,dark,still,radius,orb,flow){
 const q=value===null?0:Math.max(0,Math.min(1,value/100)),c=dualContext,TAU=Math.PI*2,top=-Math.PI/2;
 const rgba=(rgb,a)=>'rgba('+rgb.map(Math.round).join(',')+','+a+')';
 const mix=(a,b,k)=>a.map((v,i)=>v+(b[i]-v)*k);
 const stroke=(r,w,color,start=0,end=TAU)=>{c.beginPath();c.arc(170,170,r,start,end);c.lineWidth=w;c.strokeStyle=color;c.stroke();};
 c.clearRect(0,0,340,340);c.lineCap='round';c.shadowBlur=0;
 const neutral=dark?[157,172,187]:[142,156,170];
 if(mode==='halo'){
  const track=c.createRadialGradient(170,170,132,170,170,146);
  for(const [at,a] of [[0,0],[.18,.008],[.3,.035],[.4,.12],[.5,.24],[.6,.12],[.7,.035],[.82,.008],[1,0]])track.addColorStop(at,rgba(neutral,a));
  c.fillStyle=track;c.fillRect(0,0,340,340);
  if(q>0){
   // Apply the quota mask to the coloured layer, leaving the closed neutral track.
   const lc=dualLightContext;lc.clearRect(0,0,340,340);lc.drawImage(orb.frame(t,dark,false,still,palette),0,0);
   if(flow)drawRingFlow(lc,t,139.2,2);
   if(q<1){
    const used=1-q,half=Math.min(.018,q/2,used/2)/2,mask=lc.createConicGradient(top,170,170);
    for(const [at,a] of [[0,.5],[half,0],[used-half,0],[used+half,1],[1-half,1],[1,.5]])mask.addColorStop(at,'rgba(255,255,255,'+a+')');
    lc.globalCompositeOperation='destination-in';lc.fillStyle=mask;lc.fillRect(0,0,340,340);lc.globalCompositeOperation='source-over';
   }
   c.drawImage(dualLight,0,0);
  }
  const reflection=c.createConicGradient(top+.08*Math.sin(t*.24),170,170);
  for(const [at,a] of [[0,0],[.39,0],[.44,.38],[.49,0],[.81,0],[.85,.9],[.86,1],[.87,.9],[.92,0],[1,0]])reflection.addColorStop(at,'rgba(239,250,255,'+a+')');
  stroke(139.1,1.25,reflection);
 }else{
  const width=6,breath=.5-.5*Math.cos(t*TAU/5.6);
  const track=c.createRadialGradient(170,170,135.4,170,170,142.6);
  for(const [at,a] of [[0,0],[.12,.10],[.40,.19],[.60,.19],[.88,.10],[1,0]])track.addColorStop(at,rgba(neutral,a));
  c.fillStyle=track;c.fillRect(0,0,340,340);
  if(q>0){
   const start=top+TAU*(1-q),end=top+TAU;
   const colour=c.createConicGradient(top,170,170);
   for(const [at,rgb] of [[0,mix(palette.base,palette.accent,.28)],[.2,palette.base],[.43,mix(palette.base,palette.light,.3)],[.62,mix(palette.light,palette.base,.24)],[.8,mix(palette.base,palette.accent,.45)],[1,mix(palette.base,palette.accent,.28)]])colour.addColorStop(at,rgba(rgb,.93));
   c.shadowColor=rgba(palette.light,.18+.07*breath);c.shadowBlur=5;
   stroke(139,width+1,rgba(palette.base,.15+.035*breath),start,end);c.shadowBlur=0;
   stroke(139,width,colour,start,end);
   const face=c.createConicGradient(top,170,170);
   for(const [at,a] of [[0,.10],[.12,.38],[.30,.07],[.48,.12],[.62,.48],[.77,.10],[1,.10]])face.addColorStop(at,rgba(mix(palette.light,[248,253,255],.45),a));
   stroke(137.8,.8,face,start,end);
   if(flow)drawRingFlow(c,t,140.8,1.7,start,end);
   if(q<1){
    const r=Math.min(2.1,TAU*q*139*.15);
    for(const angle of [start,end]){
     const x=170+139*Math.cos(angle),y=170+139*Math.sin(angle),pearl=c.createRadialGradient(x-r*.3,y-r*.3,0,x,y,r);
     pearl.addColorStop(0,rgba(mix(palette.light,[255,255,255],.64),.98));pearl.addColorStop(.55,rgba(palette.light,.98));pearl.addColorStop(1,rgba(mix(palette.base,palette.light,.52),.94));
     c.beginPath();c.arc(x,y,r,0,TAU);c.fillStyle=pearl;c.fill();
    }
   }
  }
 }
 // Fade between the tracks instead of cutting a hard glow edge. Their cores never overlap.
 c.globalCompositeOperation='destination-in';
 const fade=c.createRadialGradient(170,170,133.6,170,170,144.4);
 for(const [at,a] of [[0,0],[.18,1],[.82,1],[1,0]])fade.addColorStop(at,'rgba(255,255,255,'+a+')');
 c.fillStyle=fade;c.fillRect(0,0,340,340);c.globalCompositeOperation='source-over';
 const scale=radius/139;ctx.drawImage(dualLayer,170-170*scale,170-170*scale,340*scale,340*scale);
}


// Retain A/B's materials; map each quota to one mirrored 180° sector.
const splitFlow=document.createElement('canvas');splitFlow.width=splitFlow.height=340;
const splitFlowContext=splitFlow.getContext('2d');
function drawSplitShell(ctx,dark){
 const scale=151/157;ctx.save();ctx.translate(170,170);ctx.scale(scale,scale);ctx.translate(-170,-170);drawDualShell(ctx,dark);ctx.restore();
}
function drawSplitHalf(ctx,mode,value,t,palette,dark,still,left,orb){
 const q=value===null?0:Math.max(0,Math.min(1,value/100));
 ctx.save();ctx.beginPath();ctx.rect(left?0:170,0,170,340);ctx.clip();
 ctx.save();ctx.translate(170,170);ctx.scale(left?-1:1,1);ctx.rotate(Math.PI);ctx.translate(-170,-170);
 drawDualTrack(ctx,mode,q*50,t,palette,dark,still,139,orb,false);ctx.restore();
 if(q>0){
  // One shared six-second sweep stays in the remaining portion of each half.
  const c=splitFlowContext,r=mode==='halo'?139.2:140.8;
  c.clearRect(0,0,340,340);drawRingFlow(c,t,r,mode==='halo'?2:1.7);
  c.globalCompositeOperation='destination-in';c.beginPath();
  c.arc(170,170,r,Math.PI/2+(left?1:-1)*Math.PI*q,Math.PI/2,left);
  c.lineWidth=mode==='halo'?5:8;c.lineCap='round';c.strokeStyle='white';c.stroke();c.globalCompositeOperation='source-over';
  ctx.drawImage(splitFlow,0,0);
 }
 ctx.restore();
}


function stageAngles(group,left,mode){
 const gap=mode==='halo'?3.8:5.2,sign=left?1:-1,deg=Math.PI/180;
 return [Math.PI/2+sign*(group*36+(group===0?6:gap/2))*deg,Math.PI/2+sign*((group+1)*36-(group===4?6:gap/2))*deg];
}
function drawStageHalf(ctx,mode,value,t,palette,dark,still,left){
 const stages=quotaStages(value),s=still?0:t,rgba=(rgb,a)=>'rgba('+rgb.map(Math.round).join(',')+','+a+')';
 ctx.save();ctx.globalAlpha=.42;drawSplitHalf(ctx,mode,0,s,palette,dark,true,left,null);ctx.restore();
 ctx.save();ctx.beginPath();ctx.rect(left?0:170,0,170,340);ctx.clip();ctx.lineCap='round';
 const width=mode==='halo'?3.2:6;
 const stroke=(radius,w,color,start,end)=>{ctx.beginPath();ctx.arc(170,170,radius,start,end,!left);ctx.lineWidth=w;ctx.strokeStyle=color;ctx.stroke();};
 for(let group=0;group<5;group++){
  const [start,end]=stageAngles(group,left,mode),fraction=stages?.[group]||0;
  stroke(139,width,dark?'rgba(159,179,198,.20)':'rgba(127,150,170,.22)',start,end);
  if(!fraction)continue;
  const finish=start+(end-start)*fraction,breath=.5-.5*Math.cos(s*Math.PI*2/5.6-group*.18);
  const colour=ctx.createLinearGradient(170+139*Math.cos(start),170+139*Math.sin(start),170+139*Math.cos(end),170+139*Math.sin(end));
  colour.addColorStop(0,rgba(palette.base,.93));colour.addColorStop(.5,rgba(palette.base.map((v,i)=>v+(palette.light[i]-v)*(.16+.1*breath)),.96));colour.addColorStop(1,rgba(palette.base,.93));
  ctx.shadowColor=rgba(palette.light,.12+.035*breath);ctx.shadowBlur=2.5;
  stroke(139,width,colour,start,finish);ctx.shadowBlur=0;
  stroke(138.3,mode==='halo'?.55:.8,rgba(palette.light,.25+.11*breath),start,finish);
  drawRingFlow(ctx,s,139.4,mode==='halo'?.7:1.1,Math.min(start,finish),Math.max(start,finish));
 }
 ctx.restore();
}
function drawStageDividers(ctx,dark){
 ctx.save();
 for(const y of [31,309]){
  const shine=ctx.createRadialGradient(169.4,y-.7,0,170,y,2.5);
  shine.addColorStop(0,dark?'#f4fbff':'#ffffff');shine.addColorStop(1,dark?'#9eb5c8':'#8fa7bb');
  ctx.beginPath();ctx.arc(170,y,2.5,0,Math.PI*2);ctx.fillStyle=shine;ctx.fill();
  ctx.lineWidth=1;ctx.strokeStyle=dark?'rgba(18,27,37,.8)':'rgba(255,255,255,.9)';ctx.stroke();
 }
 ctx.restore();
}

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    canvas.className = 'quota-effects'; canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'absolute', pointerEvents: 'none', zIndex: '3', transform: 'none', filter: 'none' });
    const ctx = canvas.getContext('2d');
    const sample = document.createElement('canvas'); sample.width = sample.height = SIZE;
    const sampleContext = sample.getContext('2d', { willReadFrequently: true });
    const wet = document.createElement('canvas'); wet.width = wet.height = SIZE;
    const wetContext = wet.getContext('2d');
    const eyes = document.createElement('canvas'); eyes.width = eyes.height = SIZE;
    const eyeContext = eyes.getContext('2d');
    let current = model(), options = {}, frame = 0, sampleRetry = 0, sampleAttempts = 0, previousFrame = -Infinity, orb = null;
    let pool = null, rawCanvas = null, rawOpacity = '', scaled = [];
    let geometry = { x: 0, y: 0, width: 0 }, destroyed = false;
    const motionPreference = root.matchMedia?.('(prefers-reduced-motion: reduce)');
    const originalScale = element => scaled.find(item => item.element === element)?.scale ?? element.style.scale;
    function restoreScale() {
      for (const item of scaled) item.element.style.scale = item.scale;
      scaled = [];
    }
    function restorePool() {
      if (rawCanvas) rawCanvas.style.opacity = rawOpacity;
      rawCanvas = null;
      if (pool) {
        for (const item of pool.targets) {
          if (item.mask === null) item.element.removeAttribute('mask');
          else item.element.setAttribute('mask', item.mask);
        }
        for (const element of pool.added) element.remove();
        pool = null;
      }
    }
    function attach() { if (canvas.parentNode !== host) host.appendChild(canvas); }
    function positionRing() {
      restoreScale();
      const bounds = host.getBoundingClientRect(), svg = host.querySelector(':scope > svg');
      const head = svg?.querySelector('.eb-head');
      let cx = bounds.width / 2, cy = bounds.height / 2, radius = Math.min(bounds.width, bounds.height) * .4;
      if (head?.getTotalLength && head.getScreenCTM) {
        const matrix = head.getScreenCTM(), points = [], length = head.getTotalLength();
        if (matrix && length > 0) {
          for (let i = 0; i < 96; i++) {
            const point = head.getPointAtLength(length * i / 96);
            points.push({ x: point.x * matrix.a + point.y * matrix.c + matrix.e - bounds.left,
              y: point.x * matrix.b + point.y * matrix.d + matrix.f - bounds.top });
          }
          cx = (Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2;
          cy = (Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) / 2;
          radius = Math.max(...points.map(p => Math.hypot(p.x - cx, p.y - cy)));
        }
      }
      const outer = current.style === 'duo' ? 163 : current.material === 'glass' ? 158 : current.style === 'ring' ? 168 : 153;
      const room = Math.max(0, Math.min(cx, cy, bounds.width - cx, bounds.height - cy) * .97);
      const factor = radius > 0 ? Math.min(1, room * 125 / (outer * radius)) : 1;
      if (factor < 1) {
        for (const element of [svg, host.querySelector(':scope > .eb-rive-aurora')].filter(Boolean)) {
          scaled.push({ element, scale: originalScale(element) });
          element.style.scale = String(factor);
        }
        cx = bounds.width / 2 + (cx - bounds.width / 2) * factor;
        cy = bounds.height / 2 + (cy - bounds.height / 2) * factor;
      }
      const width = radius * factor * SIZE / 125;
      geometry = { x: cx - width / 2, y: cy - width / 2, width };
      Object.assign(canvas.style, { left: geometry.x + 'px', top: geometry.y + 'px', width: width + 'px', height: width + 'px' });
      canvas.dataset.bodyScale = String(factor);
    }
    const svgElement = (name, attrs) => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', name);
      for (const [key, value] of Object.entries(attrs || {})) element.setAttribute(key, value);
      return element;
    };
    function setupSvgPool(svg) {
      const head = svg.querySelector('.eb-head'), material = head?.parentNode;
      if (!head || !material || !svg.querySelector('defs')) return;
      const id = 'qiuqiu-pool-' + ++serial;
      const mask = svgElement('mask', { id, maskUnits: 'userSpaceOnUse', x: -100, y: -100, width: 500, height: 500, 'mask-type': 'alpha' });
      const water = svgElement('path', { fill: '#fff' }); mask.appendChild(water);
      const clip = svgElement('clipPath', { id: id + '-shape' });
      const outline = svgElement('path'); clip.appendChild(outline);
      const reflection = svgElement('linearGradient', { id: id + '-light', x1: '0%', x2: '100%' });
      for (const [offset, opacity] of [[0,0],[.3,.85],[.65,.35],[1,0]]) reflection.appendChild(svgElement('stop', { offset, 'stop-color': '#fff', 'stop-opacity': opacity }));
      const rim = svgElement('linearGradient', { id: id + '-rim', x1: '0%', y1: '0%', x2: '100%', y2: '100%' });
      for (const [offset, opacity] of [[0,.16],[.45,.025],[1,.06]]) rim.appendChild(svgElement('stop', { offset, 'stop-color': '#91a4b3', 'stop-opacity': opacity }));
      const defs = svg.querySelector('defs'); for (const element of [mask,clip,reflection,rim]) defs.appendChild(element);
      const targets = [...material.children].filter(element => !element.matches('.eb-eye') && !element.querySelector('.eb-eye'))
        .map(element => ({ element, mask: element.getAttribute('mask') }));
      for (const target of targets) target.element.setAttribute('mask', 'url(#' + id + ')');
      const shell = svgElement('path', { fill: head.getAttribute('fill') || 'none', opacity: '.075', 'pointer-events': 'none' });
      const bevel = svgElement('path', { fill: 'none', stroke: 'url(#' + id + '-rim)', 'stroke-width': '1.7', 'pointer-events': 'none' });
      const surface = svgElement('g', { 'clip-path': 'url(#' + id + '-shape)', 'pointer-events': 'none' });
      const shadow = svgElement('path', { fill: 'none', stroke: current.dark ? '#15263b' : '#71899b', 'stroke-opacity': '.12', 'stroke-width': '2.2' });
      const light = svgElement('path', { fill: 'none', stroke: 'url(#' + id + '-light)', 'stroke-width': '.8' });
      surface.appendChild(shadow); surface.appendChild(light);
      material.insertBefore(shell, head); material.insertBefore(bevel, head);
      const face = [...material.children].find(element => element.matches('.eb-eye') || element.querySelector('.eb-eye'));
      material.insertBefore(surface, face || null);
      pool = { svg, head, water, outline, shell, bevel, surface, shadow, light, targets,
        added: [mask,clip,reflection,rim,shell,bevel,surface], path: null, rows: [] };
    }
    function svgWaterline(q) {
      const path = pool.head.getAttribute('d');
      if (path !== pool.path) {
        pool.path = path;
        for (const element of [pool.outline,pool.shell,pool.bevel]) element.setAttribute('d', path);
        pool.shell.setAttribute('fill', pool.head.getAttribute('fill') || 'none');
        const box = pool.head.getBBox(), length = pool.head.getTotalLength(), points = [];
        for (let i = 0; i < 128; i++) points.push(pool.head.getPointAtLength(length * i / 128));
        const rows = []; let total = 0;
        for (let y = box.y; y < box.y + box.height; y += 1) {
          const xs = [];
          for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y));
          }
          xs.sort((a,b) => a-b); let width = 0;
          for (let i = 0; i + 1 < xs.length; i += 2) width += xs[i + 1] - xs[i];
          rows.push({ y, width }); total += width;
        }
        pool.box = box; pool.rows = rows; pool.total = total;
      }
      if (q <= 0) return pool.box.y + pool.box.height + 2;
      if (q >= 1) return pool.box.y - 2;
      let sum = 0, target = pool.total * q;
      for (let i = pool.rows.length - 1; i >= 0; i--) {
        const row = pool.rows[i];
        if (sum + row.width >= target) return row.y + 1 - (target - sum) / Math.max(row.width, .001);
        sum += row.width;
      }
      return pool.box.y;
    }
    function wave(x, y, q, t, amplitude, center, radius) {
      return y + Math.min(1,q*14,(1-q)*14) * amplitude *
        (Math.sin((x-center)*3.25/radius-t*.9) + .32*Math.sin((x-center)*5.625/radius+t*.63));
    }
    function drawSvgPool(q, t) {
      const svg = host.querySelector(':scope > svg');
      if (pool?.svg !== svg) { restorePool(); if (svg) setupSvgPool(svg); }
      if (!pool) return;
      const y = svgWaterline(q), box = pool.box, center = box.x + box.width/2, radius = Math.max(1,box.width/2), amplitude = radius*(current.still?.044:.1024);
      let path = '';
      for (let x = box.x-3; x <= box.x+box.width+3; x += 1.5) path += (path?'L':'M') + x.toFixed(2) + ' ' + wave(x,y,q,t,amplitude,center,radius).toFixed(2);
      pool.water.setAttribute('d',path+'L500 500L-100 500Z');
      pool.shadow.setAttribute('d',path); pool.shadow.setAttribute('transform','translate(0 1.1)');
      pool.light.setAttribute('d',path); pool.surface.style.display = q>0&&q<1?'':'none';
      pool.shell.style.display = q<1?'':'none'; pool.bevel.style.display = q<1?'':'none';
      canvas.dataset.liquidY = String(y); canvas.dataset.liquidSurfaces = '1';
    }
    function canvasWave(context, y, q, t, amplitude) {
      context.beginPath();
      for (let x=0;x<=SIZE;x+=2) {
        const py = wave(x,y,q,t,amplitude,CENTER,125);
        if (x) context.lineTo(x,py); else context.moveTo(x,py);
      }
    }
    function drawRivePool(source, q, t) {
      if (rawCanvas !== source) {
        restorePool(); rawCanvas=source; rawOpacity=source.style.opacity;
      }
      const bounds=host.getBoundingClientRect(), scale=SIZE/Math.max(1,bounds.width);
      const style=root.getComputedStyle(source), width=source.clientWidth, height=source.clientHeight;
      const origin=style.transformOrigin.split(' ').map(parseFloat);
      sampleContext.clearRect(0,0,SIZE,SIZE); sampleContext.save(); sampleContext.scale(scale,scale);
      sampleContext.translate(source.offsetLeft+origin[0],source.offsetTop+origin[1]);
      if(style.transform!=='none'){
        const transform=new root.DOMMatrix(style.transform);
        sampleContext.transform(transform.a,transform.b,transform.c,transform.d,transform.e,transform.f);
      }
      sampleContext.drawImage(source,-origin[0],-origin[1],width,height); sampleContext.restore();
      const image=sampleContext.getImageData(0,0,SIZE,SIZE), eyePixels=eyeContext.createImageData(SIZE,SIZE), rows=new Float64Array(SIZE);
      let total=0;
      // Match the native Rive eye filter: only almost-white pixels are eye ink.
      // ponytail: Rive does not expose eye layers; use its existing white-ink threshold.
      for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
        const i=(y*SIZE+x)*4, alpha=image.data[i+3]; rows[y]+=alpha; total+=alpha;
        if(y<SIZE*.8&&16*(image.data[i]+image.data[i+1]+image.data[i+2])/255-47>0){
          for(let component=0;component<4;component++)eyePixels.data[i+component]=image.data[i+component];
        }
      }
      if(total===0)return false;
      source.style.opacity='0';
      eyeContext.putImageData(eyePixels,0,0);
      let y=SIZE, sum=0, target=total*q;
      if(q>=1)y=0;
      else if(q>0)for(let row=SIZE-1;row>=0;row--){if(sum+rows[row]>=target){y=row+1-(target-sum)/Math.max(rows[row],.001);break;}sum+=rows[row];}
      ctx.clearRect(0,0,SIZE,SIZE); ctx.save(); ctx.globalAlpha=.08;ctx.drawImage(sample,0,0);ctx.restore();
      if(q>0){
        wetContext.clearRect(0,0,SIZE,SIZE);wetContext.save();canvasWave(wetContext,y,q,t,current.still?5.5:12.8);
        wetContext.lineTo(SIZE,SIZE);wetContext.lineTo(0,SIZE);wetContext.closePath();wetContext.clip();wetContext.drawImage(sample,0,0);wetContext.restore();ctx.drawImage(wet,0,0);
      }
      if(q>0&&q<1){
        wetContext.clearRect(0,0,SIZE,SIZE);canvasWave(wetContext,y+1.4,q,t,current.still?5.5:12.8);
        wetContext.lineWidth=3;wetContext.strokeStyle=current.dark?'rgba(13,26,48,.22)':'rgba(91,115,133,.12)';wetContext.stroke();
        const light=wetContext.createLinearGradient(40,0,300,0);
        for(const [at,alpha] of [[0,0],[.3,.85],[.65,.35],[1,0]])light.addColorStop(at,'rgba(255,255,255,'+alpha+')');
        canvasWave(wetContext,y-.4,q,t,current.still?5.5:12.8);wetContext.lineWidth=1.1;wetContext.strokeStyle=light;wetContext.stroke();
        wetContext.globalCompositeOperation='destination-in';wetContext.drawImage(sample,0,0);wetContext.globalCompositeOperation='source-over';ctx.drawImage(wet,0,0);
      }
      ctx.drawImage(eyes,0,0);
      Object.assign(canvas.style,{left:'0px',top:'0px',width:bounds.width+'px',height:bounds.width+'px',filter:source.style.filter||'none',opacity:rawOpacity||'1'});
      canvas.dataset.liquidY=String(y);canvas.dataset.liquidSurfaces='1';
      return true;
    }
    function drawRing(t) {
      const mode=current.material==='glass'?'reference':'halo',values=current.values,dark=current.dark,still=current.still;
      if(!orb&&mode==='halo')try{orb=createColorRing(SIZE);}catch(_){/* Canvas-only fallback keeps quota readable. */}
      const usableMode=mode==='halo'&&!orb?'reference':mode;
      if(current.style==='ring'){
        if(usableMode==='reference')drawReferenceRing(ctx,(values[current.period]||0)/100,t,current.palette,dark,still);
        else{
          const q=(values[current.period]||0)/100,neutral=dark?'157,172,187':'142,156,170';
          const track=ctx.createRadialGradient(CENTER,CENTER,132,CENTER,CENTER,146);
          for(const [at,alpha] of [[0,0],[.18,.008],[.3,.035],[.4,.12],[.5,.24],[.6,.12],[.7,.035],[.82,.008],[1,0]])track.addColorStop(at,'rgba('+neutral+','+alpha+')');
          ctx.fillStyle=track;ctx.beginPath();ctx.arc(CENTER,CENTER,146,0,TAU);ctx.fill();
          if(q>0){
            wetContext.clearRect(0,0,SIZE,SIZE);wetContext.drawImage(orb.frame(t,dark,false,still,current.palette),0,0);
            drawRingFlow(wetContext,t,139.2,2);
            if(q<1){
              const used=1-q,half=Math.min(.018,q/2,used/2)/2,mask=wetContext.createConicGradient(-Math.PI/2,CENTER,CENTER);
              for(const [at,alpha] of [[0,.5],[half,0],[used-half,0],[used+half,1],[1-half,1],[1,.5]])mask.addColorStop(at,'rgba(255,255,255,'+alpha+')');
              wetContext.globalCompositeOperation='destination-in';wetContext.fillStyle=mask;wetContext.fillRect(0,0,SIZE,SIZE);wetContext.globalCompositeOperation='source-over';
            }
            ctx.drawImage(wet,0,0);
          }
          const reflection=ctx.createConicGradient(-Math.PI/2+.08*Math.sin(t*.24),CENTER,CENTER);
          for(const [at,alpha] of [[0,0],[.39,0],[.44,.38],[.49,0],[.81,0],[.85,.9],[.86,1],[.87,.9],[.92,0],[1,0]])reflection.addColorStop(at,'rgba(239,250,255,'+alpha+')');
          ctx.beginPath();ctx.arc(CENTER,CENTER,139.1,0,TAU);ctx.lineWidth=1.25;ctx.strokeStyle=reflection;ctx.stroke();
        }
      }else{
        if(usableMode==='reference')current.style==='duo'?drawDualShell(ctx,dark):drawSplitShell(ctx,dark);
        const colors=dualPalettes(current.palette);
        ['fiveHour','weekly'].forEach((period,i)=>{
          if(current.style==='duo')drawDualTrack(ctx,usableMode,values[period],t,colors[i],dark,still,i===0?134:146,orb,i===0);
          else if(current.style==='split')drawSplitHalf(ctx,usableMode,values[period],t,colors[i],dark,still,i===0,orb);
          else drawStageHalf(ctx,usableMode,values[period],t,colors[i],dark,still,i===0);
        });
        if(current.style==='stages')drawStageDividers(ctx,dark);
      }
    }
    function paint(seconds) {
      if(destroyed||!current.visible||current.style==='card'||!current.available)return;
      attach();
      if(current.style==='pool'){
        const value=current.values[current.period];
        if(value===null){ctx.clearRect(0,0,SIZE,SIZE);restorePool();return;}
        const source=host.querySelector(':scope > canvas.eb-rive-aurora.ready');
        if(source){
          if(!drawRivePool(source,value/100,seconds)&&current.still&&sampleAttempts++<60&&!sampleRetry){
            sampleRetry=root.requestAnimationFrame(()=>{sampleRetry=0;paint(seconds);});
          }
        }else{ctx.clearRect(0,0,SIZE,SIZE);drawSvgPool(value/100,seconds);}
      }else{ctx.clearRect(0,0,SIZE,SIZE);drawRing(seconds);}
    }
    function tick(time) {
      frame=0;
      if(destroyed||!current.visible||current.still||document.hidden)return;
      if(time-previousFrame>=1000/30){previousFrame=time;paint(time/1000);}
      frame=root.requestAnimationFrame(tick);
    }
    function update(input={}) {
      if (destroyed) return;
      options=input;current=model(input);current.still ||= Boolean(motionPreference?.matches);
      root.cancelAnimationFrame(frame);root.cancelAnimationFrame(sampleRetry);frame=sampleRetry=sampleAttempts=0;restorePool();restoreScale();
      Object.assign(canvas.style,{display:'',filter:'none',opacity:'1'});
      for(const key of ['liquidY','liquidSurfaces','bodyScale'])delete canvas.dataset[key];
      canvas.dataset.style=current.style;canvas.dataset.material=current.material;canvas.dataset.quotaAvailable=String(current.available);
      for(const period of ['fiveHour','weekly'])canvas.dataset[period]=current.values[period]===null?'unknown':String(current.values[period]);
      if(!current.visible||current.style==='card'||!current.available){canvas.remove();return;}
      attach();
      if(current.style!=='pool')positionRing();
      else{const bounds=host.getBoundingClientRect();Object.assign(canvas.style,{left:'0px',top:'0px',width:bounds.width+'px',height:bounds.height+'px'});}
      paint(current.still?0:root.performance.now()/1000);
      if(!current.still&&!document.hidden)frame=root.requestAnimationFrame(tick);
    }
    const refresh=()=>update(options);
    root.addEventListener('resize',refresh);document.addEventListener('visibilitychange',refresh);
    motionPreference?.addEventListener('change',refresh);
    const resizeObserver=typeof root.ResizeObserver==='function'?new root.ResizeObserver(refresh):null;
    resizeObserver?.observe(host);
    const nativeObserver=typeof root.MutationObserver==='function'?new root.MutationObserver(records=>{
      if(records.some(record=>record.type==='attributes'
        ?record.target.matches?.('.eb-rive-aurora')
        :record.target===host&&[...record.addedNodes].some(element=>element!==canvas&&element.matches?.('svg,.eb-rive-aurora'))))refresh();
    }):null;
    nativeObserver?.observe(host,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    function destroy(){
      destroyed=true;root.cancelAnimationFrame(frame);root.cancelAnimationFrame(sampleRetry);restorePool();restoreScale();canvas.remove();orb?.destroy();resizeObserver?.disconnect();nativeObserver?.disconnect();
      root.removeEventListener('resize',refresh);document.removeEventListener('visibilitychange',refresh);motionPreference?.removeEventListener('change',refresh);
    }
    return Object.freeze({update,destroy,canvas});
  }
  return Object.freeze({create,model,palette,dualPalettes,quotaStages});
}));
