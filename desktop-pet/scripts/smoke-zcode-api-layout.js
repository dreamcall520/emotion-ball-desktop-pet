// Isolated native controllers with fixture balances; no account, API or model access.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  // This fixture opens synthetic cards; never run it on the user's active desktop by default.
  assert.equal(process.env.PET_LAYOUT_VISIBLE_FIXTURE, '1', 'Visible layout fixtures require an isolated test desktop');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-api-layout-'));
  const env = { ...process.env, PET_LAYOUT_USER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio:'inherit' });
  child.on('exit', code => { fs.rmSync(data,{recursive:true,force:true}); process.exitCode=code??1; });
} else {
  const { app, BrowserWindow, screen, ipcMain } = require('electron');
  const root = process.env.PET_LAYOUT_APP_ROOT || path.resolve(__dirname,'../..');
  const { createQuotaLabelWindow } = require(path.join(root,'desktop-pet/lib/quota-label-window'));
  const { createApiUsageLabelWindow } = require(path.join(root,'desktop-pet/lib/api-usage-label-window'));
  const { createZcodeLink } = require(path.join(root,'desktop-pet/lib/zcode-link'));
  const { normalizeSettings } = require(path.join(root,'desktop-pet/lib/settings'));
  const { quotaFreeStackBounds } = require(path.join(root,'desktop-pet/lib/quota-label-placement'));
  const PetFacing = require(path.join(root,'desktop-pet/lib/pet-facing'));
  const SheepTheme = require(path.join(root,'desktop-pet/lib/sheep-theme'));
  const { capturePaintedWindow } = require(path.join(root,'desktop-pet/scripts/verify-codex-companion'));
  const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
  const out=process.env.PET_SMOKE_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(),'zcode-api-layout-artifacts-'));
  app.setPath('userData',process.env.PET_LAYOUT_USER_DATA); app.setActivationPolicy('accessory');
  app.on('window-all-closed',()=>{});
  app.whenReady().then(async()=>{
    fs.mkdirSync(out,{recursive:true}); const report={passed:false,fixture:true,noAccountApiOrModelAccess:true,root,cases:[],screenshots:[]};
    let pet,codex,api,zcode,background,bubbleWindow;
    try {
      const errors=[],onError=e=>errors.push(String(e));
      const area=screen.getPrimaryDisplay().workArea;
      background=new BrowserWindow({...area,frame:false,show:false,focusable:false,skipTaskbar:true,backgroundColor:'#f4f7fb'});
      await background.loadURL('data:text/html,<body style="background:%23f4f7fb"></body>');background.showInactive();
      pet=new BrowserWindow({x:area.x+400,y:area.y+120,width:80,height:80,frame:false,transparent:true,show:false,focusable:false,skipTaskbar:true,hasShadow:false});
      await pet.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<body style="margin:0;background:transparent"><svg width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="36" fill="#eee9e1"/><ellipse cx="29" cy="37" rx="3" ry="5" fill="#333"/><ellipse cx="51" cy="37" rx="3" ry="5" fill="#333"/><path d="M34 47 Q40 53 46 47" fill="none" stroke="#666" stroke-width="2"/></svg></body>'));
      assert.equal(await pet.webContents.executeJavaScript('document.characterSet'), 'UTF-8');
      assert.equal(await pet.webContents.executeJavaScript('document.querySelectorAll("svg ellipse").length'), 2);
      pet.setAlwaysOnTop(true,'floating');pet.showInactive();
      const settings=normalizeSettings({zcodeEnabled:true,zcodeQuotaAlwaysVisible:true,codexEnabled:true,codexQuotaAppearance:'light'});
      let plan=()=>null,syncGroup=()=>{},stack=()=>null,presentation={mode:'free',shape:'blob'},bubble=null,detailsOpened=0;
      codex=createQuotaLabelWindow({BrowserWindow,screen,getPetWindow:()=>pet,getSize:()=> 'compact',getAppearance:()=> 'light',getGuardEntry:()=>true,
        getObstacle:()=>bubble,
        getPresentation:()=>({...presentation,quotaGroupLayout:plan()?.cards.codex,quotaGroupNeighbors:[api?.getVisibleBounds(),zcode?.getVisibleBounds()].filter(Boolean)}),onLayout:()=>{syncGroup();zcode?.reposition();},onError});
      api=createApiUsageLabelWindow({BrowserWindow,screen,getPetWindow:()=>pet,getQuotaWindow:()=>codex.getWindow(),getQuotaBounds:()=>codex.getVisibleBounds(),
        getObstacleBounds:()=>bubble,
        getPresentation:()=>({...presentation,quotaGroupLayout:plan()?.cards.api}),getAppearance:()=> 'light',onOpenDetails:()=>detailsOpened++,onLayout:()=>{syncGroup();zcode?.reposition();},onError});
      // Exercise the real main helper rather than a different harness stacking rule.
      const main=fs.readFileSync(path.join(root,'desktop-pet/main.js'),'utf8');
      const now=Date.now(),windows=Array.from({length:4},(_,index)=>({id:`zcode:fixture:${index}`,label:index%2?'GLM-5.3-Flash':'GLM-5.3',model:index%2?'GLM-5.3-Flash':'GLM-5.3',
        planName:index<2?'ZCode Start Plan':'ZCode 体验额度',remaining:99.8706,remainingUnits:4993530,total:5000000,unit:'token',periodKind:'daily',periodStart:now-3600000,resetsAt:now+7200000,windowMinutes:180}));
      const snapshot={enabled:true,quota:{state:'connected',stale:false,updatedAt:now,windows},history:{available:true,windows:[],results:[]},tasks:{state:'unknown',items:[]}};
      zcode=createZcodeLink({BrowserWindow,screen,ipcMain,getPetWindow:()=>pet,getSettings:()=>settings,save:patch=>Object.assign(settings,patch),
        getPresentation:()=>({...presentation,quotaBottomAligned:true,quotaStackBelow:stack(),quotaGroupLayout:plan()?.cards.zcode}),onLayout:()=>syncGroup(),
        getObstacles:()=>[codex.getVisibleBounds(),api.getWindow()?.isVisible()?api.getWindow().getBounds():null,bubble].filter(Boolean),
        createCompanion:()=>({getSnapshot:()=>snapshot,setEnabled:async()=>{},refresh:async()=>{},close(){}}),onError});
      const scope={quotaLabel:codex,apiUsageLabel:api,zcodeLink:zcode,petWindow:pet,screen,settings,SheepTheme,PetFacing,sheepQuotaInk:null,quotaFreeStackBounds,
        edgeTuck:{getPresentation:()=>presentation},quotaDisplayConfig:()=>({style:'card'}),quotaObstacleBounds:()=>bubble,safelyInvokeWindow:(_s,fn)=>fn()};
      Function('scope','with(scope){'+main.slice(main.indexOf("let quotaFreeStackKey ="),main.indexOf('\nfunction reportQuotaError'))+';scope.plan=quotaFreeStackPlan;scope.sync=syncQuotaFreeStack;scope.stack=zcodeQuotaStackBounds;}')(scope);
      plan=scope.plan;syncGroup=scope.sync;stack=scope.stack;
      const poll=async(read,accept,label)=>{let value;const end=Date.now()+5000;do{value=await read();if(accept(value))return value;await wait(30);}while(Date.now()<end);throw Error(label+': '+JSON.stringify(value));};
      const click=async(win,selector)=>{const point=await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
        win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await wait(40);};
      const expanded=async()=>zcode.getWindow().webContents.executeJavaScript("document.getElementById('quota-label').dataset.expanded==='true'");
      const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
      const inside=r=>r.x>=area.x&&r.y>=area.y&&r.x+r.width<=area.x+area.width&&r.y+r.height<=area.y+area.height;
      const state={connected:true,busy:false,error:null,config:{},report:{month:'2026-10',updatedAt:now,costs:{month:[{currency:'USD',value:1.23}],today:[{currency:'USD',value:.04}]},usage:{inputTokens:120,outputTokens:30,cachedInputTokens:null,requests:2}}};
      codex.show({state:'ready',items:[{label:'5小时',remaining:64,windowMinutes:300}]});zcode.sync();
      await poll(()=>zcode.getVisibleBounds(),Boolean,'initial ZCode');
      for(const [name,x,y] of [['center',area.x+Math.round(area.width/2)-40,area.y+100],['near-bottom',area.x+Math.round(area.width/2)-40,area.y+area.height-150],['top-left',area.x,area.y],['top-right',area.x+area.width-80,area.y],
        ['bottom-left',area.x,area.y+area.height-80],['bottom-right',area.x+area.width-80,area.y+area.height-80]]) {
        api.hide();pet.setBounds({x,y,width:80,height:80},false);codex.reposition();zcode.reposition();await wait(80);
        const originalCodex=codex.getWindow().getBounds();
        for(const stage of ['off','connected','expanded','collapsed','off-again','unconnected']) {
          if(stage.startsWith('off'))api.hide();
          else if(stage==='connected'||stage==='unconnected') {api.show(stage==='unconnected'?{connected:false}:state);await poll(()=>api.getVisibleBounds(),Boolean,'API show');}
          else {await click(api.getWindow(),stage==='expanded'?'#quota-label':'#compact-header');await poll(()=>api.getWindow().getBounds().height,h=>h===(stage==='expanded'?92:32),'API resize');}
          for(const zExpanded of [false,true]) {
            if(await expanded()!==zExpanded)await click(zcode.getWindow(),zExpanded?'#quota-label':'button[aria-label="收起额度卡片"]');
            await poll(expanded,value=>value===zExpanded,'ZCode resize');await wait(90);
            const z=zcode.getWindow().getBounds(),c=codex.getVisibleBounds(),a=api.getVisibleBounds(),p=pet.getBounds();
            assert.ok(inside(z),JSON.stringify({name,stage,zExpanded,z}));
            for(const obstacle of [p,c,a].filter(Boolean))assert.equal(overlap(z,obstacle),false,JSON.stringify({name,stage,zExpanded,z,obstacle}));
            const group=plan();assert.deepEqual(p,{x,y,width:80,height:80},'the pet never moves to accommodate cards');
            if(group){
              const faces=[c,a,zcode.getVisibleBounds()];assert.ok(faces.every(face=>face.x+face.width/2===c.x+c.width/2));
              for(let i=1;i<faces.length;i++)assert.equal(group.placement==='above'?faces[i-1].y-faces[i].y-faces[i].height:faces[i].y-faces[i-1].y-faces[i-1].height,8);
              if(name==='near-bottom'||name.startsWith('bottom'))assert.equal(group.placement,'above');
              if(name==='center'||name.startsWith('top'))assert.equal(group.placement,'below');
            }else if(!a)assert.deepEqual(codex.getWindow().getBounds(),originalCodex,'single and dual cards retain the original Codex placement');
            report.cases.push({name,stage,zExpanded,pet:p,codex:c,api:a,zcode:z,placement:group?.placement||'legacy'});
            if((name==='center'&&['connected','expanded','off-again','unconnected'].includes(stage))||(['near-bottom','bottom-right'].includes(name)&&stage==='expanded')) {
              const file=`${name}-${stage}-${zExpanded?'expanded':'compact'}.png`,wins=[pet,codex.getWindow(),api.getWindow(),zcode.getWindow()].filter(w=>w?.isVisible());
              for(const [index,win]of wins.entries())await capturePaintedWindow({win,artifactPath:path.join(out,file.replace('.png',`-${index}.png`))});
              for(const win of wins)win.moveTop();await wait(180);
              const rs=wins.map(w=>w.getBounds()),left=Math.min(...rs.map(r=>r.x)),top=Math.min(...rs.map(r=>r.y)),right=Math.max(...rs.map(r=>r.x+r.width)),bottom=Math.max(...rs.map(r=>r.y+r.height));
              require('node:child_process').execFileSync('/usr/sbin/screencapture',['-x','-R',`${left},${top},${right-left},${bottom-top}`,path.join(out,file)]);
              report.screenshots.push(file);
            }
          }
        }
      }
      report.peek=[];
      for(const side of ['left','right']){
        presentation={mode:'peeked',side,shape:'blob'};pet.setBounds({x:side==='left'?area.x:area.x+area.width-80,y:area.y+240,width:80,height:80},false);
        codex.reposition();api.show(state);api.reposition();zcode.reposition();await wait(120);assert.equal(plan(),null);
        const {quotaLabelBounds}=require(path.join(root,'desktop-pet/lib/quota-label-placement'));
        const expected=quotaLabelBounds(pet.getBounds(),area,null,'compact',false,1,{...presentation,quotaRoleWidth:22},false,true);
        assert.deepEqual(codex.getWindow().getBounds(),{x:expected.x,y:expected.y,width:expected.width,height:expected.height},'peeked Codex geometry remains the legacy result');
        report.peek.push({side,codex:codex.getVisibleBounds(),api:api.getVisibleBounds(),zcode:zcode.getVisibleBounds()});
      }
      presentation={mode:'free',shape:'blob'};pet.setBounds({x:area.x+Math.round(area.width/2)-40,y:area.y+300,width:80,height:80},false);
      if(await expanded())await click(zcode.getWindow(),'button[aria-label="收起额度卡片"]');api.show(state);
      bubble={x:pet.getBounds().x-80,y:pet.getBounds().y+84,width:240,height:72};
      bubbleWindow=new BrowserWindow({...bubble,frame:false,show:false,focusable:false,skipTaskbar:true,backgroundColor:'#dae7fc'});
      await bubbleWindow.loadURL('data:text/html,<body style="background:%23dae7fc"></body>');bubbleWindow.showInactive();codex.reposition();api.reposition();zcode.reposition();await wait(120);
      assert.equal(plan()?.placement,'above','the below bubble rejects only the below group candidate');
      report.bubble={bounds:bubble,placement:plan().placement};bubbleWindow.destroy();bubble=null;
      presentation={mode:'free',shape:'blob'};pet.setBounds({x:area.x+Math.round(area.width/2)-40,y:area.y+area.height-150,width:80,height:80},false);codex.reposition();api.show({connected:false});zcode.reposition();await wait(120);
      await click(api.getWindow(),'#quota-label');assert.equal(detailsOpened,1);
      let guards=0;codex.getWindow().webContents.on('ipc-message',(_event,channel)=>{if(channel==='pet:quota-guard-open')guards++;});await click(codex.getWindow(),'#quota-guard-entry');assert.equal(guards,1);
      report.interaction={apiEntry:true,guardEntry:true};
      assert.deepEqual(errors,[]);report.passed=true;report.area=area;
      zcode.close();api.destroy();codex.destroy();pet.destroy();background.destroy();
      fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('ZCODE_API_LAYOUT_NATIVE_OK',JSON.stringify({cases:report.cases.length,out}));app.exit(0);
    }catch(error){report.error=error.stack;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));zcode?.close();api?.destroy();codex?.destroy();pet?.destroy();background?.destroy();bubbleWindow?.destroy();console.error(error.stack);app.exit(1);}
  });
}
