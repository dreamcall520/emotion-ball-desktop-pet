/* Coordinates the public App windows; all models are synthetic and kept in memory. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const frames = { quota: $('quota-frame'), details: $('detail-frame'), 'api-label': $('api-label-frame'), 'api-report': $('api-report-frame') };
  const ready = new Set();
  const now = Date.now(), day = 86400000;
  let appearance = 'light', colorMode = 'standard', scenario = 'balanced', expanded = true, apiExpanded = true, action = 'trend', period = 10080, unread = true, apiVisible = false, paused = false;
  const report = { month: new Date(now).toISOString().slice(0,7), updatedAt: now, costs: { month: [{currency:'usd',value:32.48}], today: [{currency:'usd',value:1.26}] }, usage: {inputTokens:2840000,cachedInputTokens:1120000,outputTokens:420000,requests:137} };
  function quotaModel() {
    const fast = scenario === 'fast', unknown = scenario === 'unknown';
    const items = [{label:'CODEX',windowMinutes:300,remaining:fast ? 12 : 82,resetsAt:now+4*3600000,pace:{state:unknown ? 'unknown' : fast ? 'fast' : 'balanced',remainingTimePercent:80}}, {label:'CODEX',windowMinutes:10080,remaining:fast ? 8 : 68,resetsAt:now+5*day,pace:{state:unknown ? 'unknown' : fast ? 'fast' : 'balanced',remainingTimePercent:71}}];
    const item = items.find(item => item.windowMinutes === period), start = item.resetsAt-item.windowMinutes*60000;
    return {state:'ready',size:'compact',expanded,appearance,colorMode,items,resetCreditsAvailable:2,extraCredits:{state:'balance',balance:'1250.00'},activity:{runningCount:1,unreadCount:unread?1:0},action,period,
      tasks:[{id:'demo-layout',title:'检查示例页面布局',state:'active',updatedAt:now}],results:unread?[{id:'demo-notes',title:'整理今日待办',state:'completed',updatedAt:now}]:[],
      resetDetailsState:'known',resetOpportunities:[{expiresAt:now+3*day,status:'available'},{expiresAt:null,status:'available'}],
      accountResetHistory:{state:'ready',updatedAt:now,events:[{kind:'granted',occurredAt:now-5*day},{kind:'redeemed',occurredAt:now-12*day},{kind:'granted',occurredAt:now-20*day}]},
      returnToTrend:action!=='trend',returnPeriod:period,
      trend:{windowMinutes:period,resetsAt:item.resetsAt,resetLabel:period===300?'4 小时后重置':'5 天后重置',samples:unknown?[]:[100,97,93,86,Math.max(item.remaining,80),item.remaining].map((remaining,index)=>({at:Math.round(start+(now-start)*index/5),remaining})),forecast:{state:unknown?'unknown':'estimate',status:fast?'risk':'safe',summary:unknown?'暂无法预估额度用完时间':fast?'额度可能在重置前用完':'按当前节奏，预计可用至重置',detail:unknown?'连续用量记录不足，稍后再查看':'按近期用量估算，会随实际用量变化；此处为合成示例'}}};
  }
  function apiModel() { return {connected:true,busy:false,error:null,report,config:{},expanded:apiExpanded,appearance,colorMode}; }
  const post = (frame,data) => frame.contentWindow.postMessage(data,location.origin);
  function send(kind) {
    if (!ready.has(kind)) return;
    post(frames[kind],{type:'qiuqiu-demo-theme',appearance,colorMode});
    post(frames[kind],{type:'qiuqiu-demo-motion',paused});
    post(frames[kind],{type:'qiuqiu-quota-model',kind,model:kind.startsWith('api-')?apiModel():quotaModel()});
  }
  const resize = () => parent.postMessage({type:'qiuqiu-demo-resize',height:Math.ceil(document.querySelector('main').getBoundingClientRect().height)},location.origin);
  function render() {
    document.documentElement.dataset.appearance=appearance; document.documentElement.dataset.colorMode=colorMode; document.documentElement.dataset.demoPaused=String(paused);
    frames.quota.width=expanded?196:128; frames.quota.height=expanded?144:32;
    frames['api-label'].width=apiExpanded?196:128; frames['api-label'].height=apiExpanded?92:32;
    frames.details.hidden=apiVisible; $('api-report').hidden=!apiVisible;
    Object.keys(frames).forEach(send); requestAnimationFrame(resize);
  }
  function openDetail(detail,nextPeriod) {
    if (!['trend','tasks','results','opportunities','credits'].includes(detail)) return;
    action=detail; period=nextPeriod===300?300:10080; apiVisible=false; render();
  }
  $('demo-scenario').addEventListener('change',event=>{scenario=event.target.value;render();});
  $('api-back').addEventListener('click',()=>openDetail('trend',period));
  $('thread-close').addEventListener('click',()=>{$('demo-thread').hidden=true;resize();});
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin) return;
    const data=event.data;
    if(event.source===parent && data?.type==='qiuqiu-demo-theme' && ['light','dark'].includes(data.appearance) && ['standard','accessible'].includes(data.colorMode)) { appearance=data.appearance;colorMode=data.colorMode;render();return; }
    if(event.source===parent && data?.type==='qiuqiu-demo-motion') {paused=data.paused===true;render();return;}
    const kind=Object.keys(frames).find(key=>event.source===frames[key].contentWindow);
    if(!kind || data?.type!=='qiuqiu-quota-action' || data.kind!==kind) return;
    if(data.action==='ready') {ready.add(kind);send(kind);}
    else if(data.action==='toggle' && kind==='quota') {expanded=!expanded;render();}
    else if(data.action==='toggle-api' && kind==='api-label') {apiExpanded=!apiExpanded;render();}
    else if(data.action==='detail') openDetail(data.detail,data.period);
    else if(data.action==='api') {apiVisible=true;render();}
    else if(data.action==='resize' && kind==='details' && Number.isFinite(data.height)) {frames.details.height=Math.max(120,Math.min(700,data.height));resize();}
    else if(data.action==='thread' && kind==='details' && ['demo-layout','demo-notes'].includes(data.id)) {
      if(data.id==='demo-notes') unread=false;
      $('thread-title').textContent=data.id==='demo-notes'?'整理今日待办':'检查示例页面布局';
      $('thread-text').textContent=data.id==='demo-notes'?'示例结果：已整理为 3 项待办，可以逐项确认截止日期与提醒。':'示例进展：正在检查桌面与手机布局。';
      $('demo-thread').hidden=false; render(); $('demo-thread-title').focus({preventScroll:true});
    } else if(data.action==='refresh-api' && kind==='api-report') {$('demo-feedback').textContent='示例报告已刷新，没有发起真实费用查询。';}
    else if(data.action==='guide' && kind==='api-report') {$('demo-feedback').textContent='此处为示例报告，无需输入真实密钥。';}
  });
  new ResizeObserver(resize).observe(document.querySelector('main'));
  window.QiuqiuQuotaDemo=Object.freeze({getState:()=>Object.freeze({appearance,colorMode,scenario,expanded,apiExpanded,action,period,unread,apiVisible,paused})});
  parent.postMessage({type:'qiuqiu-demo-ready'},location.origin);
  render();
})();
