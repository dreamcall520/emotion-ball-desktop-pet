(function renderBubble() {
  const bubble = document.getElementById('bubble');
  const message = document.getElementById('message');
  const actions = document.getElementById('actions');
  let currentId = null;
  const unsubscribe = window.petBubble.onMessage(payload => {
    bubble.dataset.placement = payload.placement;
    bubble.style.setProperty('--anchor-x', `${payload.anchorX}px`);
    // 移动窗口只更新锚点，不重建正在鼠标下的按钮。
    if (payload.id === currentId) return;
    currentId = payload.id;
    bubble.dataset.messageId = String(payload.id);
    message.textContent = payload.text;
    actions.replaceChildren();
    for (const action of payload.actions) {
      if (!['again', 'rest'].includes(action.id)) continue;
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
