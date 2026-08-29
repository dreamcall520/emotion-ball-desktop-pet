(function renderBubble() {
  const bubble = document.getElementById('bubble');
  const message = document.getElementById('message');
  const actions = document.getElementById('actions');
  let currentId = null;
  let currentActionKey = null;
  const unsubscribe = window.petBubble.onMessage(payload => {
    bubble.dataset.placement = payload.placement;
    bubble.style.setProperty('--anchor-x', `${payload.anchorX}px`);
    message.textContent = payload.text;
    const allowed = ['again', 'rest', 'codex-open', 'codex-results', 'codex-dismiss'];
    const visibleActions = payload.actions.filter(action => allowed.includes(action.id));
    const actionKey = visibleActions.map(action => `${action.id}:${action.label}`).join('|');
    // 移动窗口或原位更新文案时，不重建正在鼠标下的按钮。
    if (payload.id === currentId && actionKey === currentActionKey) return;
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
  });
  window.addEventListener('beforeunload', unsubscribe);
})();
