/* 同一实体的轮廓、侧面、眼睛和光照一起旋转；不是静态图变形。 */
function createSoftOrbRenderer(canvas, assets) {
  let disposed=false, pending=4;
  let finish;const ready=new Promise(resolve=>{finish=resolve;});let failed=false;
  function loaded(ok){if(disposed)return;failed||=!ok;if(--pending===0)finish(!failed);}
  const gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:true,preserveDrawingBuffer:true});
  if(!gl)throw new Error('当前设备不支持 WebGL2，无法显示本次立体候选。');
  const vertex=`#version 300 es
  in vec2 position;
  void main(){gl_Position=vec4(position,0.,1.);}`;
  const fragment=`#version 300 es
  precision highp float;
  uniform vec2 resolution;
  uniform vec3 primary,secondary,eyes,primary2,secondary2,eyes2,affection,affectionLight,effectColor,effectLight;
  uniform float yaw,pitch,roll,squash,lift,eyelid,smile,wink,lookX,lookY,time,dark;
  uniform int material,material2;
  uniform float transition,quotaFaceOnly,quotaBodyOnly;
  uniform float signal,scan,scanY,orbit,ufo,portal,portalProgress,cosmic,complete,completeProgress,love,loveBeat,dream,shock,flight,flightProgress,ship,shipBeam,shipDepart;
  uniform float volume,bodyFill,eyeReveal,outlineProgress,outlineAlpha,fan,modelScale,shiftX,flatness,roundness,shadowAlpha;
  uniform sampler2D shapeTexture,materialTexture,plushTexture,shipTexture;
  uniform vec4 plushUV;
  uniform int plushReady,shipReady;
  uniform int materialReady;
  out vec4 fragColor;
  float coverage;
  vec4 quotaFace;
  vec3 over(vec3 base,vec3 ink,float alpha){alpha=clamp(alpha,0.,1.);coverage=alpha+coverage*(1.-alpha);return mix(base,ink,alpha);}
  mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
  vec3 local(vec3 p,int layer){
    p.x-=shiftX;p.y-=lift;p/=modelScale;
    if(layer==0&&transition>0.){
      float peel=transition;
      p.x+=peel*.65;p.z-=sin(peel*3.14159265)*.30;
      p.xz=rot(-peel*1.5707963)*p.xz;
    }
    if(layer==1){p.x-=(1.-transition)*.12;p.y-=(1.-transition)*.06;p.z+=(1.-transition)*.15;}
    if(layer>=2){float k=float(layer-1);float spread=fan>.0001?fan:.45;p.xy-=vec2(.15,.085)*k*spread;p.z+=.11*k;p.xy=rot(.025*k*fan)*p.xy;p.xz=rot(-.055*k*fan)*p.xz;}
    p.xy=rot(roll)*p.xy;
    p.xz=rot(yaw)*p.xz;
    p.yz=rot(pitch)*p.yz;
    p.xy/=vec2((1.+squash*.19)*(1.+flatness*.08),(1.-squash*.24)*(1.-flatness*.82));
    return p;
  }
  float contour(vec2 xy){
    vec2 bounded=clamp(xy,vec2(-1.199),vec2(1.199));
    vec2 encoded=texture(shapeTexture,bounded/2.4+.5).rg;
    float sdf=((encoded.r*255.*256.+encoded.g*255.)/65535.-.5)*2.4;
    sdf+=length(xy-bounded);
    return mix(sdf,length(xy)-.55,roundness);
  }
  float body(vec3 p,int layer){
    p=local(p,layer);
    float sdf=contour(p.xy);
    int skin=layer==1?material2:material;
    float v=layer>=2?0.:volume;
    if(layer==0&&transition>0.)v*=1.-transition;
    float depth=mix(.012,.045+.12*smoothstep(0.,.6,-sdf),v);
    float bevel=mix(.008,.08,v);
    vec2 d=vec2(sdf+bevel,abs(p.z)-depth);
    float solid=min(max(d.x,d.y),0.)+length(max(d,0.))-bevel;
    return solid*.7*modelScale*(1.-flatness*.82);
  }
  float scene(vec3 p){
    float d=transition>.999?body(p,1):body(p,0);
    if(transition>0.&&transition<.999)d=min(d,body(p,1));
    if(fan>.0001){for(int i=2;i<6;i++)d=min(d,body(p,i));}
    return d;
  }
  int hitLayer(vec3 p){
    if(transition>.999)return 1;
    int layer=0;float nearest=body(p,0);
    if(transition>0.&&body(p,1)<nearest){nearest=body(p,1);layer=1;}
    if(fan>.0001){for(int i=2;i<6;i++){float distance=body(p,i);if(distance<nearest){nearest=distance;layer=i;}}}
    return layer;
  }
  vec3 normalAt(vec3 p,int layer){
    const float e=.035;
    return normalize(vec3(body(p+vec3(e,0,0),layer)-body(p-vec3(e,0,0),layer),body(p+vec3(0,e,0),layer)-body(p-vec3(0,e,0),layer),body(p+vec3(0,0,e),layer)-body(p-vec3(0,0,e),layer)));
  }
  float noise(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,45.164)))*43758.5453);}
  float heartDistance(vec2 p){
    p.x=abs(p.x);
    if(p.y+p.x>1.)return length(p-vec2(.25,.75))-.35355339;
    vec2 a=p-vec2(0.,1.),b=p-.5*max(p.x+p.y,0.);
    return sqrt(min(dot(a,a),dot(b,b)))*sign(p.x-p.y);
  }
  float eye(vec2 p,vec2 center,vec2 radius){
    float sleepAmount=1.-smoothstep(.15,.55,eyelid);
    radius.y/=max(eyelid,.01);
    vec2 q=(p-center)/radius;
    q.y/=mix(max(eyelid,.01),1.,sleepAmount);
    float oval=(length(q)-1.)*min(radius.x,radius.y);
    float x=clamp(q.x,-.82,.82);
    const float curvature=.24/(.82*.82);
    for(int i=0;i<4;i++){
      float y=.42-curvature*x*x,dy=-2.*curvature*x;
      x=clamp(x-((x-q.x)+(y-q.y)*dy)/max(.15,1.+dy*dy-2.*curvature*(y-q.y)),-.82,.82);
    }
    float curve=length(q-vec2(x,.42-curvature*x*x));
    curve=min(curve,min(length(q-vec2(-.82,.18)),length(q-vec2(.82,.18))));
    float arc=(curve-.11)*min(radius.x,radius.y);
    float xSleep=clamp(q.x,-.70,.70);
    float ySleep=.02+.10*(xSleep/.70)*(xSleep/.70);
    float taper=.018+.040*sqrt(max(0.,1.-(xSleep/.72)*(xSleep/.72)));
    float sleepCurve=(length(q-vec2(xSleep,ySleep))-taper)*min(radius.x,radius.y);
    float usual=mix(mix(oval,arc,smoothstep(0.,.86,smile)),sleepCurve,sleepAmount);
    float size=radius.x*(.92+loveBeat*.09);
    vec2 heartUV=(p-center)/size*.5+vec2(0.,.5);
    return mix(usual,heartDistance(heartUV)*size*2.,love);
  }
  vec3 shade(vec3 p,vec3 n,int layer,vec3 backdrop){
    vec3 q=local(p,layer);
    vec3 colPrimary=layer==1?primary2:primary;
    vec3 colSecondary=layer==1?secondary2:secondary;
    vec3 colEyes=layer==1?eyes2:eyes;
    int skin=layer==1?material2:material;
    if(layer==2){colPrimary=vec3(.98,.98,1.);colSecondary=vec3(.92,.92,.96);}
    if(layer==3){colPrimary=vec3(.53,.29,.8);colSecondary=vec3(.24,.16,.46);}
    if(layer==4){colPrimary=vec3(.12,.12,.28);colSecondary=colPrimary;}
    if(layer==5){colPrimary=vec3(.22,.80,.69);colSecondary=colPrimary;}
    vec3 light=normalize(vec3(-.65,1.05,1.55));
    float diffuse=max(dot(n,light),0.);
    float facing=max(n.z,0.);
    float tint=clamp(.43-.38*q.y+.19*(1.-facing),.08,.94);
    vec3 base=mix(colPrimary,colSecondary,tint);
    float roughness=.008;
    if(skin==0){
      float cloud=.5+.5*sin(q.x*3.7+q.y*4.+1.2*sin(q.x*5.-q.y*2.));
      base=mix(colPrimary,colSecondary,clamp(.54-.18*q.y-.18*cloud,.12,.65));
    }
    float spec=pow(max(dot(n,normalize(light+vec3(0,0,1))),0.),60.);
    if(skin==1){
      float rim=pow(1.-facing,2.);
      float reflection=exp(-pow((q.y-.48*q.x-.34)/.12,2.));
      base=mix(colPrimary,colSecondary,clamp(.28-.22*q.y+rim*.3,.08,.72));
      base=mix(base,vec3(.97,.99,1.),reflection*.42+rim*.32);
      roughness=.004;
      spec*=1.3;
    }
    if(skin==2){roughness=.025;spec*=.7;}
    if(skin==3){base=colPrimary;spec*=.1;}
    if(skin==4){roughness=.32;spec*=.1;}
    if(skin==5){roughness=.25;spec*=.25;}
    float grain=(noise(floor(q*420.))-.5)*roughness;
    vec3 color=base*(.85+.15*diffuse)+vec3(spec*.14)+grain;
    color+=pow(1.-facing,3.)*vec3(.025,.035,.065);
    if(skin==0){
      float rim=pow(1.-facing,.65);
      float cap=exp(-pow((q.x+.28)/.9,2.)-pow((q.y-.60)/.19,2.));
      color=over(color,vec3(.99,.985,1.),clamp(rim*.95+cap*.65,0.,.97));
      float sweep=exp(-pow((q.y-.55*q.x-.32-.06*sin(q.x*3.))/.09,2.));
      color=over(color,vec3(.99,.99,1.),sweep*.12);
      color=over(color,vec3(.94,.92,1.),pow(max(n.x,0.),3.)*.035);
    }
    if(skin==3){
      float edgeDistance=max(0.,-contour(q.xy));
      float edgeShade=exp(-edgeDistance/.12);
      float softLight=exp(-dot((q.xy-vec2(-.30,.35))/vec2(.65,.75),(q.xy-vec2(-.30,.35))/vec2(.65,.75)));
      color=mix(colPrimary,colSecondary,.08+.12*(1.-smoothstep(-.7,.5,q.y)));
      color*=1.-edgeShade*.13;
      color=over(color,vec3(.90,1.,.96),softLight*.20);
    }
    if(skin==1||skin==2){
      float depthInside=max(0.,-contour(q.xy));
      float softRim=exp(-depthInside/.075);
      vec2 hi=(q.xy-vec2(-.34,.40))/vec2(.60,.58);
      float capLight=exp(-dot(hi,hi));
      float tintLevel=.25+.32*(1.-smoothstep(-.75,.65,q.y));
      color=mix(colPrimary,colSecondary,tintLevel);
      if(skin==1){
        color*=.95+.05*smoothstep(0.,.32,depthInside);
        color=over(color,vec3(.98,1.,1.),capLight*.48+exp(-depthInside/.18)*.08);

      }else{
        color*=.86+.14*smoothstep(0.,.27,depthInside);
        color=over(color,vec3(.59,.67,.85),capLight*.25+softRim*.17);
      }
    }
    if(skin==6){
      vec2 uv=(q.xy+vec2(.9,.8486))/vec2(1.8,1.6972);
      vec2 fitted=plushUV.xy+uv*plushUV.zw;
      vec4 texel=texture(plushTexture,fitted);
      for(int i=0;i<8;i++){if(texel.a>.95)break;fitted=mix(fitted,vec2(.5),.035);texel=texture(plushTexture,fitted);}
      vec3 tint=mix(colPrimary/vec3(.4196,.5294,1.),colSecondary/vec3(.2392,.3294,.7373),.45);
      if(plushReady==1)color=texel.rgb*tint;
    }
    if(skin==7){
      float depthInside=max(0.,-contour(q.xy));
      color=mix(colPrimary,colSecondary,.6)+vec3(.12,.04,.18)*sin(q.x*5.+q.y*7.)*.12;
      float stars=pow(noise(floor(q*170.)),100.);
      color+=stars*vec3(.55,.50,.85);
      float rim=exp(-depthInside/.022);
      color+=rim*vec3(.95,.18,.82)*.9;
    }
    if(skin==0&&materialReady==1){
      vec2 uv=(q.xy+vec2(.9,.8486))/vec2(1.8,1.6972);
      uv=vec2(.1403509,.1236045)+uv*vec2(.7527911,.6810207);
      vec4 sampleColor=texture(materialTexture,uv);
      vec3 recolor=mix(colPrimary/vec3(.97647,.97255,1.),colSecondary/vec3(.71765,.65490,.92549),.5);
      vec3 pearl=sampleColor.rgb;
      pearl.g=min(pearl.g,(pearl.r+pearl.b)*.5+.012);
      float highlight=smoothstep(.86,.99,dot(pearl,vec3(.2126,.7152,.0722)));
      pearl=mix(pearl,vec3(.91,.90,.96),highlight*.58);
      color=over(color,pearl*recolor*(.98+.02*diffuse),sampleColor.a);
    }
    color=mix(colPrimary,color,max(volume,ufo*.65));

    float border=1.-smoothstep(.006,.018,abs(contour(q.xy)));
    float angle=fract(atan(q.x,q.y)/6.2831853+1.);
    float traced=1.-smoothstep(outlineProgress-.015,outlineProgress+.015,angle);
    color=over(color,vec3(.58,.54,.76),border*traced*outlineAlpha);
    q.xy/=mix(1.,.62,roundness);
    float left=eye(rot(.17)*(q.xy-vec2(-.5893+lookX,-.2293+lookY)),vec2(0),vec2(.165,.30214*eyelid*(1.-wink*.95)));
    float right=eye(q.xy,vec2(.05571+lookX,-.18+lookY),vec2(.26143,.37286*eyelid));
    float d=min(left,right);
    float aa=1.4/resolution.y;
    float front=layer>=2?0.:smoothstep(mix(.001,.01,volume),mix(.012,.13,volume),q.z);
    float eyeFactor=1.;
    if(transition>0.)eyeFactor=layer==0?1.-smoothstep(.02,.28,transition):smoothstep(.32,.65,transition);
    float edge=(1.-smoothstep(0.,.015,d))*front*eyeReveal*eyeFactor;
    float mask=(1.-smoothstep(-aa,aa,d))*front*eyeReveal*eyeFactor;
    color=over(color,color*.85,edge*.27);
    vec3 eyeColor=colEyes*(.975+.025*diffuse);
    if(skin==6){
      color*=1.-exp(-pow((d-.008)/.010,2.))*.09;
      vec2 eyeUV=left<right?rot(.17)*(q.xy-vec2(-.5893+lookX,-.2293+lookY))/vec2(.165,.30214): (q.xy-vec2(.05571+lookX,-.18+lookY))/vec2(.26143,.37286);
      vec3 eyeNormal=normalize(vec3(eyeUV,sqrt(max(.01,1.-dot(eyeUV,eyeUV)))));
      float eyeLight=max(dot(eyeNormal,normalize(vec3(-.55,.70,1.2))),0.);
      eyeColor=colEyes*(.70+.30*eyeLight)+(noise(floor(q*210.))-.5)*.018;
      if(smile>.1||eyelid<.7)eyeColor=colEyes;
    }
    if(skin==7){color+=vec3(.12,.65,.85)*exp(-max(d,0.)/.018)*.35;eyeColor=colEyes;}
    vec2 loveUV=left<right?rot(.17)*(q.xy-vec2(-.5893+lookX,-.2293+lookY))/.165:(q.xy-vec2(.05571+lookX,-.18+lookY))/.26143;
    vec3 loveColor=mix(affection,affectionLight,clamp(.20+loveUV.y*.18,0.,.50));
    vec2 loveGlint=(loveUV-vec2(-.27,.36))/vec2(.21,.13);
    loveColor=mix(loveColor,mix(affectionLight,vec3(1.),.6),exp(-dot(loveGlint,loveGlint))*.55);
    eyeColor=mix(eyeColor,loveColor,love);
    float faceAlpha=mask*mix(.65,1.,smoothstep(.15,.55,eyelid));
    quotaFace=vec4(eyeColor*faceAlpha,faceAlpha);
    color=over(color,eyeColor,faceAlpha);
    if(love>.001){
      float blush=exp(-dot((q.xy-vec2(-.68,-.53))/vec2(.13,.065),(q.xy-vec2(-.68,-.53))/vec2(.13,.065)))+exp(-dot((q.xy-vec2(.40,-.52))/vec2(.13,.065),(q.xy-vec2(.40,-.52))/vec2(.13,.065)));
      color=over(color,affectionLight,blush*love*.24);
    }
    if(layer==0&&transition>.85)color=over(color,backdrop,smoothstep(.85,1.,transition));
    return mix(backdrop,clamp(color,0.,1.),bodyFill);
  }
  float ringDistance(vec2 p,vec2 radius,float tilt){p=rot(tilt)*p;return abs(length(p/radius)-1.)*min(radius.x,radius.y);}
  float segmentDistance(vec2 p,vec2 a,vec2 b){vec2 e=b-a;return length(p-a-e*clamp(dot(p-a,e)/max(dot(e,e),.000001),0.,1.));}
  float triangleDistance(vec2 p,vec2 a,vec2 b,vec2 c){
    vec2 e0=b-a,e1=c-b,e2=a-c;
    float signArea=sign(e0.x*(c-a).y-e0.y*(c-a).x);
    float d0=-signArea*(e0.x*(p-a).y-e0.y*(p-a).x)/length(e0);
    float d1=-signArea*(e1.x*(p-b).y-e1.y*(p-b).x)/length(e1);
    float d2=-signArea*(e2.x*(p-c).y-e2.y*(p-c).x)/length(e2);
    return max(d0,max(d1,d2));
  }
  vec3 orbitalScene(vec2 uv,vec3 bg){
    vec3 ink=effectColor;
    float strength=max(signal,max(orbit,max(ufo,portal)));
    if(strength>.001){
      for(int i=0;i<7;i++){
        float index=float(i);
        vec2 star=vec2(sin(index*2.71+.4)*.87,cos(index*1.91+.8)*.81);
        float glow=exp(-dot(uv-star,uv-star)/.00003);
        bg=over(bg,ink,glow*strength*(.35+.2*sin(time*.7+index)));
      }
    }
    if(signal>.001){
      for(int i=0;i<3;i++){
        float phase=fract(time*.8+float(i)/3.);
        float r=.08+.70*phase;
        float d=abs(length(uv-vec2(-.18,-.15))-r);
        float alpha=exp(-d*d/.00003)*pow(sin(phase*3.14159265),2.)*signal*.40;
        bg=over(bg,ink,alpha);
      }
    }
    if(smile>.001&&time<34.){
      vec2 heart=(uv-vec2(.78,.75+.025*sin(time*2.)))/.09;
      if(abs(heart.x)<1.2&&abs(heart.y)<1.3){
        float nearest=10.;bool inside=false;
        vec2 previous=vec2(0.,5./16.);
        for(int i=1;i<=64;i++){
          float a=float(i)*6.2831853/64.;
          float sn=sin(a);
          vec2 point=vec2(sn*sn*sn,(13.*cos(a)-5.*cos(2.*a)-2.*cos(3.*a)-cos(4.*a))/16.);
          vec2 edge=point-previous;
          nearest=min(nearest,length(heart-previous-edge*clamp(dot(heart-previous,edge)/max(dot(edge,edge),.000001),0.,1.)));
          if((point.y>heart.y)!=(previous.y>heart.y)){
            float crossX=(previous.x-point.x)*(heart.y-point.y)/(previous.y-point.y)+point.x;
            if(heart.x<crossX)inside=!inside;
          }
          previous=point;
        }
        float aa=2./resolution.y/.09;
        float mask=1.-smoothstep(-aa,aa,inside?-nearest:nearest);
        bg=over(bg,affection,mask*smile*.9);
      }
    }
    vec2 centre=vec2(shiftX,lift)/1.35;
    if(orbit>.001){
      float a=ringDistance(uv-centre,vec2(.91,.27),-.25);
      float b=ringDistance(uv-centre,vec2(.82,.31),.38);
      bg=over(bg,ink,(exp(-a*a/.00002)*.55+exp(-b*b/.00002)*.25)*orbit);
      float angle=time*.75;
      vec2 dotPosition=centre+rot(.25)*vec2(.91*cos(angle),.27*sin(angle));
      bg=over(bg,ink,exp(-dot(uv-dotPosition,uv-dotPosition)/.00010)*orbit*.8);
    }
    if(ufo>.001){
      vec2 ground=vec2(0.,-.76);
      float ring=ringDistance(uv-ground,vec2(.45,.075),0.);
      bg=over(bg,effectColor,(exp(-ring*ring/.00003)*.65+exp(-ring*ring/.0006)*.10)*ufo);
      float beamT=clamp((uv.y+.76)/.45,0.,1.);
      if(uv.y>-.76&&uv.y<-.31){
        float width=mix(.34,.12,beamT);
        float cone=exp(-pow(uv.x/width,4.))*sin(beamT*3.14159);
        bg=over(bg,effectLight,cone*ufo*.22);
        for(int i=0;i<5;i++){
          float phase=fract(time*.55+float(i)*.2);
          vec2 point=vec2(sin(float(i)*2.4)*.24*(1.-phase*.5),-.75+phase*.45);
          float glow=exp(-dot(uv-point,uv-point)/.000025);
          bg=over(bg,effectColor,glow*sin(phase*3.14159)*ufo*.8);
        }
      }
    }
    if(portal>.001){
      float r=.18+.64*portalProgress;
      float d=ringDistance(uv-centre,vec2(r,.24+r*.12),-.18);
      float glow=exp(-d*d/.0005)*.13+exp(-d*d/.000015)*.8;
      bg=over(bg,ink,glow*portal);
    }
    if(complete>.001&&contour(local(vec3(uv*1.35,0.),0).xy)>-.04){
      float progress=completeProgress;
      float aa=2./resolution.y;
      for(int i=0;i<3;i++){
        float k=float(i),phase=clamp(progress*2.1-k*.35,0.,1.);
        vec2 centre=vec2(i==0?-.58:i==1?.59:-.08,i==2?.80:i==1?.68:.60);
        vec2 q=uv-centre;
        vec3 tint=i==1?affection:i==2?mix(effectColor,affection,.5):effectColor;
        float fade=sqrt(max(0.,sin(phase*3.14159)));
        float sparks=0.;
        for(int j=0;j<18;j++){
          float index=float(j),angle=fract(sin(index*37.21+k*19.7+2.)*29123.)*6.2831853;
          vec2 direction=vec2(cos(angle),sin(angle));
          float variation=.28+.72*fract(sin(index*17.3+k*7.1)*4137.9);
          vec2 point=direction*(.014+phase*(i==2?.15:.24))*variation;
          point.y-=phase*phase*.018;
          float head=length(q-point);
          float tail=segmentDistance(q,point,point-direction*.025*(.5+phase));
          sparks=max(sparks,(1.-smoothstep(.002,.004,tail))*.85+exp(-head*head/.00006)*.16);
        }
        bg=over(bg,tint,clamp(sparks*fade*complete,0.,.95));
      }
      for(int i=0;i<64;i++){
        float k=float(i),seed=fract(sin(k*12.9898+1.)*43758.5453);
        float x=(fract(sin(k*31.71+4.)*41375.31)*2.-1.)*.95;
        float launch=.32+fract(sin(k*19.13+8.)*32641.73)*.70;
        float fall=progress*(1.1+seed*.8);
        vec2 point=vec2(x+sin(progress*4.+k)*.035,launch-fall);
        vec2 q=rot(k+progress*(seed-.5)*6.)*(uv-point);
        float size=.009+seed*.010;
        float d;
        if(i%3==0)d=length(q)-size*(.62+.38*cos(atan(q.y+.000001,q.x)*5.));
        else if(i%3==1)d=max(abs(q.x)-size*.35,abs(q.y)-size);
        else d=abs(q.x)+abs(q.y)-size*.85;
        vec3 tint=i%3==0?effectColor:i%3==1?affection:mix(effectColor,affection,.45);
        float fade=(1.-smoothstep(.75,1.,progress))*complete;
        bg=over(bg,tint,(1.-smoothstep(-aa,aa,d))*fade*.85);
      }
      for(int i=0;i<12;i++){
        float k=float(i),side=i%2==0?1.:-1.;
        vec2 c=vec2(side*(.70+fract(sin(k*17.)*217.1)*.20),.35+fract(sin(k*13.+2.)*213.3)*.65-progress*1.1);
        vec2 q=rot(k+progress*3.)*(uv-c);
        float ribbon=abs(q.x-sin(q.y*65.+k)*.006)-.0035;
        float fade=(1.-smoothstep(.024,.043,abs(q.y)))*complete*(1.-progress);
        bg=over(bg,i%2==0?effectColor:affection,(1.-smoothstep(-aa,aa,ribbon))*fade*.7);
      }
    }
    if(love>.001){
      for(int i=0;i<3;i++){
        float k=float(i),phase=fract((time-30.)*.32+k*.29);
        vec2 c=vec2((i%2==0?1.:-1.)*(.76+.04*sin(phase*3.14)),.25+phase*.58);
        float size=.045+k*.008;
        float d=heartDistance((uv-c)/size*.5+vec2(0.,.5))*size*2.;
        float aa=2./resolution.y;
        float opacity=sin(phase*3.14159)*love*.65;
        bg=over(bg,affection,(1.-smoothstep(-aa,aa,d))*opacity);
      }
    }
    if(dream>.001){
      vec2 c=vec2(.76,.74+.018*sin(time*1.4));
      float moon=max(length(uv-c)-.062,-(length(uv-c-vec2(.026,.022))-.055));
      float aa=2./resolution.y;
      bg=over(bg,effectColor,(1.-smoothstep(-aa,aa,moon))*dream*.85);
      for(int i=0;i<3;i++){
        float k=float(i);vec2 star=vec2(.60+k*.11,.72+k*.075+.012*sin(time+k));
        vec2 q=abs(uv-star);float sparkle=q.x+q.y-.012;
        bg=over(bg,effectColor,(1.-smoothstep(-aa,aa,sparkle))*dream*.7);
      }
    }
    if(shock>.001){
      for(int side=-1;side<=1;side+=2){
        vec2 prev=vec2(float(side)*.77,.40);
        float line=10.;
        for(int j=1;j<=6;j++){
          vec2 point=vec2(float(side)*(.77+(j%2==0?.07:-.025)),.40-float(j)*.125);
          line=min(line,segmentDistance(uv,prev,point));prev=point;
        }
        bg=over(bg,effectColor,exp(-line*line/.000018)*shock*.9);
        bg=over(bg,effectLight,exp(-line*line/.00025)*shock*.17);
      }
    }
    if(flight>.001){
      for(int i=1;i<=18;i++){
        float k=float(i),a=max(0.,flightProgress-k*.007);
        vec2 trail=vec2(3.*sin(a*3.14159265),.75*sin(a*3.14159265))/1.35;
        float d=length(uv-trail);
        float glow=exp(-d*d/(.0003+k*.00003));
        bg=over(bg,effectColor,glow*(1.-k/19.)*flight*.28);
      }
    }
    if(ship>.001){
      vec2 c=vec2(.018*sin(time*1.5)+shipDepart*1.1,.79+shipDepart*.25);
      vec2 q=uv-c;
      vec2 shipUV=(uv-c)/vec2(.57,.26)+.5;
      if(shipReady==1&&all(greaterThanEqual(shipUV,vec2(0.)))&&all(lessThanEqual(shipUV,vec2(1.)))){
        vec4 spacecraft=texture(shipTexture,shipUV);
        bg=over(bg,mix(spacecraft.rgb,spacecraft.rgb*effectLight,.22),spacecraft.a*ship);
      }
      if(uv.y<.75&&uv.y>-.64){
        float t=(.75-uv.y)/1.39;float width=.07+.30*t;
        float cone=exp(-pow(uv.x/width,4.))*sin(t*3.14159);
        bg=over(bg,effectLight,cone*shipBeam*.12);
        for(int i=0;i<7;i++){
          float k=float(i),phase=fract(time*.4+k/7.);
          vec2 point=vec2(sin(k*3.1)*.17*(1.-phase),-.55+phase*1.25);
          float d=length(uv-point);
          bg=over(bg,effectColor,exp(-d*d/.000015)*sin(phase*3.14159)*shipBeam*.65);
        }
      }
    }
    return bg;
  }
  vec4 sampleScene(vec2 uv){
    coverage=0.;quotaFace=vec4(0.);
    vec3 bg=vec3(0.);
    float shadow=exp(-pow(uv.x/max(.12,.60*modelScale-max(lift,0.)*.55),2.)-pow((uv.y+.76)/.066,2.));
    if(quotaBodyOnly<.5&&quotaFaceOnly<.5){
      bg=over(bg,vec3(.54,.50,.62),shadow*.14*modelScale*shadowAlpha*(1.-dark*.6)/(1.+max(lift,0.)*3.));
      bg=orbitalScene(uv,bg);
    }
    vec3 ro=vec3(uv*1.35,4.0),rd=vec3(0,0,-1);
    float distance=0.;vec3 p=ro;bool hit=false;
    for(int i=0;i<120;i++){
      p=ro+rd*distance;
      float d=scene(p);
      if(d<.00065){hit=true;break;}
      distance+=d*.95;
      if(distance>5.5)break;
    }
    vec3 color=bg;
    if(hit){float behind=coverage;int layer=hitLayer(p);color=shade(p,normalAt(p,layer),layer,bg);coverage=behind+(1.-behind)*bodyFill;}
    if(quotaFaceOnly>.5)return quotaFace;
    if(quotaBodyOnly>.5)return vec4(clamp(color,0.,1.),clamp(coverage,0.,1.));
    if(scan>.001){
      float width=1.-smoothstep(.57,.73,abs(uv.x));
      float line=exp(-pow((uv.y-scanY)/.004,2.))*width*scan;
      float halo=exp(-pow((uv.y-scanY)/.035,2.))*width*scan;
      color=over(color,mix(effectColor,effectLight,.35),line*.32+halo*.045);
      float acquire=1.-smoothstep(.05,.8,mod(time,3.));
      vec2 h=abs(uv)-vec2(.77+acquire*.055,.72+acquire*.035);
      float bracket=min(max(abs(h.x),abs(h.y+.035)-.035),max(abs(h.y),abs(h.x+.035)-.035));
      color=over(color,effectColor,(1.-smoothstep(.002,.005,bracket))*scan*.60);
      for(int i=0;i<4;i++){
        float y=-.36+float(i)*.24;
        float d=length(uv-vec2(.80,y));
        float focus=exp(-pow((y-scanY)/.16,2.));
        color=over(color,effectColor,exp(-d*d/.000016)*focus*scan*.8);
      }
    }
    if(ufo>.001){
      vec2 centre=vec2(shiftX,lift)/1.35;
      for(int i=-1;i<=1;i++){
        vec2 light=centre+vec2(float(i)*.22,-.53)*modelScale;
        float d=length(uv-light);
        color=over(color,effectLight,(exp(-d*d/.00007)*.8+exp(-d*d/.0006)*.12)*ufo);
      }
    }
    return vec4(clamp(color,0.,1.),clamp(coverage,0.,1.));
  }
  void main(){
    vec2 uv=(gl_FragCoord.xy/resolution-.5)*2.;
    uv.x*=resolution.x/resolution.y;
    vec4 color=sampleScene(uv);
    vec3 projected=local(vec3(uv*1.35,0.),0);
    float edge=abs(contour(projected.xy));
    if(edge<.025){
      vec2 pixel=vec2(.5)/resolution;
      color=(sampleScene(uv+vec2(-pixel.x,-pixel.y))+sampleScene(uv+vec2(pixel.x,-pixel.y))+sampleScene(uv+vec2(-pixel.x,pixel.y))+sampleScene(uv+vec2(pixel.x,pixel.y)))*.25;
    }
    fragColor=color;
  }`;
  function compile(type,source){
    const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  const program=gl.createProgram();
  gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const shape=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,shape);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,0,255]));
  const image=new Image();image.onload=()=>{if(disposed)return;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,shape);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);canvas.dataset.shapeReady='true';loaded(true);};image.onerror=()=>loaded(false);image.src=assets+'shape.png';
  gl.uniform1i(gl.getUniformLocation(program,'shapeTexture'),0);
  const materialTexture=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,materialTexture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,0]));
  gl.uniform1i(gl.getUniformLocation(program,'materialTexture'),1);
  const materialImage=new Image();materialImage.onload=()=>{if(disposed)return;gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,materialTexture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,materialImage);gl.uniform1i(gl.getUniformLocation(program,'materialReady'),1);canvas.dataset.materialReady='true';loaded(true);};materialImage.onerror=()=>loaded(false);materialImage.src=assets+'pearl.png';


  const plushTexture=gl.createTexture();
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,plushTexture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([100,130,230,255]));
  gl.uniform1i(gl.getUniformLocation(program,'plushTexture'),2);
  gl.uniform4f(gl.getUniformLocation(program,'plushUV'),0.09808612440191387,0.09170653907496018,0.8189792663476874,0.784688995215311);
  const plushImage=new Image();plushImage.onload=()=>{if(disposed)return;gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,plushTexture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,plushImage);gl.uniform1i(gl.getUniformLocation(program,'plushReady'),1);canvas.dataset.plushReady='true';loaded(true);};plushImage.onerror=()=>loaded(false);plushImage.src=assets+'plush.png';
  const shipTexture=gl.createTexture();gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,shipTexture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,0]));gl.uniform1i(gl.getUniformLocation(program,'shipTexture'),3);
  const shipImage=new Image();shipImage.onload=()=>{if(disposed)return;gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,shipTexture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,shipImage);gl.uniform1i(gl.getUniformLocation(program,'shipReady'),1);canvas.dataset.shipReady='true';loaded(true);};shipImage.onerror=()=>loaded(false);shipImage.src=assets+'craft.png';
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
  const locations={};for(const name of ['resolution','primary','secondary','eyes','primary2','secondary2','eyes2','affection','affectionLight','effectColor','effectLight','yaw','pitch','roll','squash','lift','eyelid','smile','wink','lookX','lookY','time','dark','material','material2','transition','quotaFaceOnly','quotaBodyOnly','volume','bodyFill','eyeReveal','outlineProgress','outlineAlpha','fan','modelScale','shiftX','flatness','roundness','shadowAlpha','signal','scan','scanY','orbit','ufo','portal','portalProgress','cosmic','complete','completeProgress','love','loveBeat','dream','shock','flight','flightProgress','ship','shipBeam','shipDepart'])locations[name]=gl.getUniformLocation(program,name);
  const render=function(state){
    if(disposed||gl.isContextLost())return;
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.uniform2f(locations.resolution,canvas.width,canvas.height);
    for(const name of ['primary','secondary','eyes','primary2','secondary2','eyes2','affection','affectionLight','effectColor','effectLight'])gl.uniform3fv(locations[name],state[name]);
    for(const name of ['yaw','pitch','roll','squash','lift','eyelid','smile','wink','lookX','lookY','time','dark','transition','quotaFaceOnly','quotaBodyOnly','outlineProgress','outlineAlpha','fan','shiftX','flatness','roundness','signal','scan','scanY','orbit','ufo','portal','portalProgress','cosmic','complete','completeProgress','love','loveBeat','dream','shock','flight','flightProgress','ship','shipBeam','shipDepart'])gl.uniform1f(locations[name],state[name]??0);
    for(const name of ['volume','bodyFill','eyeReveal','modelScale','shadowAlpha'])gl.uniform1f(locations[name],state[name]??1);
    gl.uniform1i(locations.material,state.material);gl.uniform1i(locations.material2,state.material2);
    gl.drawArrays(gl.TRIANGLES,0,6);
  };
  render.ready=ready;
  render.destroy=(lose=true)=>{if(disposed)return;disposed=true;finish(false);if(lose)gl.getExtension('WEBGL_lose_context')?.loseContext();};
  return render;
}
