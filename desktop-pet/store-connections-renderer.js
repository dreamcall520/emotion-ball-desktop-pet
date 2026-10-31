(() => {
  const el = id => document.getElementById(id), api = window.storeConnections;
  let busy = false, busyCount=0,lastState=null,cachedPartitions=null,cachedDesktopItems=null,zcodeSourceDraft=null;
  const providers=['codex','zcode','workbuddy'], guideModel=window.ProviderConnectionGuide;
  let guideProvider=null;const skippedSteps=new Map();
  function previewState(){
    if(guideProvider!=='zcode'||zcodeSourceDraft===null||zcodeSourceDraft===lastState?.zcode?.accountSource)return lastState;
    return {...lastState,zcode:{...lastState.zcode,accountSource:zcodeSourceDraft},onboarding:{...lastState.onboarding,zcode:{...lastState.onboarding?.zcode,status:'partial',chat:{status:'unavailable',message:'请连接所选聊天方式'}}}};
  }
  function currentGuide(){return guideProvider&&lastState?guideModel.buildProviderGuide(previewState(),guideProvider):null;}
  function nextGuideStep(guide){const skipped=skippedSteps.get(guideProvider)||new Set();return guide?.steps.find(step=>step.id===guide.nextStepId&&!skipped.has(step.id))||guide?.steps.find(step=>step.id!=='capabilities'&&step.status!=='ready'&&!skipped.has(step.id)&&step.action);}
  function openGuide(provider){if(!providers.includes(provider))return;guideProvider=provider;skippedSteps.set(provider,new Set());el('connection-guide').hidden=false;paintGuide();el('connection-guide').scrollIntoView({block:'start',behavior:'smooth'});el('connection-guide').focus({preventScroll:true});}
  function paintGuide(){
    if(!guideProvider||!lastState)return;const guide=currentGuide(),skipped=skippedSteps.get(guideProvider)||new Set(),next=nextGuideStep(guide);
    el('guide-title').textContent=guide.title;el('guide-zcode-source').hidden=guideProvider!=='zcode';
    const labels={ready:'已完成',working:'处理中','needs-authorization':'需要确认',unavailable:'尚未完成',unknown:'待核实',cancelled:'已取消',error:'需要处理'};
    el('guide-steps').replaceChildren(...guide.steps.map(step=>{const li=document.createElement('li');li.dataset.step=step.id;li.dataset.status=step.status;const heading=document.createElement('div'),title=document.createElement('strong'),badge=document.createElement('span'),description=document.createElement('p');title.textContent=step.title;badge.className='step-badge';badge.textContent=skipped.has(step.id)&&step.status!=='ready'?'稍后完成':labels[step.status]||'待完成';heading.append(title,badge);description.textContent=step.description||'';li.append(heading,description);if(step.action){const action=document.createElement('button');action.className='secondary';action.dataset.action='guide-run';action.dataset.step=step.id;action.textContent=step.actionLabel||(step.status==='ready'?'查看或刷新':'完成这一步');action.disabled=busy||step.status==='working';li.append(action);}return li;}));
    el('guide-next').textContent=next?'继续：'+next.title:'返回工具卡';el('guide-next').disabled=busy||next?.status==='working';el('guide-skip').hidden=!next;el('guide-skip').disabled=busy;el('guide-chat').hidden=guideModel.buildToolCard(lastState,guideProvider).chat.status!=='ready';el('guide-chat').disabled=busy;
    el('guide-result').textContent=guide.complete?'连接已完成，可以返回工具卡使用。':!next?'已保留当前连接。未完成的能力可稍后继续。':guide.partial?'已有能力可以使用，继续完成剩余连接。':'按顺序完成必要确认。不会自动发送聊天消息。';
  }
  function paintCards(state){
    for(const provider of providers){const card=guideModel.buildToolCard(state,provider);el(provider+'-status').textContent=card.statusLabel;for(const capability of ['quota','tasks','chat']){const node=el(provider+'-capability-'+capability);node.textContent=card[capability].text;node.dataset.status=card[capability].status;}
      const button=document.querySelector('button[data-action="enable-provider"][data-provider="'+provider+'"]');button.textContent=state.onboarding?.[provider]?.status==='working'?'正在连接…':card.status==='ready'?'管理连接':card.status==='needs-authorization'?'启用授权':'继续完成连接';
      const updated=card.updatedAt?new Date(card.updatedAt):null;el(provider+'-updated').textContent=updated&&Number.isFinite(updated.getTime())?'最近更新：'+updated.toLocaleString('zh-CN'):'各项能力按实际读取结果显示';
      const taskScope=el(provider+'-task-scope'),taskList=el(provider+'-task-list');
      if(taskScope&&taskList){taskScope.textContent=card.tasks.text;const snapshot=provider==='workbuddy'?state.workbuddyDesktop?.report:state[provider+'Snapshot']?.tasks;const records=Array.isArray(snapshot?.items)?snapshot.items.slice(0,20):[];taskList.replaceChildren(...records.map(item=>{const li=document.createElement('li');const title=typeof item.title==='string'?item.title:typeof item.name==='string'?item.name:'未命名任务';const labels={active:'进行中',completed:'已完成',interrupted:'已中断',failed:'失败',unknown:'状态未知','last-completed':'上次已完成','last-interrupted':'上次已中断','last-failed':'上次失败'};li.textContent=title+' · '+(provider==='zcode'?'历史缓存，实时状态待核实':provider==='codex'&&(snapshot?.state!=='connected'||snapshot?.stale===true)?'上次记录：'+(labels[item.state]||'状态未知')+'（当前待核实）':labels[item.state]||'状态未知');return li;}));if(!records.length){const li=document.createElement('li');li.textContent=provider==='workbuddy'?'仅显示已授权的事件阶段；历史标题需在连接详情选择缓存范围。':'当前没有可展示的任务记录。';taskList.append(li);}}
      const chatButton=document.querySelector('button[data-action="open-provider-chat"][data-provider="'+provider+'"]');chatButton.disabled=busy||!(card.chat.status==='ready'||['needs-model','needs-new-chat'].includes(state.onboarding?.[provider]?.chat?.status));
    }paintGuide();
  }
  function availability(){
    if(busy){const cancel=document.querySelector('button[data-action="cancel-workbuddy-cli"]');if(cancel)cancel.disabled=!lastState?.workbuddyCli?.busy;return;}
    const o=lastState?.workbuddyOfficial||{};
    const c=lastState?.workbuddyCli||{};
    const enabled={
      'read-workbuddy-desktop':Boolean(el('workbuddy-desktop-partition').value),
      'revoke-workbuddy-desktop':lastState?.workbuddyDesktop?.directory==='stored',
      'refresh-workbuddy-cli':c.configured&&!c.busy,
      'connect-workbuddy-cli':c.configured&&!c.busy,
      'send-workbuddy-cli':c.connected&&!c.busy&&c.sendOutcome!=='unknown'&&Boolean(el('workbuddy-cli-text').value.trim()),
      'cancel-workbuddy-cli':c.busy,
      'authorize-workbuddy-official':o.configured&&!o.busy,
      'refresh-workbuddy-official':o.configured&&!o.busy,
      'disconnect-workbuddy-official':o.configured&&!o.busy,
      'send-workbuddy-assistant':o.connected&&!o.busy&&o.sendOutcome!=='unknown'&&Boolean(el('workbuddy-assistant-text').value.trim()),
      'read-workbuddy-assistant':o.connected&&!o.busy&&Boolean(o.anchorMessageId)
    };
    for(const provider of ['codex','zcode','workbuddy']){
      const onboarding=lastState?.onboarding?.[provider];
      const open=document.querySelector('button[data-action="open-provider-chat"][data-provider="'+provider+'"]');
      if(open)open.disabled=!(onboarding?['ready','needs-model','needs-new-chat'].includes(onboarding.chat?.status):lastState?.[provider]?.serviceConfigured);
      const enable=document.querySelector('button[data-action="enable-provider"][data-provider="'+provider+'"]');
      if(enable)enable.disabled=onboarding?.status==='working';
      const data=document.querySelector('button[data-action="enable-provider-data"][data-provider="'+provider+'"]');
      if(data)data.disabled=onboarding?.data?.status==='working';
    }
    for(const [action,value]of Object.entries(enabled)){const button=document.querySelector('button[data-action="'+action+'"]');if(button)button.disabled=!value;}
  }
  function paint(state) {
    if (!state) return;lastState=state;
    el('mode').textContent = state.mode === 'mas-sandbox' ? '按系统授权范围连接工具；各项能力以实际连接结果为准。' : '商店接入联调候选 · 使用独立数据；当前运行未启用 macOS App Sandbox。';
    const c = state.codex, q = state.codexSnapshot?.quota, tasks = state.codexSnapshot?.tasks, chat = state.chat;
    el('codex-status').textContent = c.directory !== 'stored' ? '未授权' : chat?.source === 'codex' && chat?.connection === 'ready' && chat?.modelsStatus === 'ready' ? '聊天已连接' : '目录已授权';
    const quota = q?.windows?.length ? q.windows.map(w => `${w.windowMinutes === 10080 ? '周额度' : w.windowMinutes === 300 ? '5小时额度' : '额度'}剩余 ${Number.isFinite(w.remaining) ? w.remaining + '%' : '未知'}`).join('；') : '额度尚未读取';
    const taskDetail = tasks?.state === 'connected' && Array.isArray(tasks.items) ? `本机日志任务 ${tasks.items.length} 项（覆盖部分日志）` : '任务尚未读取或读取失败';
    el('codex-detail').textContent = `${quota} · ${taskDetail}${chat?.source === 'codex' && (chat.error || chat.modelsError) ? ' · ' + (chat.error || chat.modelsError) : ''}`;
    el('zcode-status').textContent = state.zcode.directory === 'stored' ? '目录已授权' : '未授权';
    if(zcodeSourceDraft===null)el('zcode-account-source').value=state.zcode.accountSource==='configured-custom'?'configured-custom':'official';
    el('zcode-account-source').disabled=busy||state.onboarding?.zcode?.status==='working';
    const z = state.zcodeSnapshot;
    const zQuota = z?.quota?.state === 'connected' ? z.quota.balanceState === 'empty' ? '已读取，当前无可用套餐额度' : '已读取' : z?.quota?.code || '未读取';
    el('zcode-detail').textContent = z ? `额度：${zQuota} · 任务为本机缓存，实时状态待核实${state.zcode.serviceConfigured ? state.zcode.accountSource==='configured-custom'?' · 聊天使用已有自定义模型（原 API 计费）':' · 聊天使用官方套餐' : ''}${chat?.source === 'zcode' && (chat.error || chat.modelsError) ? ' · ' + (chat.error || chat.modelsError) : ''}` : '尚未读取账户信息';
    const wb = state.workbuddy;
    el('workbuddy-status').textContent = wb.status === 'connected' ? '汇总已读取' : wb.busy ? '查询中' : wb.loginVisible ? '等待官网登录' : '需要登录';
    el('workbuddy-detail').textContent = wb.summary ? `网站积分剩余 ${wb.summary.credits.remaining} · 未提供基础／奖励／购买分类` : '官网积分查询可选授权，不影响已连接的聊天。';
    el('workbuddy-quota-login').hidden=Boolean(wb.summary);
    const desktop=state.workbuddyDesktop;
    if(desktop){
      el('workbuddy-desktop-state').textContent=(desktop.error||(desktop.probe?'发现 '+desktop.probe.recordCount+' 条设备缓存、'+desktop.probe.partitionCount+' 个匿名账户分区':'尚未读取缓存统计'))+' · 账号归属未核实，实时运行状态未知';
      const partitionSignature=JSON.stringify(desktop.partitions);
      if(partitionSignature!==cachedPartitions){cachedPartitions=partitionSignature;const select=el('workbuddy-desktop-partition'),previous=select.value,empty=document.createElement('option');empty.value='';empty.textContent='请选择缓存账户范围';
      select.replaceChildren(empty,...desktop.partitions.map((p,index)=>{const option=document.createElement('option');option.value=p.partitionId;option.textContent='设备缓存账户 '+(index+1)+'（'+p.count+' 条历史记录）';return option;}));if(desktop.partitions.some(p=>p.partitionId===previous))select.value=previous;}
      const labels={'last-completed':'上次已完成','last-interrupted':'上次已中断','last-failed':'上次失败',unknown:'实时状态未知'};
      const itemSignature=JSON.stringify(desktop.report?.items||[]);if(itemSignature!==cachedDesktopItems){cachedDesktopItems=itemSignature;el('workbuddy-desktop-items').replaceChildren(...(desktop.report?.items||[]).map(item=>{const li=document.createElement('li');li.textContent=item.title+' · '+(labels[item.state]||'状态未知')+(item.unread?' · 缓存未读':'');return li;}));}
    }
    const cli=state.workbuddyCli;
    if(cli){
      el('workbuddy-cli-state').textContent=(cli.connected?'球球专用聊天已连接':cli.gatewayReachable?'正在核对聊天连接':cli.configured?'聊天尚未连接':'聊天尚未就绪，请点击启用授权')+' · 不包含原 WorkBuddy 桌面任务'+(cli.error?' · '+cli.error:'')+(cli.sendOutcome==='complete'?' · 本次回复已完成':'');
      const live=cli.liveTask;
      const liveLabels={completed:'本次回复已完成',interrupted:'本次回复已中断',refused:'本次请求被拒绝',failed:'本次请求失败',unknown:'本次回复状态未知，未确认结束'};
      const activeLabels={starting:'本次回复正在开始',running:'本次回复正在进行',cancelling:'已请求停止，等待确认'};
      el('workbuddy-cli-live-task').textContent=live?(live.state==='active'?(activeLabels[live.phase]||'本次回复正在进行'):liveLabels[live.state]||'本次回复状态未知')+' · 仅球球专用会话，非原桌面任务':'尚无本次回复状态';
      el('workbuddy-cli-tasks').replaceChildren(...[...cli.tasks.map(t=>(t.name||'专用会话任务')+' · 历史记录：'+t.state),...cli.sessions.map(t=>(t.name||'专用会话')+' · 历史记录：'+(t.state||'未知'))].map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
      el('workbuddy-cli-messages').replaceChildren(...cli.messages.map(m=>{const p=document.createElement('p');p.textContent=(m.role==='user'?'你：':'WorkBuddy：')+m.text;return p;}));
      el('workbuddy-cli-review').hidden=cli.sendOutcome!=='unknown';
    }
    const desktopEvents=state.workbuddyDesktopEvents;if(desktopEvents){
      const phases={'submitted':'已提交输入','session-opened':'会话已打开','stop-observed':'观察到停止候选，最终状态待确认','final-stop-observed':'观察到最终停止，原因或轮次待确认','failure-observed':'观察到失败事件','session-ended':'会话结束事件'};
      const terminals={completed:'主回复已完成（不代表后台任务全部结束）',interrupted:'主回复已中断',failed:'主回复失败'};
      const describe=row=>row.terminalConfirmed&&row.terminalKind==='main-reply'?(row.realtime===false?'上次':'')+(terminals[row.state]||'主回复终态待确认'):row.state==='unknown'?(row.realtime===false?'状态已过期，待新事件':'本轮终态尚未确认'):phases[row.phase]||'观察到事件';
      el('workbuddy-desktop-events-state').textContent=desktopEvents.error||(desktopEvents.enabled?desktopEvents.observations?.length?desktopEvents.observations.map(describe).join('；'):'接收已开启，等待本人启用插件后的元数据事件。':'尚未启用，不接收原桌面事件。');
    }
    const o=state.workbuddyOfficial;
    if(o){
      const label=o.connected?'开放平台已授权':o.pending?'等待本人授权':o.configured?'正在核对开放平台连接':'企业能力尚未开放，当前无法连接原桌面实时任务';
      el('workbuddy-enterprise-chat').hidden=!o.connected;
      el('workbuddy-official-state').textContent=label+(o.assistantOnline===true?' · 本机助理在线':o.assistantOnline===false?' · 本机助理离线':'')+(o.error?' · '+o.error:'');
      const names={CREATING:'正在创建',idle:'空闲',planning:'正在规划',working:'进行中',pending:'等待处理',completed:'已完成',failed:'失败',archived:'已归档',deleted:'已删除'};
      el('workbuddy-official-tasks').replaceChildren(...o.tasks.map(t=>{const item=document.createElement('li');item.textContent=(t.name||'未命名任务')+' · '+(names[t.status]||'未知状态');return item;}));
      el('workbuddy-send-state').textContent=o.sendOutcome==='unknown'?'发送结果未知，已锁定重发；请去原 WorkBuddy 核对。':o.sendOutcome==='accepted'?'消息已接收，回复和完成状态尚未确认。':o.tasks.length?'已加载 '+o.tasks.length+' 项云端任务'+(o.tasksPartial?'（部分范围）':''):'';
      el('workbuddy-review-unknown').hidden=o.sendOutcome!=='unknown';
      el('workbuddy-official-messages').replaceChildren(...o.messages.map(m=>{const item=document.createElement('p');item.textContent=(m.role==='assistant'?'WorkBuddy：':'共享助理消息：')+m.text+(m.requiresOriginalClient?'\n如有审批或非文本内容，请到原 WorkBuddy 处理。':'');return item;}));
    }
    for(const provider of ['codex','zcode','workbuddy']){
      const onboarding=state.onboarding?.[provider];
      const button=document.querySelector('button[data-action="enable-provider"][data-provider="'+provider+'"]');
      if(button)button.textContent=onboarding?.status==='working'?'正在连接…':onboarding?.status==='ready'?'重新连接':['partial','cancelled','error'].includes(onboarding?.status)?'继续连接':'启用授权';
      if(onboarding){
        const statusLabels={idle:'未连接',working:'正在连接',partial:'聊天未就绪',ready:'聊天已连接',cancelled:'连接未完成',error:'连接未完成'};
        el(provider+'-status').textContent=statusLabels[onboarding.status]||'未连接';
        const messages=[onboarding.message,onboarding.chat?.message].filter(Boolean);
        if(messages.length)el(provider+'-detail').textContent+=' · '+[...new Set(messages)].join(' · ');
        const dataButton=document.querySelector('button[data-action="enable-provider-data"][data-provider="'+provider+'"]');
        if(dataButton)dataButton.textContent=onboarding.chat?.status==='needs-data-authorization'?'读取已有模型配置':onboarding.data?.status==='working'?'正在连接原工具数据…':onboarding.data?.status==='ready'?'刷新原工具任务与额度':'连接原工具任务与额度（可选）';
        el(provider+'-data-state').textContent=onboarding.data?.message||'原工具任务与额度尚未授权，不影响聊天。';
      }
    }
    availability();paintCards(state);
  }
  async function refresh() { try { const r = await api.command('status'); if (r.ok) paint(r.state); } catch (_) {} }
  document.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]'); if (!button || busy && button.dataset.action!=='cancel-workbuddy-cli') return;
    let action=button.dataset.action,guideStep=null;
    if(action==='enable-provider'){openGuide(button.dataset.provider);return;}
    if(action==='guide-close'){el('connection-guide').hidden=true;guideProvider=null;return;}
    if(action==='guide-skip'){const next=nextGuideStep(currentGuide());if(next){const skipped=skippedSteps.get(guideProvider)||new Set();skipped.add(next.id);skippedSteps.set(guideProvider,skipped);}paintGuide();return;}
    if(action==='guide-chat'){action='open-provider-chat';}
    if(action==='guide-next'||action==='guide-run'){const guide=currentGuide();guideStep=action==='guide-next'?nextGuideStep(guide):guide?.steps.find(step=>step.id===button.dataset.step);if(!guideStep){el('connection-guide').hidden=true;guideProvider=null;return;}action=guideStep.action;}
    const provider=guideStep?.payload?.provider||(['guide-chat'].includes(button.dataset.action)?guideProvider:button.dataset.provider);
    busyCount++;busy = true; document.querySelectorAll('button').forEach(b => b.disabled = true); el('message').textContent = '正在处理…';
    try { const payload=guideStep?{...guideStep.payload,...(action==='enable-provider'?{provider:guideProvider,...(guideProvider==='zcode'?{accountSource:el('zcode-account-source').value}:{})}:{})}:provider?{provider}:action==='read-workbuddy-desktop'?{partitionId:el('workbuddy-desktop-partition').value}:action==='send-workbuddy-assistant'?{content:el('workbuddy-assistant-text').value}:action==='send-workbuddy-cli'?{content:el('workbuddy-cli-text').value}:undefined; const r = await api.command(action,payload); if(r.ok&&action==='enable-provider'&&guideProvider==='zcode')zcodeSourceDraft=null; if (r.state) paint(r.state); el('message').textContent = r.message || (r.ok ? '已更新' : '本次未完成，请检查连接状态。'); }
    catch (_) { el('message').textContent = '本次操作未完成，请重试。'; }
    finally { busyCount--;busy=busyCount>0; document.querySelectorAll('button').forEach(b => b.disabled = busy); await refresh(); availability();if(lastState)paintCards(lastState); }
  });
  api.onFocusProvider?.(provider=>{
    if(!['codex','zcode','workbuddy'].includes(provider))return;
    const button=document.querySelector('button[data-action="enable-provider"][data-provider="'+provider+'"]');
    button?.closest('section')?.scrollIntoView({block:'start'});
    button?.focus({preventScroll:true});
  });
  el('zcode-account-source').addEventListener('change',()=>{zcodeSourceDraft=el('zcode-account-source').value;skippedSteps.delete('zcode');paintGuide();});
  el('workbuddy-desktop-partition').addEventListener('change',availability); el('workbuddy-cli-text').addEventListener('input',availability); el('workbuddy-assistant-text').addEventListener('input',availability); api.onChange(refresh); refresh();
})();
