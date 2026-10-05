/* Existing Playwright only: NODE_PATH=... QIUQIU_SITE_URL=http://127.0.0.1:4184/ node demos/quota/check.browser.cjs */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const base=process.env.QIUQIU_SITE_URL||'http://127.0.0.1:4184/';
const out=process.env.QIUQIU_QA_OUTPUT||'/tmp/qiuqiu-live-app-demos';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const errors=[],failed=[];const report={base,browser:'Chrome / existing Playwright; Browser plugin not available',layouts:[],interactions:[],errors,failed};
 try{
  const page=await browser.newPage({viewport:{width:960,height:740}});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)failed.push(r.status()+' '+r.url());});
  await page.goto(base+'demos/quota/index.html');assert.match(await page.title(),/额度卡片 2.0/);
  const quota=page.frameLocator('#quota-frame'),detail=page.frameLocator('#detail-frame'),api=page.frameLocator('#api-label-frame');
  await quota.locator('.v20-value').first().waitFor();assert.equal(await quota.locator('.v20-value').count(),2);assert.match(await detail.locator('#details-title').innerText(),/额度趋势/);
  assert.equal(await detail.locator('.trend-chart').count(),1);
  await quota.locator('.v20-collapse').click();await page.waitForFunction(()=>QiuqiuQuotaDemo.getState().expanded===false);assert.equal(await page.locator('#quota-frame').getAttribute('width'),'128');
  await quota.locator('#quota-label').press('Enter');await page.waitForFunction(()=>QiuqiuQuotaDemo.getState().expanded===true);
  await quota.locator('[data-action="opportunities"]').click();await detail.locator('.opportunity-history > summary').click();assert.match(await detail.locator('.opportunity-history').innerText(),/已获得/);
  await quota.locator('[data-action="credits"]').click();assert.match(await detail.locator('.balance-value').innerText(),/1,250/);
  await quota.locator('[data-action="tasks"]').click();await detail.locator('.activity-item').click();await page.waitForFunction(()=>document.querySelector('#thread-title').textContent.includes('检查示例'));assert.match(await page.locator('#thread-title').innerText(),/检查示例/);await page.locator('#thread-close').click();
  await quota.locator('[data-action="results"]').click();await detail.locator('.activity-item').click();await page.locator('#thread-close').click();assert.match(await detail.locator('#details-content').innerText(),/暂无待查看/);
  await quota.locator('[data-action="trend"]').click();await detail.locator('[data-period="300"]').click();assert.match(await detail.locator('#details-content').innerText(),/82%/);
  await page.locator('#demo-scenario').selectOption('unknown');await page.waitForFunction(()=>document.querySelector('#detail-frame').contentDocument.querySelector('.forecast-copy').textContent.includes('暂无法预估额度用完时间'));assert.match(await detail.locator('.forecast-copy').innerText(),/暂无法预估额度用完时间/);
  await page.locator('#demo-scenario').selectOption('fast');await page.waitForFunction(()=>document.querySelector('#detail-frame').contentDocument.querySelector('.forecast-copy').textContent.includes('重置前用完'));assert.match(await detail.locator('.forecast-copy').innerText(),/重置前用完/);
  await page.locator('#demo-scenario').selectOption('balanced');
  await api.locator('#api-open-details').click();await page.frameLocator('#api-report-frame').locator('#month-cost').waitFor();assert.match(await page.frameLocator('#api-report-frame').locator('#month-cost').innerText(),/32.48/);
  assert.equal(await page.frameLocator('#api-report-frame').locator('#connection-settings').isVisible(),false);await page.frameLocator('#api-report-frame').locator('#refresh-report').click();await page.waitForFunction(()=>document.querySelector('#demo-feedback').textContent.includes('没有发起真实'));assert.match(await page.locator('#demo-feedback').innerText(),/没有发起真实/);await page.locator('#api-back').click();
  report.interactions.push('native compact/expanded keyboard, trend periods/forecast/unknown, account history, extra credits, tasks/results read, independent API report');
  for(const width of [960,320])for(const appearance of ['light','dark'])for(const colorMode of ['standard','accessible']){
   await page.setViewportSize({width,height:900});await page.evaluate(v=>window.postMessage({type:'qiuqiu-demo-theme',...v},location.origin),{appearance,colorMode});
   await page.waitForFunction(v=>QiuqiuQuotaDemo.getState().appearance===v.appearance&&QiuqiuQuotaDemo.getState().colorMode===v.colorMode,{appearance,colorMode});
   await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.equal(await quota.locator('html').getAttribute('data-color-mode'),colorMode);assert.equal(await detail.locator('html').getAttribute('data-accessible-appearance'),appearance);
   const screenshot=path.join(out,`quota-${width}-${appearance}-${colorMode}.png`);await page.screenshot({path:screenshot,fullPage:true});report.layouts.push({kind:'quota',width,appearance,colorMode,screenshot});
  }
  await page.evaluate(()=>window.postMessage({type:'qiuqiu-demo-motion',paused:true},location.origin));
  await page.waitForFunction(()=>document.querySelector('#quota-frame').contentDocument.documentElement.dataset.demoPaused==='true'&&document.querySelector('#api-label-frame').contentDocument.documentElement.dataset.demoPaused==='true');
  assert.equal(await quota.locator('#quota-beam').evaluate(e=>getComputedStyle(e,'::before').animationPlayState),'paused');
  assert.equal(await api.locator('#quota-beam').evaluate(e=>getComputedStyle(e,'::after').animationPlayState),'paused');
  assert.equal(await detail.locator('#details-panel').evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.goto(base+'demos/chat/index.html');assert.equal(await page.title(),'聊一会儿');await page.locator('.message').first().waitFor();assert.equal(await page.locator('.message').count(),2);assert.equal(await page.locator('#app-update').isVisible(),false);
  await page.locator('#new-chat').click();await page.locator('#cancel-new-chat').click();assert.equal(await page.locator('.message').count(),2);
  await page.locator('#new-chat').click();await page.locator('#confirm-new-chat').click();await page.locator('#message-input').fill('这是官网示例。');await page.locator('#send-message').click();await page.waitForFunction(()=>!QiuqiuChatDemo.getState().busy);assert.match(await page.locator('#messages').innerText(),/网页示例回复/);
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
  console.log(JSON.stringify({errors,failed}));assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);report.interactions.push('same-origin/source message guard, parent pause and reduced motion');
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,layouts:report.layouts.length,interactions:report.interactions,errors,failed,report:path.join(out,'report.json')}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
