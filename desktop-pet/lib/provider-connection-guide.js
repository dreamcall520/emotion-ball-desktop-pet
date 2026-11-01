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
    const loginPending=typeof state.providerLoginPending?.[provider]==='boolean'?state.providerLoginPending[provider]:chat?.loginPending===true;
    if(chat?.status==='needs-login'&&loginPending)return part('working',chat.message||'等待本人完成官方登录');
    if(provider==='zcode'&&state.zcode?.accountSource==='official'&&state.zcodeSnapshot?.quota?.balanceState==='empty')return part('unavailable','官方套餐为空，官方账号聊天尚未验证');
    if(chat?.status==='needs-login')return part('needs-authorization',chat.message||'尚未连接聊天');
    if(actual&&chat?.status!=='unavailable'){if(actual.connection!=='ready')return part(actual.connection==='connecting'?'working':'unknown','聊天连接待恢复');return part(actual.modelsStatus==='loading'?'working':'needs-authorization',actual.modelsStatus==='loading'?'正在读取聊天模型':'请选择聊天模型');}
    if(['needs-new-chat'].includes(chat?.status))return part('unknown','账号或聊天范围已变化，请开始新聊天');
    if(chat?.status==='needs-model')return part('needs-authorization','请选择聊天模型');
    if(chat?.status==='ready')return part('ready',provider==='zcode'?(state.zcode?.accountSource==='configured-custom'?'使用已有自定义模型 · 原 API 计费':'使用官方套餐聊天'):'聊天已连接 · 使用球球专用会话');
    if(onboarding?.status==='working')return part('working','正在连接聊天');
    if(chat?.status==='needs-data-authorization')return part('needs-authorization','需要允许读取已有模型配置');
    // A configured endpoint is not evidence of a successful account connection.
    if(chat?.status!=='unavailable'&&selected?.connection==='ready'&&selected.modelsStatus==='ready')return part('ready','聊天已连接');
    if(!actual&&chat?.status!=='unavailable'&&provider==='workbuddy'&&state.workbuddyCli?.connected===true&&state.workbuddyCli?.sendOutcome!=='unknown')return part('ready','聊天已连接 · 使用球球专用会话');
    if(chat?.status==='unavailable'&&onboarding?.status==='partial')return part('unavailable','聊天暂未就绪，可继续连接');
    return part('needs-authorization',onboarding?.status==='cancelled'?'连接已取消，可继续完成':'尚未连接聊天');
  }
  function quotaPart(state,provider){
    if(provider==='codex'&&state.managedCodexQuota){
      const managed=state.managedCodexQuota,snapshot=managed.snapshot;
      const windows=rows(snapshot?.windows).filter(w=>Number.isFinite(w.usedPercent)&&w.usedPercent>=0&&w.usedPercent<=100);
      if(windows.length&&managed.status==='ready')return part('ready','球球聊天账号 · '+windows.map(w=>(w.windowMinutes===10080?'周额度':w.windowMinutes===300?'5小时额度':'额度')+'剩余 '+pct(100-w.usedPercent)).join('；'),snapshot.updatedAt);
      return part(managed.status==='needs-login'?'needs-authorization':'unknown',managed.status==='needs-login'?'连接球球聊天账号后查看同账号额度，无需原工具目录授权':'球球聊天账号额度暂未读取成功；不会改用原工具账号额度');
    }
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
  function pluginState(state,provider){
    const events=state[provider+'DesktopEvents']||{},installation=state.pluginInstallations?.[provider]||{};
    const eventVerified=events.enabled===true&&(events.pluginInstallationVerified===true||rows(events.observations).length>0);
    const installed=events.enabled===true&&installation.status==='installed'&&installation.enabled===true;
    return{events,installation,eventVerified,installed};
  }
  function pluginSteps(state,provider){
    const {events,installation,eventVerified,installed}=pluginState(state,provider);
    if(state.pluginInstallationPolicy?.allowed===false&&state.pluginInstallationPolicy?.pairingAllowed!==true&&!eventVerified)return[{id:'tasks',title:'原工具任务插件',status:'blocked',description:state.pluginInstallationPolicy.message||'自动安装尚未完成商店验证。请使用原工具官方安装入口。'}];
    const pairingOnly=state.pluginInstallationPolicy?.allowed===false&&state.pluginInstallationPolicy?.pairingAllowed===true;
    const working=['checking','installing'].includes(installation.status);
    const status=working?'working':['blocked','error'].includes(installation.status)?installation.status:eventVerified||installed?'ready':'needs-authorization';
    const supplied=typeof installation.message==='string'?installation.message.slice(0,500):'';
    const description=working?(supplied||(installation.status==='checking'?'正在检查已有插件，不重复安装':'正在安装并启用球球任务插件，请稍候')):['blocked','error'].includes(installation.status)?supplied||'安装尚未完成，已可用聊天保持':eventVerified?'已确认插件安装及事件接入；正常重启无需重复安装':installed?'插件已安装启用，下一次在原工具正常使用时自动确认事件，无需反复安装':working?(installation.status==='checking'?'正在检查已有插件，不重复安装':'正在安装并启用球球任务插件，请稍候'):supplied||'球球将申请对应工具目录的写入许可，仅写入球球插件和必要插件设置；确认后自动安装，无需在原软件找入口';
    return[{id:'tasks',title:pairingOnly?'连接已有任务插件':'安装并启用任务插件',status,description:pairingOnly&&!working&&!eventVerified&&!installed?'仅更新已安装球球插件的本机连接信息，不改插件代码或原工具设置；已有目录授权可复用。':description,...(status==='ready'?{}:{action:'install-provider-plugin',payload:{provider},actionLabel:working?'正在处理…':installation.status==='installed'&&!events.enabled?'恢复任务同步':pairingOnly?'连接已有插件':'安装并启用'})},
      {id:'task-verification',title:'确认原工具事件接入',status:eventVerified?'ready':'unknown',description:eventVerified?'已收到原工具真实事件；当前任务阶段以工具卡的新事件为准':installed?'安装已完成。下一次在原工具正常使用时，球球会自动确认连接；现在无需额外测试或重复安装':'安装完成后，等待原工具正常使用产生事件；不会自动发送模型消息'}];
  }
  function taskPart(state,provider){
    if(['zcode','workbuddy'].includes(provider)){
      const {events,installation,eventVerified,installed}=pluginState(state,provider);
      if(!eventVerified&&!rows(events.observations).length){
        if(['checking','installing'].includes(installation.status))return part('working',installation.phase==='waiting-host'&&typeof installation.message==='string'?installation.message:installation.status==='checking'?'正在检查任务插件':'正在安装任务插件');
        if(installed)return part('unknown','任务插件已安装启用，等待原工具正常使用产生新事件');
        if(['blocked','error'].includes(installation.status))return part('unknown',typeof installation.message==='string'?installation.message.slice(0,500):'任务插件尚未安装完成，可继续处理；聊天不受影响');
      }
    }
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
    const status=parts.some(p=>p.status==='working')?'working':ready?'ready':parts.every(p=>p.status==='needs-authorization')?'needs-authorization':'unknown';
    const selected=state.providerChats?.[provider]||(state.chat?.source===provider?state.chat:null),installation=state.pluginInstallations?.[provider];
    const needsAttention=Boolean(selected?.accountMismatch||selected?.errorCode==='ACCOUNT_CHANGED'||state.onboarding?.[provider]?.chat?.status==='needs-new-chat'||state.onboarding?.[provider]?.status==='error'||installation?.status==='error');
    const timestamps=parts.map(p=>p.updatedAt).filter(Number.isFinite);
    return{provider,status,statusLabel:status==='ready'?(allConnected?'已连接':'已可用'):({working:'正在连接','needs-authorization':'未连接',unknown:'暂未可用'})[status],quota,tasks,chat,...(timestamps.length?{updatedAt:Math.max(...timestamps)}:{}),needsAttention,allConnected,usable:ready>0};
  }
  function buildProviderGuide(input,provider,options={}){
    const capability=options.capability===undefined?'all':options.capability,explicitCapability=options.capability!==undefined;
    if(!['chat','data','all'].includes(capability))throw new TypeError('Unknown capability');
    check(provider);const state=input||{},card=buildToolCard(state,provider),directory=provider==='workbuddy'?state.workbuddyDesktop?.directory:state[provider]?.directory;
    const chatStatus=card.chat.status;
    const chat={id:'chat',title:'连接聊天账号',status:chatStatus,description:chatStatus!=='ready'&&state.onboarding?.[provider]?.chat?.message||card.chat.text,action:['needs-model','needs-new-chat'].includes(state.onboarding?.[provider]?.chat?.status)?'open-provider-chat':'enable-provider',payload:{provider},actionLabel:chatStatus==='ready'?'聊天已连接':state.onboarding?.[provider]?.chat?.status==='needs-model'?'选择模型':state.onboarding?.[provider]?.chat?.status==='needs-new-chat'?'开始新聊天':'连接聊天'};
    const originalData=state.onboarding?.[provider]?.data;
    const modelDependency=capability==='chat'&&provider==='zcode'&&state.zcode?.accountSource==='configured-custom';
    const dataStatus=modelDependency?(directory==='stored'?'ready':'needs-authorization'):originalData?.status==='working'?'working':directory!=='stored'?'needs-authorization':originalData?(['ready','unavailable'].includes(originalData.status)?'ready':'needs-authorization'):directory==='stored'?'ready':'needs-authorization';
    const data={id:'data',title:provider==='zcode'&&state.zcode?.accountSource==='configured-custom'?'允许读取模型、额度和任务':'允许读取工具信息',status:dataStatus,description:dataStatus==='ready'?'已记住目录授权，无需重新选择':'系统将打开对应工具目录，请点“打开”；取消后可继续完成',action:'enable-provider-data',payload:{provider},actionLabel:'允许读取'};
    let steps=provider==='zcode'&&state.zcode?.accountSource==='configured-custom'&&dataStatus!=='ready'?[data,chat]:[chat,data];
    if(provider==='workbuddy'){
      steps.push({id:'quota',title:'连接官网积分',status:card.quota.status,description:card.quota.text,optional:true,action:state.workbuddy?.summary&&state.workbuddy?.status!=='needs-login'?'refresh-workbuddy':'workbuddy-login',actionLabel:state.workbuddy?.summary&&state.workbuddy?.status!=='needs-login'?'刷新积分':'登录查看积分'});

    }else{
      steps.push({id:'capabilities',title:'检查额度和任务',status:card.quota.status==='ready'&&card.tasks.status==='ready'?'ready':card.quota.status==='unavailable'?'unavailable':'unknown',description:card.quota.text+'；'+card.tasks.text,...(directory==='stored'&&card.quota.status!=='unavailable'?{action:'enable-provider-data',payload:{provider},actionLabel:'重新检查'}:{})});
    }
    if(['zcode','workbuddy'].includes(provider))steps.push(...pluginSteps(state,provider));
    if(capability==='chat'){
      steps=steps.filter(step=>step.id==='chat'||modelDependency&&step.id==='data');
      if(modelDependency){const dependency=steps.find(step=>step.id==='data');dependency.title='允许读取聊天模型配置';dependency.description=dataStatus==='ready'?'已记住模型配置所在目录，无需重新选择。':'聊天需要访问已有模型配置所在的 ZCode 目录；本次不启用额度/任务或安装插件。';dependency.actionLabel='允许读取模型配置';}
    }else if(capability==='data')steps=steps.filter(step=>step.id!=='chat');
    for(const step of steps)if(step.action&&explicitCapability)step.payload={...step.payload,provider,capability};
    // Already granted steps are observations, never another authorization prompt.
    // A vendor limitation and first-event wait are outcomes, not unfinished setup.
    for(const step of steps){
      if(step.id==='capabilities'||step.id==='task-verification')step.informational=true;
      const chatState=state.providerChats?.[provider]||(state.chat?.source===provider?state.chat:null);
      if(step.id==='chat'&&card.chat.status==='unknown'&&(chatState?.accountMismatch||chatState?.errorCode==='ACCOUNT_CHANGED'||state.onboarding?.[provider]?.chat?.status==='needs-new-chat')){
        step.status='needs-authorization';step.action='open-provider-chat';step.actionLabel='开始新聊天';
      }
      if(step.status==='ready'||step.status==='unavailable'||step.status==='blocked'&&!step.action){delete step.action;delete step.payload;}
    }
    const required=steps.filter(step=>!step.optional&&!step.informational);
    const next=required.find(step=>step.status==='needs-authorization'&&step.action);
    const complete=!required.some(step=>['needs-authorization','working','error'].includes(step.status));
    return{provider,capability,title:'连接 '+NAMES[provider],steps,complete,usable:card.usable,needsAttention:card.needsAttention,partial:!complete&&steps.some(s=>s.status==='ready'),nextStepId:next?.id||null};
  }
  return{buildProviderGuide,buildToolCard};
});
