// Read-only native DOM geometry probe. Hosts stay hidden; no user prefs/network/chat.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
if(!process.versions.electron){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const result=require('node:child_process').spawnSync(require('electron'),[__filename],{env,stdio:'inherit',timeout:60000});process.exitCode=result.status??1;}else{
const {app,BrowserWindow,session}=require('electron');app.setActivationPolicy('accessory');
const root=path.resolve(process.env.PET_QUOTA_GROUP_SOURCE_ROOT||path.resolve(__dirname,'../..'));
const out=process.env.PET_SMOKE_ARTIFACT_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'quota-foot-gap-'));
const {quotaCardBarBounds}=require(path.join(root,'desktop-pet/lib/quota-card-group-window'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{const windows=[];const cases=[];try{
fs.mkdirSync(out,{recursive:true});session.defaultSession.webRequest.onBeforeRequest((details,done)=>done({cancel:/^https?:/.test(details.url)||/\/renderer\.js$/.test(details.url)}));
const pet=new BrowserWindow({width:80,height:80,show:false,frame:false,transparent:true,webPreferences:{contextIsolation:false,nodeIntegration:false}});windows.push(pet);
await pet.loadFile(path.join(root,'desktop-pet/index.html'));
const read=code=>pet.webContents.executeJavaScript(code);
for(const theme of ['none','halloween','christmas','spring-festival'])for(const facing of ['left','right']){
await read(`window.skin?.destroy();document.getElementById('pet').replaceChildren();window.skin=SheepSkin.create(document.getElementById('pet'),{sheepTheme:${JSON.stringify(theme)},facing:${JSON.stringify(facing)}});skin.whenReady()`);
const deadline=Date.now()+6000;let ink;while(!(ink=await read("SheepOffering.measureInk(document.getElementById('pet'))"))){if(Date.now()>deadline)throw Error('No real canvas ink '+theme);await wait(16);}
for(const corner of ['center','top-left','top-right','bottom-left','bottom-right']){
const area={x:0,y:0,width:1440,height:900};const p={x:corner==='center'?680:corner.endsWith('left')?0:1360,y:corner==='center'?400:corner.startsWith('top')?0:820,width:80,height:80};
const presentation={mode:'free',shape:'new-year-sheep',sheepTheme:theme,facing,sheepInk:{theme,facing,ink}};
const bounds=quotaCardBarBounds(p,area,presentation);const bar=new BrowserWindow({width:bounds.width,height:bounds.height,show:false,frame:false,transparent:true,webPreferences:{contextIsolation:false,nodeIntegration:false}});windows.push(bar);await bar.loadFile(path.join(root,'desktop-pet/quota-card-group.html'));bar.setBounds(bounds,false);
const painted=await bar.webContents.executeJavaScript("document.querySelector('.capsule').getBoundingClientRect().toJSON()");
const foot=p.y+p.height*(ink.y+ink.height),paintTop=bounds.y+painted.y,gap=paintTop-foot;
assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=area.width&&bounds.y+bounds.height<=area.height,'bar inside workArea');
// At bottom corners a safe above-foot fallback may be required; center/top require the requested 6–8px gap.
if(!corner.startsWith('bottom'))assert(gap>=5.5&&gap<=8.5,`${theme}/${facing}/${corner}: foot gap ${gap}`);
cases.push({theme,facing,corner,ink,foot,bounds,painted,gap});bar.destroy();}
}
assert(windows.every(w=>w.isDestroyed()||!w.isVisible()),'all native hosts hidden');fs.writeFileSync(path.join(out,'quota-bar-foot-gap-report.json'),JSON.stringify({passed:true,root,cases},null,2));console.log(JSON.stringify({passed:true,cases:cases.length,out}));
}catch(error){fs.writeFileSync(path.join(out,'quota-bar-foot-gap-report.json'),JSON.stringify({passed:false,root,cases,error:error.stack},null,2));throw error;}finally{for(const w of windows)if(!w.isDestroyed())w.destroy();}}).then(()=>app.exit(0)).catch(error=>{console.error(error.stack);app.exit(1);});}
