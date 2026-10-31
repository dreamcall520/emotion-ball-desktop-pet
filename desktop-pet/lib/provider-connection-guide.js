(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ProviderConnectionGuide=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const NAMES={codex:'Codex',zcode:'ZCode',workbuddy:'WorkBuddy'};
  const part=(status,text,updatedAt)=>({status,text,...(Number.isFinite(updatedAt)&&updatedAt>=0?{updatedAt}: {})});
  const rows=value=>Array.isArray(value)?value:[];
  const pct=value=>Number.isFinite(value)&&value>=0&&value<=100?Math.round(value*100)/100+'%':'未知';
  function check(provider){if(!Object.hasOwn(NAMES,provider))throw new TypeError('Unknown AI provider');}
  function chatPart(state,provider){
    const onboarding=state.onboarding?.[provider],chat=onboarding?.chat;
    const actual=state.providerChats?.[provider];
    const selected=actual||(state.chat?.source===provider?state.chat:null);
    if(selected?.accountMismatch||selected?.errorCode==='ACCOUNT_CHANGED')return part('unknown','账号已变化，请确认后开始新聊天');
    if(actual?.connection==='ready'&&(actual.modelsStatus==='ready'||provider==='workbuddy'&&actual.modelsStatus==='provider-managed')&&chat?.status!=='unavailable')return part('ready',provider==='zcode'?(state.zcode?.accountSource==='configured-custom'?'使用已有自定义模型 · 原 API 计费':'使用官方套餐聊天'):'聊天已连接 · 使用球球专用会话');
    if(actual&&chat?.status!=='unavailable'){if(actual.connection!=='ready')return part(actual.connection==='connecting'?'working':'unknown','聊天连接待恢复');return part(actual.modelsStatus==='loading'?'working':'needs-authorization',actual.modelsStatus==='loading'?'正在读取聊天模型':'请选择聊天模型');}
    if(['needs-new-chat'].includes(chat?.status))return part('unknown','账号或聊天范围已变化，请开始新聊天');
    if(chat?.status==='needs-model')return part('needs-authorization','请选择聊天模型');
    if(chat?.status==='ready')return part('ready',provider==='zcode'?(state.zcode?.accountSource==='configured-custom'?'使用已有自定义模型 · 原 API 计费':'使用官方套餐聊天'):'聊天已连接 · 使用球球专用会话');
    if(onboarding?.status==='working')return part('working','正在连接聊天');
    if(chat?.status==='needs-data-authorization')return part('needs-authorization','需要允许读取已有模型配置');
    // A configured endpoint is not evidence of a successful account connection.
    if(chat?.status!=='unavailable'&&selected?.connection==='ready'&&selected.modelsStatus==='ready')return part('ready','聊天已连接');
    if(!actual&&chat?.status!=='unavailable'&&provider==='workbuddy'&&state.workbuddyCli?.connected===true&&state.workbuddyCli?.sendOutcome!=='unknown')return part('ready','聊天已连接 · 使用球球专用会话');
    if(provider==='zcode'&&state.zcode?.accountSource==='official'&&state.zcodeSnapshot?.quota?.balanceState==='empty')return part('unavailable','官方套餐为空，官方账号聊天尚未验证');
    if(chat?.status==='unavailable'&&onboarding?.status==='partial')return part('unavailable','聊天暂未就绪，可继续连接');
    return part('needs-authorization',onboarding?.status==='cancelled'?'连接已取消，可继续完成':'尚未连接聊天');
  }
  function quotaPart(state,provider){
    if(provider==='workbuddy'){
      const wb=state.workbuddy||{},summary=wb.summary;
      if(Number.isFinite(summary?.credits?.remaining))return part(wb.stale===true||wb.status!=='connected'?'unknown':'ready',(wb.stale===true||wb.status!=='connected'?'上次':'')+'网站积分剩余 '+summary.credits.remaining+' · 仅网站汇总',summary.updatedAt);
      return part(wb.busy?'working':'needs-authorization',wb.loginVisible?'等待本人完成官网积分登录':'尚未授权官网积分');
    }
    if(state[provider]?.directory!=='stored')return part('needs-authorization','允许读取工具信息后查看额度');
    const q=state[provider+'Snapshot']?.quota;
    if(!q)return part('unknown','额度尚未读取');
    const windows=rows(q.windows).filter(w=>Number.isFinite(w?.remaining)&&w.remaining>=0&&w.remaining<=100);
    if(windows.length){
      const stale=q.stale===true||q.state!=='connected';
      return part(stale?'unknown':'ready',(stale?'上次读取：':'')+windows.map(w=>(w.windowMinutes===10080?'周额度':w.windowMinutes===300?'5小时额度':provider==='zcode'?'套餐额度':'额度')+'剩余 '+pct(w.remaining)).join('；'),q.updatedAt);
    }
    if(q.balanceState==='empty'||q.state==='empty')return part('unavailable','当前没有可用套餐额度',q.updatedAt);
    if(q.state==='unsupported')return part('unavailable','当前来源未提供可读取额度',q.updatedAt);
    return part(q.state==='connecting'?'working':'unknown',q.state==='connecting'?'正在查询额度':'额度暂未读取成功',q.updatedAt);
  }
  function taskPart(state,provider){
    if(provider==='workbuddy'){
      const events=state.workbuddyDesktopEvents||{},observations=rows(events.observations),latest=observations.at(-1);
      const own=state.workbuddyCli?.liveTask;
      if(latest&&events.enabled){
        if(latest.realtime===false||latest.state==='unknown')return part('unknown',latest.terminalConfirmed?'上次主回复已结束，等待新事件 · 后台整体状态未确认':'原工具事件已过期，等待新事件',latest.observedAt);
        if(latest.terminalConfirmed&&latest.terminalKind==='main-reply')return part('ready',({completed:'原工具主回复已完成',interrupted:'原工具主回复已中断',failed:'原工具主回复失败'}[latest.state]||'原工具主回复已结束')+' · 后台任务整体状态未确认',latest.observedAt);
        return part('ready',({submitted:'原工具已提交输入', 'session-opened':'原工具会话已打开','stop-observed':'原工具停止候选，结束尚未确认','failure-observed':'原工具观察到失败事件','session-ended':'原工具会话结束事件'}[latest.phase]||'已收到原工具事件')+' · 整体状态未确认',latest.observedAt);
      }
      if(own){const labels={active:'球球专用回复进行中',completed:'球球专用回复已完成',interrupted:'球球专用回复已中断',failed:'球球专用回复失败',refused:'球球专用请求被拒绝',unknown:'球球专用回复状态未知'};return part(own.realtime===false||own.state==='unknown'?'unknown':'ready',(labels[own.state]||'球球专用回复状态未知')+' · 原桌面任务尚未同步',own.updatedAt);}
      return part(events.enabled?'unknown':'needs-authorization',events.enabled?'等待原工具插件事件':'开启任务同步后查看原工具事件');
    }
    if(provider==='zcode'){
      const events=state.zcodeDesktopEvents||{},latest=rows(events.observations).at(-1);
      if(events.enabled&&latest)return part(latest.realtime===false?'unknown':'ready',latest.realtime===false?'上次ZCode事件已过期，等待新事件':({submitted:'原工具已提交输入','session-opened':'原工具会话已打开','stop-observed':'原工具观察到停止，最终完成未确认'}[latest.phase]||'已收到原工具事件')+' · 不确认最终完成',latest.observedAt);
      if(events.enabled)return part('unknown','等待ZCode新任务事件 · 最终完成未确认');
    }
    if(state[provider]?.directory!=='stored')return part('needs-authorization','允许读取工具信息后查看任务');
    const tasks=state[provider+'Snapshot']?.tasks;
    if(!tasks)return part('unknown','任务尚未读取');
    const items=rows(tasks.items);
    if(provider==='zcode')return part('unknown','已读取本机任务缓存 · 原工具实时状态待核实',tasks.updatedAt);
    if(tasks.state==='connected')return part(tasks.stale===true?'unknown':'ready',(tasks.stale===true?'上次读取：':'')+'本机日志任务 '+items.length+' 项 · 仅覆盖部分日志',tasks.updatedAt);
    return part('unknown',items.length?'上次日志任务 '+items.length+' 项 · 实时状态待核实':'任务暂未读取成功',tasks.updatedAt);
  }
  function buildToolCard(input,provider){
    check(provider);const state=input||{},quota=quotaPart(state,provider),tasks=taskPart(state,provider),chat=chatPart(state,provider),parts=[quota,tasks,chat];
    const ready=parts.filter(p=>p.status==='ready').length;
    const events=state[provider+'DesktopEvents'];const taskConnectionReady=tasks.status==='ready'||Boolean(events?.enabled&&(events.pluginInstallationVerified===true||rows(events.observations).length));const allConnected=quota.status==='ready'&&chat.status==='ready'&&taskConnectionReady;
    const status=parts.some(p=>p.status==='working')?'working':allConnected?'ready':ready?'partial':parts.every(p=>p.status==='needs-authorization')?'needs-authorization':'unknown';
    const timestamps=parts.map(p=>p.updatedAt).filter(Number.isFinite);
    return{provider,status,statusLabel:({ready:'已连接',partial:'部分已连接',working:'正在连接','needs-authorization':'未连接',unknown:'待确认'})[status],quota,tasks,chat,...(timestamps.length?{updatedAt:Math.max(...timestamps)}:{}),needsAttention:status!=='ready'};
  }
  function buildProviderGuide(input,provider){
    check(provider);const state=input||{},card=buildToolCard(state,provider),directory=provider==='workbuddy'?state.workbuddyDesktop?.directory:state[provider]?.directory;
    const chatStatus=card.chat.status;
    const chat={id:'chat',title:'连接聊天账号',status:chatStatus,description:chatStatus!=='ready'&&state.onboarding?.[provider]?.chat?.message||card.chat.text,action:['needs-model','needs-new-chat'].includes(state.onboarding?.[provider]?.chat?.status)?'open-provider-chat':'enable-provider',payload:{provider},actionLabel:chatStatus==='ready'?'聊天已连接':state.onboarding?.[provider]?.chat?.status==='needs-model'?'选择模型':state.onboarding?.[provider]?.chat?.status==='needs-new-chat'?'开始新聊天':'连接聊天'};
    const dataStatus=directory==='stored'?'ready':state.onboarding?.[provider]?.data?.status==='working'?'working':'needs-authorization';
    const data={id:'data',title:provider==='zcode'&&state.zcode?.accountSource==='configured-custom'?'允许读取模型、额度和任务':'允许读取工具信息',status:dataStatus,description:dataStatus==='ready'?'已记住目录授权，无需重新选择':'系统将打开对应工具目录，请点“打开”；取消后可继续完成',action:'enable-provider-data',payload:{provider},actionLabel:'允许读取'};
    const steps=provider==='zcode'&&state.zcode?.accountSource==='configured-custom'&&dataStatus!=='ready'?[data,chat]:[chat,data];
    if(provider==='workbuddy'){
      const events=state.workbuddyDesktopEvents||{},received=rows(events.observations).length>0,installed=received||events.pluginInstallationVerified===true;
      steps.push({id:'quota',title:'连接官网积分',status:card.quota.status,description:card.quota.text,action:state.workbuddy?.summary&&state.workbuddy?.status!=='needs-login'?'refresh-workbuddy':'workbuddy-login',actionLabel:state.workbuddy?.summary&&state.workbuddy?.status!=='needs-login'?'刷新积分':'登录查看积分'});
      steps.push({id:'tasks',title:'开启原工具任务同步',status:events.enabled&&installed?'ready':events.enabled?'unknown':'needs-authorization',description:events.enabled&&installed?'已确认插件安装；当前任务状态以新事件为准，主回复结束与后台任务整体结束分别显示':events.enabled?'接收已准备，请在原工具安装或更新球球插件连接；未收到事件前不确认同步成功':'确认后准备本机元数据插件，仅同步事件，不传聊天正文',action:events.enabled?'show-workbuddy-plugin':'prepare-workbuddy-desktop-events',actionLabel:events.enabled?'查看插件安装文件':'准备任务同步'});
    }else{
      steps.push({id:'capabilities',title:'检查额度和任务',status:card.quota.status==='ready'&&card.tasks.status==='ready'?'ready':card.quota.status==='unavailable'?'unavailable':'unknown',description:card.quota.text+'；'+card.tasks.text,...(directory==='stored'&&card.quota.status!=='unavailable'?{action:'enable-provider-data',payload:{provider},actionLabel:'重新检查'}:{})});
    }
    if(provider==='zcode'){
      const events=state.zcodeDesktopEvents||{},installed=rows(events.observations).length>0||events.pluginInstallationVerified===true;
      steps.push({id:'tasks',title:'开启原工具任务同步',status:events.enabled&&installed?'ready':events.enabled?'unknown':'needs-authorization',description:events.enabled&&installed?'已确认插件安装，等待新事件；ZCode停止事件不能证明最终完成':events.enabled?'接收已准备，请在ZCode确认安装或更新球球插件连接；尚未收到事件':'仅同步会话与任务阶段，不传正文；停止不作为最终完成',action:events.enabled?'show-zcode-plugin':'prepare-zcode-desktop-events',actionLabel:events.enabled?'查看插件安装文件':'准备任务同步'});
    }
    const complete=steps.every(s=>s.status==='ready');
    // Do not keep relaunching a permission already granted or loop on a vendor
    // capability limitation. Retry remains available on the individual step.
    const next=steps.find(s=>s.status==='needs-authorization'&&s.action)||steps.find(s=>s.status!=='ready'&&s.status!=='working'&&s.action&&s.id!=='capabilities');
    return{provider,title:'连接 '+NAMES[provider],steps,complete,partial:!complete&&steps.some(s=>s.status==='ready'),nextStepId:next?.id||null};
  }
  return{buildProviderGuide,buildToolCard};
});
