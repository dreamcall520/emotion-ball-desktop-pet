const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
function run(saved, unavailable = false) {
  const element = () => ({ dataset: {}, handlers: {}, attributes: {},
    addEventListener(name, fn) { this.handlers[name] = fn; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { if (name === 'data-theme') delete this.dataset.theme; },
    contains(target) { return target === this; }, focus() { this.focused = true; }
  });
  const root = element(), theme = element(), toggle = element(), nav = element(), link = element();
  const classes = new Set();
  nav.classList = { contains: key => classes.has(key), toggle: (key, on) => on ? classes.add(key) : classes.delete(key) };
  const document = Object.assign(element(), { documentElement: root,
    querySelector: selector => ({ '[data-theme-toggle]': theme, '.nav-toggle': toggle })[selector] || null,
    getElementById: id => id === 'site-nav' ? nav : null,
    querySelectorAll: selector => selector === '.site-header a' ? [link] : []
  });
  vm.runInNewContext(source, { document, window: { localStorage: {
    getItem() { if (unavailable) throw Error('blocked'); return saved; }, setItem() {}
  } } });
  return { root, theme, toggle, nav, link, document };
}
for (const value of [null, 'invalid', 'light', 'dark', 'auto']) {
  const { root } = run(value);
  assert.equal(root.dataset.theme, value === 'auto' ? undefined : value === 'dark' ? 'dark' : 'light');
}
assert.equal(run(null, true).root.dataset.theme, 'light');
const state = run(null);
for (const close of [
  () => state.link.handlers.click(),
  () => state.document.handlers.click({ target: {} }),
  () => state.document.handlers.keydown({ key: 'Escape' })
]) {
  state.toggle.handlers.click();
  assert.equal(state.toggle.attributes['aria-expanded'], 'true');
  close();
  assert.equal(state.toggle.attributes['aria-expanded'], 'false');
}
assert.equal(state.toggle.focused, true);
console.log('Navigation dismissal and default/saved themes passed');
