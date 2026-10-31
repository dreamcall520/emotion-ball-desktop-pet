(() => {
  const el = id => document.getElementById(id), api = window.storeConnections;
  let busy = false;
  function paint(state) {
    if (!state) return;
    el('mode').textContent = state.mode === 'mas-sandbox' ? '按系统授权范围连接工具；各项能力以实际连接结果为准。' : '商店接入联调候选 · 使用独立数据；当前运行未启用 macOS App Sandbox。';
    const c = state.codex, q = state.codexSnapshot?.quota, tasks = state.codexSnapshot?.tasks, chat = state.chat;
    el('codex-status').textContent = c.directory !== 'stored' ? '未授权' : chat?.source === 'codex' && chat?.connection === 'ready' && chat?.modelsStatus === 'ready' ? '聊天已连接' : '目录已授权';
    const quota = q?.windows?.length ? q.windows.map(w => `${w.windowMinutes === 10080 ? '周额度' : w.windowMinutes === 300 ? '5小时额度' : '额度'}剩余 ${Number.isFinite(w.remaining) ? w.remaining + '%' : '未知'}`).join('；') : '额度尚未读取';
    const taskDetail = tasks?.state === 'connected' && Array.isArray(tasks.items) ? `本机日志任务 ${tasks.items.length} 项（覆盖部分日志）` : '任务尚未读取或读取失败';
    el('codex-detail').textContent = `${quota} · ${taskDetail} · ${c.serviceConfigured ? '本机服务已配置' : '尚未配置聊天服务'}${chat?.source === 'codex' && (chat.error || chat.modelsError) ? ' · ' + (chat.error || chat.modelsError) : ''}`;
    el('zcode-status').textContent = state.zcode.directory === 'stored' ? '目录已授权' : '未授权';
    const z = state.zcodeSnapshot;
    const zQuota = z?.quota?.state === 'connected' ? z.quota.balanceState === 'empty' ? '已读取，当前无可用套餐额度' : '已读取' : z?.quota?.code || '未读取';
    el('zcode-detail').textContent = z ? `额度：${zQuota} · 任务为本机缓存，实时状态待核实${state.zcode.serviceConfigured ? ' · 实验聊天连接已导入' : ''}${chat?.source === 'zcode' && (chat.error || chat.modelsError) ? ' · ' + (chat.error || chat.modelsError) : ''}` : '尚未读取账户；商店聊天通道待接入';
    const wb = state.workbuddy;
    el('workbuddy-status').textContent = wb.status === 'connected' ? '汇总已读取' : wb.busy ? '查询中' : wb.loginVisible ? '等待官网登录' : '需要登录';
    el('workbuddy-detail').textContent = wb.summary ? `网站积分剩余 ${wb.summary.credits.remaining} · 未提供基础／奖励／购买分类` : wb.errorMessage || '请先在独立官网窗口完成登录，再刷新积分';
  }
  async function refresh() { try { const r = await api.command('status'); if (r.ok) paint(r.state); } catch (_) {} }
  document.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]'); if (!button || busy) return;
    busy = true; document.querySelectorAll('button').forEach(b => b.disabled = true); el('message').textContent = '正在处理…';
    try { const r = await api.command(button.dataset.action); if (r.state) paint(r.state); el('message').textContent = r.message || (r.ok ? '已更新' : '本次未完成，请检查连接状态。'); }
    catch (_) { el('message').textContent = '本次操作未完成，请重试。'; }
    finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); await refresh(); }
  });
  api.onChange(refresh); refresh();
})();
