// Run with Node: verify expanded content stays stable while the native viewport changes width.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process'), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { env, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout); if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status === 0 && result.stdout?.includes('"passed":true') ? 0 : 1);
}
const { app, BrowserWindow } = require('electron');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuquiu-expanded-width-')); app.setPath('userData', path.join(temporary, 'userdata'));
let win, failed = false;
app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, frame: false, width: 196, height: 160, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const run = code => win.webContents.executeJavaScript(code), results = [];
  for (const [file, selectors] of [['quota-label.html',['#codex-expanded']],['api-usage-label.html',['#compact-header','#api-details']],['workbuddy-label.html',['#details']],['api-balance-label.html',['#full']]]) {
    await win.loadFile(path.resolve(__dirname, '..', file));
    win.showInactive();
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await run(`document.getElementById('quota-label').dataset.expanded='true';document.querySelectorAll(${JSON.stringify(selectors.join(','))}).forEach(n=>n.hidden=false);`);
    const motion = await run(`(async()=>{
      const label=document.getElementById('quota-label');
      label.dataset.expanded='false'; await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const roots=Array.from(document.querySelectorAll(${JSON.stringify(selectors.join(','))}));
      const fields=roots.flatMap(root=>[root,...root.querySelectorAll('span,strong,b,p')]);
      const geometry=()=>fields.map(n=>({fontSize:getComputedStyle(n).fontSize,transform:getComputedStyle(n).transform}));
      label.dataset.expanded='true'; await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const before=geometry();
      const animations=roots.flatMap(root=>root.getAnimations());
      for(const animation of animations){animation.pause();animation.currentTime=50;}
      const frames=animations.flatMap(a=>a.effect.getKeyframes());
      const beam=label.parentElement,edge=beam.getAnimations()[0];
      if(!edge)throw Error('missing opening boundary');edge.pause();edge.currentTime=60;
      const opening=beam.getBoundingClientRect().width,openingCenter=beam.getBoundingClientRect().left+opening/2;
      edge.currentTime=180;
      const during=geometry();
      for(const animation of animations){animation.currentTime=120;}
      const after=geometry();
      label.dataset.expanded='false'; await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const collapsedAnimations=roots.flatMap(root=>root.getAnimations()).length;
      const closingEdge=beam.getAnimations()[0];if(!closingEdge)throw Error('missing closing boundary');closingEdge.pause();closingEdge.currentTime=60;
      const closing=beam.getBoundingClientRect().width,closingCenter=beam.getBoundingClientRect().left+closing/2;
      closingEdge.currentTime=180;
      label.dataset.expanded='true'; await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const interrupted=beam.getAnimations()[0];interrupted.pause();interrupted.currentTime=70;
      const interruptedWidth=beam.getBoundingClientRect().width,interruptedLeft=beam.getBoundingClientRect().left;
      label.dataset.expanded='false'; await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const reversed=beam.getAnimations()[0];reversed.pause();reversed.currentTime=0;
      const reversedWidth=beam.getBoundingClientRect().width,reversedLeft=beam.getBoundingClientRect().left;
      reversed.currentTime=180;
      label.dataset.expanded='true'; await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      for(const animation of beam.getAnimations())animation.finish();
      return {before,during,after,frames,collapsedAnimations,count:animations.length,opening,closing,interruptedWidth,reversedWidth,interruptedLeft,reversedLeft,openingCenter,closingCenter,compactWidth:label.dataset.size==='compact'?128:168};
    })()`);
    assert(Math.abs(motion.openingCenter-98)<.1,file+' expansion stays centered');
    assert(Math.abs(motion.closingCenter-98)<.1,file+' collapse stays centered');
    assert(Math.abs(motion.interruptedLeft-motion.reversedLeft)<.1,file+' rapid toggle preserves border position');
    assert(Math.abs(motion.interruptedWidth-motion.reversedWidth)<.1,file+' rapid toggle resumes current border');
    assert(motion.opening>motion.compactWidth&&motion.opening<196,file+' glass expands between real bounds');
    assert(motion.closing>motion.compactWidth&&motion.closing<196,file+' glass collapses between real bounds');
    assert(motion.count>0, file+' expansion fades visible content');
    assert.deepEqual(motion.during,motion.before,file+' font sizes and transforms stay constant mid-frame');
    assert.deepEqual(motion.after,motion.before,file+' geometry stays constant at completion');
    assert.equal(motion.collapsedAnimations,0,file+' collapse cancels expansion fade');
    for(const frame of motion.frames){assert.equal(frame.transform,undefined);assert.equal(frame.fontSize,undefined);}
    for (const appearance of ['light','dark']) {
      await run(`document.documentElement.dataset.appearance=${JSON.stringify(appearance)}`);
      for (const width of [128, 144, 160, 176, 196]) {
        win.setSize(width, 160);
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const sizes = await run(`Array.from(document.querySelectorAll(${JSON.stringify(selectors.join(','))})).map(n=>({id:n.id,width:n.getBoundingClientRect().width,minWidth:getComputedStyle(n).minWidth}))`);
        for (const size of sizes) { assert.equal(size.width,174,JSON.stringify({file,appearance,width,size})); assert.equal(size.minWidth,'174px'); }
        results.push({file,appearance,viewport:width,widths:sizes.map(s=>s.width)});
      }
    }
  }
  await run(`document.getElementById('quota-label').dataset.expanded='false';new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await run(`document.getElementById('quota-beam').getAnimations().forEach(a=>a.finish())`);
  win.setSize(128,32);
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await run(`document.getElementById('quota-beam').getBoundingClientRect().left`),0,'native compact resize resets beam left');
  // Use the same placement function as the main controller, including its 184px guard host.
  const {quotaFreeStackBounds}=require('../lib/quota-label-placement');
  const area=require('electron').screen.getPrimaryDisplay().workArea;
  for(const side of ['right','left']){
    const pet={x:side==='right'?area.x:area.x+area.width-80,y:area.y+100,width:80,height:80};
    const cards={codex:{width:128,height:32,inset:2,guardTargetWidth:48},api:{width:128,height:32,inset:2},workbuddy:{width:128,height:32,inset:2},balance:{width:128,height:32,inset:2}};
    const plan=quotaFreeStackBounds(pet,area,cards,{mode:'free',quotaCardOrder:Object.keys(cards)});
    const screenFaces=[];
    for(const [id,file] of [['codex','quota-label.html'],['api','api-usage-label.html'],['workbuddy','workbuddy-label.html'],['balance','api-balance-label.html']]){
      const placement=plan.cards[id];win.setBounds({x:placement.x,y:placement.y,width:placement.width,height:placement.height});
      await win.loadFile(path.resolve(__dirname,'..',file));win.showInactive();
      await run(`(()=>{const label=document.getElementById('quota-label');label.dataset.size='compact';label.dataset.expanded='false';document.body.dataset.guardEntry=${JSON.stringify(id==='codex'?'true':'false')};document.body.dataset.guardSize='compact';document.body.dataset.guardSide=${JSON.stringify(placement.guardSide||side)};document.body.style.setProperty('--quota-card-left',${JSON.stringify((placement.cardInset?.x||0)+'px')});document.body.style.setProperty('--quota-card-top',${JSON.stringify((placement.cardInset?.y||0)+'px')});window.dispatchEvent(new Event('resize'));})()`);
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const face=await run(`(()=>{const r=document.getElementById('quota-label').getBoundingClientRect(),beam=document.getElementById('quota-beam');return {x:r.left,y:r.top,width:r.width,height:r.height,inline:[beam.style.inset,beam.style.left,beam.style.width,beam.style.height]}})()`);
      const native=win.getBounds();assert.equal(native.x+face.x,placement.face.x,id+' '+side+' face screenx matches real main placement');
      assert.equal(native.y+face.y,placement.face.y,id+' '+side+' face screeny matches real main placement');
      assert.deepEqual(face.inline,['','','',''],id+' '+side+' motion leaves guard CSS ownership intact');
      screenFaces.push(native.x+face.x);
    }
    assert.equal(new Set(screenFaces).size,1,side+' guarded Codex and other cards align');
  }
  // Guard transition metadata uses union-host coordinates from the native controller.
  win.setBounds({x:100,y:100,width:252,height:144});
  await win.loadFile(path.resolve(__dirname,'..','quota-label.html'));win.showInactive();
  const motionSource=fs.readFileSync(path.resolve(__dirname,'..','quota-card-motion.js'),'utf8').replace("if(typeof window==='undefined')return;","window.createQuotaExpandMotion=createQuotaExpandMotion;return;");
  await run(motionSource);
  const guardTransition=await run(`(async()=>{
    const label=document.getElementById('quota-label'),beam=label.parentElement;
    document.body.dataset.guardEntry='true';document.body.dataset.guardSize='compact';label.dataset.size='compact';
    document.body.style.setProperty('--quota-card-left','56px');document.body.style.setProperty('--quota-card-top','18px');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    window.guardMotion=createQuotaExpandMotion(label,{matches:false,addEventListener(){},removeEventListener(){}});
    const value={from:{left:56,top:18,width:128,height:32},to:{left:0,top:0,width:196,height:144},host:{width:252,height:144},duration:180};
    guardMotion.update({cardTransition:value,cardViewport:{host:value.host,face:value.to}});label.dataset.expanded='true';
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const edge=beam.getAnimations()[0];edge.pause();edge.currentTime=75;
    const r=beam.getBoundingClientRect(),field=document.getElementById('codex-expanded');
    const middle={left:r.left,top:r.top,width:r.width,height:r.height,font:getComputedStyle(field).fontSize,transform:getComputedStyle(field).transform};
    guardMotion.update({cardTransition:{from:value.to,to:value.from,host:value.host,duration:180},cardViewport:{host:value.host,face:value.from}});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const reverse=beam.getAnimations()[0];reverse.pause();reverse.currentTime=0;
    const rr=beam.getBoundingClientRect();
    return {middle,reverse:{left:rr.left,top:rr.top,width:rr.width,height:rr.height}};
  })()`);
  assert(guardTransition.middle.width>128&&guardTransition.middle.width<196,'guard border has real intermediate width');
  assert(guardTransition.middle.height>32&&guardTransition.middle.height<144,'guard border has real intermediate height');
  assert(guardTransition.middle.left>0&&guardTransition.middle.left<56,'guard border moves within union host');
  assert.equal(guardTransition.middle.transform,'none','guard fields never scale');
  for(const key of ['left','top','width','height'])assert(Math.abs(guardTransition.middle[key]-guardTransition.reverse[key])<.1,'guard reverse continues '+key);
  await run("document.getElementById('quota-beam').getAnimations().forEach(a=>a.finish())");
  await run('new Promise(resolve=>requestAnimationFrame(resolve))');
  assert.deepEqual(await run("(()=>{const b=document.getElementById('quota-beam'),l=document.getElementById('quota-label');return [b.style.left,b.style.top,b.style.width,b.style.height,l.style.width,l.style.height]})()"),['56px','18px','128px','32px','',''],'carrier retains the final face without native reset');
  await run('guardMotion.destroy()');
  console.log(JSON.stringify({passed:true,variants:results.length,expandedContentWidth:174,viewportWidths:[128,144,160,176,196],files:4,appearances:2,transformsAdded:false,expansionFadeMs:120,fontGeometryStable:true,guardSourceGeometrySides:2,guardAlignedCards:4,guardTransitionMiddle:guardTransition.middle}));
}).catch(error=>{failed=true;console.error(error)}).finally(()=>{win?.destroy();fs.rmSync(temporary,{recursive:true,force:true});app.exit(failed?1:0)});
