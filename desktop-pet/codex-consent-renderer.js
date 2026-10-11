(() => {
  'use strict';
  const bridge = window.qiuqiuConsent, $ = id => document.getElementById(id);
  const cancel = $('consent-cancel'), accept = $('consent-accept'), status = $('consent-status');
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const avatar = window.PetChatAvatar.create($('consent-avatar'));
  let ready = false, busy = false, disposed = false;
  const refresh = () => {
    document.documentElement.dataset.aboutVisible = String(!document.hidden);
    avatar.setActive(!disposed && !document.hidden && !motion?.matches);
    accept.disabled = !ready || busy || document.hidden || typeof bridge?.answer !== 'function';
    cancel.disabled = busy || typeof bridge?.answer !== 'function';
  };
  const receive = info => {
    if (disposed || !info?.appearance || typeof info.appearance !== 'object') return;
    avatar.update(info.appearance, null, info.codexPet);
    const first = !ready; ready = true; refresh();
    if (first && !document.hidden) cancel.focus();
  };
  async function answer(accepted) {
    if (disposed || busy || document.hidden || accepted && !ready || typeof bridge?.answer !== 'function') return;
    busy = true; refresh();
    try {
      if (await bridge.answer(accepted) !== true && !disposed) status.textContent = '确认窗口已失效，请关闭后重新开启联动。';
    } catch (_) {
      if (!disposed) status.textContent = '暂时无法确认，请关闭后重试。';
    } finally { if (!disposed) { busy = false; refresh(); } }
  }
  cancel.addEventListener('click', () => { void answer(false); });
  accept.addEventListener('click', () => { void answer(true); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); void answer(false); }
  });
  document.addEventListener('visibilitychange', refresh);
  motion?.addEventListener('change', refresh);
  const unsubscribe = bridge?.onInfo(receive);
  refresh();
  Promise.resolve(bridge?.getInfo()).then(receive, () => {});
  window.addEventListener('beforeunload', () => {
    disposed = true; unsubscribe?.(); motion?.removeEventListener('change', refresh); avatar.destroy();
  }, { once: true });
})();
