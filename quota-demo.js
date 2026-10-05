(() => {
  'use strict';
  const root = document.querySelector('[data-quota-demo]');
  if (!root) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const stages = [
    { week: 68, short: 82, weekTime: 71, shortTime: 80, weekReset: '5 天后重置', shortReset: '4 小时后重置', pace: '均衡', note: '两个周期同屏查看，点击趋势了解用量节奏。' },
    { week: 20, short: 35, weekTime: 57, shortTime: 60, weekReset: '4 天后重置', shortReset: '3 小时后重置', pace: '偏快', note: '用量偏快时，额度与节奏提示一起提醒你。' },
    { week: 8, short: 12, weekTime: 14, shortTime: 40, weekReset: '1 天后重置', shortReset: '2 小时后重置', pace: '偏快', note: '剩余额度不多了，留意使用节奏。' },
  ];
  const state = { period: 'week', appearance: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', expanded: true, stage: 0, paused: false, visible: false, action: null, detail: null, forecast: 'estimate', resultViewed: false, taskKind: 'running' };
  let timer = null;
  let detailTrigger = null;
  const chevron = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 10.5L8 5.5L13 10.5"/></svg>';
  root.innerHTML = `
    <div class="qd-toolbar">
      <span class="qd-toolbar-label">额度卡片 2.0 · 示例数据</span>
      <div class="qd-segment" role="group" aria-label="演示卡片外观">
        <button type="button" data-qd-theme="light">浅色</button>
        <button type="button" data-qd-theme="dark">深色</button>
      </div>
    </div>
    <div class="qd-stage">
      <div class="qd-panel">
        <h3>套餐额度与状态</h3>
        <section class="qd-card qd-codex-card" aria-label="Codex 额度卡片演示">
          <button type="button" class="qd-compact qd-collapse" aria-controls="qd-card-details"><span class="qd-period-pill">周</span><span>额度</span><strong data-qd-value="week">68%</strong>${chevron}</button>
          <div id="qd-card-details">
            <div class="qd-card-header"><span class="qd-product">CODEX</span><span class="qd-remaining">本周期剩余</span><button type="button" class="qd-collapse qd-chevron" aria-controls="qd-card-details">${chevron}</button></div>
            <div class="qd-periods" role="group" aria-label="选择额度趋势周期">
              <button type="button" data-qd-period="short" class="qd-period"><span class="qd-period-pill">5 小时</span><span class="qd-value-row"><strong class="qd-value" data-qd-value="short">82%</strong><span class="qd-pace">均衡</span></span><span class="qd-meter" role="progressbar" aria-label="5 小时剩余额度" aria-valuemin="0" aria-valuemax="100" data-qd-meter="short"><span></span></span><span class="qd-reset" data-qd-reset="short">4 小时后重置</span></button>
              <button type="button" data-qd-period="week" class="qd-period"><span class="qd-period-pill">周额度</span><span class="qd-value-row"><strong class="qd-value" data-qd-value="week">68%</strong><span class="qd-pace">均衡</span></span><span class="qd-meter" role="progressbar" aria-label="周剩余额度" aria-valuemin="0" aria-valuemax="100" data-qd-meter="week"><span></span></span><span class="qd-reset" data-qd-reset="week">5 天后重置</span></button>
            </div>
            <div class="qd-auxiliary">
              <div class="qd-shared"><button type="button" data-qd-detail="opportunities">重置机会 <b>2 次</b><span class="qd-clock" aria-hidden="true">◷</span></button><button type="button" data-qd-detail="credits">额外点数 <b>1,250.00</b></button></div>
              <div class="qd-links"><button type="button" data-qd-detail="tasks">进行中 <b>1</b></button><button type="button" data-qd-detail="results">待查看 <b data-qd-unread>1</b></button><button type="button" data-qd-detail="trend">↗ 趋势</button></div>
            </div>
          </div>
        </section>
        <details class="qd-help"><summary>额度与点数分别统计</summary><p>右键球球 → Codex 与 API → 额度卡设置，可选择显示周期和额外点数。Codex 返回点数状态时显示，不并入套餐额度或重置机会。</p></details>
      </div>
      <div class="qd-panel">
        <h3>独立 API 费用</h3>
        <details class="qd-card qd-api-card" open>
          <summary aria-label="展开或收起 API 费用卡片"><span class="qd-product">API</span><span class="qd-remaining">本月</span><strong class="qd-api-compact">$32.48</strong><span class="qd-api-chevron">${chevron}</span></summary>
          <div class="qd-api-value"><strong>32.48</strong><span>USD</span></div>
          <div class="qd-api-today"><span>今日 UTC</span><strong>$1.26</strong></div>
          <div class="qd-api-bottom"><span>上次查询 09:41 UTC</span><button type="button" data-qd-detail="api">查看报告 →</button></div>
        </details>
        <details class="qd-help"><summary>如何接入 API 费用？</summary><p>右键球球 → Codex 与 API → OpenAI API → OpenAI API 费用与用量…。需要组织所有者的 Admin API Key 及费用、用量读取权限；密钥仅在本机加密保存，断开连接即移除。组织费用按 UTC 汇总，可能延迟，不表示余额。</p></details>
      </div>
      <section class="qd-detail qd-glass" hidden aria-labelledby="qd-detail-title"><header><h4 id="qd-detail-title" tabindex="-1"></h4><button type="button" data-qd-close aria-label="关闭示例详情">×</button></header><div class="qd-detail-content"></div><p class="qd-detail-note">以下均为示例数据，不连接或操作真实账户。</p></section>
    </div>
    <p class="qd-caption"></p>
    <div class="qd-actions" role="group" aria-label="点击体验球球的状态回应"><button type="button" data-qd-action="thought">思考中</button><button type="button" data-qd-action="complete">已完成</button><button type="button" data-qd-action="quota">额度提醒</button></div>
    <p class="qd-disclaimer">网页演示 · 点击卡片入口查看详情，点击收起箭头体验紧凑卡</p>
    <span class="qd-sr-only" role="status" aria-live="polite"></span>`;
  const card = root.querySelector('.qd-codex-card');
  const caption = root.querySelector('.qd-caption');
  const status = root.querySelector('[role="status"]');
  const detail = root.querySelector('.qd-detail');
  const periodName = () => state.period === 'week' ? '周额度' : '5 小时';
  const running = () => !state.paused && !state.detail && state.visible && !document.hidden && !reducedMotion.matches;
  function renderDetail() {
    detail.hidden = !state.detail;
    if (!state.detail) return;
    const title = root.querySelector('#qd-detail-title');
    const content = root.querySelector('.qd-detail-content');
    const value = stages[state.stage][state.period];
    const titles = { trend: '额度趋势', opportunities: '重置机会', credits: '额外点数', tasks: '进行中 · 1', results: `待查看 · ${state.resultViewed ? 0 : 1}`, task: '任务示例详情', api: 'API 费用与用量' };
    title.textContent = titles[state.detail];
    if (state.detail === 'trend') {
      const time = stages[state.stage][`${state.period}Time`];
      const lastX = 30 + (100 - time) * 2.6;
      const points = [100, 97, 90, 85, Math.max(value, 78), value].map((y, i) => `${30 + i * (lastX - 30) / 5},${102 - y * .8}`).join(' ');
      const forecast = state.forecast === 'unknown' ? '暂无法预估额度用完时间' : state.stage === 0 ? '按当前示例节奏，预计可用至重置' : '按当前示例节奏，额度可能在重置前用完';
      content.innerHTML = `<div class="qd-segment qd-trend-tabs" role="group" aria-label="趋势周期"><button type="button" data-qd-period="short" aria-pressed="${state.period === 'short'}">5 小时</button><button type="button" data-qd-period="week" aria-pressed="${state.period === 'week'}">周额度</button></div><div class="qd-trend-stats"><p><span>${periodName()}剩余</span><strong>${value}%</strong></p><p><span>剩余时间 · 示例</span><strong>${time}%</strong></p><span class="qd-pace">${stages[state.stage].pace}</span></div><div class="qd-chart-legend"><span>━ 剩余额度</span><span>┄ 剩余时间</span><span>已采样 · 示例</span></div><svg class="qd-trend-chart" viewBox="0 0 310 130" role="img" aria-label="${periodName()}示例额度趋势，曲线仅到已采样位置"><path class="qd-chart-axis" d="M30 22H290M30 62H290M30 102H290"/><text x="1" y="25">100%</text><text x="7" y="65">50%</text><text x="13" y="105">0%</text><path class="qd-chart-time" d="M30 22L${lastX} ${102 - time * .8}"/><polyline class="qd-chart-line" points="${points}"/><circle cx="${lastX}" cy="${102 - value * .8}" r="3"/><text x="30" y="124">周期开始</text><text x="${lastX}" y="124" text-anchor="middle">已采样</text><text x="290" y="124" text-anchor="end">重置</text></svg><div class="qd-forecast"><strong>${forecast}</strong><p>${state.forecast === 'unknown' ? '连续用量记录不足，稍后再查看。' : '按近期用量估算，会随实际用量变化；此处展示预设示例。'}</p><button type="button" data-qd-forecast>${state.forecast === 'unknown' ? '体验预估提示' : '体验记录不足'}</button></div><button type="button" class="qd-detail-link" data-qd-detail="opportunities">查看重置机会与历史 →</button>`;
    } else if (state.detail === 'opportunities') {
      content.innerHTML = '<p class="qd-reset-summary">当前可用 <strong>2</strong> 次</p><dl class="qd-report"><div><dt>1 次</dt><dd>3 天后到期 · 可用</dd></div><div><dt>1 次</dt><dd>无到期限制 · 可用</dd></div></dl><details class="qd-history"><summary>账户历史 · 过去 30 天 · 示例 3 条</summary><dl class="qd-report"><div><dt>已获得</dt><dd>5 天前 · 1 次</dd></div><div><dt>已使用</dt><dd>12 天前 · 1 次</dd></div><div><dt>已获得</dt><dd>20 天前 · 1 次</dd></div></dl></details><p class="qd-subtle">实际 App 显示已同步的账户记录；历史查询未完成不代表没有记录。</p>';
    } else if (state.detail === 'credits') {
      content.innerHTML = '<p class="qd-subtle">当前余额 · 示例</p><p class="qd-balance">1,250<span>.00 点</span></p><p class="qd-subtle">额外点数、套餐额度、重置机会分别统计，API 费用独立展示。</p>';
    } else if (state.detail === 'tasks' || state.detail === 'results') {
      const results = state.detail === 'results';
      content.innerHTML = results && state.resultViewed ? '<p class="qd-subtle">暂无待查看结果。示例结果已标记为查看。</p>' : `<button type="button" class="qd-task-item" data-qd-task="${results ? 'result' : 'running'}"><span aria-hidden="true">${results ? '✓' : '◌'}</span><span><b>${results ? '整理今日待办' : '检查示例页面布局'}</b><small>${results ? '已完成 · 待查看' : '正在处理'}</small></span><span aria-hidden="true">›</span></button><p class="qd-subtle">${results ? '打开示例详情后，清除待查看标记。' : '真实 App 可点击返回对应 Codex 会话；网页仅打开示例详情。'}</p>`;
    } else if (state.detail === 'task') {
      const results = state.taskKind === 'result';
      content.innerHTML = `<p class="qd-task-title">${results ? '整理今日待办' : '检查示例页面布局'}</p><p class="qd-subtle">${results ? '示例结果：已整理为 3 项待办，可逐项确认截止日期和提醒。' : '示例进展：正在检查桌面与手机布局，完成后会出现在待查看结果中。'}</p><button type="button" class="qd-detail-link" data-qd-detail="${results ? 'results' : 'tasks'}">返回${results ? '待查看' : '任务'}列表 →</button>`;
    } else if (state.detail === 'api') {
      content.innerHTML = '<dl class="qd-report"><div><dt>本月组织费用</dt><dd>32.48 USD</dd></div><div><dt>今日 UTC 费用</dt><dd>1.26 USD</dd></div><div><dt>本月输入</dt><dd>2.84M tokens</dd></div><div><dt>其中缓存输入</dt><dd>1.12M tokens</dd></div><div><dt>本月输出</dt><dd>420K tokens</dd></div></dl><p class="qd-subtle">缓存属于输入的一部分。数据可能延迟，不表示当前聊天的实时费用或最终账单。</p>';
    }
  }
  function render() {
    root.querySelectorAll('.qd-card, .qd-glass').forEach(item => { item.dataset.appearance = state.appearance; });
    card.dataset.expanded = String(state.expanded);
    root.querySelectorAll('[data-qd-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.qdTheme === state.appearance)));
    root.querySelectorAll('.qd-collapse').forEach(button => {
      button.setAttribute('aria-expanded', String(state.expanded));
      button.setAttribute('aria-label', state.expanded ? '收起额度卡片' : '展开额度卡片');
    });
    root.querySelector('#qd-card-details').hidden = !state.expanded;
    root.querySelector('.qd-compact').hidden = state.expanded;
    root.querySelectorAll('[data-qd-value]').forEach(item => { item.textContent = `${stages[state.stage][item.dataset.qdValue]}%`; });
    root.querySelectorAll('[data-qd-meter]').forEach(meter => {
      const value = stages[state.stage][meter.dataset.qdMeter];
      meter.setAttribute('aria-valuenow', String(value));
      meter.querySelector('span').style.width = `${value}%`;
      meter.closest('.qd-period').dataset.severity = value <= 10 ? 'urgent' : value <= 20 ? 'low' : 'normal';
    });
    root.querySelectorAll('.qd-period .qd-pace').forEach(item => { item.textContent = stages[state.stage].pace; });
    root.querySelectorAll('[data-qd-reset]').forEach(item => { item.textContent = stages[state.stage][`${item.dataset.qdReset}Reset`]; });
    root.querySelector('[data-qd-unread]').textContent = state.resultViewed ? '0' : '1';
    caption.textContent = stages[state.stage].note;
    renderDetail();
    root.querySelectorAll('[data-qd-period]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.qdPeriod === state.period)));
  }
  function schedule() {
    window.clearTimeout(timer);
    timer = null;
    root.dataset.motionPaused = String(!running());
    if (!running()) return;
    timer = window.setTimeout(() => { state.stage = (state.stage + 1) % stages.length; state.action = null; render(); schedule(); }, 10000);
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    if (button.dataset.qdTheme) state.appearance = button.dataset.qdTheme;
    if (button.dataset.qdPeriod) { state.period = button.dataset.qdPeriod; state.detail = 'trend'; if (!detail.contains(button)) detailTrigger = button; }
    if (button.classList.contains('qd-collapse')) state.expanded = !state.expanded;
    if (button.dataset.qdDetail) { state.detail = button.dataset.qdDetail; if (!detail.contains(button)) detailTrigger = button; }
    if (button.hasAttribute('data-qd-forecast')) state.forecast = state.forecast === 'estimate' ? 'unknown' : 'estimate';
    if (button.dataset.qdTask) { state.taskKind = button.dataset.qdTask; if (state.taskKind === 'result') state.resultViewed = true; state.detail = 'task'; }
    if (button.hasAttribute('data-qd-close')) state.detail = null;
    const action = button.dataset.qdAction;
    if (action) { state.action = action; if (action === 'quota') state.stage = 2; }
    render();
    if (state.detail && (button.dataset.qdDetail || button.dataset.qdPeriod || button.dataset.qdTask)) root.querySelector('#qd-detail-title').focus({ preventScroll: true });
    if (button.hasAttribute('data-qd-close')) detailTrigger?.focus({ preventScroll: true });
    if (button.classList.contains('qd-collapse')) root.querySelector(state.expanded ? '.qd-chevron' : '.qd-compact').focus({ preventScroll: true });
    if (button.hasAttribute('data-qd-forecast')) root.querySelector('[data-qd-forecast]').focus({ preventScroll: true });
    if (action) {
      const notes = { thought: '思考中，球球用头顶光迹陪你等待。', complete: '完成啦！球球为你送上小小庆祝。', quota: '演示低额度提醒，记得留意剩余额度。' };
      caption.textContent = notes[action]; status.textContent = notes[action];
      document.dispatchEvent(new CustomEvent('quota-demo-action', { detail: { action } }));
    }
    schedule();
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.detail) { state.detail = null; detail.hidden = true; detailTrigger?.focus({ preventScroll: true }); schedule(); }
  });
  document.addEventListener('website-motion-pause', event => { state.paused = Boolean(event.detail?.paused); schedule(); });
  document.addEventListener('visibilitychange', schedule);
  reducedMotion.addEventListener('change', schedule);
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => { state.visible = entries[0].isIntersecting; schedule(); }, { threshold: 0.1 }).observe(root);
  else state.visible = true;
  window.QiuqiuQuotaDemo = Object.freeze({ getState: () => Object.freeze({ ...state, remainingPercent: stages[state.stage][state.period], autoPlaying: running(), reducedMotion: reducedMotion.matches }) });
  render();
  schedule();
})();
