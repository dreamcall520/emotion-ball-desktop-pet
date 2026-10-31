const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');
const { dialog } = require('electron');
const { pointerClick } = require('./verify-chat-integration');
const { capturePaintedWindow } = require('./verify-codex-companion');

async function verifyLocalPetMotion({ pet, customize, getSettings, setSize, localStore, sendCommand, packaged, edgeTuck, getMenu, openChat, getChatWindow }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1');
  assert.equal(process.env.PET_SMOKE_CODEX_PETS_ONLY, '1');
  const folder = process.env.PET_LOCAL_PET_QA_FOLDER, output = process.env.PET_CODEX_PETS_QA_OUT;
  assert(folder && path.isAbsolute(folder) && output && path.isAbsolute(output));
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'pet.json'), 'utf8'));
  fs.mkdirSync(output, { recursive: true });
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const resources=manifest.spriteVersionNumber===3?Object.values(manifest.sheets).map(s=>s.path):[manifest.spritesheetPath];
  const sourceHash=createHash('sha256').update(resources.map(file=>hash(path.join(folder,file))).join('')).digest('hex');
  const page = code => customize.webContents.executeJavaScript(code, true);
  const desktop = code => pet.webContents.executeJavaScript(code, true);
  const poll = async (read, test, label, timeout = 7000) => {
    const until = performance.now() + timeout; let value;
    do { value = await read(); if (test(value)) return value; await wait(25); } while (performance.now() < until);
    assert.fail(label + ': ' + JSON.stringify(value));
  };
  const view = () => desktop(`(()=>{const c=document.querySelector('#pet .codex-pet-sprite');return c?{...c.dataset,width:c.width,height:c.height,cssHeight:c.getBoundingClientRect().height,mode:document.querySelector('#pet').dataset.mode}:null})()`);
  const capture = (win, name) => capturePaintedWindow({ win, artifactPath: path.join(output, name + '.png') });
  const errors = [];
  for (const win of [pet, customize]) {
    win.webContents.on('did-fail-load', (_event, code, description) => errors.push({ code, description }));
    win.webContents.on('render-process-gone', (_event, detail) => errors.push(detail));
    win.webContents.on('console-message', event => {
      if (event.level >= 3 || event.level === 'error') errors.push({ type: 'console', message: event.message });
    });
  }
  await poll(() => page('window.__customizerReady'), Boolean, 'customizer ready');
  await pointerClick(customize, '#source-local');
  const before = JSON.stringify(getSettings().customization);
  const originalPicker = dialog.showOpenDialog;
  let pickerCalls = 0;
  dialog.showOpenDialog = async (owner, options) => {
    assert.equal(owner, customize); assert.deepEqual(options.properties, ['openDirectory']); pickerCalls++;
    return { canceled: false, filePaths: [folder] };
  };
  try { await pointerClick(customize, '#import-local-pet');
    await poll(() => page("document.querySelector('#stage .codex-pet-sprite')?.dataset.codexReady"), x => x === 'ready', 'real local import preview');
  } finally { dialog.showOpenDialog = originalPicker; }
  assert.equal(pickerCalls, 1); assert.equal(JSON.stringify(getSettings().customization), before, 'import alone does not change desktop');
  const importedId = await page("document.querySelector('#local-pet-grid .pet-card[aria-pressed=true]').dataset.petId");
  const imported = localStore.getImported(importedId);
  assert.equal(imported.name, manifest.displayName); assert(imported.frameMap);
  for(const file of resources){const target=manifest.spriteVersionNumber===3?Object.values(imported.sheets).find(s=>s.path.endsWith('/'+file))?.path:imported.spritesheetPath;assert.equal(hash(target),hash(path.join(folder,file)),'independent imported bytes stay identical');}
  await page("document.getElementById('startup-default').checked=true");
  await pointerClick(customize, '#save');
  await poll(() => getSettings().customization.appearance.codexPetId, id => id === importedId, 'saved actual local pet');
  assert.equal(getSettings().startupAppearance.codexPetId, importedId);
  await poll(view, v => v?.codexReady === 'ready' && v.codexPetId === importedId, 'desktop local pet ready');
  const sizes = [];
  for (const [name, pixels] of [['micro', 60], ['tiny', 80], ['compact', 108], ['small', 120], ['medium', 180], ['large', 260]]) {
    assert.notEqual(setSize(name), false);
    const state = await poll(view, v => v?.codexReady === 'ready' && Math.abs(v.cssHeight - pixels) < 1, 'desktop size ' + name);
    assert.deepEqual([state.width, state.height], [576, 624]); sizes.push({ name, ...state });
  }
  await capture(customize, 'local-import-saved');
  await capture(pet, 'desktop-large-idle');
  const sleepEnteredAt=performance.now();sendCommand('sleep');
  const sleeping = await poll(view, v => v?.codexAction === 'sleep', 'actual sleep action');
  const sleepProgress = await poll(view, v => v?.codexAction === 'sleep' && v.codexFrame !== sleeping.codexFrame, 'sleep animation progresses');
  await capture(pet, 'desktop-sleep');
  let variationCheck=null;
  if(manifest.frameMap?.sleep?.variation){
    const spec=manifest.frameMap.sleep.variation,hasClip=v=>v?.codexAction==='sleep'&&/^\d+$/.test(v.codexVariant||'');
    const first=await poll(view,hasClip,'first actual timed variation',spec.initialDelayMs[1]+2500),firstAt=performance.now();
    assert(firstAt-sleepEnteredAt>=spec.initialDelayMs[0]-300);await capture(pet,'variation-first');process.stdout.write('PET_VARIATION_FIRST_VISIBLE\n');
    await poll(view,v=>v?.codexAction==='sleep'&&v.codexVariant==='base','variation returns to ordinary base',65000);const baseAt=performance.now();await capture(pet,'variation-base');
    let second=null,secondAt=null,samples=0;const end=baseAt+spec.intervalMs[1]+2500;
    while(performance.now()<end){const current=await view();samples++;assert.equal(current.codexAction,'sleep');if(hasClip(current)){second=current;secondAt=performance.now();break;}assert.equal(current.codexVariant,'base');await wait(125);}
    assert(second,'a second real timed variation occurs');assert(secondAt-baseAt>=spec.intervalMs[0]-300,'the complete configured breathing interval remains free of variants');if(spec.clips.length>1)assert.notEqual(second.codexVariant,first.codexVariant,'successive variants differ');await capture(pet,'variation-second');
    sendCommand('wake');await poll(view,v=>v?.codexAction!=='sleep'&&v.codexVariant==='base','wake immediately cancels active variation');await poll(view,v=>v?.codexAction==='idle','wake after variation returns idle');await capture(pet,'variation-wake-cleared');
    variationCheck={realClock:true,clockAdvanced:false,first,firstDelayMs:firstAt-sleepEnteredAt,baseAt,second,quietIntervalMs:secondAt-baseAt,baseSamples:samples,wakeCleared:true};process.stdout.write('PET_VARIATION_REAL_INTERVAL_OK\n');
    sendCommand('sleep');await poll(view,v=>v?.codexAction==='sleep'&&v.codexVariant==='base','new sleep starts at ordinary breathing');
  }
  let visualFixes = null;
  if (process.env.PET_CHUGE_VISUAL_QA === '1') {
    sendCommand('wake');
    await poll(view, v => v?.codexAction === 'idle', 'wake returns idle before edge comparison');
    const dbg=pet.webContents.debugger; if(!dbg.isAttached())dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    const edges=[];
    for (const side of ['left','right']) {
      edgeTuck.dock(side); edgeTuck.pin(true,'visual-qa');
      await poll(()=>desktop(`document.getElementById('pet').dataset.edge`),v=>v===side,'edge '+side);
      await wait(350);
      const state=await desktop(`(()=>{const p=document.getElementById('pet'),c=p.querySelector('canvas');const ctx=c.getContext('2d'),pixels=ctx.getImageData(0,0,c.width,c.height).data;return{presentation:p.dataset.presentation,edge:p.dataset.edge,frame:c.dataset.codexFrame,transform:getComputedStyle(c).transform,width:c.width,height:c.height}})()`);
      assert.equal(state.presentation,'tucked');
      if(side==='right') assert.equal(state.transform,'matrix(-1, 0, 0, 1, 0, 0)'); else assert(['none','matrix(1, 0, 0, 1, 0, 0)'].includes(state.transform));
      const image=await pet.webContents.capturePage();fs.writeFileSync(path.join(output,'desktop-edge-'+side+'.png'),image.toPNG());
      const bitmap=image.toBitmap();let alphaArea=0;for(let i=3;i<bitmap.length;i+=4)if(bitmap[i]>24)alphaArea++;
      edges.push({side,...state,alphaArea,imageSize:image.getSize(),bounds:pet.getBounds()});
      edgeTuck.pin(false,'visual-qa');
    }
    assert.equal(edges[0].frame,edges[1].frame,'compare same stationary frame');
    assert(Math.abs(edges[0].alphaArea-edges[1].alphaArea)/Math.max(edges[0].alphaArea,edges[1].alphaArea)<0.03,'same body exposure on both edges');
    edgeTuck.restore();
    await poll(()=>desktop(`getComputedStyle(document.querySelector('#pet canvas')).transform`),v=>['none','matrix(1, 0, 0, 1, 0, 0)'].includes(v),'restore original orientation');
    await dbg.sendCommand('Emulation.setEmulatedMedia',{features:[]});
    visualFixes={edges};
  }
  sendCommand('sleep');
  await poll(view, v => v?.codexAction === 'sleep', 'sleep before explicit wake check');
  sendCommand('wake');
  const waking = await poll(view, v => v?.codexAction === 'wakeup', 'actual wakeup action');
  await capture(pet, 'desktop-wakeup');
  const awake = await poll(view, v => v?.codexAction === 'idle', 'wake completes to idle');
  const extraActions=[];
  const interactionIds=require('../lib/codex-pet-player').getInteractionActions(imported);
  assert(interactionIds.length,'uploaded package supplies an actual non-idle interaction');
  let previous=null;
  for(const trigger of ['random','random','click','click']){
    if(trigger==='random')sendCommand('random');else await pointerClick(pet,'#pet');
    const start=await poll(view,v=>interactionIds.includes(v?.codexAction)&&v.codexReady==='ready','generic '+trigger+' selects uploaded clip');
    if(previous&&interactionIds.length>1)assert.notEqual(start.codexAction,previous,'generic interactions avoid consecutive duplicate clips');
    previous=start.codexAction;
    const progress=await poll(view,v=>v?.codexAction===start.codexAction&&v.codexFrame!==start.codexFrame,'real frames advance after '+trigger);
    await capture(pet,'desktop-'+trigger+'-'+extraActions.length);
    const done=await poll(view,v=>v?.codexAction==='idle','generic one-shot returns idle',12000);extraActions.push({trigger,start,progress,done});
  }
  assert(new Set(extraActions.map(item=>item.start.codexAction)).size>=Math.min(2,interactionIds.length));
  sendCommand('sleep');await poll(view,v=>v?.codexAction==='sleep','sleep before real body wake click');
  await pointerClick(pet,'#pet');await poll(view,v=>v?.codexAction==='idle','sleeping body click wakes to idle');
  let chatAvatar=null;
  if(manifest.spriteVersionNumber===3){
    await openChat();const chat=getChatWindow();assert(chat?.webContents,'real chat window opens');
    chatAvatar=await poll(()=>chat.webContents.executeJavaScript(`(()=>{const c=document.querySelector('#chat-avatar .codex-pet-sprite');return c?{...c.dataset,width:c.width,height:c.height}:null})()`),v=>v?.codexReady==='ready'&&v.codexPetId===importedId,'chat avatar reads base idle');
    assert.equal(chatAvatar.codexSheet,'base');assert.equal(chatAvatar.codexAction,'idle');
    await capture(chat,'chat-v3-avatar');
    const before=await view();sendCommand('random');await wait(200);assert.equal((await view()).codexAction,before.codexAction,'chat blocks generic uploaded actions');
    chat.close();await wait(200);
  }
  const walks = [];
  const debuggerApi = pet.webContents.debugger;
  if (!debuggerApi.isAttached()) debuggerApi.attach('1.3');
  const input = (type, x, y, pressed) => debuggerApi.sendCommand('Input.dispatchMouseEvent', {
    type, x, y, button: pressed ? 'left' : type === 'mouseReleased' ? 'left' : 'none',
    buttons: pressed ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1
  });
  if (visualFixes) {
    edgeTuck.dock('right'); const b=pet.getBounds();
    await poll(()=>desktop(`document.getElementById('pet').dataset.presentation`),v=>v==='tucked','right edge tucked before actual ink hover');
    await wait(250);const shot=await pet.webContents.capturePage(),size=shot.getSize(),bitmap=shot.toBitmap();let ink=null,distance=Infinity;
    for(let y=Math.floor(size.height*.25);y<Math.floor(size.height*.85);y++)for(let x=size.width-3;x>=Math.floor(size.width*.75);x--)if(bitmap[(y*size.width+x)*4+3]>240){const d=(x-size.width*.92)**2+(y-size.height*.5)**2;if(d<distance){distance=d;ink={x:b.x+(x+.5)/size.width*b.width,y:b.y+(y+.5)/size.height*b.height};}}
    assert(ink,'actual exposed opaque body exists');edgeTuck.sampleCursor(ink);edgeTuck.pin(true,'drag-qa');
    await poll(()=>desktop(`document.getElementById('pet').dataset.presentation`),v=>v==='peeked','right edge hover recalls full pet');
    await wait(250); await capture(pet,'desktop-edge-right-peek');
  }
  const x = 130, y = 130;
  await input('mouseMoved', x, y, false);
  await input('mousePressed', x, y, true);
  try {
    for (const [direction, delta] of [['right', 35], ['left', -35]]) {
      await input('mouseMoved', x + delta, y, true);
      const first = await poll(view, v => v?.codexAction === 'run-' + direction, 'actual drag walk ' + direction);
      const progressed = await poll(view, v => v?.codexAction === 'run-' + direction && v.codexFrame !== first.codexFrame, 'walk animation progresses ' + direction);
      let transform=null;
      if(visualFixes){ transform=await desktop(`getComputedStyle(document.querySelector('#pet canvas')).transform`);
        assert(Number(transform.match(/^matrix\(([^,]+)/)?.[1]??1)>0,'drag removes edge mirror while frameMap controls walk facing'); }
      await capture(pet, 'desktop-walk-' + direction); walks.push({ direction, first, progressed,transform });
    }
  } finally { await input('mouseReleased', x - 35, y, false); }
  sendCommand('rest');
  if(visualFixes){edgeTuck.pin(false,'drag-qa');edgeTuck.restore();}
  assert.equal(createHash('sha256').update(resources.map(file=>hash(path.join(folder,file))).join('')).digest('hex'),sourceHash); assert.deepEqual(errors, []);
  const result = { ok: true, packaged, source: folder, actualName: imported.name, importedId, sourceHash,
    nativeDirectoryPickerAutomated: false, directoryResultInjectedOnlyInExplicitSmoke: true,
    actualLocalImportIpc: true, savedStartup: true, chatAvatar, extraActions, visualFixes, variationCheck, sizes, sleeping, sleepProgress, waking, awake, walks, errors,
    realModelCalls: 0, installedProfileModified: false };
  fs.writeFileSync(path.join(output, 'report-local-motion.json'), JSON.stringify(result, null, 2));
  process.stdout.write('PET_LOCAL_PET_MOTION_OK\n');
}
module.exports = { verifyLocalPetMotion };
