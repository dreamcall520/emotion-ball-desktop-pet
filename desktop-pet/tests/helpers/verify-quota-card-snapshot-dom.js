// The input is a real main-process settings snapshot, not a hand-written menu fixture.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const DISPLAY_IDS={codex:'/codex-menu/codex-quota-visible',api:'/codex-menu/openai-api-menu/openai-api-visible',zcode:'/zcode-menu/zcode-quota-visible',workbuddy:'/workbuddy-quota-visible'};
if(process.versions.electron&&process.argv.includes('--quota-snapshot-dom')){
 const {app,BrowserWindow,session}=require('electron');const file=process.argv[process.argv.indexOf('--quota-snapshot-dom')+1];const input=JSON.parse(fs.readFileSync(file,'utf8'));
 const data=path.join(path.dirname(file),'userData');fs.mkdirSync(data);app.setPath('userData',data);app.setActivationPolicy('accessory');
 app.whenReady().then(async()=>{let win;try{
 const root=process.env.PET_SETTINGS_SOURCE_ROOT||path.resolve(__dirname,'../../..');
 session.defaultSession.webRequest.onBeforeRequest((d,done)=>done({cancel:/^https?:/.test(d.url)||/\/global-settings-renderer\.js$/.test(d.url)}));
 win=new BrowserWindow({width:1080,height:820,show:false,webPreferences:{contextIsolation:false,nodeIntegration:false}});await win.loadFile(path.join(root,'desktop-pet/global-settings.html'));
 const run=code=>win.webContents.executeJavaScript(code);
 await run(`window.snapshot=${JSON.stringify({...input,initialView:'quota-cards'})};window.qiuqiuSettings={get:async()=>snapshot,act:async()=>({snapshot}),saveQuotaCards:async()=>({ok:true,config:snapshot.quotaCards,snapshot}),onNavigate(){},onPetSleepState(){return ()=>{}}};void 0`);
 await run(fs.readFileSync(path.join(root,'desktop-pet/global-settings-renderer.js'),'utf8'));
 const deadline=Date.now()+3000;while(!await run("document.querySelector('[data-settings-section=quota-cards]')!==null")){if(Date.now()>deadline)throw Error('Main snapshot did not open quota card management');await new Promise(r=>setTimeout(r,16));}
 const rows=await run(`Object.fromEntries([...document.querySelectorAll('[data-quota-card]')].map(row=>{const checkbox=[...row.querySelectorAll('input[type=checkbox]')].find(e=>e.getAttribute('aria-label')?.endsWith('显示额度卡'));return [row.dataset.quotaCard,{action:checkbox?.dataset.action,checked:checkbox?.checked,nativeChecked:checkbox?.matches(':checked')}]}))`);
 for(const [source,id]of Object.entries(DISPLAY_IDS)){assert.equal(rows[source]?.action,id,source+' uses main menu leaf');assert.equal(rows[source]?.checked,true,source+' real preference reaches DOM');assert.equal(rows[source]?.nativeChecked,true,source+' native checkbox accessibility state');}
 assert.equal(win.isVisible(),false);console.log('PASS REAL_MAIN_QUOTA_SNAPSHOT_DOM 4 checked native controls');win.destroy();app.exit(0);
 }catch(error){console.error(error.stack);win?.destroy();app.exit(1);}});
}else module.exports=async function verify(snapshot){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quota-snapshot-dom-')),file=path.join(dir,'snapshot.json');fs.writeFileSync(file,JSON.stringify(snapshot),{mode:0o600});
 try{const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;await new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(require('electron'),[__filename,'--quota-snapshot-dom',file],{env});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(output)));});}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
};
