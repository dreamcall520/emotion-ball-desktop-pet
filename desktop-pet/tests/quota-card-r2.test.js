const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '../quota-label-renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../quota-label.css'), 'utf8');
const creditBalanceText = require('../credit-balance');
const NOW = 1800000000000;

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.className = ''; this.dataset = {}; this.attributes = {};
    this.children = []; this.events = {}; this._text = '';
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  replaceChildren(...children) { this._text = ''; this.children = []; children.forEach(child => this.appendChild(child)); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'class') this.className = String(value); }
  addEventListener(key, callback) { (this.events[key] ||= []).push(callback); }
  click() {
    const event = { target: this, stopped: false, stopPropagation() { this.stopped = true; } };
    for (let current = this; current; current = current.parent) {
      for (const callback of current.events.click || []) callback(event);
      if (event.stopped) break;
    }
  }
}
const all = root => root.children.flatMap(child => [child, ...all(child)]);
const byClass = (root, value) => all(root).filter(element => element.className.split(' ').includes(value));

function harness(appearance, colorMode) {
  const ids = ['quota-label', 'status', 'summary', 'items', 'overflow', 'reset-time', 'reset-credits',
    'compact-product', 'compact-period', 'secondary-quota', 'secondary-period', 'secondary-value',
    'secondary-progress', 'secondary-reset', 'extra-credits', 'credits-balance', 'credits-unit', 'codex-expanded'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
  const root = new Element(); root.dataset.colorMode = colorMode; root.dataset.accessibleAppearance = appearance;
  nodes['quota-label'].appendChild(nodes['codex-expanded']);
  const calls = []; let receive;
  class FixedDate extends Date { static now() { return NOW; } }
  vm.runInNewContext(renderer, {
    Date: FixedDate,
    document: { documentElement: root, getElementById: id => nodes[id],
      createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag) },
    window: { petCreditBalanceText: creditBalanceText, addEventListener() {}, petQuotaLabel: {
      onModel(callback) { receive = callback; }, openDetail(...args) { calls.push(['detail', ...args]); },
      toggleExpanded() { calls.push(['toggle']); }
    } }
  });
  return { calls, root, card: nodes['codex-expanded'], receive };
}
const item = minutes => ({ label: 'Codex', windowMinutes: minutes, remaining: 60,
  resetsAt: NOW + 3600000, pace: { state: 'balanced', remainingTimePercent: 60 } });

test('R2 单/双周期标准与色弱浅/深：次数、图标、标题和数字共用原按钮动作', async t => {
  for (const appearance of ['light', 'dark']) for (const colorMode of ['standard', 'accessible']) {
    for (const dual of [false, true]) await t.test(`${appearance}/${colorMode}/${dual ? '双' : '单'}周期`, () => {
      const h = harness(appearance, colorMode);
      const show = count => h.receive({ state: 'ready', appearance, expanded: true,
        items: dual ? [item(300), item(10080)] : [item(300)], resetCreditsAvailable: count,
        extraCredits: { state: 'balance', balance: '2480.00' } });
      show(2);
      assert.equal(byClass(h.card, 'v20-pace').length, dual ? 2 : 1);
      assert.ok(byClass(h.card, 'v20-pace').every(pace => pace.className.includes('balanced')));
      const reset = byClass(h.card, 'v20-opportunities')[0];
      const count = byClass(reset, 'v20-reset-count')[0];
      const clock = byClass(reset, 'v20-reset-clock')[0];
      assert.equal(reset.tagName, 'button'); assert.equal(reset.type, 'button');
      assert.equal(count.textContent, '2 次'); assert.equal(count.dataset.available, 'true');
      assert.equal(reset.children.at(-1), clock); assert.equal(clock.attributes['aria-hidden'], 'true');
      assert.equal(clock.attributes.focusable, 'false'); assert.equal(clock.children.length, 2);
      assert.match(reset.attributes['aria-label'], /2 次.*查看详情/);
      reset.children[0].click(); count.click(); clock.click();
      assert.deepEqual(h.calls, Array.from({ length: 3 }, () => ['detail', 'opportunities', 300]));
      const credit = byClass(h.card, 'v20-credit')[0];
      assert.equal(credit.tagName, 'button'); assert.equal(credit.type, 'button');
      assert.equal(byClass(credit, 'v20-credit-balance')[0].textContent, '2,480.00');
      credit.children[0].click(); byClass(credit, 'v20-credit-balance')[0].click();
      assert.deepEqual(h.calls.slice(-2), [['detail', 'credits', 300], ['detail', 'credits', 300]]);
      assert.equal(h.calls.some(call => call[0] === 'toggle'), false);
      for (const [value, expected] of [[0, '0 次'], [undefined, '暂未提供']]) {
        show(value);
        const current = byClass(h.card, 'v20-reset-count')[0];
        assert.equal(current.textContent, expected); assert.equal(current.dataset.available, 'false');
        assert.equal(byClass(h.card, 'v20-reset-clock').length, 1);
      }
    });
  }
});

test('R2 独立收起按钮一次toggle且不会触发卡片冒泡，保留caption', () => {
  const h = harness('light', 'standard');
  h.receive({ state: 'ready', expanded: true, items: [item(300)] });
  const collapse = byClass(h.card, 'v20-collapse')[0];
  assert.equal(collapse.tagName, 'button'); assert.equal(collapse.type, 'button');
  assert.equal(collapse.attributes['aria-label'], '收起额度卡片'); assert.equal(collapse.children[0].tagName, 'svg');
  assert.equal(byClass(h.card, 'v20-caption')[0].textContent, '本周期剩余');
  collapse.click(); assert.deepEqual(h.calls, [['toggle']]);
});

test('R2 均衡及可用“xx 次”共享主题蓝，标题/零/未知中性，hover保留鼠标提示', () => {
  assert.match(css, /--quota-action-blue:\s*#356bbf/);
  assert.match(css, /:root\[data-appearance="dark"\]\s*\{[^}]*--quota-action-blue:\s*#b8d1f3/);
  assert.match(css, /:root\[data-appearance="system"\]\s*\{[^}]*--quota-action-blue:\s*#b8d1f3/);
  assert.match(css, /:root\[data-color-mode="accessible"\]\[data-accessible-appearance\]\s*\{[^}]*--quota-action-blue:\s*var\(--accessible-blue\)/);
  assert.match(css, /\.v20-pace\.balanced\s*\{\s*color:\s*var\(--quota-action-blue\)/);
  assert.match(css, /\.v20-shared \.v20-reset-count\s*\{\s*color:\s*var\(--quota-subtle\)/);
  assert.match(css, /\.v20-shared \.v20-reset-count\[data-available="true"\]\s*\{\s*color:\s*var\(--quota-action-blue\)/);
  assert.match(css, /\.v20-shared button:hover\s*\{[^}]*background:/);
  assert.doesNotMatch(css, /\.v20-shared button:hover\s*\{[^}]*text-decoration:\s*underline/);
  assert.match(css, /\.v20-shared button > :is\(span, b\)\s*\{\s*cursor:\s*inherit/);
  assert.match(css, /\.v20-reset-clock\s*\{[^}]*fill:\s*none[^}]*stroke:\s*currentColor/);
});

test('R2 余额只复用共享格式器，renderer Node出口保留同一个function', () => {
  assert.equal(require('../quota-label-renderer').creditBalanceText, creditBalanceText);
  assert.doesNotMatch(renderer, /function creditBalanceText\(|BigInt\(/);
  assert.match(renderer, /window\.petCreditBalanceText/);
  assert.match(renderer, /require\('\.\/credit-balance'\)/);
});
