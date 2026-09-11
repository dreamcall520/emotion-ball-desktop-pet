(() => {
  'use strict';
  const root = document.querySelector('[data-quota-demo]');
  if (!root) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const stages = [
    { week: 68, short: 82, note: '额度充足，安心做自己的事。' },
    { week: 20, short: 35, note: '额度渐少，球球会轻轻提醒。' },
    { week: 8, short: 12, note: '剩余额度不多了，留意使用节奏。' },
  ];
  const state = { period: 'week', appearance: 'dark', expanded: true, stage: 0, paused: false, visible: false, action: null };
  let timer = null;
  root.innerHTML = `
    <div class="qd-toolbar">
      <span class="qd-toolbar-label">卡片外观</span>
      <div class="qd-segment" role="group" aria-label="演示卡片外观，不改变网页主题">
        <button type="button" data-qd-theme="light" aria-pressed="false">浅色</button>
        <button type="button" data-qd-theme="dark" aria-pressed="true">深色</button>
      </div>
    </div>
    <div class="qd-stage">
      <section class="qd-card" data-appearance="dark" data-severity="normal" aria-label="Codex 额度卡片演示">
        <div class="qd-card-header">
          <span class="qd-product">CODEX</span>
          <div class="qd-periods" role="group" aria-label="额度周期">
            <button type="button" data-qd-period="short" aria-pressed="false">5 小时</button>
            <button type="button" data-qd-period="week" aria-pressed="true">周额度</button>
          </div>
          <button type="button" class="qd-collapse" aria-expanded="true" aria-controls="qd-card-details" aria-label="收起额度卡片"><span aria-hidden="true">⌃</span></button>
        </div>
        <div class="qd-value-row"><span class="qd-value">68<span>%</span></span><span class="qd-remaining">剩余额度</span></div>
        <div class="qd-meter" role="progressbar" aria-label="周剩余额度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="68"><span></span></div>
        <div id="qd-card-details" class="qd-details">
          <div><strong class="qd-reset">1 天后重置</strong><span>当前周期 · 演示</span></div>
          <div class="qd-credit"><strong>1 次</strong><span>重置机会</span></div>
        </div>
      </section>
    </div>
    <p class="qd-caption">额度充足，安心做自己的事。</p>
    <div class="qd-actions" role="group" aria-label="点击体验球球的状态回应">
      <button type="button" data-qd-action="thought">思考中</button>
      <button type="button" data-qd-action="complete">已完成</button>
      <button type="button" data-qd-action="quota">额度提醒</button>
    </div>
    <p class="qd-disclaimer">演示数据，不连接 Codex · 点击按钮体验回应</p>
    <span class="qd-sr-only" role="status" aria-live="polite"></span>`;
  const card = root.querySelector('.qd-card');
  const caption = root.querySelector('.qd-caption');
  const status = root.querySelector('[role="status"]');
  const running = () => !state.paused && state.visible && !document.hidden && !reducedMotion.matches;
  function render() {
    const value = stages[state.stage][state.period];
    card.dataset.appearance = state.appearance;
    card.dataset.severity = value <= 10 ? 'urgent' : value <= 20 ? 'low' : 'normal';
    card.dataset.expanded = String(state.expanded);
    root.querySelectorAll('[data-qd-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.qdTheme === state.appearance)));
    root.querySelectorAll('[data-qd-period]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.qdPeriod === state.period)));
    const collapse = root.querySelector('.qd-collapse');
    collapse.setAttribute('aria-expanded', String(state.expanded));
    collapse.setAttribute('aria-label', state.expanded ? '收起额度卡片' : '展开额度卡片');
    root.querySelector('#qd-card-details').hidden = !state.expanded;
    root.querySelector('.qd-value').innerHTML = `${value}<span>%</span>`;
    const meter = root.querySelector('.qd-meter');
    meter.setAttribute('aria-valuenow', String(value));
    meter.setAttribute('aria-label', `${state.period === 'week' ? '周' : '5 小时'}剩余额度`);
    meter.querySelector('span').style.width = `${value}%`;
    root.querySelector('.qd-reset').textContent = state.period === 'week' ? '1 天后重置' : '2 小时后重置';
    caption.textContent = stages[state.stage].note;
  }
  function schedule() {
    window.clearTimeout(timer);
    timer = null;
    root.dataset.motionPaused = String(!running());
    if (!running()) return;
    timer = window.setTimeout(() => {
      state.stage = (state.stage + 1) % stages.length;
      state.action = null;
      render();
      schedule();
    }, 10000);
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    if (button.dataset.qdTheme) state.appearance = button.dataset.qdTheme;
    if (button.dataset.qdPeriod) state.period = button.dataset.qdPeriod;
    if (button.classList.contains('qd-collapse')) state.expanded = !state.expanded;
    const action = button.dataset.qdAction;
    if (action) {
      state.action = action;
      if (action === 'quota') state.stage = 2;
    }
    render();
    if (action) {
      const notes = { thought: '思考中，球球用头顶光迹陪你等待。', complete: '完成啦！球球为你送上小小庆祝。', quota: '演示低额度提醒，记得留意剩余额度。' };
      caption.textContent = notes[action];
      status.textContent = notes[action];
      document.dispatchEvent(new CustomEvent('quota-demo-action', { detail: { action } }));
    }
    schedule();
  });
  document.addEventListener('website-motion-pause', event => {
    state.paused = Boolean(event.detail?.paused);
    schedule();
  });
  document.addEventListener('visibilitychange', schedule);
  reducedMotion.addEventListener('change', schedule);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      state.visible = entries[0].isIntersecting;
      schedule();
    }, { threshold: 0.1 }).observe(root);
  } else {
    state.visible = true;
  }
  window.QiuqiuQuotaDemo = Object.freeze({
    getState: () => Object.freeze({ ...state, remainingPercent: stages[state.stage][state.period], autoPlaying: running(), reducedMotion: reducedMotion.matches }),
  });
  render();
  schedule();
})();
