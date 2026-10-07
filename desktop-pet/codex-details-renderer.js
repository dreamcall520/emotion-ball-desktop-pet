(function renderCodexDetails() {
  'use strict';
  const bridge = window.petCodexDetails;
  const root = document.documentElement;
  const panel = document.getElementById('details-panel');
  const title = document.getElementById('details-title');
  const content = document.getElementById('details-content');
  const close = document.getElementById('details-close');
  const back = document.getElementById('details-back');
  const readAll = document.getElementById('details-read-all');
  if (!bridge?.onModel || !panel || !title || !content || !close || !back) return;
  const actions = ['tasks', 'results', 'trend', 'opportunities', 'credits'];
  const taskStates = { active: '进行中', waiting: '等待中', completed: '已完成', failed: '执行失败', interrupted: '已中断', idle: '空闲', unknown: '状态未提供' };
  const clean = (value, limit = 140) => typeof value === 'string'
    ? Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ').replace(/\s+/gu, ' ').trim()).slice(0, limit).join('') : '';
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const array = (value, limit = 300) => Array.isArray(value) ? value.slice(0, limit) : [];
  const timestamp = value => Number.isSafeInteger(value) && value > 0 ? value : null;
  const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const countText = value => value === null ? '—' : value > 99 ? '99+' : String(value);
  const periodName = minutes => minutes === 10080 ? '周' : minutes === 300 ? '5 小时' : `${minutes} 分钟`;
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className || '';
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const note = text => node('p', 'panel-note', text);
  function invoke(method, ...args) { try { bridge[method]?.(...args); } catch (_) {} }
  function button(text, className, callback) {
    const element = node('button', className, text);
    element.type = 'button'; element.addEventListener('click', callback); return element;
  }
  function dateLabel(at) {
    if (!timestamp(at)) return '暂未提供';
    const date = new Date(at), now = new Date();
    return `${date.getFullYear() !== now.getFullYear() ? `${date.getFullYear()}/` : ''}${String(date.getMonth() + 1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
  }
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  let appearance = 'system', colorMode = 'standard', lastModel = null, markingRead = false;
  const chartViews = new Map();
  let expiryTimer;
  function theme() {
    const resolved = appearance === 'system' ? media?.matches ? 'dark' : 'light' : appearance;
    root.dataset.appearance = appearance;
    root.dataset.resolvedAppearance = resolved;
    root.dataset.accessibleAppearance = resolved;
    root.dataset.colorMode = colorMode;
  }
  function resize() {
    const measure = () => {
      const style = window.getComputedStyle(panel);
      const height = Math.ceil(content.getBoundingClientRect().bottom - panel.getBoundingClientRect().top
        + (panel.scrollTop || 0) + parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth));
      if (Number.isFinite(height)) invoke('resize', Math.max(120, Math.min(700, height)));
    };
    if (window.requestAnimationFrame) window.requestAnimationFrame(measure); else measure();
  }
  function copyModel(value) {
    const source = object(value);
    const items = array(source.items, 2).map(raw => {
      const item = object(raw), pace = object(item.pace);
      return { windowMinutes: item.windowMinutes, remaining: percent(item.remaining), resetsAt: timestamp(item.resetsAt), resetLabel: clean(item.resetLabel, 40),
        pace: { state: ['fast','balanced','slow'].includes(pace.state) ? pace.state : 'unknown', remainingTimePercent: percent(pace.remainingTimePercent) } };
    }).filter(item => Number.isSafeInteger(item.windowMinutes) && item.windowMinutes > 0 && item.remaining !== null);
    const activity = object(source.activity);
    const tasks = key => array(source[key]).map(raw => { const item = object(raw); return { id: clean(item.id,160), turnId: clean(item.turnId,160), title: clean(item.title), state: Object.hasOwn(taskStates,item.state) ? item.state : 'unknown', updatedAt: timestamp(item.updatedAt) }; }).filter(item => item.id);
    const opportunity = raw => { const item = object(raw); return { expiresAt: item.expiresAt === null ? null : timestamp(item.expiresAt) || 'unknown', estimatedRemaining: percent(item.estimatedRemaining), title: clean(item.title), status: ['available','redeeming','redeemed'].includes(item.status) ? item.status : 'unknown', state: ['used','expired'].includes(item.state) ? item.state : null }; };
    const trend = object(source.trend), forecast = object(trend.forecast);
    const accountHistory = object(source.accountResetHistory);
    const samples = array(trend.samples,6000).map(raw => { const sample = object(raw); return { at: timestamp(sample.at), remaining: percent(sample.remaining) }; }).filter(sample => sample.at !== null && sample.remaining !== null).sort((a,b) => a.at - b.at).filter((sample,index,list) => !index || sample.at > list[index-1].at);
    return { action: actions.includes(source.action) ? source.action : 'tasks', appearance: ['light','dark'].includes(source.appearance) ? source.appearance : 'system',
      state: source.state, observedAt: timestamp(source.observedAt), quotaUpdatedAt: timestamp(source.quotaUpdatedAt),
      colorMode: ['standard','accessible'].includes(source.colorMode) ? source.colorMode : null, generation: count(source.generation), items,
      period: items.some(item => item.windowMinutes === source.period) ? source.period : items[0]?.windowMinutes || 300,
      activity: { runningCount: count(activity.runningCount), unreadCount: count(activity.unreadCount) }, tasks: tasks('tasks'), results: tasks('results'),
      resetCreditsAvailable: count(source.resetCreditsAvailable), resetDetailsState: source.resetDetailsState === 'known' ? 'known' : 'unknown',
      resetDetailsPartial: source.resetDetailsPartial === true, resetOpportunities: Array.isArray(source.resetOpportunities) ? array(source.resetOpportunities).map(opportunity) : null,
      resetHistory: array(source.resetHistory).map(opportunity).filter(item => item.state), extraCredits: object(source.extraCredits),
      accountResetHistory: { state: ['ready','partial','error'].includes(accountHistory.state) ? accountHistory.state : 'unavailable',
        updatedAt: timestamp(accountHistory.updatedAt),
        events: array(accountHistory.events,200).map(raw => { const event = object(raw); return { kind: event.kind, occurredAt: timestamp(event.occurredAt) }; })
          .filter(event => ['granted','redeemed'].includes(event.kind) && event.occurredAt !== null) },
      returnToTrend: source.returnToTrend === true, returnPeriod: Number.isSafeInteger(source.returnPeriod) ? source.returnPeriod : null,
      trend: { samples, resetsAt: timestamp(trend.resetsAt), resetLabel: clean(trend.resetLabel,40), windowMinutes: Number.isSafeInteger(trend.windowMinutes) ? trend.windowMinutes : null,
        forecast: { state: forecast.state === 'estimate' ? 'estimate' : 'unknown', exhaustsAt: timestamp(forecast.exhaustsAt), label: clean(forecast.label,100),
          status: ['risk','tight','safe'].includes(forecast.status) ? forecast.status : 'unknown', summary: clean(forecast.summary,100), detail: clean(forecast.detail,100) } } };
  }
  function setTitle(text, amount) {
    title.replaceChildren(node('span','',text), ...(amount !== undefined && amount !== null ? [node('span','activity-count',countText(amount))] : []));
  }
  function icon(state) {
    const wrap = node('span', 'activity-icon');
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 20 20'); svg.setAttribute('aria-hidden','true');
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', state === 'completed' ? 'M4 10l4 4 8-9' : state === 'failed' || state === 'interrupted' ? 'M5 5l10 10M15 5L5 15' : state === 'waiting' ? 'M6 3h8M6 17h8M7 3v4l6 6v4M13 3v4l-6 6v4' : 'M4 4h12v9H9l-4 3v-3H4z');
    svg.appendChild(path); wrap.appendChild(svg); return wrap;
  }
  function renderActivity(model) {
    const results = model.action === 'results', list = results ? model.results : model.tasks.filter(task => ['active','waiting'].includes(task.state));
    setTitle(results ? '待查看' : '进行中', results ? model.activity.unreadCount : model.activity.runningCount);
    if (!list.length) {
      const known = results ? model.activity.unreadCount : model.activity.runningCount;
      content.replaceChildren(node('p','empty-state',known === null ? '暂未提供' : results ? '暂无待查看结果' : '暂无进行中任务'),note(results ? '仅记录球球观察到的新完成结果。' : '仅展示球球已观察到的任务状态。'));
      return;
    }
    const ul = node('ul','activity-list');
    ul.replaceChildren(...list.map(task => {
      const li = node('li',''), row = button('','activity-item',() => invoke('openThread',task.id,task.turnId || undefined));
      row.dataset.threadId = task.id;
      const copy = node('span','activity-copy');
      copy.replaceChildren(node('b','',task.title || '未命名会话'),node('small','',taskStates[task.state]));
      row.replaceChildren(icon(task.state),copy,...(results ? [node('span','unread-marker')] : []));
      li.appendChild(row); return li;
    }));
    content.replaceChildren(ul,note(results ? '打开对应会话后，清除该条待查看标记。' : '点击任务，打开对应 Codex 会话。阶段仅显示已观察到的状态。'));
  }
  function opportunityRows(entries, history = false) {
    const list = node('ul','opportunity-list');
    const head = node('li','table-head');
    head.replaceChildren(node('span','','次数'),node('span','',history ? '原到期时间' : '到期时间'),node('span','','状态'));
    list.replaceChildren(head,...entries.map(entry => {
      const li = node('li','');
      const expiry = entry.expiresAt === null ? '无到期限制' : entry.expiresAt === 'unknown' ? '暂未提供' : dateLabel(entry.expiresAt);
      const state = history ? entry.state === 'expired' ? '已过期' : '已使用' : ({available:'可用',redeeming:'使用中',redeemed:'已使用',unknown:'状态未提供'}[entry.status]);
      li.replaceChildren(node('b','','1 次'),node('span','',expiry),node('span','opportunity-status',state));
      if (entry.title) li.title = entry.title;
      return li;
    }));
    return list;
  }
  function renderOpportunities(model) {
    setTitle('重置机会');
    const summary = node('div','reset-summary');
    summary.replaceChildren(node('span','','当前可用'),node('strong',model.resetCreditsAvailable > 0 ? 'positive-count' : '',model.resetCreditsAvailable === null ? '暂未提供' : String(model.resetCreditsAvailable)),...(model.resetCreditsAvailable === null ? [] : [node('span',model.resetCreditsAvailable > 0 ? 'positive-count' : '','次')]));
    const nodes = [summary];
    if (model.resetCreditsAvailable === 0) nodes.push(node('p','empty-state','暂无重置机会'));
    else if (model.resetOpportunities?.length) {
      nodes.push(opportunityRows(model.resetOpportunities));
      if (model.resetDetailsPartial) nodes.push(note('仅返回部分明细，机会总数以当前可用数量为准。'));
    } else nodes.push(node('p','empty-state','到期明细暂未提供'));
    const history = node('details','opportunity-history');
    const account = model.accountResetHistory, synced = ['ready','partial'].includes(account.state);
    const historyLabel = synced && (account.state === 'ready' || account.events.length) ? `账户历史 · 过去 30 天 · ${account.events.length} 条${account.state === 'partial' ? '（部分）' : ''}`
      : account.events.length ? `账户历史 · ${account.events.length} 条（未更新）` : '账户历史 · 未同步';
    const historyContent = [];
    if (account.events.length) {
      const list = node('ul','opportunity-list'), head = node('li','table-head');
      head.replaceChildren(node('span','','记录'),node('span','','发生时间'),node('span','',''));
      list.replaceChildren(head,...account.events.map(event => {
        const li = node('li','');
        li.replaceChildren(node('b','',event.kind === 'granted' ? '已获得' : '已使用'),node('span','',dateLabel(event.occurredAt)),node('span','',''));
        return li;
      }));
      historyContent.push(list);
    } else historyContent.push(node('p','empty-state',account.state === 'ready' ? '过去 30 天暂无获得或使用记录' : '账户历史暂未同步'));
    if (!synced) historyContent.push(note('历史查询未完成，不代表账户没有记录。稍后会自动重试。'));
    else if (account.state === 'partial') historyContent.push(note('仅显示已同步的部分记录，稍后会自动重试。'));
    history.replaceChildren(node('summary','',historyLabel),...historyContent);
    history.addEventListener('toggle',resize); nodes.push(history);
    if (model.resetHistory.length) {
      const local = node('details','opportunity-history local-opportunity-history');
      local.replaceChildren(node('summary','',`本机观察记录 · ${model.resetHistory.length}`),opportunityRows(model.resetHistory,true),note('仅包含球球在本机观察到的已使用或已过期机会，独立于账户历史。'));
      local.addEventListener('toggle',resize); nodes.push(local);
    }
    content.replaceChildren(...nodes);
  }
  function svgNode(tag, attributes, text) {
    const element = document.createElementNS('http://www.w3.org/2000/svg',tag);
    for (const [key,value] of Object.entries(attributes)) element.setAttribute(key,String(value));
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function chart(model, item) {
    const samples = model.trend.samples, reset = model.trend.resetsAt || item.resetsAt;
    const duration = (model.trend.windowMinutes || item.windowMinutes) * 60000;
    const end = reset || samples.at(-1)?.at, start = reset ? reset - duration : samples[0]?.at;
    const valid = samples.filter(sample => sample.at >= start && sample.at <= end);
    if (!valid.length || !end || end <= start) return node('p','empty-state','暂无已采样趋势');
    const svg = svgNode('svg',{class:'trend-chart',viewBox:'0 0 368 130',role:'img','aria-label':`${periodName(item.windowMinutes)}已采样额度趋势，曲线只到最后采样时间`});
    const x = at => 30 + (at - start) / (end - start) * 320, y = remaining => 102 - remaining * .8;
    svg.appendChild(svgNode('path',{class:'axis',d:'M30 22H350M30 62H350M30 102H350'}));
    [100,50,0].forEach((value,index) => svg.appendChild(svgNode('text',{x: value === 100 ? 1 : value === 50 ? 7 : 13,y:25+index*40},`${value}%`)));
    const segments = [], gaps = [], timeSegments = [];
    valid.forEach((sample,index) => {
      const previous = valid[index-1];
      const correction = previous && (sample.remaining > previous.remaining || previous.remaining-sample.remaining >= 25);
      const missing = previous && sample.at-previous.at >= 300000;
      if (!previous || missing || correction) segments.push([]);
      if (!previous || correction) timeSegments.push([]);
      // A dashed connector relates two known observations, never a continuous usage record.
      if (missing && !correction) gaps.push([previous,sample]);
      segments.at(-1).push(sample);
      timeSegments.at(-1).push(sample);
    });
    const coordinate = sample => `${x(sample.at).toFixed(1)} ${y(sample.remaining).toFixed(1)}`;
    const paths = segments.map(segment => TrendCurve.path(segment.map(sample => [x(sample.at), y(sample.remaining)])));
    const path = paths.map((value,index) => segments[index].length === 1 ? `${value}L${coordinate(segments[index][0])}` : value).join('');
    const last = valid.at(-1);
    const area = paths.flatMap((value,index) => segments[index].length > 1
      ? [`${value}L${x(segments[index].at(-1).at)} 102L${x(segments[index][0].at)} 102Z`] : []).join('');
    if (area) svg.appendChild(svgNode('path',{class:'observed-area',d:area}));
    if (reset) svg.appendChild(svgNode('path',{class:'time-path',d:timeSegments.map(segment => {
      const timeCoordinate = sample => `${x(sample.at).toFixed(1)} ${y((end-sample.at)/(end-start)*100).toFixed(1)}`;
      return `M${timeCoordinate(segment[0])}L${timeCoordinate(segment.at(-1))}`;
    }).join('')}));
    svg.appendChild(svgNode('path',{class:'now',d:`M${x(last.at)} 16V102`}));
    if (gaps.length) {
      const connector = svgNode('path',{class:'unrecorded-line',d:gaps.map(gap => 'M'+gap.map(coordinate).join('L')).join('')});
      connector.appendChild(svgNode('title',{},'虚线区间无记录，仅连接两次已知采样，不参与用量预估'));
      svg.appendChild(connector);
      svg.setAttribute('aria-label',`${periodName(item.windowMinutes)}已采样额度趋势，蓝色虚线区间无记录，曲线只到最后采样时间`);
    }
    svg.appendChild(svgNode('path',{class:'observed-line',d:path,'stroke-linecap':'round','stroke-linejoin':'round'}));
    const markerStride = Math.max(1, Math.ceil((valid.length - 1) / 6));
    valid.forEach((sample,index) => {
      const endpoint = index === 0 || index === valid.length - 1;
      if (!endpoint && index % markerStride !== 0) return;
      const dot = svgNode('circle',{class:'point'+(endpoint?' endpoint':''),cx:x(sample.at),cy:y(sample.remaining),r:endpoint ? 2.4 : 2});
      dot.appendChild(svgNode('title',{},`${dateLabel(sample.at)} · ${sample.remaining}%`)); svg.appendChild(dot);
    });
    const tick = (at,anchor,text) => svg.appendChild(svgNode('text',{x:x(at),y:122,'text-anchor':anchor},text));
    const timeOnly = at => dateLabel(at).split(' ').at(-1);
    tick(start,'start',item.windowMinutes > 1440 ? dateLabel(start).split(' ')[0] : timeOnly(start));
    if ((last.at - start)/(end-start) > .18 && (end-last.at)/(end-start) > .18) tick(last.at,'middle','已采样');
    tick(end,'end',`${item.windowMinutes > 1440 ? dateLabel(end).split(' ')[0] : timeOnly(end)}${reset ? ' 重置' : ''}`);
    return svg;
  }
  function addResetMarkers(graph,svg,model,item){
    const end=model.trend.resetsAt||item.resetsAt,duration=(model.trend.windowMinutes||item.windowMinutes)*60000;
    const start=end-duration,now=Date.now();
    if(!end||!quotaFresh(model,now)||model.resetCreditsAvailable===0||!svg.classList.contains('trend-chart')||svg.classList.contains('daily-chart'))return;
    const entries=(model.resetOpportunities||[]).filter(e=>e.status==='available'&&typeof e.expiresAt==='number'&&e.expiresAt>now&&e.expiresAt>=start&&e.expiresAt<end).sort((a,b)=>a.expiresAt-b.expiresAt);
    const groups=[];
    for(const entry of entries){
      const x=30+(entry.expiresAt-start)/duration*320,last=groups.at(-1);
      if(last&&x-last.x<26)last.entries.push(entry);else groups.push({x,entries:[entry]});
    }
    if(!groups.length)return;
    svg.setAttribute('role','group');
    const layer=node('div','reset-markers');
    for(const group of groups){
      svg.appendChild(svgNode('path',{class:'reset-event-guide',d:`M${group.x} 24V102`,'aria-hidden':'true'}));
      const details=node('details','reset-event'),summary=node('summary','reset-event-trigger');
      details.dataset.expiry=String(group.entries[0].expiresAt);
      summary.dataset.expiry=details.dataset.expiry;
      details.style.left=group.x/368*100+'%';
      summary.setAttribute('aria-label',`${group.entries.length} 次重置机会到期 · ${group.entries.map(e=>dateLabel(e.expiresAt)).join('、')}`);
      const clock=svgNode('svg',{viewBox:'0 0 16 16','aria-hidden':'true'});
      clock.append(svgNode('circle',{cx:8,cy:8,r:5.5}),svgNode('path',{d:'M8 4.5V8H5'}));summary.appendChild(clock);
      if(group.entries.length>1)summary.appendChild(node('span','reset-event-count',String(group.entries.length)));
      const popup=node('div','reset-event-popup');
      popup.id=`reset-expiry-detail-${groups.indexOf(group)}`;
      popup.setAttribute('role','note');
      popup.style.left=(Math.max(0,Math.min(368-182,group.x-91))-group.x+12)+'px';
      popup.appendChild(node('b','reset-event-heading','到期前记得使用'));
      for(const entry of group.entries)popup.appendChild(node('span','reset-event-time',`1 次 · ${dateLabel(entry.expiresAt)} 到期`));
      const balance=node('div','reset-event-balance');
      balance.replaceChildren(node('span','','当前剩余额度'),node('b','',`${Math.round(item.remaining)}%`));
      const estimate=group.entries[0].estimatedRemaining;
      popup.append(balance,node('small','',`${group.entries.length>1?'最早到期时':'到期时'}预计余量：${estimate===null?'暂无法预估':Math.round(estimate)+'%（预估）'}`));
      details.replaceChildren(summary,popup);
      details.addEventListener('toggle',()=>{if(details.open){summary.setAttribute('aria-describedby',popup.id);for(const other of layer.children)if(other!==details)other.open=false;const help=graph.parentElement?.querySelector('.chart-help');if(help)help.open=false;}else summary.removeAttribute('aria-describedby');});
      details.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();details.open=false;summary.focus();}});
      layer.appendChild(details);
    }
    graph.appendChild(layer);
  }
  function quotaFresh(model,now=Date.now()) {
    return model.state==='ready'&&model.quotaUpdatedAt!==null&&model.quotaUpdatedAt<=now&&now-model.quotaUpdatedAt<300000;
  }
  function scheduleExpiry(model) {
    window.clearTimeout?.(expiryTimer);
    if(model.action!=='trend'||!quotaFresh(model)||model.resetCreditsAvailable===0)return;
    const now=Date.now(),expiry=(model.resetOpportunities||[]).filter(entry=>entry.status==='available'&&typeof entry.expiresAt==='number'&&entry.expiresAt>now).map(entry=>entry.expiresAt);
    if(!expiry.length)return;
    const deadline=Math.min(model.quotaUpdatedAt+300000,...expiry);
    expiryTimer=window.setTimeout?.(()=>render(lastModel),Math.max(1,deadline-now));
  }
  function dailyChart(model,item){
    const end=model.trend.samples.at(-1)?.at,reset=model.trend.resetsAt||item.resetsAt;
    const start=reset-(model.trend.windowMinutes||item.windowMinutes)*60000;
    const days=TrendDaily.build(model.trend.samples,{start,end});
    if(!days.length)return node('p','empty-state','暂无已记录用量');
    const max=Math.max(10,Math.ceil(Math.max(0,...days.map(d=>d.amount||0))/.8/5)*5);
    const svg=svgNode('svg',{class:'trend-chart daily-chart',viewBox:'0 0 368 130',role:'img','data-correction':days.some(d=>d.correction),'aria-label':'每日消耗参考。点上数值为有连续记录时减少的额度，不是每日末余额。缺记录的日期不连线；淡虚线表示记录不完整，仅供比较，不能当作全天总用量。'});
    const left=30,right=350,bottom=102,top=22,step=(right-left)/days.length,y=v=>bottom-v/max*(bottom-top);
    svg.appendChild(svgNode('path',{class:'axis',d:'M30 22H350M30 102H350'}));
    [max,max/2,0].forEach((v,i)=>svg.appendChild(svgNode('text',{x:24,y:25+i*40,'text-anchor':'end'},v+'%')));
    const connectors=svgNode('g',{});svg.appendChild(connectors);
    days.forEach((day,i)=>{
      const px=left+step*(i+.5),latest=i===days.length-1,date=dateLabel(day.at).split(' ')[0];
      if(day.amount===null){
        const label=day.count===1?'仅 1 次记录':day.count?'无法计算':'—';
        svg.appendChild(svgNode('text',{x:px,y:85,'text-anchor':'middle',class:'daily-empty','aria-label':date+' '+(day.count?'无法计算用量：'+label:'没有记录')},label));
      }
      else{
        const previous=days[i-1];
        if(previous&&previous.amount!==null&&!previous.reset&&!day.reset){
          const partial=previous.partial||day.partial||previous.correction||day.correction;
          const connector=svgNode('path',{d:`M${px-step} ${y(previous.amount)}L${px} ${y(day.amount)}`,class:'daily-line'+(partial?' partial':'')});
          connector.appendChild(svgNode('title',{},partial?'两天记录不完整，虚线只便于比较参考值':'比较相邻两天已记录的消耗量'));
          connectors.appendChild(connector);
        }
        const point=svgNode('circle',{cx:px,cy:y(day.amount),r:latest?2.5:2,class:'daily-point'+(latest?' latest':''),'data-day':date,'data-amount':day.amount,'data-correction':day.correction,'data-partial':day.partial});
        point.appendChild(svgNode('title',{},`${date} · 记录中减少 ${day.amount}%（占周期总额度）。${day.increased?'剩余额度曾增加，当天用量仅供参考。':day.correction?'短时变化较大，该次变化未计入用量。':day.partial?'只覆盖部分时段，不代表全天用量。':'连续记录覆盖本日已过去时段。'}`));svg.appendChild(point);
        svg.appendChild(svgNode('text',{x:px,y:y(day.amount)-7,'text-anchor':'middle',class:'daily-value'+(latest?' latest':'')},day.amount+'%'));
      }
      svg.appendChild(svgNode('text',{x:px,y:116,'text-anchor':'middle'},date));
      const secondary=day.increased?'剩余额度增加':day.correction?'额度变化较大':latest?'截至 '+dateLabel(end).split(' ').at(-1):day.amount!==null&&day.partial?'仅部分时段':'';
      if(secondary)svg.appendChild(svgNode('text',{x:px,y:128,'text-anchor':'middle',class:'daily-secondary'},secondary));
    });
    return svg;
  }
  function renderTrend(model) {
    const item = model.items.find(value => value.windowMinutes === model.period);
    setTitle(model.items.length > 1 ? '额度趋势' : model.period === 10080 ? '周额度趋势' : `${periodName(model.period)}趋势`);
    title.appendChild(node('small','title-product','CODEX'));
    if (!item) { content.replaceChildren(node('p','empty-state','暂无周期额度')); return; }
    if (model.items.length > 1) {
      const tabs = node('div','trend-tabs');
      tabs.replaceChildren(...model.items.map(period => {
        const tab = button(periodName(period.windowMinutes),'',() => invoke('openDetail','trend',period.windowMinutes));
        tab.dataset.period = String(period.windowMinutes);
        tab.setAttribute('aria-pressed',String(model.period === period.windowMinutes)); return tab;
      }));
      tabs.setAttribute('role','group'); tabs.setAttribute('aria-label','趋势周期'); panel.querySelector('.panel-header').insertBefore(tabs,panel.querySelector('.panel-tools'));
    }
    const stats = node('div','trend-stats');
    const stat = (text,label,className) => { const p = node('p',''); p.replaceChildren(node('span','',label),node('strong',className,text)); return p; };
    const time = item.pace.remainingTimePercent;
    stats.replaceChildren(stat(`${Math.round(item.remaining)}%`,'剩余额度',''),stat(time === null ? '—' : `${Math.round(time)}%`,'剩余时间','time-value'),node('span',`trend-pace ${item.pace.state}`,({fast:'用量偏快',balanced:'节奏均衡',slow:'用量较慢',unknown:'待记录'}[item.pace.state])));
    const meta = node('div','chart-meta');
    const trendChart = chart(model,item);
    const hasUnrecorded = Boolean(trendChart.querySelector('.unrecorded-line'));
    const latest = model.trend.samples.at(-1)?.at;
    const updated = node('span','chart-updated',latest ? `${dateLabel(latest).split(' ').at(-1)} 更新` : '暂无记录');
    updated.title = latest ? `已记录至 ${dateLabel(latest)}；实线为连续采样${hasUnrecorded ? '，蓝色虚线区间无记录' : ''}，后续暂无记录。` : '尚未提供趋势记录';
    const forecast = node('div',`forecast-note ${model.trend.forecast.status}`), copy = node('div','forecast-copy');
    const known = model.trend.forecast.state === 'estimate';
    copy.replaceChildren(node('b','',model.trend.forecast.summary || (known ? '预估结果暂未提供' : '暂无法预估额度用完时间')),node('p','',model.trend.forecast.detail || (known ? '按近期用量估算，会随实际用量变化' : '连续用量记录不足，稍后再查看')));
    forecast.title = '根据连续用量记录，估算当前周期额度何时用完、能否够用到重置';
    forecast.replaceChildren(node('span','forecast-symbol',known ? ({risk:'⚠️',tight:'⏳',safe:'🌿'}[model.trend.forecast.status] || '⏳') : '🔎'),copy,node('span','forecast-badge',known ? '预估' : '待预估'));
    const bottom = node('div','panel-bottom'), reset = node('p','');
    reset.replaceChildren(node('span','','本周期重置'),node('b','',model.trend.resetLabel || item.resetLabel || dateLabel(model.trend.resetsAt || item.resetsAt)));
    const opportunities = button('','reset-link',() => invoke('openDetail','opportunities',model.period));
    opportunities.dataset.action = 'opportunities';
    const chevron = node('span','reset-chevron','›');
    chevron.setAttribute('aria-hidden','true');
    const opportunityAmount = node('b','');
    opportunityAmount.replaceChildren(node('span',model.resetCreditsAvailable > 0 ? 'positive-count' : '',model.resetCreditsAvailable === null ? '暂未提供' : String(model.resetCreditsAvailable)),...(model.resetCreditsAvailable === null ? [] : [node('span',model.resetCreditsAvailable > 0 ? 'positive-count' : '',' 次')]));
    opportunities.replaceChildren(node('span','','重置机会 '),opportunityAmount,chevron);
    const expiries = quotaFresh(model) ? (model.resetOpportunities || []).filter(entry => entry.status==='available' && typeof entry.expiresAt === 'number' && entry.expiresAt > Date.now()).sort((a,b) => a.expiresAt-b.expiresAt) : [];
    if (expiries.length && model.resetCreditsAvailable!==0) opportunities.appendChild(node('span','expiry',`1 次于 ${dateLabel(expiries[0].expiresAt)} 到期`));
    bottom.replaceChildren(reset,opportunities);
    const graph=node('div','chart-block'),switcher=node('div','chart-view-switch');
    switcher.setAttribute('role','tablist');switcher.setAttribute('aria-label','图表视图');
    const lineTitle=updated.title,help=node('details','chart-help'),summary=node('summary','','ⓘ'),helpBody=node('div','chart-help-body');
    summary.setAttribute('aria-label','图表说明');summary.dataset.help='chart';help.replaceChildren(summary,helpBody);
    help.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();help.open=false;summary.focus();}});
    help.addEventListener('toggle',()=>{if(help.open)graph.querySelectorAll('.reset-event').forEach(event=>event.open=false);});
    const status=node('span','chart-status'),actions=node('div','chart-actions');
    actions.replaceChildren(status,updated,help);meta.replaceChildren(switcher,actions);
    const views=[['line','走势'],['daily','每日消耗']];
    function selectView(kind){
      chartViews.set(model.period,kind);
      graph.querySelector('.trend-chart')?.remove();
      graph.querySelector('.empty-state')?.remove();
      graph.querySelector('.reset-markers')?.remove();
      // The line SVG is reused when switching views; rebuild its event guides once.
      trendChart.querySelectorAll('.reset-event-guide').forEach(guide=>guide.remove());
      const selectedChart=kind==='daily'?dailyChart(model,item):trendChart;
      graph.prepend(selectedChart);
      addResetMarkers(graph,selectedChart,model,item);
      graph.dataset.view=kind;
      const daily=kind==='daily';
      status.textContent=daily?'仅供参考':'';
      updated.title=daily?'历史记录不完整，图中数值不能当作全天总用量。':lineTitle;
      const meanings=node('dl','chart-meanings');
      const rows=daily?[
        ['仅 1 次记录','无法计算用量'],
        ['仅部分时段','不代表全天用量'],
        ['剩余额度增加','读到的余额变多，用量仅供参考']
      ]:[['蓝色实线','有连续记录'],['蓝色虚线','中间没有记录'],['灰色虚线','剩余时间参考']];
      rows.forEach(([label,meaning])=>meanings.append(node('dt','',label),node('dd','',meaning)));
      helpBody.replaceChildren(meanings,node('p','chart-help-foot',daily?'— 无记录 · 虚线只连接参考值':'额度增加或重置时，走势分段显示'));
      help.open=false;
      for(const b of switcher.children){const active=b.dataset.view===kind;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
      resize();
    }
    views.forEach(([kind,label])=>{
      const tab=button(label,'',()=>selectView(kind));
      tab.dataset.view=kind;tab.setAttribute('role','tab');
      tab.addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();const next=kind==='line'?'daily':'line';selectView(next);switcher.querySelector(`[data-view="${next}"]`).focus();}});
      switcher.appendChild(tab);
    });
    content.replaceChildren(stats,meta,graph,forecast,bottom);
    selectView(chartViews.get(model.period)||'line');
  }
  function renderCredits(model) {
    setTitle('剩余额度');
    const credit = model.extraCredits, summary = node('div','balance-summary');
    const valid = credit.state === 'balance' && typeof credit.balance === 'string' && /^\d+(?:\.\d+)?$/.test(credit.balance) && credit.balance.length <= 128;
    let formatted = '';
    if (valid && typeof window.petCreditBalanceText === 'function') {
      try { formatted = window.petCreditBalanceText(credit.balance); } catch (_) {}
    }
    const parts = typeof formatted === 'string' ? formatted.match(/^([<]?[\d,]+)(\.\d{2})$/u) : null;
    summary.replaceChildren(node('p','balance-caption','当前余额'));
    if (parts) {
      const value = node('strong','balance-value');
      value.title = credit.balance;
      value.setAttribute('aria-label',formatted);
      value.replaceChildren(node('span','balance-whole',parts[1]),node('span','balance-decimal',parts[2]));
      summary.appendChild(value);
    } else {
      summary.appendChild(node('strong','balance-state',credit.state === 'none' ? '暂无余额' : credit.state === 'unlimited' ? '不限额' : '暂未提供'));
    }
    if (credit.state === 'stale') summary.appendChild(node('p','balance-status','余额已过期，等待更新'));
    else if (credit.usageStatus === 'blocked') summary.appendChild(node('p','balance-status blocked','已达花费限制'));
    content.replaceChildren(summary);
  }
  function render(value) {
    try {
      const model = copyModel(value);
      const change = !lastModel || lastModel.action !== model.action || lastModel.period !== model.period;
      const historyOpen = !change && panel.querySelector('.opportunity-history')?.open === true;
      const focusedThread = !change ? document.activeElement?.dataset?.threadId : null;
      const focusedPeriod = !change ? document.activeElement?.dataset?.period : null;
      const focusedView = !change ? document.activeElement?.dataset?.view : null;
      const focusedExpiry = !change ? document.activeElement?.dataset?.expiry : null;
      const focusedHelp = !change && document.activeElement?.dataset?.help === 'chart';
      const openExpiry = !change ? content.querySelector('.reset-event[open]')?.dataset.expiry : null;
      const helpOpen = !change && content.querySelector('.chart-help')?.open;
      lastModel = model;
      appearance = model.appearance; if (model.colorMode) colorMode = model.colorMode; theme();
      panel.dataset.action = model.action;
      panel.querySelector('.trend-tabs')?.remove();
      back.hidden = !model.returnToTrend;
      if (readAll) { readAll.hidden = model.action !== 'results' || !model.results.length; readAll.disabled = markingRead || model.generation === null; }
      if (model.action === 'trend') renderTrend(model);
      else if (model.action === 'opportunities') renderOpportunities(model);
      else if (model.action === 'credits') renderCredits(model);
      else renderActivity(model);
      if (historyOpen && panel.querySelector('.opportunity-history')) panel.querySelector('.opportunity-history').open = true;
      if (openExpiry) { const event = Array.from(content.querySelectorAll('.reset-event')).find(event=>event.dataset.expiry===openExpiry); if(event)event.open=true; }
      if (helpOpen && content.querySelector('.chart-help')) content.querySelector('.chart-help').open=true;
      if (change) title.focus();
      else if (focusedThread) {
        const next = Array.from(content.querySelectorAll('.activity-item')).find(element => element.dataset.threadId === focusedThread);
        (next || title).focus();
      } else if (focusedPeriod) {
        const next = Array.from(panel.querySelectorAll('.trend-tabs button')).find(element => element.dataset.period === focusedPeriod);
        next?.focus();
      } else if (focusedView) {
        content.querySelector(`[data-view="${focusedView}"]`)?.focus();
      } else if (focusedExpiry) {
        const next=Array.from(content.querySelectorAll('.reset-event-trigger')).find(event=>event.dataset.expiry===focusedExpiry);
        (next||title).focus();
      } else if (focusedHelp) {
        content.querySelector('.chart-help summary')?.focus();
      }
      scheduleExpiry(model);
      resize();
    } catch (_) { window.clearTimeout?.(expiryTimer); content.replaceChildren(node('p','empty-state','详情暂未提供')); resize(); }
  }
  readAll?.addEventListener('click',async () => {
    if (markingRead || lastModel?.action !== 'results' || !lastModel.results.length || lastModel.generation === null) return;
    const generation = lastModel.generation;
    markingRead = true; readAll.disabled = true;
    try {
      if (await bridge.markAllRead(generation) !== true) throw new Error('MARK_READ_FAILED');
      if (readAll.hidden) title.focus();
    } catch (_) {
      if (lastModel?.action === 'results' && lastModel.generation === generation) {
        content.querySelector('.read-error')?.remove();
        content.appendChild(node('p','panel-note read-error','未能保存已读状态，请重试。')); resize();
      }
    } finally { markingRead = false; readAll.disabled = lastModel?.generation === null; }
  });
  close.addEventListener('click',() => invoke('close'));
  back.addEventListener('click',() => invoke('openDetail','trend',lastModel?.returnPeriod || lastModel?.period));
  window.addEventListener('keydown',event => { if (event.key === 'Escape') { event.preventDefault(); invoke('close'); } });
  const unsubscribe = bridge.onModel(render);
  const unsubscribeColor = bridge.onColorMode?.((value, preference) => { colorMode = value === 'accessible' ? 'accessible' : 'standard'; if (['light','dark','system'].includes(preference)) appearance = preference; theme(); });
  const mediaChange = () => theme(); media?.addEventListener?.('change',mediaChange);
  window.addEventListener('beforeunload',() => { try { window.clearTimeout?.(expiryTimer); unsubscribe?.(); unsubscribeColor?.(); media?.removeEventListener?.('change',mediaChange); } catch (_) {} });
  theme();
})();
