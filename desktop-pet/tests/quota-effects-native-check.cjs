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
window.checkEffects=()=>{
  const report=[];
  for(const entry of results)for(const size of [108,260])for(const material of ['soft','glass'])
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
      report.push({shape:appearance.shape,size,style,material,sameBody,drawable,bodyScale,poolLine,rivePool});
    }
  for(const {appearance,effect,original,host} of results){
    effect.update({appearance,quotas:{fiveHour:0,weekly:0},config:{style:'duo'},reducedMotion:true});
    const zero=effect.canvas.isConnected&&effect.canvas.dataset.quotaAvailable==='true';
    effect.update({appearance,quotas:{fiveHour:74,weekly:null},config:{style:'duo'},reducedMotion:true});
    const missing=!effect.canvas.isConnected&&original.style.scale==='';
    effect.update({appearance,quotas:{fiveHour:null,weekly:0},config:{style:'pool'},reducedMotion:true});
    const unknown=effect.canvas.dataset.fiveHour==='unknown'&&!original.querySelector('[id^="qiuqiu-pool-"]');
    effect.destroy();effect.update({appearance,config:{style:'ring'}});
    const restored=!effect.canvas.isConnected&&original.style.scale===''&&(!host.querySelector('.eb-rive-aurora')||host.querySelector('.eb-rive-aurora').style.opacity==='0.68');
    report.push({shape:appearance.shape,zero,missing,unknown,restored});
  }
  return report;
};
</script>`);

app.whenReady().then(async () => {
  try {
    const window = new BrowserWindow({ width: 1250, height: 360, show: false });
    await window.loadFile(path.join(directory, 'index.html'));
    await window.webContents.executeJavaScript('ready');
    const report = await window.webContents.executeJavaScript('checkEffects()');
    for (const result of report) {
      if ('style' in result) {
        assert.ok(result.sameBody && result.drawable && result.poolLine && result.rivePool, JSON.stringify(result));
        assert.ok(result.bodyScale > 0 && result.bodyScale <= 1, JSON.stringify(result));
      } else assert.ok(result.zero && result.missing && result.unknown && result.restored, JSON.stringify(result));
    }
    console.log('QUOTA_EFFECTS_NATIVE_OK: ' + report.length + ' SVG/Rive material, size and missing/zero checks');
    fs.rmSync(directory, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error(error);fs.rmSync(directory, { recursive: true, force: true });app.exit(1);
  }
});
