(function exposePetBehavior(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetBehavior = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPetBehavior() {
  const IDLE_OPTIONS = Object.freeze({
    standbyAfter: 120000,
    sleepAfter: 600000,
    standbyId: '04',
    sleepId: '00'
  });

  function isDrag(start, current) {
    return Math.hypot(current.x - start.x, current.y - start.y) > 6;
  }

  function chooseClickAction(value) {
    if (value < 1 / 3) return 'bounce';
    if (value < 2 / 3) return 'spin';
    return 'happy';
  }

  return {
    IDLE_OPTIONS,
    isDrag,
    chooseClickAction
  };
});
