const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
if(process.versions.electron&&process.argv.includes('--summary-child')){
 const {app,BrowserWindow,ipcMain,session}=require('electron');app.setPath('userData',process.env.PET_SUMMARY_DATA);app.setActivationPolicy('accessory');
 app.whenReady().then(async()=>{let win,detail;try{
  session.defaultSession.webRequest.onBeforeRequest((r,cb)=>cb({cancel:/^https?:/.test(r.url)}));
  const base=path.resolve(__dirname,'..');win=new BrowserWindow({width:224,height:400,show:false,frame:false,webPreferences:{preload:path.join(base,'bubble-preload.js'),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
  const sizes=[],requests=[];ipcMain.on('pet:bubble-resize',(e,p)=>{if(e.sender===win.webContents){sizes.push(p);win.setSize(224,Math.min(400,p.height));}});ipcMain.on('pet:bubble-details',(e,p)=>{if(e.sender===win.webContents)requests.push(p);});
  await win.loadFile(path.join(base,'bubble.html'));const run=s=>win.webContents.executeJavaScript(s),wait=()=>new Promise(r=>setTimeout(r,45));
  const long='真实长文本渲染验收。\n'+'原始内容完整保留，气泡只呈现有限行摘要。'.repeat(40);let count=0;
  for(const theme of ['green','blue','purple'])for(const appearance of ['light','dark'])for(const mode of ['standard','accessible']){
   win.webContents.send('pet:color-mode',mode,appearance,theme);
   for(const maxHeight of [400,160]){
    const payload={id:42,text:long,maxHeight,placement:'above',anchorX:112,actions:[{id:'again',label:'再来一次'},{id:'rest',label:'你歇会儿'}]};win.webContents.send('pet:bubble',payload);await wait();
    const result=await run(`(()=>{const m=document.getElementById('message'),d=document.getElementById('bubble-details');return {text:m.textContent,lines:Number(getComputedStyle(m).webkitLineClamp),height:m.clientHeight,details:!d.hidden,buttons:[...document.querySelectorAll('#actions button')].map(b=>({text:b.textContent,bottom:b.getBoundingClientRect().bottom})),h:innerHeight}})()`);
    assert.equal(result.text,long);assert.ok(result.lines>=1&&result.lines<=5);assert.ok(result.height<=100);assert.equal(result.details,true);assert.equal(result.buttons.length,2);assert.ok(result.buttons.every(b=>b.bottom<=result.h-12));assert.equal(sizes.at(-1).truncated,true);assert.ok(sizes.at(-1).height<=maxHeight);
    await run("document.getElementById('bubble-details').click();window.originalAction=document.querySelector('#actions button');void 0");await wait();assert.equal(requests.at(-1).id,42);
    win.webContents.send('pet:bubble',{...payload,text:'短消息'});await wait();assert.equal(await run("document.getElementById('bubble-details').hidden"),true);assert.equal(await run("document.querySelector('#actions button')===originalAction"),true,'same-id update preserves buttons');assert.equal(sizes.at(-1).truncated,false);count++;
   }
  }
  detail=new BrowserWindow({width:420,height:240,show:false,webPreferences:{preload:path.join(base,'bubble-details-preload.js'),sandbox:true,contextIsolation:true,backgroundThrottling:false}});await detail.loadFile(path.join(base,'bubble-details.html'));detail.webContents.send('pet:bubble-details-content',{id:42,text:long+'<script>bad()</script>'});detail.webContents.send('pet:color-mode','accessible','dark','purple');await wait();
  const d=await detail.webContents.executeJavaScript(`({text:document.getElementById('detail-content').textContent,script:!!document.querySelector('#detail-content script'),select:getComputedStyle(document.body).userSelect,scroll:document.documentElement.scrollHeight>innerHeight,mode:document.documentElement.dataset.colorMode})`);assert.equal(d.text,long+'<script>bad()</script>');assert.equal(d.script,false);assert.equal(d.select,'text');assert.equal(d.scroll,true);assert.equal(d.mode,'accessible');assert.equal(win.isVisible(),false);assert.equal(detail.isVisible(),false);detail.destroy();win.destroy();console.log('BUBBLE_SUMMARY_OK '+count);app.exit(0);
 }catch(e){detail?.destroy();win?.destroy();console.error(e.stack);app.exit(1);}});
}else require('node:test')('bubble summaries preserve actions and open complete safe selectable text',{timeout:30000},()=>{const data=fs.mkdtempSync(path.join(os.tmpdir(),'bubble-summary-'));try{const r=require('node:child_process').spawnSync(require('electron'),[__filename,'--summary-child'],{encoding:'utf8',timeout:25000,env:{...process.env,PET_SUMMARY_DATA:data}});assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/BUBBLE_SUMMARY_OK 24/);}finally{fs.rmSync(data,{recursive:true,force:true});}});
