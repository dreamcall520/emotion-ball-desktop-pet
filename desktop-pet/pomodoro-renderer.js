(() => {
  'use strict';
  const api = window.qiuPomodoro;
  const $ = id => document.getElementById(id);
  const faces = ['analog', 'timeline', 'modules', 'minutes'];
  const labels = { focus: '专注', short: '短休息', long: '长休息' };
  const view = new URLSearchParams(location.search).get('view');
  document.body.dataset.view = ['panel', 'mini', 'message'].includes(view) ? view : 'panel';
  let state = null, busy = 0, pinBusy = false, intentionTimer = null, intentionDirty = false;
  let measuredMessageHeight = null, measureMessagePending = false;
  let clockFraction = null, clockTarget = null, clockFrame = null;
  const root = document.documentElement;
  const syncAppearance = () => { root.dataset.notesAppearance = root.dataset.appearance === 'dark' ? 'dark' : 'light'; };
  const appearanceObserver = new MutationObserver(syncAppearance);
  appearanceObserver.observe(root, { attributes: true, attributeFilter: ['data-appearance'] });
  syncAppearance();
  const subscriptions = [];
  function fitMessage() {
    if (!api || measureMessagePending) return;
    measureMessagePending = true;
    requestAnimationFrame(() => {
      measureMessagePending = false;
      if ($('encouragement').hidden) return;
      const cardHeight = $('encouragement').getBoundingClientRect().height <= 36 ? 36 : 54;
      if (cardHeight === measuredMessageHeight) return;
      measuredMessageHeight = cardHeight;
      api.action('layout', { cardHeight }).then(result => { if (!result?.ok) measuredMessageHeight = null; })
        .catch(() => { measuredMessageHeight = null; });
    });
  }
  function feedback(message) {
    const node = document.body.dataset.view === 'message' ? $('message-feedback') : $('feedback');
    node.textContent = message || ''; node.hidden = !message;
  }
  async function action(type, value) {
    if (!api) { feedback('番茄钟尚未连接，请重新打开。'); return false; }
    if (type === 'pin' && pinBusy) return false;
    const blocking = !['pin', 'layout', 'intention'].includes(type);
    if (type === 'pin') pinBusy = true;
    if (blocking) busy++;
    renderBusy();
    try {
      const result = await api.action(type, value);
      if (!result?.ok) { feedback(result?.message || '操作未完成，请重试。'); return false; }
      feedback('');
      if (result.state) accept(result.state);
      return true;
    } catch (_) { feedback('操作未完成，请重试。'); return false; }
    finally { if (blocking) busy--; if (type === 'pin') pinBusy = false; renderBusy(); }
  }
  function renderBusy() {
    $('pin').setAttribute('aria-busy', String(pinBusy));
    for (const node of document.querySelectorAll('#start,#reset,#pin,.modes button,#settings button[type=submit],#rest-now,#five-more')) node.disabled = busy > 0;
  }
  function drawClock(value) {
    clockFraction = value;
    const fraction = value >= 0 && value <= 1 ? value : ((value % 1) + 1) % 1;
    const angle = fraction * 360, radians = angle * Math.PI / 180;
    const x = 100 + 66 * Math.sin(radians), y = 100 - 66 * Math.cos(radians);
    $('clock-sector').setAttribute('d', fraction === 0 ? '' : fraction === 1 ?
      'M100 100 L100 34 A66 66 0 1 1 100 166 A66 66 0 1 1 100 34 Z' :
      `M100 100 L100 34 A66 66 0 ${fraction > .5 ? 1 : 0} 1 ${x.toFixed(4)} ${y.toFixed(4)} Z`);
    $('clock-needle').setAttribute('transform', `rotate(${angle} 100 100)`);
  }
  function renderClock(remaining, total) {
    const scale = Math.max(60, Math.ceil(total / 3600) * 60), fraction = Math.max(0, Math.min(1, remaining / (scale * 60)));
    $('clock-scale').textContent = `${scale} 分钟刻度 · 每格 ${scale / 60} 分钟`;
    if (clockTarget === fraction) return;
    clockTarget = fraction;
    cancelAnimationFrame(clockFrame);
    if (clockFraction === null || state.face !== 'analog' || matchMedia('(prefers-reduced-motion: reduce)').matches) { drawClock(fraction); return; }
    const from = clockFraction, delta = ((fraction - from + 1.5) % 1) - .5, started = performance.now();
    const step = now => {
      const progress = Math.min(1, (now - started) / 240);
      if (progress === 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) { drawClock(fraction); clockFrame = null; return; }
      drawClock(from + delta * (1 - (1 - progress) ** 3));
      clockFrame = requestAnimationFrame(step);
    };
    clockFrame = requestAnimationFrame(step);
  }
  function accept(value) { if (value && typeof value === 'object') { state = value; render(); } }
  function render() {
    if (!state) return;
    const remaining = Math.max(0, Math.ceil(state.remaining || 0)), total = Math.max(1, state.total || 1500);
    const time = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
    const focus = state.mode === 'focus', complete = state.status === 'complete', running = state.status === 'running', paused = state.status === 'paused';
    const face = faces.includes(state.face) ? state.face : 'analog';
    if (document.body.dataset.view === 'mini') {
      $('mini').hidden = false;
      $('mini').dataset.status = state.status;
      $('mini-label').textContent = paused ? '暂停' : focus ? '专注' : '休息';
      $('mini-time').textContent = complete ? '完成' : time;
      $('mini').setAttribute('aria-label', `${labels[state.mode] || '专注'}${complete ? '完成' : time}，展开番茄钟`);
      return;
    }
    if (document.body.dataset.view === 'message') {
      $('reminder').hidden = !state.reminder;
      $('reminder').dataset.kind = focus ? 'focus' : 'rest';
      $('encouragement').hidden = Boolean(state.reminder) || !state.encouragement;
      $('encouragement').textContent = typeof state.encouragement === 'string' ? state.encouragement : '';
      if (!state.reminder && state.encouragement) fitMessage();
      $('reminder-title').textContent = focus ? '这次专注，完成了。' : '休息好了，再出发。';
      $('reminder-copy').textContent = focus ? `专注了 ${Number((total / 60).toFixed(1))} 分钟，歇一会儿吧。` : '下一次专注，继续按自己的节奏来。';
      const rest = state.cycleCompleted >= 4 ? 'long' : 'short';
      $('rest-now').textContent = focus ? `${rest === 'long' ? '长休息' : '休息'} ${state.durations?.[rest] || (rest === 'long' ? 15 : 5)} 分钟` : '开始下一次专注';
      $('five-more').hidden = !focus;
      renderBusy(); return;
    }
    $('focus-panel').hidden = false;
    $('focus-panel').dataset.face = face;
    $('focus-panel').style.setProperty('--remaining', remaining / total);
    $('time-minutes').textContent = time.slice(0, -3); $('time-seconds').textContent = time.slice(-2);
    $('time').setAttribute('aria-label', `剩余${Math.floor(remaining / 60)}分钟${remaining % 60}秒`);
    $('phase-label').textContent = complete ? '这次计时已完成' : paused ? '已暂停' : running ? `${labels[state.mode]}中` : `准备${labels[state.mode]}`;
    $('start-label').textContent = complete ? focus ? '开始休息' : '开始下一次专注' : running ? '暂停' : paused ? '继续' : focus ? '开始专注' : '开始休息';
    $('start-icon').setAttribute('href', running ? '#i-pause' : '#i-play');
    $('timeline-total').textContent = `${Number((total / 60).toFixed(1))} 分钟`;
    renderClock(remaining, total);
    $('today-rounds').textContent = state.completed || 0;
    $('today-minutes').textContent = Number((state.minutes || 0).toFixed(1));
    if (!intentionDirty && document.activeElement !== $('intention')) $('intention').value = state.intention || '';
    $('pin').setAttribute('aria-pressed', String(Boolean(state.pinned)));
    $('pin').setAttribute('aria-label', state.pinned ? '取消置顶' : '置顶窗口');
    $('pin').title = state.pinned ? '取消置顶' : '置顶窗口';
    for (const button of document.querySelectorAll('.modes button')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
      button.classList.toggle('active', button.dataset.mode === state.mode);
    }
    renderBusy();
  }
  async function saveIntention() {
    clearTimeout(intentionTimer);
    if (!intentionDirty) return true;
    const value = $('intention').value;
    const ok = await action('intention', value);
    if (ok && $('intention').value === value) intentionDirty = false;
    return ok;
  }
  async function closeSettings() {
    if (!$('settings').hidden && !(await action('layout', { face: state?.face || 'analog', settings: false }))) return;
    $('settings').hidden = true; $('settings-open').setAttribute('aria-expanded', 'false');
    feedback(''); $('settings-open').focus();
  }
  $('mini').onclick = () => action('open');
  $('start').onclick = async () => { if (await saveIntention()) action('toggle'); };
  $('reset').onclick = () => action('reset');
  $('pin').onclick = () => action('pin', !state?.pinned);
  $('collapse').onclick = async () => { if (await saveIntention()) action('close-panel'); };
  for (const button of document.querySelectorAll('.modes button')) button.onclick = () => action('mode', button.dataset.mode);
  $('intention').oninput = () => { intentionDirty = true; clearTimeout(intentionTimer); intentionTimer = setTimeout(saveIntention, 350); };
  $('settings-open').onclick = async () => {
    if (!state || !(await saveIntention()) || !(await action('layout', { face: state.face, settings: true }))) return;
    const form = $('settings');
    for (const key of Object.keys(labels)) form.elements[key].value = state.durations?.[key] || ({ focus: 25, short: 5, long: 15 })[key];
    form.elements.face.value = state.face || 'analog'; form.elements.encouragement.checked = state.encouragementEnabled !== false;
    form.hidden = false; $('settings-open').setAttribute('aria-expanded', 'true');
    form.querySelector('input:checked').focus();
  };
  $('settings-close').onclick = closeSettings; $('settings-cancel').onclick = closeSettings;
  $('settings').onsubmit = async event => {
    event.preventDefault(); const form = $('settings');
    if (!form.reportValidity()) return;
    const value = { face: form.elements.face.value, encouragementEnabled: form.elements.encouragement.checked,
      durations: Object.fromEntries(Object.keys(labels).map(key => [key, Number(form.elements[key].value)])) };
    if (await action('settings', value)) await closeSettings();
  };
  $('rest-now').onclick = () => action('rest'); $('five-more').onclick = () => action('extend');
  $('dismiss-reminder').onclick = () => action('dismiss');
  document.addEventListener('keydown', async event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (document.body.dataset.view === 'panel') {
      if (!$('settings').hidden) await closeSettings(); else if (await saveIntention()) action('close-panel');
    } else if (document.body.dataset.view === 'message' && state?.reminder) action('dismiss');
  });
  if (api) {
    subscriptions.push(api.onState(accept));
    api.load().then(result => result?.ok ? accept(result.state) : feedback(result?.message || '番茄钟加载失败。')).catch(() => feedback('番茄钟加载失败，请重新打开。'));
  } else { $('focus-panel').hidden = document.body.dataset.view !== 'panel'; feedback('番茄钟尚未连接，请重新打开。'); }
  window.addEventListener('beforeunload', () => { clearTimeout(intentionTimer); cancelAnimationFrame(clockFrame); appearanceObserver.disconnect(); subscriptions.forEach(unsubscribe => unsubscribe()); }, { once: true });
})();
