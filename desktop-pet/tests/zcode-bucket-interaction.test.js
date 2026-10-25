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
  remaining: 70, resetsAt: Date.now() + 86400000, periodKind: id < 2 ? 'one_time' : 'daily' }));

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
  assert.equal(ready.cells[0].children[0].children[0].textContent, '1024活动');
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


test('已知来源用完整中文，每桶保留原模型，底部明细是独立整行入口', () => {
  const h = fixture({sourceId:'zcode',state:'ready',expanded:true,items:items(4)});
  assert.deepEqual(h.cells.map(cell=>cell.children[0].children[0].textContent),['1024活动','1024活动','每日体验','每日体验']);
  assert.deepEqual(h.cells.map(cell=>cell.children[0].children[1].textContent),items(4).map(item=>item.label));
  const entry=h.nodes['codex-expanded'].children[2].children[0].children[0];
  assert.equal(entry.tagName,'button'); assert.equal(entry.textContent,'查看额度明细›');
  entry.click(); assert.deepEqual(h.calls,[['detail','quota','bucket-0']]);
  assert.equal(h.nodes['codex-expanded'].children[2].children[1].tagName,'nav');
  const single=fixture({sourceId:'zcode',state:'ready',expanded:true,items:items(1)});
  assert.equal(single.cells[0].children[0].children[0].textContent,'1024活动');
  assert.equal(single.cells[0].children[0].children[1].textContent,'GLM-5.3');
});


test('ZCode 真余量保留1位精度，接近满额/用尽不误显示100或0，收起/展开/aria一致，Codex不改', () => {
  for(const [remaining,expected] of [[99.8706,'99.9%'],[99.99,'<100%'],[99.95,'<100%'],[.01,'<0.1%'],[100,'100%'],[0,'0%'],[50,'50%']]) {
    const h=fixture({sourceId:'zcode',state:'ready',expanded:true,items:[{...items(1)[0],remaining}]});
    assert.equal(h.cells[0].children[1].children[0].textContent,expected);
    assert.ok(h.cells[0].attributes['aria-label'].includes(expected));
    assert.ok(h.cells[0].children[2].attributes['aria-valuetext'].startsWith(expected));
    assert.ok(h.nodes.items.children[0].children[2].textContent.startsWith(expected));
    assert.ok(h.nodes.items.children[0].children[3].attributes['aria-valuetext'].startsWith(expected));
    assert.ok(h.nodes.summary.textContent.includes(expected));
  }
  const codex=fixture({state:'ready',expanded:true,items:[{...items(1)[0],remaining:99.8706}]});
  assert.equal(codex.cells[0].children[0].children[0].textContent,'100%');
});


test('ZCode 标准收起行短显示已知模型，完整型号保留title与aria；展开和未知模型保留原名', () => {
  const rows=items(4); const h=fixture({sourceId:'zcode',state:'ready',size:'standard',items:rows});
  assert.deepEqual(h.nodes.items.children.map(row=>row.children[0].textContent),['5.3','5.3 Flash','5.3','5.3 Flash']);
  assert.ok(h.nodes.items.children[1].children[0].title.includes('GLM-5.3-Flash'));
  assert.equal(h.nodes.items.children[1].children[0].attributes['aria-label'],'GLM-5.3-Flash');
  assert.equal(h.cells[1].children[0].children[1].textContent,'GLM-5.3-Flash');
  const unknown=fixture({sourceId:'zcode',state:'ready',items:[{...rows[0],label:'Custom Official Model'}]});
  assert.equal(unknown.nodes.items.children[0].children[0].textContent,'Custom Official Model');
});


test('套餐别名仅限已知名称和周期，未知企业1024套餐和非daily StartPlan保留真实名称', () => {
  const plans=[
    {planName:'企业1024点套餐',periodKind:'unknown'},
    {planName:'ZCode Start Plan',periodKind:'one_time'},
    {planName:'ZCode Start Plan',periodKind:'daily'},
    {planName:'ZCode 1024 Dev Day',periodKind:'one_time'}
  ];
  const h=fixture({sourceId:'zcode',state:'ready',expanded:true,items:plans.map((plan,i)=>({...items(4)[i],...plan}))});
  assert.deepEqual(h.cells.map(cell=>cell.children[0].children[0].textContent),['企业1024点套餐','ZCode Start Plan','每日体验','1024活动']);
});


test('ZCode 仅展示按已知来源分组、每组GLM5.3再Flash，标准收起与展开同序且bucket IPC不变', () => {
  const base=items(4), now=Date.now();
  const rows=[{...base[0],bucketId:'trial-glm',planName:'ZCode Start Plan',periodKind:'daily',label:'GLM-5.3',resetsAt:now+3600000},
    {...base[1],bucketId:'event-flash',planName:'ZCode 1024 Dev Day',periodKind:'one_time',label:'GLM-5.3-Flash',resetsAt:now+7200000},
    {...base[2],bucketId:'event-glm',planName:'ZCode 1024 Dev Day',periodKind:'one_time',label:'GLM-5.3',resetsAt:now+7200000},
    {...base[3],bucketId:'trial-flash',planName:'ZCode Start Plan',periodKind:'daily',label:'GLM-5.3-Flash',resetsAt:now+3600000}];
  const original=rows.map(row=>row.bucketId); const h=fixture({sourceId:'zcode',state:'ready',size:'standard',expanded:true,items:rows});
  assert.deepEqual(h.cells.map(cell=>cell.dataset.period),['trial-glm','trial-flash','event-glm','event-flash']);
  assert.deepEqual(h.nodes.items.children.map(row=>row.children[1].textContent),['每日体验','每日体验','1024活动','1024活动']);
  assert.deepEqual(h.nodes.items.children.map(row=>row.children[0].textContent),['5.3','5.3 Flash','5.3','5.3 Flash']);
  h.cells[1].click(); h.cells[3].click(); assert.deepEqual(h.calls,[['detail','trend','trial-flash'],['detail','trend','event-flash']]);
  assert.deepEqual(rows.map(row=>row.bucketId),original,'input order and source first are unchanged');
  const codex=fixture({state:'ready',expanded:true,items:rows.slice(0,2)});
  assert.equal(codex.cells[1].attributes['aria-label'].startsWith('1天'),true);
});

test('未知来源保留原序，同名已知plan的不同真实周期不合并', () => {
  const now=Date.now(); const rows=[
    {...items(1)[0],bucketId:'unknown-flash',planName:'企业套餐',periodKind:'unknown',label:'GLM-5.3-Flash'},
    {...items(1)[0],bucketId:'period-a-flash',planName:'ZCode Start Plan',periodKind:'daily',label:'GLM-5.3-Flash',resetsAt:now+3600000},
    {...items(1)[0],bucketId:'unknown-glm',planName:'企业套餐',periodKind:'unknown',label:'GLM-5.3'},
    {...items(1)[0],bucketId:'period-b-glm',planName:'ZCode Start Plan',periodKind:'daily',label:'GLM-5.3',resetsAt:now+7200000},
    {...items(1)[0],bucketId:'period-a-glm',planName:'ZCode Start Plan',periodKind:'daily',label:'GLM-5.3',resetsAt:now+3600000}];
  const h=fixture({sourceId:'zcode',state:'ready',expanded:true,items:rows});
  assert.deepEqual(h.cells.map(cell=>cell.dataset.period),['unknown-flash','period-a-glm','period-a-flash','unknown-glm','period-b-glm']);
});


test('相同已知名称/周期但不同官方plan ID保持分组独立', () => {
  const end=Date.now()+3600000,base={...items(1)[0],planName:'ZCode Start Plan',periodKind:'daily',resetsAt:end};
  const rows=[{...base,bucketId:'zcode:plan-a:flash:user-a',label:'GLM-5.3-Flash'},
    {...base,bucketId:'zcode:plan-b:glm:user-b',label:'GLM-5.3'},
    {...base,bucketId:'zcode:plan-a:glm:user-a',label:'GLM-5.3'}];
  const h=fixture({sourceId:'zcode',state:'ready',expanded:true,items:rows});
  assert.deepEqual(h.cells.map(cell=>cell.dataset.period),['zcode:plan-a:glm:user-a','zcode:plan-a:flash:user-a','zcode:plan-b:glm:user-b']);
});
