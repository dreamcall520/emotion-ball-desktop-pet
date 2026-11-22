'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
if(process.versions.electron&&process.argv.includes('--collapsed-card-child')){
 const {app,BrowserWindow,session}=require('electron');app.setPath('userData',process.env.QIUQIU_COLLAPSED_CARD_TEST_DATA);app.setActivationPolicy('accessory');
 app.whenReady().then(async()=>{let win;try{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,done)=>done({cancel:true}));
  win=new BrowserWindow({width:168,height:58,frame:false,transparent:true,show:false,webPreferences:{contextIsolation:false,nodeIntegration:false,backgroundThrottling:false}});
  await win.loadFile(path.join(__dirname,'../quota-label.html'));const run=code=>win.webContents.executeJavaScript(code);
  await run(`window.cardActions=[];window.petQuotaLabel={onModel:callback=>window.showQuota=callback,toggleExpanded:()=>cardActions.push('toggle')};true`);
  await run(fs.readFileSync(path.join(__dirname,'../quota-label-renderer.js'),'utf8'));
  let cases=0;const captionStyles=new Map();
  for(const sourceId of ['codex','zcode'])for(const size of ['standard','compact'])for(const appearance of ['light','dark'])for(const colorMode of ['standard','accessible'])for(const dual of [false,true])for(const expanded of [false,true]){
   const items=(dual?[300,10080]:[sourceId==='codex'?10080:300]).map(minutes=>({label:minutes===300?'5 小时额度':'每周额度',windowMinutes:minutes,
    remaining:sourceId==='codex'?(minutes===10080?0:74):(minutes===300?99.9:94),resetsAt:Date.now()+3600000,
    ...(sourceId==='zcode'?{planName:'max · 团队',bucketId:`zcode:paid:CREDIT_LIMIT:${minutes===300?'3:5':'6:1'}`,periodKind:'rolling'}:{})}));
   const dimensions=require('../lib/quota-label-placement').quotaLabelSize(size,expanded,items.length,false,false,null,sourceId,sourceId==='zcode'&&dual);win.setSize(dimensions.width,dimensions.height);
   await run(`document.documentElement.dataset.appearance=${JSON.stringify(appearance)};document.documentElement.dataset.colorMode=${JSON.stringify(colorMode)};document.documentElement.dataset.accessibleAppearance=${JSON.stringify(appearance)};showQuota(${JSON.stringify({sourceId,state:'ready',size,appearance,expanded,items,...(sourceId==='codex'?{codexIconPreference:'app-default',codexIconDark:false}:{})})});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
   await run(`Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})))`);
   const layout=await run(`(()=>{const card=document.querySelector('#quota-label'),r=card.getBoundingClientRect(),visible=e=>e.getClientRects().length&&e.getBoundingClientRect().width;const parts=[...card.querySelectorAll('#compact-product,#compact-period,.quota-name,.quota-value,.summary-period,.summary-value,.v20-brand,.v20-plan-summary,.v20-value,.v20-cell-label')].filter(visible).map(e=>{const a=e.getBoundingClientRect();return {text:e.textContent,left:a.left,right:a.right,top:a.top,bottom:a.bottom,overflow:e.scrollWidth>e.clientWidth+1}});return {text:card.innerText,width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:card.scrollWidth>card.clientWidth+1||card.scrollHeight>card.clientHeight+1,parts,planCount:card.innerText.split('Max · 团队').length-1,icon:[...card.querySelectorAll('img')].filter(visible).map(e=>e.getAttribute('src')),severity:card.dataset.severity,captions:[...card.querySelectorAll('.quota-cycle-caption')].filter(visible).map(e=>{const c=getComputedStyle(e);return {text:e.textContent,fontSize:c.fontSize,fontWeight:c.fontWeight,lineHeight:c.lineHeight,color:c.color,paddingLeft:c.paddingLeft,paddingRight:c.paddingRight}})}})()`);
   const context=JSON.stringify({sourceId,size,appearance,colorMode,dual,expanded,layout});
   assert.equal(layout.overflow,false,context);assert.equal(layout.width,!expanded&&size==='compact'?124:dimensions.width,context);
   assert(layout.parts.every(p=>!p.overflow&&p.left>=layout.left&&p.right<=layout.right&&p.top>=layout.top&&p.bottom<=layout.bottom),context);
   if(sourceId==='zcode'){assert.match(layout.text,/ZCode/,context);assert(layout.icon.includes('assets/integrations/zcode.png'),context);assert.equal(layout.planCount,expanded||size==='standard'?1:0,context);}
   if(sourceId==='codex')assert.equal(layout.severity,'urgent',context);
   assert(layout.captions.length>0,context);
   for(const caption of layout.captions){
    assert(['5小时额度','周额度'].includes(caption.text),context);
    const {text,...style}=caption;assert.equal(style.fontSize,'9.5px',context);assert.equal(style.fontWeight,'550',context);assert.equal(style.lineHeight,'12px',context);assert.equal(style.paddingLeft,'0px',context);assert.equal(style.paddingRight,'0px',context);
    const key=appearance+'/'+colorMode;if(!captionStyles.has(key))captionStyles.set(key,style);else assert.deepEqual(style,captionStyles.get(key),context);
   }

   if(size==='standard'&&!expanded){
    const before=await run('cardActions.length');await run(`document.querySelector('#compact-product img').click()`);assert.equal(await run('cardActions.length'),before+1);
   }
   if(process.env.QIUQIU_COLLAPSED_CARD_CAPTURE_DIR&&size==='standard'&&appearance==='light'&&colorMode==='standard'&&dual===(sourceId==='zcode')&&!expanded){
    fs.mkdirSync(process.env.QIUQIU_COLLAPSED_CARD_CAPTURE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.QIUQIU_COLLAPSED_CARD_CAPTURE_DIR,sourceId+'-collapsed.png'),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG());
   }
   cases++;
  }
  const longPlan='Max Enterprise 团队 · 国际产品设计与研发协作特别套餐 Team Organization Complete Name';
  const longLabels=['跨境产品研发项目专享长期额度与视觉设计联合试用计划 Complete Official Quota Name','Official Model Research Extended Context & Vision 每周专业研发额度'];
  const shapes=[{id:'shared',count:2,shared:true,paid:false},{id:'separate',count:2,shared:false,paid:false},{id:'paid',count:2,shared:true,paid:true},{id:'single',count:1,shared:true,paid:false}];
  let longCases=0;
  for(const shape of shapes)for(const size of ['standard','compact'])for(const appearance of ['light','dark'])for(const expanded of [false,true])for(const remaining of [99.8706,99.99,0]){
   const expected=remaining===99.8706?'99.9%':remaining===99.99?'<100%':'0%';
   const items=longLabels.slice(0,shape.count).map((label,index)=>({label,planName:longPlan+(shape.shared?'':index?' · 每周专项分组 Weekly Project B':' · 短周期专项分组 Five Hour Project A'),
    bucketId:shape.paid?`zcode:paid:CREDIT_LIMIT:${index?'6:1':'3:5'}`:`zcode:custom:${index}`,windowMinutes:index?10080:300,remaining,resetsAt:Date.now()+3600000,periodKind:'rolling'}));
   const dimensions=require('../lib/quota-label-placement').quotaLabelSize(size,expanded,items.length,false,false,null,'zcode',shape.paid&&items.length>1);
   win.setSize(dimensions.width,dimensions.height);
   await run(`document.documentElement.dataset.appearance=${JSON.stringify(appearance)};document.documentElement.dataset.colorMode='standard';showQuota(${JSON.stringify({sourceId:'zcode',state:'ready',size,appearance,expanded,items})});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
   await run(`Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})))`);
   const layout=await run(`(()=>{const card=document.querySelector('#quota-label'),r=card.getBoundingClientRect(),visible=e=>e.getClientRects().length&&e.getBoundingClientRect().width;const data=e=>{const a=e.getBoundingClientRect(),c=getComputedStyle(e);return {text:e.textContent,title:e.title,aria:e.getAttribute('aria-label'),left:a.left,right:a.right,top:a.top,bottom:a.bottom,width:a.width,height:a.height,scroll:e.scrollWidth,client:e.clientWidth,overflow:e.scrollWidth>e.clientWidth+1,whiteSpace:c.whiteSpace,textOverflow:c.textOverflow,fontSize:c.fontSize,fontWeight:c.fontWeight,lineHeight:c.lineHeight,paddingLeft:c.paddingLeft,paddingRight:c.paddingRight}};return {width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,title:card.title,aria:card.getAttribute('aria-label'),overflow:card.scrollWidth>card.clientWidth+1||card.scrollHeight>card.clientHeight+1,names:[...card.querySelectorAll('.quota-cycle-caption')].filter(visible).map(data),plans:[...card.querySelectorAll('#compact-period,.quota-period,.v20-plan-summary,.v20-plan-name')].filter(visible).map(data),values:[...card.querySelectorAll('.quota-value,.summary-value,.v20-value')].filter(visible).map(data)}})()`);
   const context=JSON.stringify({shape:shape.id,size,appearance,expanded,remaining,layout});
   assert.equal(layout.overflow,false,context);assert.equal(layout.width,!expanded&&size==='compact'?124:dimensions.width,context);assert(layout.height<=dimensions.height,context);
   assert(layout.title.includes(items[0].label)&&layout.title.includes(items[0].planName),context);assert.equal(layout.aria,layout.title,context);
   for(const part of [...layout.names,...layout.plans,...layout.values])assert(part.left>=layout.left&&part.right<=layout.right+.1&&part.top>=layout.top&&part.bottom<=layout.bottom+.1,context);
   assert(layout.names.length>0,context);
   for(const name of layout.names){assert.equal(name.fontSize,'9.5px',context);assert.equal(name.fontWeight,'550',context);assert.equal(name.lineHeight,'12px',context);assert.equal(name.whiteSpace,'nowrap',context);assert.equal(name.textOverflow,'ellipsis',context);assert.equal(name.paddingLeft,'0px',context);assert.equal(name.paddingRight,'0px',context);assert(name.height<=16,context);assert(name.title.length>32,context);assert(name.aria?.length>32,context);}
   for(const plan of layout.plans){assert.equal(plan.whiteSpace,'nowrap',context);assert.equal(plan.textOverflow,'ellipsis',context);assert(plan.title.includes(items[0].planName)||items.some(item=>plan.title===item.planName),context);assert.equal(plan.aria,plan.title,context);assert(plan.overflow,'long plan should actually exercise ellipsis: '+context);}
   assert.equal(layout.values.length,expanded||size==='standard'?items.length:1,context);
   for(const value of layout.values){if(!expanded)assert([...layout.names,...layout.plans].filter(part=>part.top<value.bottom&&part.bottom>value.top).every(part=>part.right<=value.left+.1),context);assert(value.text.startsWith(expected),context);assert.equal(value.overflow,false,context);if(remaining===0&&!expanded&&size==='standard')assert(value.text.includes('已用尽'),context);}
   if(!shape.paid)assert(layout.names.some(name=>name.overflow),'long quota name should actually exercise ellipsis: '+context);
   if(process.env.QIUQIU_COLLAPSED_CARD_CAPTURE_DIR&&remaining===99.99&&(shape.id==='shared'||(shape.id==='separate'&&expanded&&size==='standard'&&appearance==='light'))){
    fs.mkdirSync(process.env.QIUQIU_COLLAPSED_CARD_CAPTURE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.QIUQIU_COLLAPSED_CARD_CAPTURE_DIR,`zcode-long-${shape.id}-${size}-${appearance}-${expanded?'expanded':'collapsed'}.png`),(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG());
   }
   longCases++;
  }
  assert.equal(longCases,96);console.log('LONG_CARD_DOM_OK '+longCases+' layouts');
  console.log('CAPTION_STYLE_MATRIX '+JSON.stringify(Object.fromEntries(captionStyles)));
  assert.equal(win.isVisible(),false);console.log('COLLAPSED_CARD_DOM_OK '+cases+' layouts');win.destroy();app.exit(0);
 }catch(error){console.error(error.stack);win?.destroy();app.exit(1);}});
}else test('Codex/ZCode cards fit 64 source/theme variants and 96 long-name layouts without hiding percentages',{timeout:60000},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'collapsed-card-visual-'));
 try{const env={...process.env,QIUQIU_COLLAPSED_CARD_TEST_DATA:root};delete env.ELECTRON_RUN_AS_NODE;
  const result=require('node:child_process').spawnSync(require('electron'),[__filename,'--collapsed-card-child'],{env,encoding:'utf8',timeout:50000});
  assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/COLLAPSED_CARD_DOM_OK 64 layouts/);assert.match(result.stdout,/LONG_CARD_DOM_OK 96 layouts/);console.log(result.stdout.trim());
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
