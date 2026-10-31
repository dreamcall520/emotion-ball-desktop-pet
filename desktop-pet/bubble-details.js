(() => {
  const content = document.getElementById('detail-content');
  const unsubscribe = window.petBubbleDetails.onMessage(payload => {
    if (typeof payload?.text !== 'string') return;
    content.textContent = payload.text;
    window.scrollTo(0, 0);
  });
  window.addEventListener('beforeunload', unsubscribe, { once: true });
})();
