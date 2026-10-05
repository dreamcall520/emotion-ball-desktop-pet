/* Embedded App windows must not take focus or move the surrounding website. */
(() => {
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (options) {
    if (!document.hasFocus()) return;
    return focus.call(this, { ...options, preventScroll: true });
  };
})();
