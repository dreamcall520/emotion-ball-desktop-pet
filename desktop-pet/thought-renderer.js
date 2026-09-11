'use strict';
const flow = ThoughtFlow.create(document.getElementById('flow'));
window.petThought.onFrame(packet => {
  if (!packet?.visible) { flow.stop(); return; }
  flow.play({ side: packet.side, viewBox: packet.viewBox, rotation: packet.rotation,
    elapsedMs: packet.elapsedMs, reducedMotion: packet.reducedMotion });
});
window.addEventListener('beforeunload', () => flow.destroy());
