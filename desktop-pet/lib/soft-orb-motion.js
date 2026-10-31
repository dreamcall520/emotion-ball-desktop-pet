globalThis.MGMotion=(()=>{
const duration=38;
const ease=x=>{x=Math.max(0,Math.min(1,x));return x*x*x*(x*(x*6-15)+10);};
const ramp=(t,a,b)=>ease((t-a)/(b-a));
function at(t){
t=((t%duration)+duration)%duration;
const p={yaw:0,pitch:0,roll:0,squash:0,lift:0,eyelid:1,smile:0,wink:0,lookX:0,lookY:0,volume:1,bodyFill:1,eyeReveal:1,outlineProgress:0,outlineAlpha:0,fan:0,modelScale:1,shiftX:0,flatness:0,roundness:0,blue:0,eyeTint:0,shadowAlpha:1,from:'base',to:'base',transition:0,signal:0,scan:0,scanY:0,orbit:0,ufo:0,portal:0,portalProgress:0,cosmic:0,complete:0,completeProgress:0,love:0,loveBeat:0,dream:0,shock:0,flight:0,flightProgress:0,ship:0,shipBeam:0,shipDepart:0};
if(t<3){const e=ramp(t,.25,.7)*(1-ramp(t,2,2.7));p.lookX=.075*e;p.lookY=.025*e;p.yaw=.10*e;p.roll=-.035*e;p.signal=.7*e;}
if(t>=3&&t<6){const x=t-3,e=ramp(x,.2,.48)*(1-ramp(x,1.65,2.6));p.squash=0;p.smile=.95*e;p.eyelid=1;p.roll=0;p.lift=0;p.orbit=0;p.signal=.25*e;}
if(t>=6&&t<9){const x=t-6,e=ramp(x,.2,.65)*(1-ramp(x,1.6,2.8));p.lift=.25*e;p.shiftX=.11*Math.sin(x*4)*e;p.roll=.045*Math.sin(x*4+.4)*e;p.yaw=.13*Math.sin(x*4)*e;p.orbit=.65*e;p.squash=0;}
if(t>=9&&t<12){const x=t-9,e=ramp(x,.2,.55)*(1-ramp(x,2.3,2.85));p.scan=e;p.scanY=.65-1.3*ramp(x,.4,2.5);p.lookY=-.055*Math.sin(x*2)*e;p.pitch=.035*e;}
if(t>=12&&t<15){const x=t-12,e=ramp(x,.2,.8)*(1-ramp(x,1.9,2.85));p.ufo=.9*e;p.lift=.16*e;p.lookY=-.06*e;p.eyelid=1-.15*e;}
if(t>=15&&t<18){const x=t-15,s=ramp(x,.15,.85)*(1-ramp(x,1.6,2.65));p.lift=-.035*s;p.eyelid=1-.94*s;p.portal=.8*ramp(x,1.55,1.8)*(1-ramp(x,2.35,2.85));p.portalProgress=ramp(x,1.55,2.85);p.dream=ramp(x,.65,.95)*(1-ramp(x,1.5,1.8));}

if(t>=18&&t<22){const x=t-18,e=ramp(x,.3,.65)*(1-ramp(x,2.5,3.5));p.shock=e;p.shiftX=.018*Math.sin(x*43)*e;p.roll=.018*Math.sin(x*37)*e;p.lookY=.035*e;}
if(t>=22&&t<26){const x=t-22,a=ramp(x,.45,3.65);p.flight=ramp(x,.15,.5)*(1-ramp(x,3.5,3.95));p.flightProgress=a;p.shiftX=3.*Math.sin(a*Math.PI);p.lift=.75*Math.sin(a*Math.PI);p.roll=-.10*Math.sin(a*6.28318);p.lookX=.06*p.flight;}
if(t>=26&&t<30){
 const x=t-26,collect=ramp(x,.75,1.9),restore=ramp(x,3.15,3.95);
 p.ship=ramp(x,.1,.6)*(1-ramp(x,2.4,2.9));p.shipBeam=ramp(x,.55,.8)*(1-ramp(x,1.95,2.25));
 p.shipDepart=ramp(x,2.1,2.85);p.modelScale=1-.94*collect*(1-restore);p.lift=1.065*collect*(1-restore);
 p.bodyFill=(1-ramp(x,1.85,2.05))+ramp(x,3.2,3.55);p.eyeReveal=p.bodyFill;p.shadowAlpha=1-collect*(1-restore);p.lookY=.07*p.shipBeam;
 p.portal=ramp(x,3.05,3.25)*(1-ramp(x,3.65,3.98));p.portalProgress=restore;
}

if(t>=30&&t<34){const x=t-30,e=ramp(x,.5,1.05)*(1-ramp(x,3.1,3.85));p.love=e;const phase=((x-1.05)%1.2+1.2)%1.2;p.loveBeat=e*(Math.exp(-Math.pow((phase-.10)/.08,2))*.65+Math.exp(-Math.pow((phase-.32)/.1,2))*.40);p.lookX=.035*ramp(x,.1,.4)*(1-ramp(x,.5,.9));p.lift=.055*e;p.roll=-.025*e;}
if(t>=34){
 const x=t-34,e=ramp(x,.45,.85)*(1-ramp(x,3.0,3.85));
 p.complete=ramp(x,.65,.9)*(1-ramp(x,2.7,3.6));p.completeProgress=ramp(x,.7,3.35);
 p.smile=.98*e;p.lift=.18*ramp(x,.45,1.05)*(1-ramp(x,1.6,2.7));p.roll=.035*Math.sin(x*2.8)*e;
 p.eyelid=1-.65*ramp(x,.08,.29)*(1-ramp(x,.34,.56));
}
return p;
}return Object.freeze({duration,at});})();
