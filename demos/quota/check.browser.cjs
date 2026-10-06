/* Existing Playwright only: NODE_PATH=... QIUQIU_SITE_URL=http://127.0.0.1:4185/ node demos/quota/check.browser.cjs */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const base=process.env.QIUQIU_SITE_URL||'http://127.0.0.1:4185/';
const out=process.env.QIUQIU_QA_OUTPUT||'/tmp/qiuqiu-live-app-demos';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const errors=[],failed=[],externalRequests=[];const report={base,browser:'Chrome / existing Playwright; Browser plugin not available',layouts:[],interactions:[],errors,failed,externalRequests};
 try{
  const page=await browser.newPage({viewport:{width:1100,height:740}});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)failed.push(r.status()+' '+r.url());});
  page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin)externalRequests.push(r.url());});
  await page.goto(base+'demos/quota/index.html');assert.match(await page.title(),/额度卡片 2.0/);
  const quota=page.frameLocator('#quota-frame'),detail=page.frameLocator('#detail-frame'),api=page.frameLocator('#api-label-frame');
  await quota.locator('.v20-value').first().waitFor();assert.equal(await quota.locator('.v20-value').count(),2);assert.match(await detail.locator('#details-title').innerText(),/额度趋势/);
  assert.equal(await detail.locator('.trend-chart').count(),1);
  const cardRect=selector=>page.locator(selector).evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,nativeWidth:e.contentWindow.innerWidth,nativeHeight:e.contentWindow.innerHeight}));
  const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.1,`${actual} differs from ${expected}`);
  const scenarioSelect=page.locator('#demo-scenario');
  await scenarioSelect.click();await scenarioSelect.selectOption('fast');await page.waitForFunction(()=>QiuqiuQuotaDemo.getState().scenario==='fast');
  assert.equal(await scenarioSelect.evaluate(e=>document.activeElement===e),true);assert.equal(await scenarioSelect.getAttribute('data-focus-mode'),'pointer');assert.equal(await scenarioSelect.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
  const pointerScreenshot=path.join(out,'quota-pointer-fast.png');await page.screenshot({path:pointerScreenshot,fullPage:true});
  await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.equal(await scenarioSelect.evaluate(e=>document.activeElement===e),true);assert.equal(await scenarioSelect.getAttribute('data-focus-mode'),'keyboard');assert.equal(await scenarioSelect.evaluate(e=>getComputedStyle(e).outlineWidth),'1px');assert.equal(await scenarioSelect.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
  assert.equal(await scenarioSelect.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),edge=parseFloat(s.outlineWidth)+parseFloat(s.outlineOffset);return r.top>=edge&&r.left>=edge&&r.right+edge<=innerWidth;}),true);
  const keyboardScreenshot=path.join(out,'quota-keyboard-focus.png');await page.screenshot({path:keyboardScreenshot,fullPage:true});report.focus={pointerScreenshot,keyboardScreenshot};
  await scenarioSelect.selectOption('balanced');await page.waitForFunction(()=>QiuqiuQuotaDemo.getState().scenario==='balanced');
  report.interactions.push('mouse scenario selection remains focused without outline; Tab returns a 1px keyboard focus; unified toolbar and native card/detail alignment');
  let rect=await cardRect('#quota-frame');near(rect.width,280);near(rect.height,280*144/196);assert.equal(rect.nativeWidth,196);assert.equal(rect.nativeHeight,144);
  rect=await cardRect('#api-label-frame');near(rect.width,280);near(rect.height,280*92/196);near((await cardRect('#detail-frame')).width,792);
  assert.equal(await page.locator('#demo-feedback').isVisible(),false);assert.doesNotMatch(await page.locator('main').innerText(),/公开界面|网页演示不连接账户|此处为合成示例/);
  await quota.locator('.v20-collapse').click();await page.waitForFunction(()=>QiuqiuQuotaDemo.getState().expanded===false);rect=await cardRect('#quota-frame');near(rect.width,280*128/196);near(rect.height,280*32/196);assert.equal(rect.nativeWidth,128);assert.equal(rect.nativeHeight,32);
  await quota.locator('#quota-label').press('Enter');await page.waitForFunction(()=>QiuqiuQuotaDemo.getState().expanded===true);
  await api.locator('#quota-label').press('Enter');await page.waitForFunction(()=>QiuqiuQuotaDemo.getState().apiExpanded===false);rect=await cardRect('#api-label-frame');near(rect.width,280*128/196);near(rect.height,280*32/196);await api.locator('#quota-label').press('Enter');await page.waitForFunction(()=>QiuqiuQuotaDemo.getState().apiExpanded===true);
  await quota.locator('[data-action="opportunities"]').click();await detail.locator('.opportunity-history > summary').click();assert.match(await detail.locator('.opportunity-history').innerText(),/已获得/);
  await quota.locator('[data-action="credits"]').click();assert.match(await detail.locator('.balance-value').innerText(),/1,250/);
  await quota.locator('[data-action="tasks"]').click();await detail.locator('.activity-item').click();await page.waitForFunction(()=>document.querySelector('#thread-title').textContent.includes('检查示例'));assert.match(await page.locator('#thread-title').innerText(),/检查示例/);await page.locator('#thread-close').click();
  await quota.locator('[data-action="results"]').click();await detail.locator('.activity-item').click();await page.locator('#thread-close').click();assert.match(await detail.locator('#details-content').innerText(),/暂无待查看/);
  await quota.locator('[data-action="trend"]').click();await detail.locator('[data-period="300"]').click();assert.match(await detail.locator('#details-content').innerText(),/82%/);
  await page.locator('#demo-scenario').selectOption('unknown');await page.waitForFunction(()=>document.querySelector('#detail-frame').contentDocument.querySelector('.forecast-copy').textContent.includes('暂无法预估额度用完时间'));assert.match(await detail.locator('.forecast-copy').innerText(),/暂无法预估额度用完时间/);
  await page.locator('#demo-scenario').selectOption('fast');await page.waitForFunction(()=>document.querySelector('#detail-frame').contentDocument.querySelector('.forecast-copy').textContent.includes('重置前用完'));assert.match(await detail.locator('.forecast-copy').innerText(),/重置前用完/);
  await page.locator('#demo-scenario').selectOption('balanced');
  await api.locator('#api-open-details').click();await page.frameLocator('#api-report-frame').locator('#month-cost').waitFor();assert.match(await page.frameLocator('#api-report-frame').locator('#month-cost').innerText(),/32.48/);
  near(await page.locator('#quota-frame').evaluate(e=>e.getBoundingClientRect().top),await page.locator('#api-report-frame').evaluate(e=>e.getBoundingClientRect().top));
  assert.equal(await page.frameLocator('#api-report-frame').locator('#connection-settings').isVisible(),false);await page.frameLocator('#api-report-frame').locator('#refresh-report').click();await page.waitForFunction(()=>!document.querySelector('#demo-feedback').hidden);assert.equal(await page.locator('#demo-feedback').innerText(),'报告已刷新。');await page.locator('#api-back').click();assert.equal(await page.locator('#demo-feedback').isVisible(),false);
  report.interactions.push('280px native cards / filling default trend; both compact/expanded keyboard modes, trend periods/forecast/unknown, account history, extra credits, tasks/results read, independent API report and concise click feedback');
  const modes=[{mode:'main',query:'',cardWidth:280,gap:20,breakpoint:700,widths:[1100,720,700,360,320]},{mode:'appearance',query:'?appearanceDemo=1',cardWidth:224,gap:16,breakpoint:559,widths:[620,560,559,360,320]}];
  for(const config of modes){
   await page.goto(base+'demos/quota/index.html'+config.query);await quota.locator('.v20-value').first().waitFor();await detail.locator('.trend-chart').waitFor();
   for(const width of config.widths)for(const appearance of ['light','dark'])for(const colorMode of ['standard','accessible']){
   await page.setViewportSize({width,height:900});await page.evaluate(v=>window.postMessage({type:'qiuqiu-demo-theme',...v},location.origin),{appearance,colorMode});
   await page.waitForFunction(v=>QiuqiuQuotaDemo.getState().appearance===v.appearance&&QiuqiuQuotaDemo.getState().colorMode===v.colorMode,{appearance,colorMode});
   await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   rect=await cardRect('#quota-frame');near(rect.width,config.cardWidth);near((await cardRect('#api-label-frame')).width,config.cardWidth);assert.equal(rect.nativeWidth,196);near((await cardRect('#detail-frame')).width,width-8-(width>config.breakpoint?config.cardWidth+config.gap:0));
   const positions=await page.evaluate(()=>({card:document.querySelector('#quota-frame').getBoundingClientRect().toJSON(),detail:document.querySelector('#detail-frame').getBoundingClientRect().toJSON()}));
   if(width>config.breakpoint){near(positions.detail.left-positions.card.right,config.gap);near(positions.card.left,4);near(positions.detail.top,positions.card.top);}else assert.ok(positions.detail.top>positions.card.bottom);
   const toolbar=await page.locator('.demo-toolbar').evaluate(e=>e.getBoundingClientRect().toJSON());near(toolbar.left,4);near(toolbar.right,width-4);assert.ok(toolbar.bottom<positions.card.top);assert.equal(await page.locator('.demo-cards h2').count(),0);
   assert.equal(await detail.locator('html').evaluate(e=>e.scrollWidth<=innerWidth),true);
   assert.equal(await quota.locator('html').getAttribute('data-color-mode'),colorMode);assert.equal(await detail.locator('html').getAttribute('data-accessible-appearance'),appearance);
   const screenshot=path.join(out,`quota-${config.mode}-${width}-${appearance}-${colorMode}.png`);await page.screenshot({path:screenshot,fullPage:true});report.layouts.push({kind:'quota',mode:config.mode,width,appearance,colorMode,cardWidth:rect.width,detailWidth:(await cardRect('#detail-frame')).width,height:await page.locator('main').evaluate(e=>Math.ceil(e.getBoundingClientRect().height)),screenshot});
   }
  }
  for(const config of modes){
   await page.goto(base+'demos/quota/index.html'+config.query);await quota.locator('.v20-value').first().waitFor();
   for(const width of config.mode==='main'?[700,360,320]:[620,560,360,320]){
   await page.setViewportSize({width,height:900});await quota.locator('.v20-collapse').click();await page.waitForFunction(()=>!QiuqiuQuotaDemo.getState().expanded);near((await cardRect('#quota-frame')).width,config.cardWidth*128/196);await quota.locator('#quota-label').press('Enter');await page.waitForFunction(()=>QiuqiuQuotaDemo.getState().expanded);
   await api.locator('#quota-label').press('Enter');await page.waitForFunction(()=>!QiuqiuQuotaDemo.getState().apiExpanded);near((await cardRect('#api-label-frame')).width,config.cardWidth*128/196);await api.locator('#quota-label').press('Enter');await page.waitForFunction(()=>QiuqiuQuotaDemo.getState().apiExpanded);
   await quota.locator('[data-action="opportunities"]').click();await detail.locator('.opportunity-history > summary').click();assert.match(await detail.locator('.opportunity-history').innerText(),/已获得/);await quota.locator('[data-action="trend"]').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
   await api.locator('#api-open-details').click();assert.match(await page.frameLocator('#api-report-frame').locator('#month-cost').innerText(),/32.48/);assert.equal(await page.frameLocator('#api-report-frame').locator('.api-panel').evaluate(e=>e.scrollWidth<=innerWidth),true);await page.locator('#api-back').click();
  }
  await page.goto(base+'demos/quota/index.html');await quota.locator('.v20-value').first().waitFor();await page.setViewportSize({width:260,height:900});await page.waitForTimeout(200);near((await cardRect('#quota-frame')).width,252);assert.equal((await cardRect('#quota-frame')).nativeWidth,196);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  for(const width of [1100,320]){
   await page.setViewportSize({width,height:900});await page.waitForFunction(()=>{
    const frame=document.querySelector('#detail-frame'),doc=frame.contentDocument,panel=doc.querySelector('#details-panel'),content=doc.querySelector('#details-content'),style=frame.contentWindow.getComputedStyle(panel);
    return frame.height==Math.ceil(content.getBoundingClientRect().bottom-panel.getBoundingClientRect().top+panel.scrollTop+parseFloat(style.paddingBottom)+parseFloat(style.borderBottomWidth));
   });
  }
  report.interactions.push('main and appearance column / 360px / 320px actual pointer and keyboard folding, history, trend and independent API report; below-280px container scales down without changing native viewport');
  await page.evaluate(()=>window.postMessage({type:'qiuqiu-demo-motion',paused:true},location.origin));
  await page.waitForFunction(()=>document.querySelector('#quota-frame').contentDocument.documentElement.dataset.demoPaused==='true'&&document.querySelector('#api-label-frame').contentDocument.documentElement.dataset.demoPaused==='true');
  assert.equal(await quota.locator('#quota-beam').evaluate(e=>getComputedStyle(e,'::before').animationPlayState),'paused');
  assert.equal(await api.locator('#quota-beam').evaluate(e=>getComputedStyle(e,'::after').animationPlayState),'paused');
  assert.equal(await detail.locator('#details-panel').evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.goto(base+'demos/chat/index.html');assert.equal(await page.title(),'聊一会儿');await page.locator('.message').first().waitFor();assert.equal(await page.locator('.message').count(),2);assert.equal(await page.locator('#app-update').isVisible(),false);
  await page.locator('#new-chat').click();await page.locator('#cancel-new-chat').click();assert.equal(await page.locator('.message').count(),2);
  await page.locator('#new-chat').click();await page.locator('#confirm-new-chat').click();await page.locator('#message-input').fill('这是官网示例。');await page.locator('#send-message').click();await page.waitForFunction(()=>!QiuqiuChatDemo.getState().busy);assert.match(await page.locator('#messages').innerText(),/先慢一点，挑一件想说的事，我们接着聊。/);
  await page.locator('#chat-history').click();await page.locator('.history-item').filter({hasText:'给今天留一点空隙'}).click();assert.equal(await page.locator('.message').count(),2);
  await page.locator('#chat-model').click();await page.locator('[data-model="demo-strong"]').click();assert.equal(await page.locator('#chat-model').innerText(),'分析模型 · 示例');
  await page.locator('#close-chat').click();assert.equal(await page.locator('#demo-closed').isVisible(),true);await page.locator('#demo-reopen').click();assert.equal(await page.locator('.chat-panel').isVisible(),true);
  for(const shape of ['blob','cloud','square','aurora-cloud']){
   await page.evaluate(shape=>window.postMessage({type:'qiuqiu-demo-avatar',appearance:{shape,bodyColor:'#5B3BC7',eyeColor:'#FFFFFF',eyeScale:1,eyeSpacing:1,eyeHeight:0,idleEyes:'original',auroraStyle:'dimensional'}},location.origin),shape);
   await page.waitForFunction(shape=>document.querySelector('#chat-avatar').dataset.shape===shape&&document.querySelector('#chat-avatar').dataset.avatarReady==='true',shape,{timeout:30000});
   if(shape==='aurora-cloud')assert.equal(await page.locator('#chat-avatar').getAttribute('data-avatar-engine'),'rive');
  }
  report.interactions.push('native chat new/cancel/send/history/model/close/reopen; four public avatar shapes including six-lobe Rive');
  for(const width of [960,320])for(const appearance of ['light','dark'])for(const colorMode of ['standard','accessible']){
   await page.setViewportSize({width,height:520});await page.evaluate(v=>window.postMessage({type:'qiuqiu-demo-theme',...v},location.origin),{appearance,colorMode});await page.waitForFunction(v=>QiuqiuChatDemo.getState().appearance===v.appearance&&QiuqiuChatDemo.getState().colorMode===v.colorMode,{appearance,colorMode});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const screenshot=path.join(out,`chat-${width}-${appearance}-${colorMode}.png`);await page.screenshot({path:screenshot,fullPage:false});report.layouts.push({kind:'chat',width,appearance,colorMode,screenshot});
  }
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:window,origin:'https://example.invalid',data:{type:'qiuqiu-demo-theme',appearance:'light',colorMode:'standard'}})));assert.equal(await page.evaluate(()=>QiuqiuChatDemo.getState().appearance),'dark');
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:null,origin:location.origin,data:{type:'qiuqiu-demo-theme',appearance:'light',colorMode:'standard'}})));assert.equal(await page.evaluate(()=>QiuqiuChatDemo.getState().appearance),'dark');
  await page.evaluate(()=>window.postMessage({type:'qiuqiu-demo-motion',paused:true},location.origin));await page.waitForFunction(()=>document.querySelector('#chat-avatar').dataset.avatarActive==='false');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.composer').evaluate(e=>getComputedStyle(e,'::before').animationName),'none');
  console.log(JSON.stringify({errors,failed,externalRequests}));assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.deepEqual(externalRequests,[]);report.interactions.push('same-origin/source message guard, parent pause and reduced motion; no external requests');
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,layouts:report.layouts.length,interactions:report.interactions,errors,failed,report:path.join(out,'report.json')}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
