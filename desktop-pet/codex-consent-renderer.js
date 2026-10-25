(() => {
  'use strict';
  const bridge = window.qiuqiuConsent, $ = id => document.getElementById(id);
  const cancel = $('consent-cancel'), accept = $('consent-accept'), status = $('consent-status');
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const avatar = window.PetChatAvatar.create($('consent-avatar'));
  let ready = false, busy = false, disposed = false, zcodeCopyApplied = false;
  const refresh = () => {
    document.documentElement.dataset.aboutVisible = String(!document.hidden);
    avatar.setActive(!disposed && !document.hidden && !motion?.matches);
    accept.disabled = !ready || busy || document.hidden || typeof bridge?.answer !== 'function';
    cancel.disabled = busy || typeof bridge?.answer !== 'function';
  };
  const receive = info => {
    if (disposed || !info?.appearance || typeof info.appearance !== 'object') return;
    if (info.sourceId === 'zcode' && !zcodeCopyApplied) {
      document.title = '开启 ZCode 联动';
      const copy = {
        'consent-title': '让球球陪你关注 ZCode',
        'consent-subtitle': '提醒额度余量，也留意任务进展。',
        'consent-state-title': '本机状态',
        'consent-state-body': '读取本机 ZCode 当前登录账号的套餐、额度与任务状态。',
        'consent-privacy-title': '保护隐私',
        'consent-privacy-credentials': '账户凭据仅用于连接 ZCode 对应官方服务，不保存、不发送给其他服务。',
        'consent-privacy-messages': '聊天仅在你主动发送时进行，使用 ZCode 对应模型与额度，只操作球球自身的聊天会话。',
        'consent-control-title': '由你掌控',
        'consent-control-body': '不监听键盘，也不会代你操作其他 ZCode 任务。可随时在「ZCode 联动」中关闭。',
        'consent-status': '可随时在「ZCode 联动」中关闭。'
      };
      for (const [id, text] of Object.entries(copy)) $(id).textContent = text;
      zcodeCopyApplied = true;
    }
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
    if (event.key === 'Tab') document.documentElement.dataset.consentKeyboard = 'true';
    if (event.key === 'Escape') { event.preventDefault(); void answer(false); }
  });
  document.addEventListener('pointerdown', () => { delete document.documentElement.dataset.consentKeyboard; });
  document.addEventListener('visibilitychange', refresh);
  motion?.addEventListener('change', refresh);
  const unsubscribe = bridge?.onInfo(receive);
  refresh();
  Promise.resolve(bridge?.getInfo()).then(receive, () => {});
  window.addEventListener('beforeunload', () => {
    disposed = true; unsubscribe?.(); motion?.removeEventListener('change', refresh); avatar.destroy();
  }, { once: true });
})();
