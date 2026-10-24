/* Share the released sheep renderer while retaining the existing four web engines. */
(() => {
  const create = window.EmotionBall.create;
  window.EmotionBall.create = function (target, options) {
    return options?.shape === 'new-year-sheep'
      ? window.SheepSkin.create(target, options) : create.call(this, target, options);
  };
})();
