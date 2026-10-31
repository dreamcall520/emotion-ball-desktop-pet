const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
if(process.versions.electron&&process.argv.includes('--glass-child')){
 const {app,BrowserWindow,session}=require('electron');
 app.setPath('userData',process.env.PET_SHORTCUT_GLASS_DATA);app.setActivationPolicy('accessory');
 app.whenReady().then(async()=>{let win;try{
  session.defaultSession.webRequest.onBeforeRequest((d,done)=>done({cancel:/^https?:/.test(d.url)||/\.js(?:\?|$)/.test(d.url)}));
  win=new BrowserWindow({width:500,height:400,show:false,frame:false,transparent:true,useContentSize:true,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  await win.loadFile(path.resolve(__dirname,'../shortcuts.html'));
  const run=s=>win.webContents.executeJavaScript(s);
  await run(`document.getElementById('floating').hidden=false;document.getElementById('floating').innerHTML=['聊天','定制','便签','待办','番茄钟','设置'].map(t=>'<button class="action floating-action"><span class="action-icon"><svg></svg></span><span class="action-name">'+t+'</span></button>').join('');void 0`);
  const cdp=win.webContents.debugger;cdp.attach('1.3');await cdp.sendCommand('DOM.enable');await cdp.sendCommand('CSS.enable');await cdp.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const {root}=await cdp.sendCommand('DOM.getDocument');const {nodeId}=await cdp.sendCommand('DOM.querySelector',{nodeId:root.nodeId,selector:'.floating-action'});
  const {layoutShortcuts}=require('../lib/shortcut-layout');let count=0;
  for(const pet of [{x:600,y:400,width:80,height:80},{x:600,y:350,width:180,height:180},{x:20,y:20,width:80,height:80},{x:1340,y:800,width:80,height:80}])for(const theme of ['green','blue','purple'])for(const appearance of ['light','dark'])for(const mode of ['standard','accessible']){
   const layout=layoutShortcuts({petBounds:pet,workArea:{x:0,y:0,width:1440,height:900}});assert.equal(layout.items.length,6);win.setSize(layout.bounds.width,layout.bounds.height);
   await run(`Object.assign(document.documentElement.dataset,{uiTheme:'${theme}',appearance:'${appearance}',notesAppearance:'${appearance}',accessibleAppearance:'${appearance}',colorMode:'${mode}',inputMode:'keyboard'});document.getElementById('blue-style').disabled=${theme!=='blue'};(()=>{const l=${JSON.stringify(layout)},f=document.getElementById('floating');f.dataset.small=String(l.cardSize<58);f.style.setProperty('--card-font',(l.cardSize<58?11:13)+'px');[...f.children].forEach((b,i)=>{Object.assign(b.style,{left:l.items[i].x+'px',top:l.items[i].y+'px',width:l.items[i].width+'px',height:l.items[i].height+'px'})})})();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
   const measure=()=>run(`(()=>{const all=[...document.querySelectorAll('.floating-action')],b=all[0],s=getComputedStyle(b);return {image:s.backgroundImage,bg:s.backgroundColor,blur:s.backdropFilter,shadow:s.boxShadow,transform:s.transform,transition:s.transitionDuration,outline:s.outlineWidth,filter:getComputedStyle(document.body).filter,cards:all.map(e=>{const r=e.getBoundingClientRect(),n=e.querySelector('.action-name'),t=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom,textFits:t.x>=r.x&&t.right<=r.right&&t.y>=r.y&&t.bottom<=r.bottom&&n.scrollWidth<=n.clientWidth}}),width:innerWidth,height:innerHeight}})()`);
   const normal=await measure();assert.equal(normal.filter,'none');assert.equal(normal.transform,'none');assert.equal(normal.transition,'0s');for(const [i,c]of normal.cards.entries()){assert.equal(c.w,layout.items[i].width);assert.equal(c.h,layout.items[i].height);assert.ok(c.textFits,JSON.stringify({pet,theme,appearance,mode,c}));assert.ok(c.x>=5&&c.y>=5&&c.right<=normal.width-5&&c.bottom<=normal.height-5);}
   if(mode==='standard'){assert.match(normal.image,/linear-gradient/);assert.match(normal.blur,/blur\(18px\)/);assert.notEqual(normal.shadow,'none');}else{assert.equal(normal.image,'none');assert.match(normal.bg,/^rgb\(/);assert.equal(normal.blur,'none');assert.equal(normal.shadow,'none');}
   await cdp.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['hover','focus','focus-visible']});const hover=await measure();assert.deepEqual(hover.cards,normal.cards);assert.equal(hover.outline,'2px');if(mode==='standard')assert.notEqual(hover.shadow,normal.shadow);else{assert.equal(hover.shadow,'none');assert.equal(hover.image,'none');}await cdp.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});assert.equal(win.isVisible(),false);count++;
  }
  win.destroy();console.log('SHORTCUT_GLASS_OK '+count);app.exit(0);
 }catch(e){win?.destroy();console.error(e.stack);app.exit(1);}});
}else require('node:test')('floating shortcut glass preserves native geometry and accessible materials',{timeout:30000},()=>{const data=fs.mkdtempSync(path.join(os.tmpdir(),'shortcut-glass-'));try{const r=require('node:child_process').spawnSync(require('electron'),[__filename,'--glass-child'],{encoding:'utf8',timeout:25000,env:{...process.env,PET_SHORTCUT_GLASS_DATA:data}});assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/SHORTCUT_GLASS_OK 48/);}finally{fs.rmSync(data,{recursive:true,force:true});}});
