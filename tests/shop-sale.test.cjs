const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../shop-sale.js'), 'utf8');
const endsAt = Date.parse('2026-11-12T00:00:00+08:00');

function run(now) {
  const price = original => ({ dataset: { originalPrice: String(original) }, textContent: String(original) });
  const prices = [120, 66, 88, 50, 60].map(price);
  const savings = [120, 66, 88, 50, 60].map(price);
  const product = { dataset: { productOriginal: '50' } };
  const detailPrice = price(50), detailSaving = price(50), originalPrice = {};
  prices.push(detailPrice);
  savings.push(detailSaving);
  const state = { now, variant: { dataset: { variantPrice: '50', variantOriginal: '50' } }, timer: null, events: [] };
  const documentHandlers = {}, windowHandlers = {};
  const document = {
    documentElement: { dataset: {} },
    querySelector: selector => ({
      '[data-product-title]': product,
      'input[name="variant"]:checked': state.variant,
      '.detail-price [data-shop-price]': detailPrice,
      '.detail-copy [data-sale-saving]': detailSaving,
      '.original-price [data-original-price]': originalPrice
    })[selector],
    querySelectorAll: selector => selector === '[data-shop-price]' ? prices : selector === '[data-sale-saving]' ? savings : [],
    addEventListener: (name, callback) => { documentHandlers[name] = callback; },
    dispatchEvent: event => state.events.push(event.type)
  };
  const window = { addEventListener: (name, callback) => { windowHandlers[name] = callback; } };
  vm.runInNewContext(source, {
    document, window, Event: class { constructor(type) { this.type = type; } },
    Date: { parse: Date.parse, now: () => state.now },
    setTimeout: (callback, delay) => { state.timer = { callback, delay }; return 1; },
    clearTimeout: () => { state.timer = null; }
  });
  return { state, root: document.documentElement, prices, savings, product, detailPrice, detailSaving, originalPrice, window, documentHandlers, windowHandlers };
}

const active = run(endsAt - 1);
assert.equal(active.root.dataset.shopSale, 'active');
assert.deepEqual(active.prices.slice(0, 5).map(price => price.textContent), [96, 52.8, 70.4, 40, 48]);
assert.deepEqual(active.savings.slice(0, 5).map(saving => saving.textContent), ['立省 ¥24', '立省 ¥13.2', '立省 ¥17.6', '立省 ¥10', '立省 ¥12']);
assert.equal(active.state.timer.delay, 1);
active.state.variant.dataset = { variantPrice: '60', variantOriginal: '60' };
active.window.updateShopSale();
assert.equal(active.product.dataset.productPrice, '48');
assert.equal(active.product.dataset.productSale, '双十一 8 折');
assert.equal(active.detailPrice.textContent, 48);
assert.equal(active.detailSaving.textContent, '立省 ¥12');
assert.equal(active.originalPrice.textContent, '60');

active.state.now = endsAt;
active.state.timer.callback();
assert.equal(active.root.dataset.shopSale, undefined);
assert.deepEqual(active.prices.slice(0, 5).map(price => price.textContent), ['120', '66', '88', '50', '60']);
assert.equal(active.product.dataset.productPrice, '60');
assert.equal(active.product.dataset.productSale, undefined);
assert.equal(active.state.timer, null);
assert.ok(active.state.events.includes('shop-sale-change'));

for (const now of [endsAt, endsAt + 1]) {
  const expired = run(now);
  assert.equal(expired.root.dataset.shopSale, undefined);
  assert.equal(expired.product.dataset.productPrice, '50');
  assert.equal(expired.state.timer, null);
}
const resume = run(endsAt - 10000);
resume.state.now = endsAt + 10000;
resume.documentHandlers.visibilitychange();
assert.equal(resume.product.dataset.productPrice, '50');
resume.state.now = endsAt - 10000;
resume.windowHandlers.pageshow();
assert.equal(resume.product.dataset.productPrice, '40');
console.log('Double 11: prices, savings, sizes, exact Shanghai cutoff, open-tab expiry and resume checks passed');
