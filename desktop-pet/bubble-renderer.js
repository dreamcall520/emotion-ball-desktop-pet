(function renderBubble() {
  const bubble = document.getElementById('bubble');
  const message = document.getElementById('message');
  const actions = document.getElementById('actions');
  let currentId = null;
  let currentActionKey = null;
  let resizeFrame = null;
  function fitWindow(id) {
    if (typeof window.petBubble.resize !== 'function') return;
    if (resizeFrame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(resizeFrame);
    const measure = () => {
      resizeFrame = null;
      // 先解除随窗口拉伸的 bottom 约束，只测自然内容高度；否则箭头溢出会被
      // scrollHeight 反复计入，形成“窗口增高 → 测量更高 → 再增高”的反馈循环。
      const previousBottom = bubble.style.bottom;
      const previousHeight = bubble.style.height;
      bubble.style.bottom = 'auto';
      bubble.style.height = 'max-content';
      const naturalHeight = Math.ceil(bubble.getBoundingClientRect().height);
      bubble.style.bottom = previousBottom;
      bubble.style.height = previousHeight;
      // 气泡本体之外，上下透明留白合计 22px。
      window.petBubble.resize(id, naturalHeight + 22);
    };
    if (typeof requestAnimationFrame === 'function') resizeFrame = requestAnimationFrame(measure);
    else measure();
  }
  const unsubscribe = window.petBubble.onMessage(payload => {
    bubble.dataset.placement = payload.placement;
    bubble.dataset.tone = ['normal', 'strong', 'urgent'].includes(payload.tone) ? payload.tone : 'normal';
    bubble.style.setProperty('--anchor-x', `${payload.anchorX}px`);
    message.textContent = payload.text;
    const allowed = ['again', 'rest', 'codex-open', 'codex-results', 'codex-dismiss'];
    const visibleActions = payload.actions.filter(action => allowed.includes(action.id));
    const actionKey = visibleActions.map(action => `${action.id}:${action.label}`).join('|');
    // 移动窗口或原位更新文案时，不重建正在鼠标下的按钮。
    if (payload.id === currentId && actionKey === currentActionKey) {
      fitWindow(payload.id);
      return;
    }
    currentId = payload.id;
    currentActionKey = actionKey;
    bubble.dataset.messageId = String(payload.id);
    actions.replaceChildren();
    for (const action of visibleActions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = action.id;
      button.textContent = action.label;
      button.addEventListener('click', () => {
        for (const sibling of actions.children) sibling.disabled = true;
        window.petBubble.reply(payload.id, action.id);
      });
      actions.appendChild(button);
    }
    fitWindow(payload.id);
  });
  window.addEventListener('beforeunload', () => {
    if (resizeFrame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(resizeFrame);
    unsubscribe();
  });
})();
