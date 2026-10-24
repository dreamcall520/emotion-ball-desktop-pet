(function (root) {
  'use strict';
  const ids = ['reindeer', 'tree', 'santa', 'snowman', 'gift', null];
  function createRotation(random = Math.random) {
    let bag = [], previous, lastClickSwitch = -Infinity;
    return {
      next(commit = true) {
        if (!bag.length) {
          bag = ids.slice();
          for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [bag[i], bag[j]] = [bag[j], bag[i]];
          }
          if (bag[bag.length - 1] === previous) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
        }
        const next = bag[bag.length - 1];
        if (commit) { previous = next; bag.pop(); }
        return next;
      },
      delay(mode) { return mode === 'demo' ? 8000 : 3300000 + Math.floor(random() * 600001); },
      shouldSwitchOnClick(now, commit = true) {
        if (now - lastClickSwitch < 600000 || random() >= .1) return false;
        if (commit) lastClickSwitch = now;
        return true;
      },
      markClickSwitch(now) { lastClickSwitch = now; }
    };
  }
  if (typeof module !== 'undefined') module.exports = { createRotation };
  else root.createBuddyRotation = createRotation;
})(typeof window === 'undefined' ? globalThis : window);
