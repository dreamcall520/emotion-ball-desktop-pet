const fs=require('node:fs'),path=require('node:path');
if(!process.versions.electron){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=require('node:child_process').spawnSync(require('electron'),[__filename],{env,encoding:'utf8'});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status===0&&r.stdout.includes('"passed":true')?0:1);}
const assert=require('node:assert/strict');
const{app,BrowserWindow,screen,session}=require('electron');
const root=path.resolve(__dirname,'../..');
const{createQuotaLabelWindow}=require(path.join(root,'desktop-pet/lib/quota-label-window'));
app.setPath('userData',fs.mkdtempSync('/tmp/qiuqiu-guard-live-'));app.setActivationPolicy('accessory');
let pet,controller;app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{try{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,done)=>done({cancel:true}));
 const area=screen.getPrimaryDisplay().workArea;const results=[];
 for(const side of ['right','left']){
 pet=new BrowserWindow({x:side==='right'?area.x+80:area.x+area.width-100,y:area.y+250,width:80,height:80,show:false,frame:false});pet.showInactive();
 controller=createQuotaLabelWindow({BrowserWindow,screen,getPetWindow:()=>pet,getSize:()=>'compact',getGuardEntry:()=>true,getPresentation:()=>({mode:'free',shape:'new-year-sheep',quotaRoleWidth:24}),alwaysOnTop:false,onError:e=>console.error(e)});
 controller.show({state:'ready',items:[{id:'probe',label:'Codex',windowMinutes:300,remaining:47.6,resetsAt:2000000000000}],overflow:0});
 const win=controller.getWindow();await new Promise(r=>setTimeout(r,450));
 for(const action of ['expand','collapse']){
 const native=[];const timer=setInterval(()=>native.push({time:Date.now(),...win.getBounds()}),5);
 const frames=await win.webContents.executeJavaScript(`new Promise(resolve=>{const rows=[],start=performance.now();let triggered=false;function frame(){const b=document.getElementById('quota-beam'),r=b.getBoundingClientRect(),l=document.getElementById('quota-label'),g=document.getElementById('quota-guard-entry'),gr=g?.getBoundingClientRect(),field=l.querySelector(l.dataset.expanded==='true'?'.v20-value':'.summary-value')||l;rows.push({time:Date.now(),t:performance.now()-start,screenX,screenY,left:r.left,top:r.top,width:r.width,height:r.height,worldX:screenX+r.left,worldY:screenY+r.top,expanded:l.dataset.expanded,guard:document.body.dataset.guardEntry,role:gr?{left:gr.left,top:gr.top,width:gr.width,height:gr.height,visible:getComputedStyle(g).visibility}:null,font:getComputedStyle(field).fontSize,transform:getComputedStyle(field).transform,inline:b.getAttribute('style')});if(!triggered){triggered=true;l.click();}if(performance.now()-start<320)requestAnimationFrame(frame);else resolve(rows)}requestAnimationFrame(frame)})`);
 clearInterval(timer);results.push({side,action,frames,native});await new Promise(r=>setTimeout(r,80));
 }
 controller.destroy();pet.destroy();controller=null;pet=null;
 }
 const out='/tmp/qiuqiu-guard-carrier-native-check.json';fs.writeFileSync(out,JSON.stringify(results,null,2));
 for(const result of results){
 const nativeKeys=new Set(result.native.map(b=>[b.x,b.y,b.width,b.height].join(',')));
 assert.equal(nativeKeys.size,1,result.side+' '+result.action+' carrier stays fixed');
 const rows=result.frames;
 for(let i=0;i<rows.length;i++){
 const f=rows[i];assert.equal(f.transform,'none');assert(f.width>=127.8&&f.width<=196.2,'no union/full-frame width flash');assert(f.height>=31.8&&f.height<=131.2,'no union/full-frame height flash');
 if(i){const d=f.width-rows[i-1].width;assert(result.action==='expand'?d>=-.2:d<=.2,'width never reverses');}
 }
 assert.equal(Math.round(rows.at(-1).width),result.action==='expand'?196:128);
 const first=rows[0],last=rows.at(-1),sign=Math.sign(last.worldX-first.worldX);
 for(let i=1;i<rows.length;i++){
 assert(Math.abs(rows[i].worldY-first.worldY)<.5,'world vertical anchor never jumps');
 if(sign)assert((rows[i].worldX-rows[i-1].worldX)*sign>=-.5,'world horizontal movement never reverses');
 }
 }
 console.log(JSON.stringify({passed:true,file:out,phases:results.length,frames:results.map(v=>v.frames.length),nativeCarrierFixed:true,noReverseJump:true}));app.exit(0);
}catch(e){console.error(e);controller?.destroy();pet?.destroy();app.exit(1)}});
