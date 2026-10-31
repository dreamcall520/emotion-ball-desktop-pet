(() => {
  const el = id => document.getElementById(id), api = window.storeConnections;
  let busy = false, busyCount=0,lastState=null,cachedPartitions=null,cachedDesktopItems=null;
  function availability(){
    if(busy){const cancel=document.querySelector('button[data-action="cancel-workbuddy-cli"]');if(cancel)cancel.disabled=!lastState?.workbuddyCli?.busy;return;}
    const o=lastState?.workbuddyOfficial;
    if(!o)return;
    const c=lastState.workbuddyCli||{};
    const enabled={
      'read-workbuddy-desktop':Boolean(el('workbuddy-desktop-partition').value),
      'revoke-workbuddy-desktop':lastState.workbuddyDesktop?.directory==='stored',
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
    for(const [action,value]of Object.entries(enabled)){const button=document.querySelector('button[data-action="'+action+'"]');if(button)button.disabled=!value;}
  }
  function paint(state) {
    if (!state) return;lastState=state;
    el('mode').textContent = state.mode === 'mas-sandbox' ? '按系统授权范围连接工具；各项能力以实际连接结果为准。' : '商店接入联调候选 · 使用独立数据；当前运行未启用 macOS App Sandbox。';
    const c = state.codex, q = state.codexSnapshot?.quota, tasks = state.codexSnapshot?.tasks, chat = state.chat;
    el('codex-status').textContent = c.directory !== 'stored' ? '未授权' : chat?.source === 'codex' && chat?.connection === 'ready' && chat?.modelsStatus === 'ready' ? '聊天已连接' : '目录已授权';
    const quota = q?.windows?.length ? q.windows.map(w => `${w.windowMinutes === 10080 ? '周额度' : w.windowMinutes === 300 ? '5小时额度' : '额度'}剩余 ${Number.isFinite(w.remaining) ? w.remaining + '%' : '未知'}`).join('；') : '额度尚未读取';
    const taskDetail = tasks?.state === 'connected' && Array.isArray(tasks.items) ? `本机日志任务 ${tasks.items.length} 项（覆盖部分日志）` : '任务尚未读取或读取失败';
    el('codex-detail').textContent = `${quota} · ${taskDetail} · ${c.serviceConfigured ? '本机服务已配置' : '尚未配置聊天服务'}${chat?.source === 'codex' && (chat.error || chat.modelsError) ? ' · ' + (chat.error || chat.modelsError) : ''}`;
    el('zcode-status').textContent = state.zcode.directory === 'stored' ? '目录已授权' : '未授权';
    const z = state.zcodeSnapshot;
    const zQuota = z?.quota?.state === 'connected' ? z.quota.balanceState === 'empty' ? '已读取，当前无可用套餐额度' : '已读取' : z?.quota?.code || '未读取';
    el('zcode-detail').textContent = z ? `额度：${zQuota} · 任务为本机缓存，实时状态待核实${state.zcode.serviceConfigured ? state.zcode.accountSource==='configured-custom'?' · 聊天使用已有自定义模型（原 API 计费）':' · 聊天使用官方套餐' : ''}${chat?.source === 'zcode' && (chat.error || chat.modelsError) ? ' · ' + (chat.error || chat.modelsError) : ''}` : '尚未读取账户；商店聊天通道待接入';
    const wb = state.workbuddy;
    el('workbuddy-status').textContent = wb.status === 'connected' ? '汇总已读取' : wb.busy ? '查询中' : wb.loginVisible ? '等待官网登录' : '需要登录';
    el('workbuddy-detail').textContent = wb.summary ? `网站积分剩余 ${wb.summary.credits.remaining} · 未提供基础／奖励／购买分类` : wb.errorMessage || '请先在独立官网窗口完成登录，再刷新积分';
    const desktop=state.workbuddyDesktop;
    if(desktop){
      el('workbuddy-desktop-state').textContent=(desktop.error||(desktop.probe?'发现 '+desktop.probe.recordCount+' 条设备缓存、'+desktop.probe.partitionCount+' 个匿名账户分区':'尚未读取缓存统计'))+' · 账号归属未核实，实时运行状态未知';
      const partitionSignature=JSON.stringify(desktop.partitions);
      if(partitionSignature!==cachedPartitions){cachedPartitions=partitionSignature;const select=el('workbuddy-desktop-partition'),previous=select.value,empty=document.createElement('option');empty.value='';empty.textContent='请选择缓存账户范围';
      select.replaceChildren(empty,...desktop.partitions.map((p,index)=>{const option=document.createElement('option');option.value=p.partitionId;option.textContent='设备缓存账户 '+(index+1)+'（'+p.count+' 条历史记录）';return option;}));if(desktop.partitions.some(p=>p.partitionId===previous))select.value=previous;}
      document.querySelector('button[data-action="authorize-workbuddy-desktop"]').textContent=desktop.directory==='stored'?'刷新已授权的缓存统计':'授权桌面任务缓存目录';
      const labels={'last-completed':'上次已完成','last-interrupted':'上次已中断','last-failed':'上次失败',unknown:'实时状态未知'};
      const itemSignature=JSON.stringify(desktop.report?.items||[]);if(itemSignature!==cachedDesktopItems){cachedDesktopItems=itemSignature;el('workbuddy-desktop-items').replaceChildren(...(desktop.report?.items||[]).map(item=>{const li=document.createElement('li');li.textContent=item.title+' · '+(labels[item.state]||'状态未知')+(item.unread?' · 缓存未读':'');return li;}));}
    }
    const cli=state.workbuddyCli;
    if(cli){
      el('workbuddy-cli-state').textContent=(cli.connected?'专用 CLI 会话已连接':cli.gatewayReachable?'CLI 网关已连通，聊天尚未验证':cli.configured?'CLI 连接已导入':'尚未导入 CLI 连接')+' · 不包含原 WorkBuddy 桌面任务'+(cli.error?' · '+cli.error:'')+(cli.sendOutcome==='complete'?' · 本次回复已完成':'');
      el('workbuddy-cli-tasks').replaceChildren(...[...cli.tasks.map(t=>(t.name||'CLI任务')+' · '+t.state),...cli.sessions.map(t=>(t.name||'CLI会话')+' · '+(t.state||'未知'))].map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
      el('workbuddy-cli-messages').replaceChildren(...cli.messages.map(m=>{const p=document.createElement('p');p.textContent=(m.role==='user'?'你：':'CLI：')+m.text;return p;}));
      el('workbuddy-cli-review').hidden=cli.sendOutcome!=='unknown';
    }
    const o=state.workbuddyOfficial;
    if(o){
      const label=o.connected?'开放平台已授权':o.pending?'等待本人授权':o.configured?'服务地址已配置':'尚需获批应用和服务端配置';
      el('workbuddy-official-state').textContent=label+(o.assistantOnline===true?' · 本机助理在线':o.assistantOnline===false?' · 本机助理离线':'')+(o.error?' · '+o.error:'');
      const names={CREATING:'正在创建',idle:'空闲',planning:'正在规划',working:'进行中',pending:'等待处理',completed:'已完成',failed:'失败',archived:'已归档',deleted:'已删除'};
      el('workbuddy-official-tasks').replaceChildren(...o.tasks.map(t=>{const item=document.createElement('li');item.textContent=(t.name||'未命名任务')+' · '+(names[t.status]||'未知状态');return item;}));
      el('workbuddy-send-state').textContent=o.sendOutcome==='unknown'?'发送结果未知，已锁定重发；请去原 WorkBuddy 核对。':o.sendOutcome==='accepted'?'消息已接收，回复和完成状态尚未确认。':o.tasks.length?'已加载 '+o.tasks.length+' 项云端任务'+(o.tasksPartial?'（部分范围）':''):'';
      el('workbuddy-review-unknown').hidden=o.sendOutcome!=='unknown';
      el('workbuddy-official-messages').replaceChildren(...o.messages.map(m=>{const item=document.createElement('p');item.textContent=(m.role==='assistant'?'WorkBuddy：':'共享助理消息：')+m.text+(m.requiresOriginalClient?'\n如有审批或非文本内容，请到原 WorkBuddy 处理。':'');return item;}));
    }
    availability();
  }
  async function refresh() { try { const r = await api.command('status'); if (r.ok) paint(r.state); } catch (_) {} }
  document.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]'); if (!button || busy && button.dataset.action!=='cancel-workbuddy-cli') return;
    busyCount++;busy = true; document.querySelectorAll('button').forEach(b => b.disabled = true); el('message').textContent = '正在处理…';
    try { const payload=button.dataset.action==='read-workbuddy-desktop'?{partitionId:el('workbuddy-desktop-partition').value}:button.dataset.action==='configure-workbuddy-official'?{baseUrl:el('workbuddy-relay-url').value.trim()}:button.dataset.action==='send-workbuddy-assistant'?{content:el('workbuddy-assistant-text').value}:button.dataset.action==='send-workbuddy-cli'?{content:el('workbuddy-cli-text').value}:undefined; const r = await api.command(button.dataset.action,payload); if (r.state) paint(r.state); el('message').textContent = r.message || (r.ok ? '已更新' : '本次未完成，请检查连接状态。'); }
    catch (_) { el('message').textContent = '本次操作未完成，请重试。'; }
    finally { busyCount--;busy=busyCount>0; document.querySelectorAll('button').forEach(b => b.disabled = busy); await refresh(); availability(); }
  });
  el('workbuddy-desktop-partition').addEventListener('change',availability); el('workbuddy-cli-text').addEventListener('input',availability); el('workbuddy-assistant-text').addEventListener('input',availability); api.onChange(refresh); refresh();
})();
