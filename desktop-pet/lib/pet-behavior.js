(function exposePetBehavior(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetBehavior = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPetBehavior() {
  function isDrag(start, current) {
    return Math.hypot(current.x - start.x, current.y - start.y) > 6;
  }

  function chooseClickAction(value) {
    if (value < 1 / 3) return 'bounce';
    if (value < 2 / 3) return 'spin';
    return 'happy';
  }

  return {
    isDrag,
    chooseClickAction
  };
});
