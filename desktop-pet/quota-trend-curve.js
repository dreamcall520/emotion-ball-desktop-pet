/* Shape-preserving drawing between observations; no new history samples. */
(function(root){
  function curves(points){
    if(points.length<2)return [];
    const h=points.slice(1).map((p,i)=>p[0]-points[i][0]);
    const d=h.map((dx,i)=>(points[i+1][1]-points[i][1])/dx);
    const m=[d[0]];
    for(let i=1;i<points.length-1;i++){
      const a=d[i-1],b=d[i],w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];
      m[i]=a*b<=0?0:(w1+w2)/(w1/a+w2/b);
    }
    m.push(d.at(-1));
    for(let i=0;i<d.length;i++){
      if(d[i]===0){m[i]=m[i+1]=0;continue;}
      const a=m[i]/d[i],b=m[i+1]/d[i],length=Math.hypot(a,b);
      if(length>3){m[i]=3*a*d[i]/length;m[i+1]=3*b*d[i]/length;}
    }
    return h.map((dx,i)=>[points[i],[points[i][0]+dx/3,points[i][1]+m[i]*dx/3],
      [points[i+1][0]-dx/3,points[i+1][1]-m[i+1]*dx/3],points[i+1]]);
  }
  const pair=p=>p.map(v=>Number(v.toFixed(5))).join(' ');
  const path=points=>points.length?'M'+pair(points[0])+curves(points).map(c=>'C'+c.slice(1).map(pair).join(' ')).join(''):'';
  const api={curves,path};
  if(typeof module!=='undefined')module.exports=api;else root.TrendCurve=api;
})(typeof window==='undefined'?this:window);
