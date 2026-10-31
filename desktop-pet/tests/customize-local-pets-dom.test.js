const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
if(process.versions.electron&&process.argv.includes('--local-pets-dom-child')){
const {app,BrowserWindow,session}=require('electron');app.setPath('userData',process.env.PET_LOCAL_DOM_DATA);app.setActivationPolicy('accessory');
app.whenReady().then(async()=>{let win;try{
const root=process.env.PET_CUSTOMIZE_SOURCE_ROOT||path.resolve(__dirname,'../..');
session.defaultSession.webRequest.onBeforeRequest((details,done)=>done({cancel:/^https?:/.test(details.url)||/\/customize-renderer\.js$/.test(details.url)}));
win=new BrowserWindow({width:1080,height:820,show:false,webPreferences:{contextIsolation:false,nodeIntegration:false}});await win.loadFile(path.join(root,'desktop-pet/customize.html'));
const run=code=>win.webContents.executeJavaScript(code);const until=async(code,message)=>{const end=Date.now()+5000;while(!await run(code)){if(Date.now()>end)throw Error(message);await new Promise(r=>setTimeout(r,16));}};
await run(`window.saves=[];window.previews=[];window.current={customization:PetCustomization.normalizeCustomization({appearance:{shape:'new-year-sheep',sheepTheme:'christmas'}}),size:'tiny',appearancePresets:[]};window.current.startupAppearance=current.customization.appearance;
const sprite=document.createElement('canvas');sprite.width=1536;sprite.height=1872;const c=sprite.getContext('2d');c.fillStyle='#5566aa';c.fillRect(0,0,1536,1872);window.localPet={id:'codex-'+ 'a'.repeat(64),importedId:'codex-'+ 'a'.repeat(64),name:'我的本地伙伴',version:1,rows:9,frameMap:{sleep:{start:56,count:8,durations:Array(8).fill(100)},wakeup:{start:64,count:8,durations:Array(8).fill(75),loop:false}},imageURL:sprite.toDataURL(),origin:'local',imported:true};window.codexPet={...localPet,id:'codex-'+ 'b'.repeat(64),importedId:'codex-'+ 'b'.repeat(64),name:'既有Codex副本',origin:'codex'};
window.localPets=[];window.importMode='canceled';window.petCustomizer={load:async()=>structuredClone(current),listCodexPets:async()=>({ok:true,pets:[codexPet]}),listLocalPets:async()=>window.failList?{ok:false}:{ok:true,pets:localPets},importLocalPet:async()=>{if(importMode==='canceled')return {ok:false,canceled:true};if(importMode==='fail')return {ok:false,error:'素材格式不支持'};localPets=[localPet];return {ok:true,pet:localPet}},preview:value=>previews.push(structuredClone(value)),save:async(value,startup)=>{saves.push(structuredClone(value));current.customization=structuredClone(value);if(startup)current.startupAppearance=value.appearance;return true;},setSize:async()=>true};void 0;`);
await run(fs.readFileSync(path.join(root,'desktop-pet/customize-renderer.js'),'utf8'));await until('window.__customizerReady','customizer ready');
assert.deepEqual(await run("[...document.querySelectorAll('.source-switch button')].map(e=>e.textContent)"),['球球外观','Codex 宠物','其他伙伴','额度展示']);
await run("document.getElementById('source-local').click()");await until("document.getElementById('local-read-status').textContent==='本地导入 · 0'",'empty library');
assert.equal(await run("document.getElementById('local-panel').hidden"),false);assert.match(await run("document.querySelector('.local-pet-help').textContent"),/准备素材：.*pet.json.*导入预览：.*预览满意后保存到桌面.*提示：.*普通照片、GIF/);
await run("document.getElementById('local-help-open').click()");assert.equal(await run("document.getElementById('local-help-dialog').open"),true);assert.match(await run("document.getElementById('local-help-dialog').textContent"),/制作要求.*PNG 或 WebP.*1536 × 1872.*1536 × 2288.*文件夹示例/s);assert.match(await run("document.getElementById('local-help-dialog').textContent"),/3 倍.*4608 × 5616.*4608 × 6864.*16 MiB/s);await run("document.getElementById('local-help-close').click()");assert.equal(await run("document.getElementById('local-help-dialog').open"),false);
win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
await run("document.getElementById('refresh-local-pets').focus()");
win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await until("document.activeElement.id==='import-local-pet'",'real keyboard tab reaches import');
const importStyle=await run("(()=>{const e=document.getElementById('import-local-pet'),s=getComputedStyle(e);return {background:s.backgroundColor,border:s.borderTopWidth,cursor:s.cursor,outline:getComputedStyle(e).outlineWidth,outlineStyle:getComputedStyle(e).outlineStyle,focusVisible:e.matches(':focus-visible')}})()");assert.notEqual(importStyle.background,'rgba(0, 0, 0, 0)');assert.equal(importStyle.border,'1px');assert.equal(importStyle.cursor,'pointer');assert.notEqual(importStyle.outlineStyle,'none');assert.equal(importStyle.focusVisible,true);assert(parseFloat(importStyle.outline)>=2,'keyboard focus remains clearly visible (author 2px or platform accessibility override)');
if(process.env.PET_CUSTOMIZE_STYLE_ARTIFACT)fs.writeFileSync(process.env.PET_CUSTOMIZE_STYLE_ARTIFACT,JSON.stringify({sourceRoot:root,computed:importStyle,matchingRules:await run("[...document.styleSheets].flatMap(sheet=>{try{return [...sheet.cssRules].filter(rule=>rule.selectorText?.includes('.local-import')).map(rule=>({href:sheet.href,rule:rule.cssText}))}catch(_){return []}})")},null,2));
assert.equal(await run("(()=>{window.originalImport=petCustomizer.importLocalPet;petCustomizer.importLocalPet=()=>new Promise(resolve=>window.resolveImport=resolve);document.getElementById('import-local-pet').click();return document.getElementById('import-local-pet').disabled})()"),true,'native dialog/import busy disables visible button');
await run("resolveImport({ok:false,canceled:true});petCustomizer.importLocalPet=originalImport;void 0");await until("!document.getElementById('import-local-pet').disabled",'busy cancel');
await run("document.getElementById('import-local-pet').click()");await until("!document.getElementById('import-local-pet').disabled",'cancel import');
assert.equal(await run('previews.at(-1).shape'),'new-year-sheep');assert.equal(await run('saves.length'),0);
await run("window.importMode='fail';document.getElementById('import-local-pet').click()");await until("!document.getElementById('import-local-pet').disabled",'failed import');assert.match(await run("document.getElementById('message').textContent"),/素材格式不支持/);assert.equal(await run('previews.at(-1).shape'),'new-year-sheep');
await run("window.failList=true;document.getElementById('refresh-local-pets').click()");await until("document.getElementById('local-read-status').textContent==='读取暂未完成'",'read failure');
await run("window.failList=false;document.getElementById('refresh-local-pets').click()");await until("document.getElementById('local-read-status').textContent==='本地导入 · 0'",'retry empty');
await run("window.importMode='success';document.getElementById('import-local-pet').click()");await until("document.querySelector('.codex-pet-sprite')?.dataset.codexReady==='ready'",'real player imported sprite ready');
assert.equal(await run('saves.length'),0,'import does not apply desktop appearance');assert.equal(await run('current.customization.appearance.shape'),'new-year-sheep');assert.equal(await run('previews.at(-1).codexPetId'),'codex-'+'a'.repeat(64));
assert.equal(await run("document.querySelector('#local-pet-grid .pet-card').getAttribute('aria-pressed')"),'true');
await until("previews.at(-1).codexPetId==='codex-'+ 'a'.repeat(64)",'selected local preview has rendered');
assert.equal(await run("document.getElementById('pet-settings').parentElement.id"),'local-panel');
assert.equal(await run("Boolean(document.querySelector('#pet-action option[value=sleep]'))"),true);await run("document.getElementById('pet-action').value='sleep';document.getElementById('pet-action').dispatchEvent(new Event('change'))");assert.equal(await run("document.querySelector('.codex-pet-sprite').dataset.codexAction"),'sleep');
await run("document.getElementById('pet-action').value='wave';document.getElementById('pet-action').dispatchEvent(new Event('change'))");assert.equal(await run("document.querySelector('.codex-pet-sprite').dataset.codexAction"),'wave');
await run("(()=>{const s=document.getElementById('pet-action');s.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse'}));s.focus();s.value='sleep';s.dispatchEvent(new Event('change'))})()");
assert.equal(await run("getComputedStyle(document.getElementById('pet-action')).outlineStyle"),'none','pointer-selected preview action has no selection outline');
await run("document.getElementById('pet-action').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))");
assert.notEqual(await run("getComputedStyle(document.getElementById('pet-action')).outlineStyle"),'none','keyboard action selection keeps focus indication');
await run("document.getElementById('pet-action').blur()");

await run("document.getElementById('pet-play').click()");assert.equal(await run("document.getElementById('pet-play').getAttribute('aria-label')"),'播放动画');
await run("document.getElementById('source-codex').click()");assert.equal(await run("document.querySelectorAll('#pet-grid .pet-card').length"),1);assert.equal(await run("document.querySelector('#pet-grid .pet-name').textContent"),'既有Codex副本');
assert.equal(await run("document.getElementById('pet-settings').parentElement.id"),'codex-panel');assert.equal(await run('previews.at(-1).codexPetId'),'codex-'+'a'.repeat(64),'switching tabs does not select another pet');
await run("document.getElementById('source-codex').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))");assert.equal(await run("document.getElementById('source-local').getAttribute('aria-selected')"),'true');
await run("document.getElementById('save').click()");await until("saves.length===1&&!document.getElementById('save').disabled",'save completed');assert.equal(await run('saves[0].appearance.codexPetId'),'codex-'+'a'.repeat(64));assert.equal(await run('current.customization.appearance.shape'),'codex-pet');
assert.equal(await run('current.startupAppearance.codexPetId'),'codex-'+'a'.repeat(64),'默认保存导入伙伴，下次启动沿用');
await run("document.getElementById('startup-default').checked=false;document.getElementById('source-codex').click();document.querySelector('#pet-grid .pet-card').click();document.getElementById('pet-opacity').value='20';document.getElementById('pet-opacity').dispatchEvent(new Event('input'))");
assert.equal(await run("document.getElementById('startup-default').checked"),false,'切换伙伴和透明度保留主动临时换装');
await run("document.getElementById('save').click()");await until("saves.length===2&&!document.getElementById('save').disabled",'temporary save completed');
assert.equal(await run('current.customization.appearance.codexPetId'),'codex-'+'b'.repeat(64));assert.equal(await run('current.startupAppearance.codexPetId'),'codex-'+'a'.repeat(64),'临时换装不覆盖启动伙伴');
assert.equal(await run("(()=>{const e=document.querySelector('.source-switch');return e.scrollWidth<=e.clientWidth+1})()"),true,'four tabs fit settings column');
await run("document.getElementById('source-local').click();document.documentElement.dataset.theme='dark'");
assert.equal(await run("(()=>{const p=document.getElementById('local-panel'),r=p.getBoundingClientRect(),grid=document.getElementById('local-pet-grid');return r.width>0&&p.scrollWidth<=p.clientWidth+1&&grid.scrollWidth<=grid.clientWidth+1})()"),true,'local library fits dark settings panel');
// Deleting a preview never saves it or changes the active skin; cancel/failure keep it listed.
await run("document.querySelector('#local-pet-grid .pet-card').click();window.deleteCalls=[];window.deleteMode='cancel';petCustomizer.deleteLocalPet=async id=>{deleteCalls.push(id);if(deleteMode==='cancel')return{ok:false,canceled:true};if(deleteMode==='fail')return{ok:false,error:'该皮肤已设为启动默认，请先更换启动外观'};if(deleteMode==='pending')return new Promise(r=>window.finishDelete=r);localPets=[];return{ok:true,id}};void 0;");
assert.equal(await run("document.querySelector('#local-pet-grid .pet-card').getAttribute('aria-pressed')"),'true');
await until("previews.at(-1).codexPetId==='codex-'+ 'a'.repeat(64)",'selected local preview has rendered');
// Multiple imported rows must keep names intact, including in a shorter window.
await run("document.getElementById('message').hidden=true;window.localPets=Array.from({length:7},(_,i)=>({...localPet,id:'codex-'+(i+1).toString(16).repeat(64),importedId:'codex-'+(i+1).toString(16).repeat(64),name:i===0?'楚哥':'伙伴 '+(i+1)}));document.getElementById('refresh-local-pets').click()");
await until("document.querySelectorAll('#local-pet-grid .pet-card').length===7",'multiple rows loaded');
for(const size of [[800,580],[860,700],[1080,820]]){
 win.setSize(...size);
 for(let i=0;i<7;i++){
  const g=await run(`(()=>{const n=document.querySelectorAll('#local-pet-grid .pet-name')[${i}],c=n.closest('.pet-card'),item=c.parentElement;n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect(),b=c.getBoundingClientRect(),row=item.getBoundingClientRect();return{rect:{x:r.x,y:r.y,height:r.height},hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,180),grid:{height:document.getElementById('local-pet-grid').clientHeight,scroll:document.getElementById('local-pet-grid').scrollTop},height:r.height,contained:r.top>=b.top&&r.bottom<=b.bottom&&b.bottom<=row.bottom+1,visible:n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
  assert(g.height>=18&&g.contained&&g.visible,'every name has its own visible line at '+size.join('x')+' row '+i+' '+JSON.stringify(g));
 }
}
await run("window.localPets=[localPet];document.getElementById('refresh-local-pets').click()");await until("document.querySelectorAll('#local-pet-grid .pet-card').length===1",'restore single local pet');
if(process.env.PET_LOCAL_DELETE_SCREENSHOT){
 await run("const captureStyle=document.createElement('style');captureStyle.textContent='*{transition:none!important}';document.head.append(captureStyle);void 0;");
 const target=process.env.PET_LOCAL_DELETE_SCREENSHOT;fs.mkdirSync(path.dirname(target),{recursive:true});
 if(process.env.PET_LOCAL_VISUAL_SPRITE){const url='data:image/webp;base64,'+fs.readFileSync(process.env.PET_LOCAL_VISUAL_SPRITE).toString('base64');await run(`document.querySelector('#local-pet-grid .pet-sprite').style.setProperty('--sprite','url('+JSON.stringify(${JSON.stringify(url)})+')');document.querySelector('#local-pet-grid .pet-sprite').style.setProperty('--rows','1');void 0;`);}
 for(const width of [860,1080])for(const theme of ['light','dark']){
  win.setSize(width,820);await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  await new Promise(r=>setTimeout(r,240));
  const geometry=await run("(()=>{const b=document.querySelector('.local-pet-delete'),r=b.getBoundingClientRect(),card=b.previousElementSibling.getBoundingClientRect(),sprite=document.querySelector('#local-pet-grid .pet-sprite').getBoundingClientRect(),p=document.getElementById('local-panel').getBoundingClientRect();return {theme:document.documentElement.dataset.theme,background:getComputedStyle(b).backgroundColor,color:getComputedStyle(b).color,clickable:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),inside:r.x>=card.x&&r.right<=card.right&&r.y>=card.y&&r.bottom<=sprite.top+1,clip:{x:Math.floor(p.x),y:Math.floor(p.y),width:Math.ceil(p.width),height:Math.min(440,Math.ceil(p.height))}}})()");
  console.log(JSON.stringify({width,theme,geometry}));
  assert(geometry.clickable&&geometry.inside,'delete remains visible, clickable and clear of the sprite');
  fs.writeFileSync(target.replace(/\.png$/,'-'+width+'-'+theme+'.png'),(await win.webContents.capturePage(geometry.clip,{stayAwake:true})).toPNG());
 }
 win.setSize(1080,820);
}
await run("document.querySelector('.local-pet-delete').click()");await until("!document.getElementById('save').disabled",'cancel deletion');
assert.equal(await run("document.querySelectorAll('#local-pet-grid .pet-card').length"),1);
await run("deleteMode='fail';document.querySelector('.local-pet-delete').click()");await until("!document.getElementById('save').disabled",'blocked deletion');assert.match(await run("document.getElementById('message').textContent"),/启动默认/);
assert.equal(await run('previews.at(-1).codexPetId'),'codex-'+'a'.repeat(64));
await run("deleteMode='pending';document.querySelector('.local-pet-delete').click()");await until("!!window.finishDelete",'pending delete');assert.equal(await run("document.getElementById('save').disabled&&document.getElementById('import-local-pet').disabled&&document.querySelector('.local-pet-delete').disabled"),true);
await run("window.localPets=[];finishDelete({ok:true,id:localPet.id})");await until("!document.getElementById('save').disabled&&document.querySelectorAll('#local-pet-grid .pet-card').length===0",'delete completed');
await until("previews.at(-1).codexPetId==='codex-'+ 'b'.repeat(64)",'deleted draft restores active preview');
assert.equal(await run('saves.length'),2,'deleting a draft never writes settings');assert.equal(await run("document.getElementById('local-read-state').hidden"),false);assert.equal(await run("document.querySelectorAll('#pet-grid .pet-card').length"),1,'Codex library untouched');
await run("importMode='success';document.getElementById('import-local-pet').click()");await until("document.querySelectorAll('#local-pet-grid .pet-card').length===1&&!document.getElementById('import-local-pet').disabled",'reimport after deletion');
assert.equal(win.isVisible(),false);console.log('PASS local tab / empty retry / cancel failure preserve sheep / real sprite preview action pause / separate Codex copy / save / keyboard');win.destroy();app.exit(0);
}catch(error){console.error(error.stack);win?.destroy();app.exit(1);}});
}else require('node:test')('local partner import reuses real customizer DOM and player without applying until save',async()=>{const data=fs.mkdtempSync(path.join(os.tmpdir(),'local-pet-dom-'));try{const env={...process.env,PET_LOCAL_DOM_DATA:data};delete env.ELECTRON_RUN_AS_NODE;await new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(require('electron'),[__filename,'--local-pets-dom-child'],{env});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);child.on('exit',code=>code===0?resolve():reject(Error(output)));child.on('error',reject);});}finally{fs.rmSync(data,{recursive:true,force:true});}});
