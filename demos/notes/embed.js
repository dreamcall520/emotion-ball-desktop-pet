/* Same-origin relay; the panel iframe owns the only demo state. */
(() => {
  for (const root of document.querySelectorAll('[data-notes-native-demo]')) {
    const panel = root.querySelector('iframe[data-notes-frame="panel"]'), desktop = root.querySelector('iframe[data-notes-frame="desktop"]');
    if (!panel || !desktop) continue;
    const panelUrl = new URL(panel.getAttribute('src'), location.href), desktopUrl = new URL(desktop.getAttribute('src'), location.href);
    const status = root.querySelector('[data-notes-native-status]');
    let scope, activeId = 'sample-weekend', activeView = 'note';
    const say = text => { if (status) status.textContent = text; };
    const reopen = root.querySelector('[data-notes-reopen-note]');
    const reopenPanel = root.querySelector('[data-notes-reopen-panel]');
    const send = (frame, packet) => frame.contentWindow?.postMessage({ type: 'qiuqiu-notes-demo', scope, ...packet }, location.origin);
    function showDesktop(open, view = activeView, id = activeId) {
      activeId = id; activeView = view; desktop.hidden = !open; if (reopen) reopen.hidden = open;
      if (!open) return;
      const url = new URL(view === 'reminder' ? 'reminder.html' : 'desktop.html', desktopUrl);
      url.searchParams.set('demoScope', scope); url.searchParams.set('id', id);
      desktop.height = view === 'reminder' ? '190' : '220';
      desktop.style.width = view === 'reminder' ? 'min(100%, 360px)' : 'min(100%, 300px)';
      if (desktop.src !== url.href) desktop.src = url.href;
    }
    function reset() {
      scope = crypto.randomUUID(); activeId = 'sample-weekend'; activeView = 'note'; panel.hidden = false;
      if (reopenPanel) reopenPanel.hidden = true;
      const url = new URL(panelUrl); url.searchParams.set('demoScope', scope); panel.src = url.href; showDesktop(true, 'note', activeId); say('');
    }
    window.addEventListener('message', event => {
      if (event.origin !== location.origin) return;
      const sender = event.source === panel.contentWindow ? 'panel' : event.source === desktop.contentWindow ? 'desktop' : null;
      const packet = event.data;
      if (!sender || packet?.type !== 'qiuqiu-notes-demo' || packet.scope !== scope || packet.from !== sender) return;
      if (packet.kind === 'request' && sender === 'desktop') send(panel, packet);
      if (packet.kind === 'response' && sender === 'panel') send(desktop, packet);
      if (packet.kind === 'state' || packet.kind === 'reminder') send(sender === 'panel' ? desktop : panel, packet);
      if (packet.kind === 'view' && sender === 'panel') showDesktop(packet.open === true, packet.view, packet.id || activeId);
      if (packet.kind === 'panel-visibility' && sender === 'panel' && reopenPanel) { panel.hidden = !packet.open; reopenPanel.hidden = packet.open; }
      if (packet.kind === 'notice') say(packet.message);
    });
    root.querySelector('[data-notes-demo-reset]')?.addEventListener('click', reset);
    root.querySelector('[data-notes-demo-reminder]')?.addEventListener('click', () => send(panel, { kind: 'show-reminder' }));
    reopen?.addEventListener('click', () => send(panel, { kind: 'reopen-note' }));
    reopenPanel?.addEventListener('click', () => { panel.hidden = false; reopenPanel.hidden = true; });
    reset();
  }
})();
