const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const renderer = fs.readFileSync(path.join(__dirname, '../quota-label-renderer.js'), 'utf8');
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this._text = ''; }
  set textContent(text) { this._text = String(text); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  replaceChildren(...children) { this._text = ''; this.children = []; children.forEach(child => this.appendChild(child)); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(key, callback) { (this.events[key] ||= []).push(callback); }
  click() {
    const event = { stopped: false, stopPropagation() { this.stopped = true; } };
    for (let target = this; target; target = target.parent) {
      for (const callback of target.events.click || []) callback(event);
      if (event.stopped) break;
    }
  }
}
function fixture(model) {
  const nodes = Object.fromEntries(['quota-label','status','summary','items','overflow','codex-expanded','compact-product','compact-period','quota-numbers'].map(id => [id, new Element()]));
  nodes['quota-label'].appendChild(nodes['codex-expanded']);
  let receive; const calls = [];
  vm.runInNewContext(renderer, { document: { documentElement: new Element(), getElementById: id => nodes[id],
    createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag) },
  window: { addEventListener() {}, petQuotaLabel: { onModel(fn) { receive = fn; },
    toggleExpanded() { calls.push(['toggle']); }, openDetail(...args) { calls.push(['detail', ...args]); } } } });
  receive(model); return { nodes, calls, cells: nodes['codex-expanded'].children[1].children };
}
const items = count => Array.from({ length: count }, (_unused, id) => ({ label: id % 2 ? 'GLM-5.3-Flash' : 'GLM-5.3',
  planName: id < 2 ? '1024 活动' : 'Start Plan 体验', bucketId: `bucket-${id}`, windowMinutes: 1440,
  remaining: 70, resetsAt: Date.now() + 86400000, periodKind: 'daily' }));

test('ZCode 1/2/4 桶、标准/小巧、浅/深：整格按钮直接打开对应桶趋势且阻止收起冒泡', () => {
  for (const count of [1, 2, 4]) for (const size of ['standard', 'compact']) for (const appearance of ['light', 'dark']) {
    const h = fixture({ sourceId: 'zcode', state: 'ready', expanded: true, size, appearance, items: items(count) });
    assert.equal(h.cells.length, count);
    for (const [id, cell] of h.cells.entries()) {
      assert.equal(cell.tagName, 'button'); assert.equal(cell.type, 'button');
      assert.equal(cell.dataset.period, `bucket-${id}`); assert.equal(cell.dataset.action, 'trend');
      assert.match(cell.attributes['aria-label'], /GLM-5\.3.*查看.*趋势/);
      assert.ok(cell.title.includes(items(count)[id].planName));
      cell.children[0].children[0].click();
      assert.deepEqual(h.calls.at(-1), ['detail', 'trend', `bucket-${id}`]);
    }
    assert.equal(h.calls.some(row => row[0] === 'toggle'), false);
    assert.equal(h.nodes['quota-label'].dataset.expanded, 'true');
    h.nodes['codex-expanded'].children[0].children[1].children[1].click();
    assert.deepEqual(h.calls.at(-1), ['toggle'], 'dedicated collapse action is unchanged');
  }
});

test('Codex 额度格仍是 section，保留原卡片点击收起而不新增桶跳转', () => {
  const h = fixture({ state: 'ready', expanded: true, items: [{ label: 'Codex', windowMinutes: 300, remaining: 70, resetsAt: Date.now() + 3600000 }] });
  assert.equal(h.cells[0].tagName, 'section'); assert.equal(h.cells[0].type, undefined);
  h.cells[0].children[0].click(); assert.deepEqual(h.calls, [['toggle']]);
});


test('ZCode 成功获取额度时不把记录不足误写成待记录；真实节奏与过期状态仍保留', () => {
  const ready = fixture({ sourceId: 'zcode', state: 'ready', expanded: true, items: items(4) });
  assert.doesNotMatch(ready.nodes['codex-expanded'].textContent, /待记录/);
  assert.match(ready.cells[0].children[0].title, /1024 活动/);
  assert.equal(ready.cells[0].children[0].children[0].textContent, '1024');
  const stale = fixture({ sourceId: 'zcode', state: 'stale', expanded: true, items: items(1) });
  assert.match(stale.nodes['codex-expanded'].textContent, /待更新/);
  const codex = fixture({ state: 'ready', expanded: true, items: items(1) });
  assert.match(codex.nodes['codex-expanded'].textContent, /待记录/);
});


test('ZCode 展开使用今天/明天或月日短时间且明确到期/刷新，title保留准确年月日；Codex仍是倒计时', () => {
  const now = new Date(), today = new Date(now.getFullYear(),now.getMonth(),now.getDate(),23,59).getTime();
  const tomorrow = new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,9,0).getTime();
  const later = new Date(now.getFullYear(),now.getMonth(),now.getDate()+3,9,0).getTime();
  const rows = items(4).map((row,i)=>({...row,resetsAt:[today,tomorrow,later,later][i],periodKind:i%2?'expiry':'daily'}));
  const h = fixture({sourceId:'zcode',state:'ready',expanded:true,items:rows});
  const times = h.cells.map(cell=>cell.children.at(-1));
  assert.equal(times[0].textContent,'今天 23:59刷新'); assert.equal(times[1].textContent,'明天 09:00到期');
  assert.match(times[2].textContent,/^\d{2}\/\d{2}刷新$/); assert.match(times[3].textContent,/^\d{2}\/\d{2}到期$/);
  assert.match(times[3].title,/^\d{4}\/\d{2}\/\d{2} 09:00 到期（本机时间）$/);
  const codex = fixture({state:'ready',expanded:true,items:[{...rows[1],windowMinutes:300}]});
  assert.match(codex.cells[0].children.at(-1).textContent,/后重置/);
});
