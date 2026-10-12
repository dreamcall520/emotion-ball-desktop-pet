// Run with Node; the existing Electron binary checks the real SVG/Rive layers.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { stdio: 'inherit', env });
  process.exit(result.status ?? 1);
}

const { app, BrowserWindow } = require('electron');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-effects-'));
app.setPath('userData', path.join(directory, 'userdata'));
const base = path.resolve(__dirname, '../..');
const scripts = [
  'emotion-ball/js/rings.js', 'emotion-ball/js/custom-shapes.js',
  'emotion-ball/js/emotions.js', 'emotion-ball/js/ball.js', 'emotion-ball/js/engine.js',
  'desktop-pet/lib/customization.js', 'desktop-pet/lib/rive.js',
  'desktop-pet/lib/boo-binary.js', 'desktop-pet/lib/aurora-rive.js',
  'desktop-pet/quota-effects.js'
];
const fileUrl = file => pathToFileURL(path.join(base, file)).href;
fs.symlinkSync(path.join(base, 'desktop-pet/assets'), path.join(directory, 'assets'));
fs.writeFileSync(path.join(directory, 'index.html'), `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${fileUrl('desktop-pet/aurora-rive.css')}">
<style>body{margin:24px;display:flex;gap:24px;background:#edf1f4}.host{position:relative;width:260px;height:260px}svg{width:100%;height:100%}</style>
${scripts.map(file => '<script src="' + fileUrl(file) + '"></script>').join('')}
<body><script>
window.results=[];
window.ready=(async()=>{
  EmotionBall.config.register({...EmotionBall.config.get('02').raw,id:'50',name:'check',anims:[],pool:[0]});
  for(const shape of ['blob','cloud','square','aurora-cloud']){
    const host=document.createElement('div');host.className='host';document.body.append(host);
    const appearance=PetCustomization.normalizeAppearance(PetCustomization.applyShapeRecommendation(PetCustomization.normalizeAppearance(),shape));
    appearance.auroraTransparency=32;
    if(shape==='aurora-cloud')appearance.eyeColor='#112233';
    const customShape=EB_CUSTOM_SHAPES.createShape(appearance),texture=PetCustomization.auroraReferenceTexture(appearance,customShape);
    const ball=EmotionBall.create(host,{emotion:'50',fallbackId:'50',shape,customShape,auroraBodyTexture:texture,
      auroraStyle:appearance.auroraStyle,glowPinkColor:appearance.glowPinkColor,glowGoldColor:appearance.glowGoldColor,
      eyeScale:1,eyeSpacing:1,eyeHeight:0,auroraTransparency:32,idle:false,autostart:false,
      color:appearance.bodyColor,eyeColor:appearance.eyeColor});
    ball.renderStatic();
    let rive=null;
    if(shape==='aurora-cloud'){
      rive=AuroraRive.create(host,appearance,texture,true);
      if(!rive||!await rive.whenReady())throw Error('Rive failed');
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      rive.setActive(false);
    }
    results.push({host,appearance,ball,rive,original:host.querySelector('svg'),
      eyes:[...host.querySelectorAll('.eb-eye')],effect:QuotaEffects.create(host)});
  }
  return true;
})();
window.checkEffects=async()=>{
  const report=[];
  for(const entry of results)for(const size of [80,120,180,260])for(const material of ['soft','glass'])
    for(const style of ['card','pool','ring','duo','split','stages']){
      const {host,appearance,effect,original,eyes}=entry;
      host.style.width=host.style.height=size+'px';
      effect.update({appearance,quotas:{fiveHour:74,weekly:38},config:{style,material},reducedMotion:true});
      const sameBody=host.querySelector('svg')===original&&eyes.every(eye=>eye.isConnected&&!eye.hasAttribute('mask'));
      const drawable=style==='card'?!effect.canvas.isConnected:effect.canvas.isConnected;
      const bodyScale=Number(effect.canvas.dataset.bodyScale||1);
      const poolLine=style!=='pool'||Number.isFinite(Number(effect.canvas.dataset.liquidY));
      const riveSource=host.querySelector('canvas.eb-rive-aurora.ready');
      const rivePool=style!=='pool'||!riveSource||(riveSource.style.opacity==='0'&&effect.canvas.style.opacity==='0.68'&&effect.canvas.style.filter===riveSource.style.filter);
      let smallRingAlpha=null;
      if(size===80&&style==='ring'&&material==='soft'){
        // Measure the rendered result after desktop-sized downsampling, not the source artwork.
        const width=parseFloat(effect.canvas.style.width),check=document.createElement('canvas');
        check.width=check.height=Math.ceil(width);check.getContext('2d').drawImage(effect.canvas,0,0,width,width);
        const data=check.getContext('2d').getImageData(0,0,check.width,check.height).data;
        let peak=0;
        for(let offset=-3;offset<=3;offset+=.25){
          const x=Math.round(width/2),y=Math.round(width/2+139*width/340+offset);
          peak=Math.max(peak,data[(y*check.width+x)*4+3]/255);
        }
        smallRingAlpha=peak;
      }
      report.push({shape:appearance.shape,size,style,material,sameBody,drawable,bodyScale,poolLine,rivePool,smallRingAlpha});
    }
  for(const {host,appearance,effect,original} of results)for(const hiddenMode of ['display-none','zero-size'])
    for(const material of ['soft','glass'])for(const style of ['pool','ring','duo','split','stages']){
      host.style.display=hiddenMode==='display-none'?'none':'';
      host.style.width=host.style.height=hiddenMode==='zero-size'?'0px':'80px';
      effect.update({appearance,quotas:{fiveHour:74,weekly:38},config:{style,material},reducedMotion:true});
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const hiddenInit=!effect.canvas.isConnected&&original.style.scale===''&&!original.querySelector('[id^="qiuqiu-pool-"]');
      host.style.display='';host.style.width=host.style.height='80px';
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const resizeRestored=effect.canvas.isConnected&&parseFloat(effect.canvas.style.width)>0;
      report.push({shape:appearance.shape,hiddenMode,material,hiddenStyle:style,hiddenInit,resizeRestored});
    }
  for(const {host,appearance,effect} of results)for(const size of [80,260])for(const material of ['soft','glass'])
    for(const singlePeriod of ['fiveHour','weekly'])for(const style of ['duo','split','stages']){
      host.style.width=host.style.height=size+'px';
      const input={appearance,quotas:{fiveHour:null,weekly:null,[singlePeriod]:88},config:{style,material},reducedMotion:true};
      effect.update(input);
      const singleVisible=effect.canvas.isConnected&&effect.canvas.dataset.style===(style==='duo'?'ring':style);
      let fiveSegments=true,stageFraction=true,zeroIsGrey=true,stageDirection=true,stageCount=null;
      if(style==='stages'){
        const occupancy=value=>{
          effect.update({...input,quotas:{...input.quotas,[singlePeriod]:value}});
          const data=effect.canvas.getContext('2d').getImageData(0,0,340,340).data;
          let chromatic=false;
          const pixels=Array.from({length:720},(_,i)=>{
            const angle=-Math.PI/2+i*Math.PI/360,x=Math.round(170+139*Math.cos(angle)),y=Math.round(170+139*Math.sin(angle));
            const pixel=(y*340+x)*4,rgb=[data[pixel],data[pixel+1],data[pixel+2]];
            if(data[pixel+3]>128&&Math.max(...rgb)-Math.min(...rgb)>45)chromatic=true;
            return data[pixel+3]>128;
          });
          const alphaAt=angle=>data[(Math.round(170+139*Math.sin(angle))*340+Math.round(170+139*Math.cos(angle)))*4+3];
          return {pixels,chromatic,topRight:alphaAt(-Math.PI/4),bottomLeft:alphaAt(Math.PI*3/4)};
        };
        const full=occupancy(100),partial=occupancy(88),empty=occupancy(0);
        stageCount=full.pixels.filter((lit,i)=>lit&&!full.pixels[(i+719)%720]).length;
        fiveSegments=stageCount===5;
        const ratio=partial.pixels.filter(Boolean).length/full.pixels.filter(Boolean).length;
        stageFraction=Math.abs(ratio-.88)<.04;
        zeroIsGrey=!empty.chromatic;
        const half=occupancy(50);
        stageDirection=half.topRight<half.bottomLeft*.6;
      }
      report.push({shape:appearance.shape,size,material,singlePeriod,singleStyle:style,singleVisible,fiveSegments,stageFraction,zeroIsGrey,stageDirection,stageCount});
    }
  for(const {host,appearance,effect,rive} of results.filter(entry=>entry.rive)){
    effect.update({appearance,config:{style:'card'}});host.style.width=host.style.height='260px';
    const source=host.querySelector('.eb-rive-aurora.ready'),css=source.style.cssText;
    for(const pose of ['none','rotate(-12deg)','scaleX(-1) rotate(-12deg)']){
      Object.assign(source.style,{width:'210%',height:'210%',left:'-55%',top:'-55%',transform:pose});
      effect.update({appearance,quotas:{fiveHour:null,weekly:88},config:{style:'pool'},reducedMotion:true});
      const data=effect.canvas.getContext('2d').getImageData(0,0,340,340).data;
      let leftEdge=0,rightEdge=0,painted=0;
      for(let y=0;y<340;y++)for(let x=0;x<340;x++)if(data[(y*340+x)*4+3]){
        painted++;if(x===0)leftEdge++;if(x===339)rightEdge++;
      }
      report.push({shape:appearance.shape,poolPose:pose,completeFootprint:painted>1000&&leftEdge===0&&rightEdge===0,
        nativeEyes:source.style.opacity==='0'&&effect.canvas.style.filter===source.style.filter});
    }
    effect.update({appearance,config:{style:'card'}});source.style.cssText=css;
  }
  for(const {host,appearance,effect,rive} of results.filter(entry=>entry.rive)){
    const source=host.querySelector('.eb-rive-aurora.ready'),css=source.style.cssText;
    const outline=document.createElement('canvas');outline.width=outline.height=128;
    const c=outline.getContext('2d',{willReadFrequently:true});
    for(const size of [80,260])for(const material of ['soft','glass'])for(const style of ['ring','duo','split','stages'])
      for(const pose of ['none','rotate(-12deg)','scaleX(-1) rotate(-12deg)']){
        effect.update({appearance,config:{style:'card'}});host.style.width=host.style.height=size+'px';
        Object.assign(source.style,{width:'210%',height:'210%',left:'-55%',top:'-55%',transform:pose});
        rive.setActive(true);dispatchEvent(new Event('resize'));
        await new Promise(resolve=>setTimeout(resolve,40));
        effect.update({appearance,quotas:{fiveHour:74,weekly:38},config:{style,material},reducedMotion:false});
        let maxRadius=0;const scales=[];
        for(let f=0;f<4;f++){
          await new Promise(resolve=>setTimeout(resolve,34));
          c.clearRect(0,0,128,128);c.drawImage(source,0,0,128,128);const d=c.getImageData(0,0,128,128).data;
          const computed=getComputedStyle(source),[ox,oy]=computed.transformOrigin.split(' ').map(parseFloat);
          const scale=computed.scale==='none'?[1]:computed.scale.split(' ').map(Number),tr=computed.translate==='none'?[0,0]:computed.translate.split(' ').map(parseFloat);
          const matrix=new DOMMatrix().translate(source.offsetLeft+ox+(tr[0]||0),source.offsetTop+oy+(tr[1]||0)).scale(scale[0],scale[1]??scale[0]);
          if(computed.transform!=='none')matrix.multiplySelf(new DOMMatrix(computed.transform));matrix.translateSelf(-ox,-oy);
          const width=parseFloat(effect.canvas.style.width),cx=parseFloat(effect.canvas.style.left)+width/2,cy=parseFloat(effect.canvas.style.top)+width/2;
          for(let y=0;y<128;y++)for(let x=0;x<128;x++)if(d[(y*128+x)*4+3]>8){
            const point=matrix.transformPoint({x:(x+.5)*source.clientWidth/128,y:(y+.5)*source.clientHeight/128});
            maxRadius=Math.max(maxRadius,Math.hypot(point.x-cx,point.y-cy)*340/width);
          }
          scales.push(Number(effect.canvas.dataset.bodyScale));
        }
        rive.setActive(false);
        const stableFit=scales.every((value,i)=>i===0||value<=scales[i-1]+.00001);
        effect.update({appearance,config:{style:'card'}});
        report.push({shape:appearance.shape,nativeRingPose:pose,size,material,ringStyle:style,maxRadius,
          safeOutline:maxRadius>60&&maxRadius<=125,stableFit,restoredPivot:source.style.scale===''&&source.style.translate===''});
      }
    source.style.cssText=css;
  }
  for(const {appearance,effect,original,host} of results){
    effect.update({appearance,quotas:{fiveHour:0,weekly:0},config:{style:'duo'},reducedMotion:true});
    const zero=effect.canvas.isConnected&&effect.canvas.dataset.quotaAvailable==='true';
    effect.update({appearance,quotas:{fiveHour:74,weekly:null},config:{style:'duo'},reducedMotion:true});
    const fallback=effect.canvas.isConnected&&effect.canvas.dataset.style==='ring';
    effect.update({appearance,quotas:{fiveHour:null,weekly:null},config:{style:'duo'},reducedMotion:true});
    const missing=!effect.canvas.isConnected&&original.style.scale==='';
    effect.update({appearance,quotas:{fiveHour:null,weekly:0},config:{style:'pool'},reducedMotion:true});
    const weeklyOnly=effect.canvas.isConnected&&effect.canvas.dataset.fiveHour==='unknown'&&effect.canvas.dataset.weekly==='0'&&Number.isFinite(Number(effect.canvas.dataset.liquidY));
    effect.update({appearance,quotas:{fiveHour:null,weekly:null},config:{style:'pool'},reducedMotion:true});
    const unknown=!effect.canvas.isConnected&&effect.canvas.dataset.fiveHour==='unknown'&&effect.canvas.dataset.weekly==='unknown'&&!original.querySelector('[id^="qiuqiu-pool-"]');
    effect.destroy();effect.update({appearance,config:{style:'ring'}});
    const restored=!effect.canvas.isConnected&&original.style.scale===''&&(!host.querySelector('.eb-rive-aurora')||host.querySelector('.eb-rive-aurora').style.opacity==='0.68');
    report.push({shape:appearance.shape,zero,fallback,missing,weeklyOnly,unknown,restored});
  }
  return report;
};
</script>`);

app.whenReady().then(async () => {
  try {
    const window = new BrowserWindow({ width: 1250, height: 360, show: false, webPreferences: { backgroundThrottling: false } });
    await window.loadFile(path.join(directory, 'index.html'));
    await window.webContents.executeJavaScript('ready');
    const report = await window.webContents.executeJavaScript('checkEffects()');
    for (const result of report) {
      if ('style' in result) {
        assert.ok(result.sameBody && result.drawable && result.poolLine && result.rivePool, JSON.stringify(result));
        assert.ok(result.bodyScale > 0 && result.bodyScale <= 1, JSON.stringify(result));
        if(result.smallRingAlpha!==null)assert.ok(result.smallRingAlpha>=.65, JSON.stringify(result));
      } else if('hiddenMode' in result)assert.ok(result.hiddenInit&&result.resizeRestored,JSON.stringify(result));
      else if('singlePeriod' in result)assert.ok(result.singleVisible&&result.fiveSegments&&result.stageFraction&&result.zeroIsGrey&&result.stageDirection,JSON.stringify(result));
      else if('poolPose' in result)assert.ok(result.completeFootprint&&result.nativeEyes,JSON.stringify(result));
      else if('nativeRingPose' in result)assert.ok(result.safeOutline&&result.stableFit&&result.restoredPivot,JSON.stringify(result));
      else assert.ok(result.zero && result.fallback && result.missing && result.weeklyOnly && result.unknown && result.restored, JSON.stringify(result));
    }
    console.log('QUOTA_EFFECTS_NATIVE_OK: ' + report.length + ' SVG/Rive material, size and missing/zero checks');
    fs.rmSync(directory, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error(error);fs.rmSync(directory, { recursive: true, force: true });app.exit(1);
  }
});
