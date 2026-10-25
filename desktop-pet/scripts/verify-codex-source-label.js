// Hidden native DOM checks with fixture data only; no account or model access.
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else {
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.PET_SOURCE_LABEL_ROOT ? path.join(process.env.PET_SOURCE_LABEL_ROOT,'desktop-pet') : path.resolve(__dirname,'..');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'codex-source-dom-'));
app.setPath('userData',profile);app.setActivationPolicy('accessory');
process.on('uncaughtException',e=>{console.error(e);app.exit(1)});process.on('unhandledRejection',e=>{console.error(e);app.exit(1)});
app.whenReady().then(async()=>{
 const w=new BrowserWindow({width:128,height:32,show:false,frame:false,webPreferences:{preload:path.join(root,'quota-label-preload.js'),sandbox:true,contextIsolation:true}});
 await w.loadFile(path.join(root,'quota-label.html'));w.webContents.debugger.attach('1.3');const results=[],windows=[w];
 let passed=false;
 try{
 for(const appearance of ['light','dark','system'])for(const scheme of ['light','dark'])for(const colorMode of ['standard','accessible'])for(const size of ['compact','standard'])for(const minutes of [300,10080,12345])for(const remaining of [0,100,91.4,99.9]){
  await w.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
  w.setContentSize(size==='compact'?128:168,size==='compact'?32:58);
  w.webContents.send('pet:color-mode',colorMode,appearance);w.webContents.send('pet:quota-label',{state:'ready',size,appearance,expanded:false,items:[{label:'unknown upstream label',windowMinutes:minutes,remaining}]});
  await w.webContents.executeJavaScript(`Promise.all([...document.querySelectorAll('.source-icon img')].map(img=>img.decode()))`);
  const actual=await w.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>{const card=document.querySelector('#quota-label'),compact=card.dataset.size==='compact'; const elements=[...document.querySelectorAll(compact?'#summary,.summary-period,.source-icon,.summary-period-label,.summary-value':'#items,.quota-name,.quota-period,.quota-value')];resolve({ariaLabel:card.getAttribute('aria-label'),title:card.title,icons:[...document.querySelectorAll('.source-icon img')].map(img=>({src:img.getAttribute('src'),loaded:img.complete&&img.naturalWidth>0,visible:!!img.getClientRects().length})),summary:document.querySelector('#summary').textContent,elements:elements.map(e=>{const r=e.getBoundingClientRect();return{text:e.textContent,client:e.clientWidth,scroll:e.scrollWidth,x:r.x,right:r.right,width:r.width}}),card:card.getBoundingClientRect().toJSON()});}))`);
  const name=JSON.stringify({appearance,scheme,colorMode,size,minutes,remaining});
  for(const e of actual.elements){assert(e.scroll<=e.client+1,`${name}: clipped ${JSON.stringify(e)}`);assert(e.x>=actual.card.x&&e.right<=actual.card.right,`${name}: outside ${JSON.stringify(e)}`)}
  if(size==='compact')assert.equal(actual.summary,`${minutes===300?'5小时额度':minutes===10080?'周额度':'额度'}${Math.round(remaining)}%`);
  assert(actual.icons.length>=2&&actual.icons.every(icon=>icon.loaded));assert.match(actual.ariaLabel,/Codex/);assert.match(actual.title,/Codex/);
  const visibleIcon=actual.icons.find(icon=>icon.visible);assert.equal(visibleIcon.src,`assets/integrations/${appearance==='dark'||appearance==='system'&&scheme==='dark'?'codex-dark':'codex'}.png`);
  assert.equal(w.isVisible(),false);results.push({name,...actual});
 }
 for(const [source,page,preload,channel] of [['zcode','quota-label','quota-label','pet:zcode-quota-label'],['api','api-usage-label','api-usage-label','pet:api-usage-label'],['workbuddy','workbuddy-label','workbuddy-label','pet:workbuddy-label']]) {
  const card=new BrowserWindow({width:128,height:32,show:false,frame:false,webPreferences:{preload:path.join(root,`${preload}-preload.js`),sandbox:true,contextIsolation:true,...(source==='zcode'?{additionalArguments:['--pet-source=zcode']}:{})}});windows.push(card);
  await card.loadFile(path.join(root,`${page}.html`));card.webContents.debugger.attach('1.3');
  for(const appearance of ['light','dark','system'])for(const scheme of ['light','dark'])for(const colorMode of ['standard','accessible'])for(const remaining of [0,100,91.4]) {
   await card.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
   card.webContents.send('pet:color-mode',colorMode,appearance);
   const state=source==='api'?{connected:true,appearance,expanded:false,report:{month:'2026-10',updatedAt:Date.now(),costs:{month:[{currency:'USD',value:remaining}],today:[{currency:'USD',value:0}]},usage:{inputTokens:120,outputTokens:30,cachedInputTokens:null,requests:2}}}
    :source==='workbuddy'?{enabled:true,appearance,expanded:false,report:{total:remaining,basic:remaining,reward:0,purchased:0,plan:'体验版',expires:[]}}
    :{sourceId:'zcode',state:'ready',size:'compact',appearance,expanded:false,items:[{label:'GLM-5.3',windowMinutes:1440,remaining}]};
   card.webContents.send(channel,state);
   await card.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(resolve))`);
   await card.webContents.executeJavaScript(`Promise.all([...document.querySelectorAll('.source-icon img')].map(img=>img.decode()))`);
   const actual=await card.webContents.executeJavaScript(`(()=>{const r=document.querySelector('#quota-label').getBoundingClientRect();return{icons:[...document.querySelectorAll('.source-icon img')].map(img=>({src:img.getAttribute('src'),loaded:img.complete&&img.naturalWidth>0})),elements:[...document.querySelectorAll('#summary,.summary-period,.source-icon,.summary-period-label,.summary-value')].map(e=>{const b=e.getBoundingClientRect();return{text:e.textContent,client:e.clientWidth,scroll:e.scrollWidth,x:b.x,right:b.right}}),card:r.toJSON()}})()`);
   actual.accessible=await card.webContents.executeJavaScript(`(()=>{const target=document.querySelector(${JSON.stringify(source==='workbuddy'?'#toggle':'#quota-label')});return{ariaLabel:target.getAttribute('aria-label'),title:target.title}})()`);
   const fullSource=source==='api'?'OpenAI API':source==='workbuddy'?'WorkBuddy':'ZCode';assert(actual.accessible.ariaLabel.includes(fullSource));assert(actual.accessible.title.includes(fullSource));
   const name=JSON.stringify({source,appearance,scheme,colorMode,remaining});assert(actual.icons.length===1&&actual.icons.every(icon=>icon.loaded),`${name}: source artwork did not load`);
   assert.equal(actual.icons[0].src,`assets/integrations/${source==='api'?'openai':source}.png`);
   for(const e of actual.elements){assert(e.scroll<=e.client+1,`${name}: clipped ${JSON.stringify(e)}`);assert(e.x>=actual.card.x&&e.right<=actual.card.right,`${name}: outside ${JSON.stringify(e)}`)}
   assert.equal(card.isVisible(),false);results.push({name,...actual});
  }
 }
 const out=path.join(process.env.PET_SMOKE_ARTIFACT_DIR || path.resolve(__dirname,'../build'),'codex-source-dom-evidence.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({passed:true,sourceRoot:root,cases:results.length,results},null,2));console.log(JSON.stringify({passed:true,cases:results.length,out}));passed=true;
 }catch(error){console.error(error.stack);}finally{windows.forEach(win=>win.destroy());fs.rmSync(profile,{recursive:true,force:true});app.exit(passed?0:1)}
});

}
