const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const directory = path.resolve(__dirname, '../demos/quota');
const read = file => fs.readFileSync(path.join(directory, file), 'utf8');
const origin = 'https://qiuqiu.pet';
const now = new Date(2026, 9, 7, 12).getTime();
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}

// Minimal DOM adapted from public v0.4.4 desktop-pet/tests/codex-details-r2.test.js.
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.className = ''; this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this.style = {}; this._text = ''; }
  get parentElement() { return this.parent || null; }
  get classList() { return { contains: value => this.className.split(/\s+/).includes(value) }; }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  replaceChildren(...children) { this._text = ''; [...this.children].forEach(child => child.remove()); this.append(...children); }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  prepend(...children) { [...children].reverse().forEach(child => this.insertBefore(child, this.children[0])); }
  appendChild(child) { child.remove(); child.parent = this; this.children.push(child); return child; }
  insertBefore(child, before) { child.remove(); child.parent = this; const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); return child; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'class') this.className = String(value); }
  getAttribute(key) { if (key === 'open') return this.open ? '' : null; return this.attributes[key] ?? (key.startsWith('data-') ? this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : null) ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, callback) { this.events[type] = callback; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const parts = selector.split(/\s+/), matches = (child, part) => {
      const attribute = part.match(/\[([^=\]]+)(?:="([^"]*)")?\]$/);
      const [tag, ...classes] = part.replace(/\[.*\]$/, '').split('.');
      return (!tag || child.tagName === tag) && classes.every(value => child.classList.contains(value))
        && (!attribute || (attribute[2] === undefined ? child.getAttribute(attribute[1]) !== null : child.getAttribute(attribute[1]) === attribute[2]));
    };
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    if (selector === '*') return descendants;
    return descendants.filter(child => {
      if (!matches(child, parts.at(-1))) return false;
      let ancestor = child.parentElement;
      for (let index = parts.length - 2; index >= 0; index--) {
        while (ancestor && !matches(ancestor, parts[index])) ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    });
  }
  getBoundingClientRect() { return { top: 0, bottom: 220, height: 220, width: 368 }; }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
}
function nodesFor(html) {
  return Object.fromEntries([...read(html).matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"/g)].map(([, tag, id]) => [id, Object.assign(new Element(tag), { id })]));
}
function events() {
  const listeners = {};
  return { addEventListener: (type, fn) => (listeners[type] ||= []).push(fn), fire: (type, event) => (listeners[type] || []).forEach(fn => fn(event)) };
}
function mount() {
  const incoming = [], outgoing = [], sent = [], hostWindow = events(), childWindow = events();
  const upstream = { postMessage() {} }, hostNodes = nodesFor('index.html'), root = new Element();
  const main = new Element(), cards = new Element(), detail = new Element(); cards.clientWidth = 196;
  const hostDocument = { documentElement: root, getElementById: id => hostNodes[id], addEventListener() {},
    querySelector: selector => ({ main, '.demo-cards': cards, '.demo-detail': detail })[selector], querySelectorAll: () => [] };
  const names = { quota: 'quota-frame', details: 'detail-frame', 'api-label': 'api-label-frame', 'api-report': 'api-report-frame' };
  for (const [kind, id] of Object.entries(names)) {
    const frame = hostNodes[id]; new Element().appendChild(frame); frame.sent = [];
    frame.contentWindow = { postMessage(packet, target) {
      assert.equal(target, origin); const data = structuredClone(packet); frame.sent.push(data);
      if (kind === 'details') incoming.push(data);
    } };
  }
  const receiveHost = (data, source = hostNodes['detail-frame'].contentWindow, eventOrigin = origin) => hostWindow.fire('message', { data, source, origin: eventOrigin });
  vm.runInNewContext(read('demo.js'), { document: hostDocument, window: hostWindow, parent: upstream,
    location: { origin, search: '?appearanceDemo=1' }, URLSearchParams, Date: Clock,
    requestAnimationFrame: fn => fn(), ResizeObserver: class { observe() {} } });

  const nodes = nodesFor('codex-details.html'), childRoot = new Element(), body = new Element('body');
  const header = new Element('header'), tools = new Element('nav'); header.className = 'panel-header'; tools.className = 'panel-tools';
  tools.append(nodes['details-back'], nodes['details-close']);
  header.append(nodes['details-title'], nodes['details-read-all'], tools);
  nodes['details-panel'].append(header, nodes['details-content']); body.append(nodes['details-panel']);
  const domEvents = events(), document = { documentElement: childRoot, body,
    getElementById: id => nodes[id], createElement: tag => Object.assign(new Element(tag), { ownerDocument: document }),
    createElementNS: (_, tag) => document.createElement(tag), addEventListener: domEvents.addEventListener };
  Object.values(nodes).forEach(node => { node.ownerDocument = document; });
  const host = { postMessage(data, target) { assert.equal(target, origin); outgoing.push(structuredClone(data)); } };
  const computedStyle = () => ({ paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px' });
  Object.assign(childWindow, { getComputedStyle: computedStyle, requestAnimationFrame: fn => fn(), setTimeout: () => 1, clearTimeout() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  const context = vm.createContext({ window: childWindow, document, parent: host, Date: Clock, URLSearchParams,
    location: { origin, pathname: '/demos/quota/codex-details.html', search: '' } });
  // Run the same bridge and native modules used by the real child HTML.
  for (const file of ['demo-bridge.js', '../ui-theme.js', 'color-mode.js', 'credit-balance.js', 'quota-trend-curve.js', 'quota-daily-model.js']) vm.runInContext(read(file), context, { filename: file });
  Object.assign(context, { TrendCurve: childWindow.TrendCurve, TrendDaily: childWindow.TrendDaily });
  vm.runInContext(read('codex-details-renderer.js'), context, { filename: 'codex-details-renderer.js' });
  const receiveChild = (data, source = host, eventOrigin = origin) => childWindow.fire('message', { data, source, origin: eventOrigin });
  function pump() {
    let turns = 0;
    while (outgoing.length || incoming.length) {
      assert.ok(++turns < 200, 'message exchange must settle');
      while (outgoing.length) { const packet = outgoing.shift(); sent.push(packet); receiveHost(packet); }
      while (incoming.length) receiveChild(incoming.shift());
    }
  }
  domEvents.fire('DOMContentLoaded'); pump();
  const model = () => hostNodes['detail-frame'].sent.filter(packet => packet.type === 'qiuqiu-quota-model').at(-1).model;
  return { nodes, hostNodes, root: childRoot, api: childWindow.petCodexDetails, sent, pump, model, receiveHost, receiveChild,
    state: () => hostWindow.QiuqiuQuotaDemo.getState(), top: data => receiveHost(data, upstream),
    scenario: value => hostNodes['demo-scenario'].events.change({ target: { value } }) };
}

test('actual quota demo models drive native views, expiry clocks, periods and trusted memory-only read clearing', async () => {
  const h = mount(), content = h.nodes['details-content'], panel = h.nodes['details-panel'];
  const select = view => content.querySelector(`[data-view="${view}"]`).events.click();
  const period = minutes => { panel.querySelector(`[data-period="${minutes}"]`).events.click(); h.pump(); };
  const continuous = () => {
    const line = content.querySelector('.observed-line');
    assert.equal((line.getAttribute('d').match(/M/g) || []).length, 1, 'the example uses one continuous observed curve');
    assert.equal(content.querySelector('.unrecorded-line'), null);
    const model = h.model(), samples = model.trend.samples;
    assert.ok((samples.at(-1).at - samples[0].at) / (model.period * 60000) >= .6, 'the observed curve covers at least 60% of the cycle');
  };
  const conciseDailyLabels = () => assert.ok(content.querySelectorAll('.daily-value').every(label => /^\d+(?:\.\d)?%$/.test(label.textContent)), 'daily values show at most one decimal');
  assert.equal(h.model().period, 10080);
  assert.equal(content.querySelector('.chart-block').dataset.view, 'line');
  continuous();
  const clocks = content.querySelectorAll('.reset-event-trigger');
  assert.equal(clocks.length, 2);
  assert.ok(clocks.every(clock => clock.querySelector('svg circle') && /重置机会到期/.test(clock.getAttribute('aria-label'))));
  assert.match(content.querySelector('.reset-event-popup').textContent, /到期时预计余量：暂无法预估/);
  select('daily');
  assert.equal(content.querySelector('.chart-block').dataset.view, 'daily');
  assert.equal(content.querySelector('[data-view="daily"]').getAttribute('aria-selected'), 'true');
  assert.equal(content.querySelector('.chart-status').textContent, '仅供参考');
  assert.match(content.querySelector('.daily-chart').getAttribute('aria-label'), /不是每日末余额/);
  // At local noon, the shipped five-day weekly example records 4.1% since midnight.
  assert.equal(Number(content.querySelectorAll('.daily-point').at(-1).getAttribute('data-amount')), 4.1);
  conciseDailyLabels();
  assert.equal(content.querySelector('.reset-markers'), null);
  period(300); assert.equal(h.model().period, 300);
  assert.equal(content.querySelector('.chart-block').dataset.view, 'line');
  continuous();
  select('daily'); assert.equal(Number(content.querySelector('.daily-point').getAttribute('data-amount')), 18);
  conciseDailyLabels();
  period(10080); assert.equal(content.querySelector('.chart-block').dataset.view, 'daily', 'each period retains its own view');
  h.scenario('unknown'); h.pump();
  for (const view of ['line', 'daily', 'line']) {
    select(view);
    assert.equal(content.querySelectorAll('.empty-state').length, 1);
    assert.equal(content.querySelector('.empty-state').textContent, view === 'line' ? '暂无已采样趋势' : '暂无已记录用量');
    assert.equal(content.querySelector('.reset-markers'), null);
  }
  h.scenario('balanced'); h.pump();
  let color;
  h.api.onColorMode((...args) => { color = args; });
  assert.deepEqual(color, ['standard', 'light', 'blue']);
  h.top({ type: 'qiuqiu-demo-theme', appearance: 'dark', colorMode: 'accessible', uiTheme: 'green' }); h.pump();
  assert.deepEqual(color, ['accessible', 'dark', 'green']);
  assert.equal(h.root.dataset.uiTheme, 'green'); assert.equal(h.root.dataset.accessibleAppearance, 'dark');
  const spoof = { type: 'qiuqiu-demo-theme', appearance: 'light', colorMode: 'standard', uiTheme: 'blue' };
  h.receiveChild(spoof, {}); h.receiveChild(spoof, undefined, 'https://foreign.test');
  assert.deepEqual(color, ['accessible', 'dark', 'green']);

  h.api.openDetail('results', 10080); h.pump();
  assert.equal(h.state().unread, true); assert.equal(h.nodes['details-read-all'].hidden, false);
  const stale = h.api.markAllRead(h.model().generation - 1); h.pump();
  assert.equal(await stale, false); assert.equal(h.state().unread, true);
  const before = structuredClone(h.model()), generation = before.generation;
  const forged = { type: 'qiuqiu-quota-action', kind: 'details', action: 'mark-all-read', generation };
  h.receiveHost(forged, {}); h.receiveHost(forged, undefined, 'https://foreign.test');
  h.receiveHost({ ...forged, kind: 'quota' }); h.pump();
  assert.equal(h.state().unread, true);
  const clearing = h.nodes['details-read-all'].events.click();
  let resolved = false; clearing.then(() => { resolved = true; });
  const fakeReply = { type: 'qiuqiu-quota-read-result', generation, success: true };
  h.receiveChild(fakeReply, {}); h.receiveChild(fakeReply, undefined, 'https://foreign.test');
  await Promise.resolve(); assert.equal(resolved, false, 'foreign confirmations cannot settle the clear request');
  assert.equal(h.state().unread, true, 'clear only takes effect after the trusted parent handles it');
  h.pump(); await clearing;
  assert.equal(h.sent.filter(packet => packet.action === 'mark-all-read').at(-1).generation, generation);
  assert.equal(h.state().unread, false); assert.equal(h.model().results.length, 0);
  assert.equal(h.model().activity.unreadCount, 0); assert.equal(h.nodes['details-read-all'].hidden, true);
  assert.match(content.textContent, /暂无待查看结果/);
  assert.deepEqual(h.model().tasks, before.tasks); assert.deepEqual(h.model().items, before.items);
  assert.deepEqual(h.model().trend, before.trend); assert.deepEqual(h.model().resetOpportunities, before.resetOpportunities);
  assert.equal(mount().state().unread, true, 'a fresh demo reconstructs its sample memory; no visitor data is read or persisted');
});
