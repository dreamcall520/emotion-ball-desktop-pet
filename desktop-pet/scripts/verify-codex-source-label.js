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
 await w.loadFile(path.join(root,'quota-label.html'));w.webContents.debugger.attach('1.3');const results=[];
 let passed=false;
 try{
 for(const appearance of ['light','dark','system'])for(const scheme of ['light','dark'])for(const colorMode of ['standard','accessible'])for(const size of ['compact','standard'])for(const minutes of [300,10080,12345])for(const remaining of [0,100,91.4,99.9]){
  await w.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
  w.setContentSize(size==='compact'?128:168,size==='compact'?32:58);
  w.webContents.send('pet:color-mode',colorMode,appearance);w.webContents.send('pet:quota-label',{state:'ready',size,appearance,expanded:false,items:[{label:'unknown upstream label',windowMinutes:minutes,remaining}]});
  const actual=await w.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>{const card=document.querySelector('#quota-label'),compact=card.dataset.size==='compact'; const elements=[...document.querySelectorAll(compact?'#summary,.summary-period,.summary-badge,.summary-period-label,.summary-value':'#items,.quota-name,.quota-period,.quota-value')];resolve({summary:document.querySelector('#summary').textContent,elements:elements.map(e=>{const r=e.getBoundingClientRect();return{text:e.textContent,client:e.clientWidth,scroll:e.scrollWidth,x:r.x,right:r.right,width:r.width}}),card:card.getBoundingClientRect().toJSON()});}))`);
  const name=JSON.stringify({appearance,scheme,colorMode,size,minutes,remaining});
  for(const e of actual.elements){assert(e.scroll<=e.client+1,`${name}: clipped ${JSON.stringify(e)}`);assert(e.x>=actual.card.x&&e.right<=actual.card.right,`${name}: outside ${JSON.stringify(e)}`)}
  if(size==='compact')assert.equal(actual.summary,`CX${minutes===300?'5h':minutes===10080?'周':'额度'}${Math.round(remaining)}%`);
  assert.equal(w.isVisible(),false);results.push({name,...actual});
 }
 const out=path.join(process.env.PET_SMOKE_ARTIFACT_DIR || path.resolve(__dirname,'../build'),'codex-source-dom-evidence.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({passed:true,cases:results.length,results},null,2));console.log(JSON.stringify({passed:true,cases:results.length,out}));passed=true;
 }catch(error){console.error(error.stack);}finally{w.destroy();fs.rmSync(profile,{recursive:true,force:true});app.exit(passed?0:1)}
});

}
