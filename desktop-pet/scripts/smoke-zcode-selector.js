// Native fixture acceptance of the shared renderer; no app main, account or model requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const output = process.env.PET_ZCODE_SELECTOR_OUT || '/Users/allan/Documents/ChatGPT/F03｜球球桌面宠物/验收记录/ZCode联动-20261025/trend-selector';
if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-selector-'));
  const env = {...process.env,PET_ZCODE_SELECTOR_PROFILE:profile,PET_ZCODE_SELECTOR_OUT:output}; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'),[`--user-data-dir=${profile}`,__filename],{env,stdio:'inherit'});
  const deadline = setTimeout(()=>child.kill('SIGTERM'),60000);
  child.once('close',code=>{clearTimeout(deadline);fs.rmSync(profile,{recursive:true,force:true});process.exitCode=code === 0 ? 0 : 1;});
} else {
  const {app,BrowserWindow,ipcMain,nativeTheme,screen}=require('electron');
  assert.ok(process.env.PET_ZCODE_SELECTOR_PROFILE);app.setPath('userData',process.env.PET_ZCODE_SELECTOR_PROFILE);app.setActivationPolicy('accessory');app.on('window-all-closed',()=>{});
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const page=(win,code)=>win.webContents.executeJavaScript(code,true);
  async function poll(read,accept,label){for(let i=0;i<100;i++){const value=await read();if(accept(value))return value;await wait(30);}throw new Error(label);}
  async function pointer(win,selector){const p=await page(win,`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw new Error('missing target');n.scrollIntoView({block:'nearest',inline:'nearest'});const r=n.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);win.focus();for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...p,...(type==='mouseMove'?{}:{button:'left',clickCount:1})});await wait(50);}
  async function key(win,keyCode){win.webContents.sendInputEvent({type:'keyDown',keyCode});win.webContents.sendInputEvent({type:'keyUp',keyCode});await wait(50);}
  app.whenReady().then(async()=>{
    fs.mkdirSync(output,{recursive:true});const report={ok:false,fixtureOnly:true,actualModelCalls:0,scenarios:[],screenshots:[]};
    const { buildZcodeDetailsModel } = require('../lib/zcode-quota-view');
    const now=Date.now(),plans=['ZCode Start Plan 体验额度：每天重新计算，不同模型分别计量','ZCode Start Plan 体验额度：每天重新计算，不同模型分别计量','ZCode 1024 Dev Day 活动套餐：四个很长的来源名称也不能覆盖关闭按钮','ZCode 1024 Dev Day 活动套餐：四个很长的来源名称也不能覆盖关闭按钮'];
    const zitems=plans.map((planName,i)=>({id:`zcode:fixture-${i}`,label:i%2?'GLM-5.3-Flash':'GLM-5.3',planName,windowMinutes:i<2?1440:43200,periodStart:now-3600000,resetsAt:now+82800000,remaining:i===1?99.8706:100,remainingUnits:i===1?4993530:200000000,total:i===1?5000000:200000000,unit:'token',periodKind:i<2?'daily':'one_time'}));
    try {
      for(const source of ['zcode','codex'])for(const width of [320,404])for(const appearance of ['light','dark']){
        nativeTheme.themeSource=appearance;const prefix=`pet:${source}-details`,items=source==='zcode'?zitems:[{windowMinutes:300,remaining:64,resetsAt:now+7200000},{windowMinutes:10080,remaining:77,resetsAt:now+604800000}];
        const win=new BrowserWindow({width,height:520,show:false,frame:false,transparent:true,useContentSize:true,webPreferences:{preload:path.resolve(__dirname,'../codex-details-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,...(source==='zcode'?{additionalArguments:['--pet-source=zcode']}: {})}});
        let selected=source==='zcode'?items[0].id:300,closed=0,action='trend',estimated=false,monthWindow=false,paceCase=null,tinyDecline=false;const calls=[];
        const model=()=>{
          if(source!=='zcode')return {sourceId:source,action:'trend',items,period:selected,appearance,state:'ready',quotaUpdatedAt:now,trend:{windowMinutes:1440,resetsAt:now+82800000,samples:[{at:now-120000,remaining:90},{at:now-60000,remaining:87},{at:now,remaining:84}]}};
          const windows=[zitems[0],zitems[3],zitems[2],zitems[1]].map(item=>({...item,remaining:estimated?97:item.remaining,remainingUnits:estimated?item.total*.97:item.remainingUnits,...(monthWindow ? {periodStart:now-30*86400000,windowMinutes:31*1440} : {}),...(paceCase ? paceCase==='unknown' ? {periodStart:null,windowMinutes:null} : {periodStart:now-43200000,resetsAt:now+43200000,windowMinutes:1440,remaining:{fast:30,balanced:50,slow:90}[paceCase],remainingUnits:2000000*({fast:30,balanced:50,slow:90}[paceCase])} : {})}));
          const snapshot={enabled:true,quota:{state:'connected',stale:false,updatedAt:now,windows},history:{available:true,windows:windows.filter(item=>item.periodStart!==null).map(item=>({id:item.id,periodStart:item.periodStart,resetsAt:item.resetsAt,samples:(monthWindow ? [-1,0] : [-12,-8,-4,0]).map((minute,i)=>({at:now+minute*60000,remaining:estimated?100-i:tinyDecline?(i===3?item.remaining:100-(100-item.remaining)*i/3):item.remaining}))}))}};
          return buildZcodeDetailsModel(snapshot,{action,bucketId:selected,appearance},now);
        };
        const owns=e=>e.sender===win.webContents&&e.senderFrame===e.sender.mainFrame&&e.sender.getURL()===pathToFileURL(path.resolve(__dirname,'../codex-details.html')).href;
        const open=(event,next,id)=>{assert.ok(owns(event));assert.ok(['trend','quota'].includes(next));assert.ok(items.some(item=>source==='zcode'?item.id===id:item.windowMinutes===id));calls.push({action:next,id});selected=id;action=next;win.webContents.send(prefix,model());};
        const close=event=>{assert.ok(owns(event));closed++;};
        const resize=(event,height)=>{assert.ok(owns(event));win.setContentSize(width,Math.min(700,screen.getPrimaryDisplay().workArea.height-20,Math.max(120,height)));};
        ipcMain.on(`${prefix}-open`,open);ipcMain.on(`${prefix}-close`,close);ipcMain.on(`${prefix}-resize`,resize);
        try {
          await win.loadFile(path.resolve(__dirname,'../codex-details.html'));win.webContents.send(prefix,model());win.showInactive();
          await poll(()=>page(win,"document.querySelector('.title-product')?.textContent"),value=>value===source.toUpperCase(),'initial renderer');await wait(100);
          const geometry=await page(win,`(()=>{const r=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();return{width:innerWidth,scrollWidth:document.body.scrollWidth,header:r('.panel-header'),close:r('#details-close'),selector:r('.zcode-bucket-selector'),grid:r('.zcode-bucket-grid'),descriptionCount:document.querySelectorAll('.zcode-bucket-description').length,headerTabs:document.querySelectorAll('.panel-header .trend-tabs').length};})()`);
          assert.equal(geometry.width,width);assert.ok(geometry.scrollWidth<=width);assert.ok(geometry.close.right<=width&&geometry.close.left>=0);
          const scenario={source,width,appearance,geometry};report.scenarios.push(scenario);
          const capture=async suffix=>{await wait(80);const file=path.join(output,`${source}-${width}-${appearance}-${suffix}.png`);const image=await win.webContents.capturePage();assert.ok(!image.isEmpty());fs.writeFileSync(file,image.toPNG());report.screenshots.push(file);};
          if(source==='zcode'){
            assert.equal(geometry.headerTabs,0);assert.ok(geometry.selector.top>=geometry.header.bottom);assert.ok(geometry.grid.right<=width-12);assert.equal(geometry.descriptionCount,0);
            scenario.initialForecast=model().trend.forecast;
            assert.equal(scenario.initialForecast.reason,'no-decline');
            scenario.buttons=await page(win,`[...document.querySelectorAll('.zcode-bucket-button')].map(n=>({text:n.textContent,id:n.dataset.bucketOption,title:n.title,aria:n.getAttribute('aria-label'),selected:n.getAttribute('aria-pressed'),font:parseFloat(getComputedStyle(n).fontSize),rect:n.getBoundingClientRect().toJSON(),scrollWidth:n.scrollWidth,clientWidth:n.clientWidth}))`);
            assert.deepEqual(scenario.buttons.map(b=>b.text),['体验·5.3','体验·Flash','活动·5.3','活动·Flash']);
            assert.ok(scenario.buttons.every(b=>{const item=zitems.find(item=>item.id===b.id);return b.title===`${item.planName} · ${item.label}`&&b.aria===b.title;}));
            assert.ok(scenario.buttons.every(b=>b.font>=12&&b.scrollWidth<=b.clientWidth));
            assert.equal(new Set(scenario.buttons.map(b=>b.rect.top)).size,1,'all source chips stay on one row');
            assert.equal(await page(win,"document.querySelector('.forecast-badge')===null"),true);
            assert.match(await page(win,"document.querySelector('.forecast-copy').textContent"),/当前记录尚无消耗.*记录到消耗后/);
            assert.equal(await page(win,"document.querySelectorAll('.zcode-sample-info,.zcode-chart-caption').length"),0);
            assert.match(await page(win,"document.querySelector('.chart-help-body').textContent"),/实测余额.*时间基准/);
            assert.doesNotMatch(await page(win,"document.querySelector('.chart-help-body').textContent"),/次采样|\d{2}\/\d{2}/);
            scenario.flatCurve=await page(win,"({blue:document.querySelector('.observed-line').getBBox().height,timeReference:document.querySelector('.time-path').getBBox().height})");
            assert.equal(await page(win,"document.querySelector('.zcode-usage-note')===null"),true,'exact 100% model has no invented used amount');
            assert.equal(scenario.flatCurve.blue,0,'100% real samples must remain flat');assert.ok(scenario.flatCurve.timeReference>0,'time baseline changes independently');
            assert.match(await page(win,"document.querySelector('.zcode-countdown').textContent"),/小时/);
            await capture('flat-real-backend');
            const railState=()=>page(win,`(()=>{const n=document.querySelector('.zcode-bucket-grid'),r=n.getBoundingClientRect(),last=n.lastElementChild.getBoundingClientRect(),active=document.activeElement?.getBoundingClientRect();return{left:n.scrollLeft,scroll:n.scrollWidth,client:n.clientWidth,rect:r.toJSON(),last:last.toJSON(),active:active?.toJSON()};})()`);
            scenario.railInitial=await railState();
            if(width===320)assert.ok(scenario.railInitial.scroll>scenario.railInitial.client,'narrow rail must accept horizontal scrolling');
            else assert.ok(scenario.railInitial.scroll<=scenario.railInitial.client+1,'wide rail fits natural chip widths without forcing extra space');
            await page(win,"document.querySelector('.zcode-bucket-grid').scrollLeft=document.querySelector('.zcode-bucket-grid').scrollWidth");
            await wait(30);scenario.railScrolled=await railState();
            if(width===320)assert.ok(scenario.railScrolled.left>0);
            win.webContents.send(prefix,model());await wait(80);scenario.railRefresh=await railState();assert.equal(scenario.railRefresh.left,scenario.railScrolled.left,'background refresh preserves manually scrolled position');
            assert.ok(scenario.railRefresh.last.right<=scenario.railRefresh.rect.right,'last chip becomes pointer reachable');
            await pointer(win,'.zcode-bucket-button[data-bucket-option="zcode:fixture-3"]');
            await poll(()=>selected,value=>value===zitems[3].id,'one click bucket IPC');assert.equal(calls.length,1);
            await poll(()=>page(win,"document.querySelector('.zcode-bucket-button[aria-pressed=true]')?.title"),value=>value===`${zitems[3].planName} · ${zitems[3].label}`,'selected full title');
            assert.match(await page(win,"document.querySelector('.panel-bottom').textContent"),/使用截止/);assert.match(await page(win,"document.querySelector('.panel-bottom p').title"),/到期后剩余额度失效/);
            await key(win,'Home');await key(win,'Enter');await poll(()=>selected,value=>value===zitems[0].id,'keyboard bucket IPC');assert.equal(calls.length,2);
            assert.equal(await page(win,"document.activeElement.dataset.bucketOption"),zitems[0].id);
            scenario.railHome=await railState();assert.ok(scenario.railHome.active.left>=scenario.railHome.rect.left,'Home focuses a visible chip');
            await key(win,'End');scenario.railEnd=await railState();assert.ok(scenario.railEnd.active.right<=scenario.railEnd.rect.right,'End automatically reveals the last chip');
            await key(win,'Enter');await poll(()=>selected,value=>value===zitems[3].id,'End Enter selects the same last bucket');
            const selectedScroll=(await railState()).left;win.webContents.send(prefix,model());await wait(80);assert.equal((await railState()).left,selectedScroll,'selected refresh retains scroll position');
            await capture('rail-last-visible');await key(win,'Home');await key(win,'Enter');await poll(()=>selected,value=>value===zitems[0].id,'Home Enter returns to first bucket');
            estimated=true;win.webContents.send(prefix,model());await poll(()=>page(win,"document.querySelector('.forecast-badge').textContent"),value=>value==='可能提前用完','backend estimate');
            scenario.estimateForecast=model().trend.forecast;assert.equal(scenario.estimateForecast.reason,'estimate');
            assert.match(await page(win,"document.querySelector('.forecast-note').title"),/近期连续/);
            scenario.declineCurve=await page(win,"document.querySelector('.observed-line').getBBox().height");assert.ok(Math.abs(scenario.declineCurve-2.4)<0.01,'blue curve follows 100% to 97% actual quota samples');
            await capture('estimate-real-backend');
            estimated=false;win.webContents.send(prefix,model());await poll(()=>page(win,"document.querySelector('.forecast-note').dataset.reason"),value=>value==='no-decline','restore exact usage fixture');
            await pointer(win,'.panel-bottom .reset-link');await poll(()=>page(win,"document.querySelector('#details-panel').dataset.action"),value=>value==='quota','quota IPC');
            scenario.quota=await page(win,`({groups:[...document.querySelectorAll('.zcode-quota-group-title')].map(n=>n.textContent),rows:[...document.querySelectorAll('.zcode-quota-row')].map(n=>({aria:n.getAttribute('aria-label'),rect:n.getBoundingClientRect().toJSON(),scrollWidth:n.scrollWidth,clientWidth:n.clientWidth})),width:innerWidth,scrollWidth:document.body.scrollWidth,contentWidth:document.querySelector('#details-content').scrollWidth,panelWidth:document.querySelector('#details-panel').clientWidth})`);
            assert.deepEqual(scenario.quota.groups,['每日体验','限时活动']);assert.equal(scenario.quota.rows.length,4);
            assert.ok(scenario.quota.rows.every(row=>row.rect.right<=width-12&&row.scrollWidth<=row.clientWidth));
            assert.ok(scenario.quota.scrollWidth<=width&&scenario.quota.contentWidth<=scenario.quota.panelWidth);
            assert.match(scenario.quota.rows[1].aria,/4,993,530 \/ 5,000,000 token/);await capture('quota');
            await pointer(win,'.zcode-quota-row[data-bucket-id="zcode:fixture-2"]');await poll(()=>selected,value=>value===zitems[2].id,'whole row opens bucket trend');
            assert.equal(calls.at(-1).action,'trend');scenario.actualBucketChanges=calls.filter(call=>call.action==='trend').length;
            monthWindow=true;win.webContents.send(prefix,model());await pointer(win,'[data-view="daily"]');
            await poll(()=>page(win,"document.querySelector('.chart-block').dataset.view"),value=>value==='daily','month activity daily view');
            scenario.monthDaily=await page(win,`({dates:[...document.querySelectorAll('.daily-chart text')].filter(n=>/^\\d\\d\\/\\d\\d$/.test(n.textContent)).map(n=>({text:n.textContent,rect:n.getBoundingClientRect().toJSON()})),emptyDays:document.querySelectorAll('.daily-empty').length,points:[...document.querySelectorAll('.daily-point')].map(n=>({day:n.getAttribute('data-day'),amount:n.getAttribute('data-amount')})),help:document.querySelector('.chart-help-body').textContent,viewLabel:document.querySelector('[data-view="daily"]').textContent})`);
            assert.equal(scenario.monthDaily.dates.length,7);assert.equal(scenario.monthDaily.emptyDays,6);assert.equal(scenario.monthDaily.points.length,1);assert.equal(scenario.monthDaily.points[0].amount,'0');
            assert.match(scenario.monthDaily.viewLabel,/近7日/);assert.match(scenario.monthDaily.help,/不代表全天/);
            scenario.monthDaily.dates.forEach((date,index,dates)=>{if(index)assert.ok(dates[index-1].rect.right<date.rect.left,'month dates must not overlap');});
            await capture('month-near7-daily');await pointer(win,'[data-view="line"]');
            scenario.monthLineStart=await page(win,"document.querySelector('.trend-chart text[text-anchor=\"start\"]').textContent");
            const expectedStart=new Date(now-30*86400000);assert.equal(scenario.monthLineStart,`${String(expectedStart.getMonth()+1).padStart(2,'0')}/${String(expectedStart.getDate()).padStart(2,'0')}`,'line view retains the full cycle start');
            assert.equal(model().items.find(item=>item.bucketId===selected).periodStart,now-30*86400000,'full cycle model remains intact');
            monthWindow=false;scenario.paces=[];
            for(const state of ['fast','slow','balanced','unknown']){
              paceCase=state;win.webContents.send(prefix,model());
              await poll(()=>page(win,"document.querySelector('.trend-pace').className"),value=>value===`trend-pace ${state}`,'actual backend pace');
              const pace=await page(win,`(()=>{const n=document.querySelector('.trend-pace'),p=document.querySelector('.panel-bottom p'),link=document.querySelector('.panel-bottom .reset-link'),r=p.getBoundingClientRect(),v=p.querySelector('b').getBoundingClientRect();return{state:n.className,color:getComputedStyle(n).color,base:getComputedStyle(document.documentElement).getPropertyValue('--detail-surface'),footer:{rect:r.toJSON(),label:p.querySelector('span').getBoundingClientRect().toJSON(),value:v.toJSON(),link:link.getBoundingClientRect().toJSON(),scroll:p.scrollWidth,client:p.clientWidth},width:innerWidth,scrollWidth:document.body.scrollWidth};})()`);
              const rgb=text=>text.match(/[\d.]+/g).slice(0,3).map(Number),luminance=rgb=>rgb.map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
              const foreground=luminance(rgb(pace.color)),background=luminance(rgb(pace.base));pace.contrast=(Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05);
              assert.ok(pace.contrast>=4.5,'small pace text has readable contrast');assert.ok(pace.scrollWidth<=width);
              assert.ok(Math.abs(pace.footer.label.top-pace.footer.value.top)<1,'footer date stays on the label line');assert.ok(pace.footer.rect.right<pace.footer.link.left,'footer does not cover details action');assert.ok(pace.footer.scroll<=pace.footer.client);
              scenario.paces.push(pace);await capture(`pace-${state}`);
            }
            assert.equal(new Set(scenario.paces.map(p=>p.color)).size,4,'each pace state has a distinct color');
            paceCase=null;tinyDecline=true;win.webContents.send(prefix,model());await pointer(win,'.zcode-bucket-button[data-bucket-option="zcode:fixture-1"]');
            await poll(()=>page(win,"document.querySelector('.trend-stats strong').textContent"),value=>value==='99.9%','real Flash daily percentage');
            scenario.tinyUsage=await page(win,"({percentage:document.querySelector('.trend-stats strong').textContent,amount:document.querySelector('.zcode-usage-note').textContent,blueHeight:document.querySelector('.observed-line').getBBox().height})");
            assert.equal(scenario.tinyUsage.amount,'本周期已用 6,470 token');assert.ok(Math.abs(scenario.tinyUsage.blueHeight-0.10352)<0.0001,'tiny observed decline is not exaggerated');await capture('flash-daily-actual-usage');
          } else {assert.equal(geometry.headerTabs,1);assert.equal(await page(win,"document.querySelectorAll('.trend-tabs button').length"),2);assert.equal(await page(win,"document.querySelectorAll('.zcode-bucket-selector').length"),0);await capture('unchanged');}
          await pointer(win,'#details-close');assert.equal(closed,1,'close remains reachable');
        } finally {ipcMain.removeListener(`${prefix}-open`,open);ipcMain.removeListener(`${prefix}-close`,close);ipcMain.removeListener(`${prefix}-resize`,resize);win.destroy();}
      }
      report.ok=true;console.log('PET_ZCODE_SELECTOR_NATIVE_OK');
    } finally {fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
    app.exit(0);
  }).catch(error=>{console.error(error.stack||error);app.exit(1);});
}
