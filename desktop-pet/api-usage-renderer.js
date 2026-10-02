(() => {
  'use strict';
  const bridge = window.qiuqiuApiUsage;
  const $ = id => document.getElementById(id);
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  let state = { connected: false, busy: false, error: null, config: {}, report: null };
  let actionBusy = false;
  let configEdited = false;
  let initialized = false;

  const errorMessages = {
    ADMIN_KEY_REQUIRED: '需要组织的 Admin API Key，普通调用 Key 无法查询费用。',
    UNAUTHENTICATED: '管理密钥无效或已失效，请重新连接。',
    UNAUTHORIZED: '管理密钥无效或已失效，请重新连接。',
    FORBIDDEN: '当前管理密钥没有查询组织报告的权限。',
    RATE_LIMITED: '查询暂时受限，请稍后刷新。',
    TIMEOUT: '查询超时，请稍后刷新。',
    NETWORK: '未能连接 OpenAI，请检查网络后刷新。',
    INVALID_CONFIG: '请检查项目 ID 和调用 Key ID 后重新连接。',
    CREDENTIAL_STORE_ERROR: '未能保存管理密钥，请重新连接。',
    BRIDGE_UNAVAILABLE: '报告连接暂不可用，请重新打开窗口。',
    QUERY_FAILED: '报告读取失败，请检查连接后重试。'
  };

  function errorText(error) {
    if (typeof error === 'string') return errorMessages[error] || error;
    const code = error?.code;
    return errorMessages[code] || '报告读取失败，请检查连接后重试。';
  }

  function displayCosts(node, entries, hasReport) {
    node.replaceChildren();
    node.classList.remove('empty-cost');
    const valid = Array.isArray(entries) ? entries.filter(entry => entry && typeof entry.currency === 'string' && /^[a-z]{3}$/i.test(entry.currency) && typeof entry.value === 'number' && Number.isFinite(entry.value)) : [];
    if (!hasReport || valid.length === 0) {
      node.textContent = hasReport ? '暂无费用记录' : '—';
      if (hasReport) node.classList.add('empty-cost');
      return;
    }
    for (const entry of valid) {
      const row = document.createElement('span');
      row.className = 'currency-row';
      const amount = entry.value !== 0 && Math.abs(entry.value) < 0.000001 ? entry.value.toExponential(2) : money.format(entry.value);
      row.append(document.createTextNode(amount));
      const currency = document.createElement('span');
      currency.className = 'currency-unit';
      currency.textContent = entry.currency.toUpperCase();
      row.append(currency);
      node.append(row);
    }
  }

  function tokenValue(value, missing = '—') {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? number.format(value) : missing;
  }

  function render(next) {
    if (next && typeof next === 'object' && typeof next.connected === 'boolean') state = next;
    const busy = actionBusy || state.busy === true;
    const connected = state.connected === true;
    const report = connected && state.report && typeof state.report === 'object' ? state.report : null;
    const config = state.config || {};
    $('api-key-id').disabled = busy;
    $('project-id').disabled = busy;
    $('admin-key').disabled = busy;
    $('connect-report').disabled = busy || !bridge;
    $('refresh-report').disabled = busy || !connected || !bridge;
    $('disconnect-report').disabled = busy || !bridge;
    $('disconnect-report').hidden = !connected;
    $('open-guide').disabled = busy || !bridge;
    $('connect-report').textContent = connected ? '更新连接并查询' : '连接并查询';
    $('connection-label').textContent = connected ? '已连接' : '未连接';
    $('admin-key').required = !connected;
    $('admin-key').placeholder = connected ? '留空沿用已保存的管理密钥' : '输入组织管理密钥';
    $('query-status').dataset.connected = String(connected);
    $('query-status').textContent = busy
      ? report ? '正在查询，当前显示上次成功报告…' : '正在查询官方报告…'
      : state.error ? report ? '未更新，当前仍显示上次成功报告。' : '未更新，请检查连接设置。'
        : connected ? report ? '已连接 · 报告已更新' : '已连接 · 尚无查询结果' : '尚未连接';
    $('query-error').hidden = !state.error;
    $('query-error').textContent = state.error ? errorText(state.error) : '';
    const month = report?.month;
    $('report-month').textContent = typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) ? `${month} · UTC` : 'UTC';
    displayCosts($('month-cost'), report?.costs?.month, Boolean(report));
    displayCosts($('today-cost'), report?.costs?.today, Boolean(report));
    $('input-tokens').textContent = tokenValue(report?.usage?.inputTokens);
    $('output-tokens').textContent = tokenValue(report?.usage?.outputTokens);
    $('cached-tokens').textContent = tokenValue(report?.usage?.cachedInputTokens, report ? '未提供' : '—');
    const requests = tokenValue(report?.usage?.requests, '');
    $('request-count').textContent = requests ? `${requests} 次请求` : '—';
    const scope = [];
    if (connected && typeof config.projectId === 'string' && config.projectId) scope.push(`项目：${config.projectId}`);
    if (connected && typeof config.apiKeyId === 'string' && config.apiKeyId) scope.push(`调用 Key：${config.apiKeyId}`);
    $('report-scope').textContent = scope.length ? scope.join(' · ') : '全部组织';
    $('scope-note').textContent = scope.length ? '只有上述范围专供 Codex 使用时，才可作为 Codex 用量。' : '包含组织内其他 API 使用；不是单独的 Codex 用量。';
    const updated = report?.updatedAt;
    const validTime = typeof updated === 'number' && Number.isFinite(updated) && !Number.isNaN(new Date(updated).getTime());
    $('updated-at').textContent = validTime ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }).format(updated) + ' UTC' : '尚未查询';
    if (validTime) $('updated-at').dateTime = new Date(updated).toISOString();
    else $('updated-at').removeAttribute('datetime');
    if (!configEdited) {
      $('project-id').value = typeof config.projectId === 'string' ? config.projectId : '';
      $('api-key-id').value = typeof config.apiKeyId === 'string' ? config.apiKeyId : '';
    }
    if (!initialized) { $('connection-settings').open = !connected; initialized = true; }
    document.querySelector('.api-panel').setAttribute('aria-busy', String(busy));
  }

  async function run(method, payload) {
    if (actionBusy || state.busy || !bridge || typeof bridge[method] !== 'function') return;
    actionBusy = true;
    render();
    try {
      const next = payload === undefined ? await bridge[method]() : await bridge[method](payload);
      if (method === 'connect' && next?.connected && !next.error) { configEdited = false; $('connection-settings').open = false; }
      if (method === 'disconnect' && next?.connected === false) {
        configEdited = false;
        $('admin-key').value = '';
        $('connection-settings').open = true;
      }
      render(next);
    } catch (_) {
      state = { ...state, error: 'QUERY_FAILED' };
    } finally { actionBusy = false; render(); }
  }

  $('connection-form').addEventListener('submit', event => {
    event.preventDefault();
    const key = $('admin-key').value.trim();
    $('admin-key').value = '';
    if (!key && !state.connected) return;
    run('connect', { key, projectId: $('project-id').value.trim(), apiKeyId: $('api-key-id').value.trim() });
  });
  for (const id of ['project-id', 'api-key-id']) $(id).addEventListener('input', () => { configEdited = true; });
  $('refresh-report').addEventListener('click', () => { $('admin-key').value = ''; run('refresh'); });
  $('disconnect-report').addEventListener('click', () => { $('admin-key').value = ''; run('disconnect'); });
  $('open-guide').addEventListener('click', () => run('openGuide'));
  let unsubscribe;
  try { if (typeof bridge?.onState === 'function') unsubscribe = bridge.onState(render); } catch (_) {}
  window.addEventListener('beforeunload', () => { $('admin-key').value = ''; if (typeof unsubscribe === 'function') unsubscribe(); }, { once: true });
  render();
  if (typeof bridge?.getState === 'function') {
    Promise.resolve().then(() => bridge.getState()).then(render).catch(() => render({ ...state, error: 'QUERY_FAILED' }));
  } else render({ ...state, error: 'BRIDGE_UNAVAILABLE' });
})();
