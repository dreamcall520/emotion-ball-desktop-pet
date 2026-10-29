// Run with Node. Real Chromium DOM/native input; local fixture APIs never open user apps.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process'), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { encoding: 'utf8', env });
  if (result.stdout) process.stdout.write(result.stdout); if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status === 0 && result.stdout?.includes('\"passed\":true') ? 0 : 1);
}
const { app, BrowserWindow, ipcMain } = require('electron');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-shortcut-focus-')); app.setPath('userData', path.join(temp, 'userdata'));
const preload = path.join(temp, 'preload.cjs');
fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('qiuShortcuts',{getState:()=>ipcRenderer.invoke('fixture:get'),onState:callback=>{const f=(_e,v)=>callback(v);ipcRenderer.on('fixture:state',f);return()=>ipcRenderer.removeListener('fixture:state',f)},onColorMode:callback=>{ipcRenderer.on('fixture:color',(_e,...v)=>callback(...v));return()=>{}},recording(){},pointer(){},close(){},save:()=>Promise.resolve({ok:true}),setShape:()=>Promise.resolve({ok:true}),openAction:id=>ipcRenderer.send('fixture:action',id),openSettings:()=>ipcRenderer.send('fixture:action','settings')});`);
let win, session = 1, actions = [], failed = false;
const config = { enabled: true, shape: 'floating', launcher: 'Ctrl+Alt+Q', chat: '', custom: '', note: '', todo: '', pomodoro: '', noteBehavior: 'panel', todoBehavior: 'panel' };
const layout = { cardSize: 58, items: ['chat','custom','note','todo','pomodoro','settings'].map((id,i)=>({id,x:35+i%3*100,y:40+Math.floor(i/3)*95,width:58,height:58})) };
let current = { view:'floating', session, config, layout, focus:false, animation:{phase:'opening',duration:1} };
ipcMain.handle('fixture:get',()=>current);ipcMain.on('fixture:action',(_e,id)=>actions.push(id));
const run = code => win.webContents.executeJavaScript(code);
async function until(predicate,label) { const deadline=Date.now()+3000;while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,15));}console.error('FOCUS_DEBUG',label,await sample());throw Error('Timed out: '+label); }
async function show(view='floating',mode='standard',theme='blue') {
  current={...current,view,session:++session,focus:false,animation:{phase:'opening',duration:1}};
  win.hide(); win.webContents.send('fixture:state',current);win.webContents.send('fixture:color',mode,'light',theme);
  await until(async()=>await run(`document.body.dataset.session===${JSON.stringify(String(session))}`),'new session');
  win.show();win.focus();win.webContents.focus();await until(()=>run('document.hasFocus()'),'window focus');
  await run('Promise.allSettled(document.getAnimations().map(a=>a.finished))');
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
}
const sample = () => run(`({mode:document.documentElement.dataset.inputMode,pointerReady:document.documentElement.dataset.pointerReady,selected:[...document.querySelectorAll('[data-action][aria-current=true]')].filter(n=>n.getClientRects().length).map(n=>n.dataset.action),active:document.activeElement.dataset.action||'',visible:[...document.querySelectorAll('[data-action]')].filter(n=>n.getClientRects().length).map(n=>({id:n.dataset.action,outline:getComputedStyle(n).outlineStyle}))})`);
app.whenReady().then(async()=>{
  win=new BrowserWindow({show:false,width:416,height:330,webPreferences:{preload,contextIsolation:true,sandbox:true}});
  win.setIgnoreMouseEvents(true);
  await win.loadFile(path.resolve(__dirname,'../shortcuts.html'));
  await until(async()=>await run("document.body.dataset.session==='1'"),'initial render');
  const results=[];
  for(const mode of ['standard','accessible'])for(const view of ['floating','list']) {
    for(let repeat=0;repeat<3;repeat++) {
      await show(view,mode);let s=await sample();assert.deepEqual(s.selected,[]);assert.equal(s.active,'');assert(s.visible.every(n=>n.outline==='none'),JSON.stringify(s));
      // Native Tab enters the roving action group; arrows move the keyboard selection.
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});
      await until(async()=>(await sample()).selected.length===1,'arrow selection');
      s=await sample();assert.equal(s.mode,'keyboard');assert.equal(s.active,'chat');
      assert.equal(await run("getComputedStyle(document.activeElement).outlineStyle"),'solid',JSON.stringify(await sample()));
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});
      await until(async()=>(await sample()).active==='custom','next arrow');
      // Genuine pointer input removes keyboard current/focus instead of retaining a fake hovered selection.
      const position=await run(`(()=>{const r=document.querySelector('#${view} [data-action=custom]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2)+${repeat+1},y:Math.round(r.y+r.height/2)}})()`);
      win.setIgnoreMouseEvents(false);
      win.webContents.sendInputEvent({type:'mouseMove',...position});
      await run('new Promise(resolve=>requestAnimationFrame(resolve))');
      win.webContents.sendInputEvent({type:'mouseMove',x:position.x+1,y:position.y});
      await until(async()=>(await sample()).mode==='pointer','pointer modality');s=await sample();assert.deepEqual(s.selected,[]);assert.equal(s.active,'');win.setIgnoreMouseEvents(true);
      results.push({mode,view,repeat,cleanOpen:true,arrowNavigation:true,pointerReset:true});
    }
  }
  await show('floating');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  await until(async()=>(await sample()).selected.length===1,'Tab selection');assert.equal((await sample()).active,'chat');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});
  await until(()=>actions.includes('chat'),'Enter action');
  console.log(JSON.stringify({passed:true,repeatedOpens:results.length,modes:['standard','accessible'],views:['floating','list'],nativeTab:true,nativeArrows:true,nativePointerReset:true,noUserAppsOpened:true}));
}).catch(error=>{console.error(error);failed=true}).finally(()=>{win?.destroy();ipcMain.removeHandler('fixture:get');ipcMain.removeAllListeners('fixture:action');fs.rmSync(temp,{recursive:true,force:true});app.exit(failed?1:0)});
