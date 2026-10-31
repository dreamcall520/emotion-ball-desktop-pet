(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EdgePeek=api;
})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  // Canvas translation fractions calibrated against the approved body reveals.
  // Artwork, body scale and the native window bounds stay unchanged.
  const SPECS=Object.freeze({
    blob:Object.freeze({tucked:.5,peeked:.0864,delayMs:900}),
    'new-year-sheep':Object.freeze({tucked:.5275,peeked:.1466,delayMs:900}),
    'soft-orb':Object.freeze({tucked:.58015625,peeked:.1861,delayMs:900})
  });
  const BODY=Object.freeze({blob:[.06,.06,.94,.94],'new-year-sheep':[40/320,.08,270/320,.96],'soft-orb':[85/512,95/512,427/512,417/512]});
  function specFor(shape){return SPECS[shape]||null;}
  function edgeOffset(shape,presentation,width){const spec=specFor(shape);return spec&&['left','right'].includes(presentation?.side)&&['tucked','peeked'].includes(presentation?.mode)?(presentation.side==='left'?-1:1)*spec[presentation.mode]*width:0;}
  function translatedBounds(bounds,shape,presentation,painted=bounds){
    if(!specFor(shape)||!['left','right'].includes(presentation?.side)||!['tucked','peeked'].includes(presentation?.mode))return painted;
    const offset=edgeOffset(shape,presentation,bounds.width),x=Math.max(bounds.x,painted.x+offset),right=Math.min(bounds.x+bounds.width,painted.x+painted.width+offset);
    // Companion windows use integer native pixels. Round the painted envelope
    // outward so along-row avoidance cannot oscillate on a subpixel gap.
    const leftPixel=Math.max(bounds.x,Math.floor(x)),rightPixel=Math.min(bounds.x+bounds.width,Math.ceil(right));
    return {...painted,x:leftPixel,width:Math.max(0,rightPixel-leftPixel)};
  }
  function containsVisibleBody(shape,{bounds,side,mode,point}){
    if(!specFor(shape)||!['tucked','peeked'].includes(mode)||!['left','right'].includes(side))return null;
    if(!bounds||!point||![bounds.x,bounds.y,bounds.width,bounds.height,point.x,point.y].every(Number.isFinite)||bounds.width<=0||bounds.height<=0)return false;
    if(point.x<bounds.x||point.x>=bounds.x+bounds.width||point.y<bounds.y||point.y>=bounds.y+bounds.height)return false;
    // Match the stationary rounded join mask; transparent trimmed corners
    // must not wake the pet. Mirroring changes only the horizontal coordinate.
    if(shape==='blob'&&mode==='tucked'){
      const x=side==='left'?(point.x-bounds.x)/bounds.width:1-(point.x-bounds.x)/bounds.width;
      const y=(point.y-bounds.y)/bounds.height;
      let top=.0985;
      if(x<.18){let lo=0,hi=1;for(let i=0;i<20;i++){const t=(lo+hi)/2,px=.24*t*t*(1-t)+.18*t*t*t;if(px<x)lo=t;else hi=t;}const t=(lo+hi)/2,u=1-t;top=.18*u*u*u+3*.06*u*u*t+3*.0537*u*t*t+.0985*t*t*t;}
      if(y<top||y>1-top)return false;
    }
    const [x0,y0,x1,y1]=BODY[shape];
    const hit=state=>{const offset=edgeOffset(shape,{side,mode:state},bounds.width),cx=bounds.x+bounds.width*(x0+x1)/2+offset,cy=bounds.y+bounds.height*(y0+y1)/2;
      return ((point.x-cx)/(bounds.width*(x1-x0)/2))**2+((point.y-cy)/(bounds.height*(y1-y0)/2))**2<=1;};
    // Retain the already visible cap while the peek transition is travelling.
    return hit(mode)||(mode==='peeked'&&hit('tucked'));
  }
  return Object.freeze({specFor,edgeOffset,translatedBounds,containsVisibleBody});
});
