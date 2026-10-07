/* Coordinates the public App windows; all models are synthetic and kept in memory. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const frames = { quota: $('quota-frame'), details: $('detail-frame'), 'api-label': $('api-label-frame'), 'api-report': $('api-report-frame') };
  const cards = document.querySelector('.demo-cards');
  const ready = new Set();
  const cardWindows = {dual:null,'5h':300,week:10080};
  const appearanceDemo=new URLSearchParams(location.search).get('appearanceDemo')==='1';
  document.documentElement.dataset.appearanceDemo=String(appearanceDemo);
  const now = Date.now(), day = 86400000;
  let generation = 0;
  let appearance = 'light', colorMode = 'standard', uiTheme = 'blue', scenario = 'balanced', cardPeriod = 'dual', expanded = true, apiExpanded = true, action = 'trend', period = 10080, unread = appearanceDemo, apiVisible = false, paused = false, taskState = 'processing';
  const report = { month: new Date(now).toISOString().slice(0,7), updatedAt: now, costs: { month: [{currency:'usd',value:32.48}], today: [{currency:'usd',value:1.26}] }, usage: {inputTokens:2840000,cachedInputTokens:1120000,outputTokens:420000,requests:137} };
  function quotaModel() {
    const fast = scenario === 'fast', unknown = scenario === 'unknown';
    const items = [{label:'CODEX',windowMinutes:300,remaining:fast ? 12 : 82,resetsAt:now+2*3600000,pace:{state:unknown ? 'unknown' : fast ? 'fast' : 'balanced',remainingTimePercent:40}}, {label:'CODEX',windowMinutes:10080,remaining:fast ? 8 : 68,resetsAt:now+2*day,pace:{state:unknown ? 'unknown' : fast ? 'fast' : 'balanced',remainingTimePercent:29}}].filter(item=>cardWindows[cardPeriod]===null || item.windowMinutes===cardWindows[cardPeriod]);
    const item = items.find(item => item.windowMinutes === period), start = item.resetsAt-item.windowMinutes*60000;
    const count = Math.ceil((now-start)/240000);
    const samples = unknown ? [] : Array.from({length:count+1},(_,index)=>({at:Math.round(start+(now-start)*index/count),remaining:Math.round((100-(100-item.remaining)*(index/count)**1.3)*10)/10}));
    const runningCount=appearanceDemo || taskState==='processing' ? 1 : 0;
    return {state:'ready',observedAt:now,quotaUpdatedAt:now,generation,size:'compact',expanded,appearance,colorMode,items,resetCreditsAvailable:2,extraCredits:{state:'balance',balance:'1250.00'},activity:{runningCount,unreadCount:unread?1:0},action,period,
      tasks:runningCount?[{id:'demo-layout',title:'检查示例页面布局',state:'active',updatedAt:now}]:[],results:unread?[{id:'demo-notes',title:appearanceDemo?'整理今日待办':'检查示例页面布局',state:'completed',updatedAt:now}]:[],
      resetDetailsState:'known',resetOpportunities:[{expiresAt:now+3600000,status:'available'},{expiresAt:now+day,status:'available'}],
      accountResetHistory:{state:'ready',updatedAt:now,events:[{kind:'granted',occurredAt:now-5*day},{kind:'redeemed',occurredAt:now-12*day},{kind:'granted',occurredAt:now-20*day}]},
      returnToTrend:action!=='trend',returnPeriod:period,
      trend:{windowMinutes:period,resetsAt:item.resetsAt,resetLabel:period===300?'2 小时后重置':'2 天后重置',samples,forecast:{state:unknown?'unknown':'estimate',status:fast?'risk':'safe',summary:unknown?'暂无法预估额度用完时间':fast?'额度可能在重置前用完':'按当前节奏，预计可用至重置',detail:unknown?'连续用量记录不足，稍后再查看':'按近期用量估算，会随实际用量变化'}}};
  }
  function apiModel() { return {connected:true,busy:false,error:null,report,config:{},expanded:apiExpanded,appearance,colorMode}; }
  const post = (frame,data) => frame.contentWindow.postMessage(data,location.origin);
  function send(kind) {
    if (!ready.has(kind)) return;
    post(frames[kind],{type:'qiuqiu-demo-theme',appearance,colorMode,uiTheme});
    post(frames[kind],{type:'qiuqiu-demo-motion',paused});
    post(frames[kind],{type:'qiuqiu-quota-model',kind,model:kind.startsWith('api-')?apiModel():quotaModel()});
  }
  const resize = () => parent.postMessage({type:'qiuqiu-demo-resize',height:Math.ceil(document.querySelector('main').getBoundingClientRect().height)},location.origin);
  // Preserve the native viewports; scale both cards and folded modes together.
  function sizeCards() {
    const scale = cards.clientWidth / 196;
    for (const [kind,isExpanded,height] of [['quota',expanded,cardPeriod==='dual'?144:131],['api-label',apiExpanded,92]]) {
      const frame = frames[kind], width = isExpanded ? 196 : 128, nativeHeight = isExpanded ? height : 32;
      frame.width=width; frame.height=nativeHeight;
      frame.style.transform=`scale(${scale})`;
      frame.parentElement.style.width=`${width*scale}px`;
      frame.parentElement.style.height=`${nativeHeight*scale}px`;
    }
  }
  function feedback(text) { $('demo-feedback').textContent=text; $('demo-feedback').hidden=false; resize(); }
  function render() {
    generation++;
    document.documentElement.dataset.appearance=appearance; document.documentElement.dataset.colorMode=colorMode; document.documentElement.dataset.demoPaused=String(paused);
    document.querySelectorAll('[data-card-period]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.cardPeriod===cardPeriod)));
    sizeCards();
    frames.details.hidden=apiVisible; $('api-report').hidden=!apiVisible; $('api-back').hidden=!apiVisible;
    Object.keys(frames).forEach(send); requestAnimationFrame(resize);
    if(!appearanceDemo) parent.postMessage({type:'qiuqiu-demo-task-state',state:taskState},location.origin);
  }
  function openDetail(detail,nextPeriod) {
    if (!['trend','tasks','results','opportunities','credits'].includes(detail)) return;
    $('demo-feedback').hidden=true;
    action=detail; period=cardWindows[cardPeriod]??(nextPeriod===300?300:10080); apiVisible=false; render();
  }
  function openThread(id) {
    const result=id==='demo-notes';
    if(result && !appearanceDemo && taskState==='processing') return;
    if(result) {unread=false;if(!appearanceDemo) taskState='viewed';}
    $('thread-title').textContent=result&&appearanceDemo?'整理今日待办':'检查示例页面布局';
    $('thread-text').textContent=result
      ? appearanceDemo?'示例结果：已整理为 3 项待办，可以逐项确认截止日期与提醒。':'示例结果：已完成桌面与手机布局检查。'
      : '示例进展：正在检查桌面与手机布局。';
    $('demo-thread').hidden=false; render(); $('demo-thread-title').focus({preventScroll:true});
  }
  const scenarioSelect=$('demo-scenario');
  scenarioSelect.addEventListener('pointerdown',()=>{scenarioSelect.dataset.focusMode='pointer';});
  document.addEventListener('keydown',event=>{
    if(event.key==='Tab' || event.target===scenarioSelect) scenarioSelect.dataset.focusMode='keyboard';
  },true);
  scenarioSelect.addEventListener('change',event=>{scenario=event.target.value;render();});
  $('demo-card-period').addEventListener('click',event=>{
    const button=event.target.closest('button[data-card-period]');
    if(!button || !Object.hasOwn(cardWindows,button.dataset.cardPeriod)) return;
    cardPeriod=button.dataset.cardPeriod;openDetail('trend',period);
  });
  $('api-back').addEventListener('click',()=>openDetail('trend',period));
  $('thread-close').addEventListener('click',()=>{$('demo-thread').hidden=true;resize();});
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin) return;
    const data=event.data;
    if(event.source===parent && data?.type==='qiuqiu-demo-theme' && ['light','dark'].includes(data.appearance) && ['standard','accessible'].includes(data.colorMode)) { appearance=data.appearance;colorMode=data.colorMode;if(['green','blue'].includes(data.uiTheme)) uiTheme=data.uiTheme;render();return; }
    if(event.source===parent && data?.type==='qiuqiu-demo-motion') {paused=data.paused===true;render();return;}
    if(event.source===parent && data?.type==='qiuqiu-demo-task') {
      if(!appearanceDemo && ['processing','completed','viewed'].includes(data.state)) {
        const changed=taskState!==data.state;
        taskState=data.state;unread=taskState==='completed';
        if(taskState==='viewed') openThread('demo-notes');
        else {if(changed) $('demo-thread').hidden=true;render();}
      }
      return;
    }
    const kind=Object.keys(frames).find(key=>event.source===frames[key].contentWindow);
    if(!kind || data?.type!=='qiuqiu-quota-action' || data.kind!==kind) return;
    if(data.action==='ready') {ready.add(kind);send(kind);}
    else if(data.action==='toggle' && kind==='quota') {expanded=!expanded;render();}
    else if(data.action==='toggle-api' && kind==='api-label') {apiExpanded=!apiExpanded;render();}
    else if(data.action==='detail') openDetail(data.detail,data.period);
    else if(data.action==='api') {apiVisible=true;render();}
    else if(data.action==='resize' && kind==='details' && Number.isFinite(data.height)) {frames.details.height=Math.max(120,Math.min(700,data.height));resize();}
    else if(data.action==='thread' && kind==='details' && ['demo-layout','demo-notes'].includes(data.id)) {
      openThread(data.id);
    } else if(data.action==='mark-all-read' && kind==='details') {
      const success=data.generation===generation;
      if(success) {unread=false;if(!appearanceDemo && taskState==='completed') taskState='viewed';render();}
      post(frames.details,{type:'qiuqiu-quota-read-result',generation:data.generation,success});
    } else if(data.action==='refresh-api' && kind==='api-report') {feedback('报告已刷新。');}
    else if(data.action==='guide' && kind==='api-report') {feedback('网页无需输入密钥。');}
  });
  new ResizeObserver(resize).observe(document.querySelector('main'));
  new ResizeObserver(()=>{sizeCards();resize();}).observe(cards);
  let detailWidth=0;
  new ResizeObserver(([entry])=>{
    if(entry.contentRect.width===detailWidth) return;
    detailWidth=entry.contentRect.width; send('details');
  }).observe(document.querySelector('.demo-detail'));
  window.QiuqiuQuotaDemo=Object.freeze({getState:()=>Object.freeze({appearance,colorMode,scenario,cardPeriod,expanded,apiExpanded,action,period,unread,apiVisible,paused,taskState})});
  parent.postMessage({type:'qiuqiu-demo-ready'},location.origin);
  render();
})();
