const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NOW = 1800000000000;
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.className = ''; this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this._text = ''; this.hidden = false; this.open = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  replaceChildren(...children) { this._text = ''; this.children = []; children.forEach(child => this.appendChild(child)); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  insertBefore(child, before) { child.parent = this; const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'class') this.className = String(value); }
  addEventListener(type, callback) { this.events[type] = callback; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const matches = element => selector.startsWith('.') ? element.className.split(' ').includes(selector.slice(1)) : element.tagName === selector;
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  focus() { this.focused = (this.focused || 0) + 1; }
  getBoundingClientRect() { return { top: 0, bottom: 220, height: 220 }; }
  click() { this.events.click?.({ stopPropagation() {}, preventDefault() {} }); }
}
function harness(file, ids, apiName) {
  const nodes = Object.fromEntries(ids.map(id => [id,new Element()]));
  const root = new Element(), calls = [], events = {};
  let receive, color;
  const api = { onModel(callback) { receive = callback; }, onColorMode(callback) { color = callback; },
    openDetail(...args) { calls.push(['openDetail',...args]); }, openThread(...args) { calls.push(['openThread',...args]); },
    close() { calls.push(['close']); }, resize(value) { calls.push(['resize',value]); }, toggleExpanded() { calls.push(['toggle']); } };
  class FixedDate extends Date { static now() { return NOW; } }
  const context = { document: { documentElement: root, getElementById: id => nodes[id], createElement: tag => new Element(tag), createElementNS: (_ns,tag) => new Element(tag) },
    window: { [apiName]: api, petCreditBalanceText: require('../credit-balance'), getComputedStyle() { return { paddingBottom: '13px', borderBottomWidth: '1px' }; }, addEventListener(type,callback) { events[type] = callback; }, requestAnimationFrame(callback) { callback(); }, matchMedia() { return { matches:false, addEventListener() {}, removeEventListener() {} }; } }, Date: FixedDate };
  if (apiName === 'petCodexDetails') {
    const header = new Element(); header.className = 'panel-header';
    const tools = new Element(); tools.className = 'panel-tools';
    tools.replaceChildren(nodes['details-back'],nodes['details-close']);
    header.replaceChildren(nodes['details-title'],tools);
    nodes['details-panel'].replaceChildren(header,nodes['details-content']);
  }
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'..',file),'utf8'),context);
  return { nodes, root, calls, receive: value => receive(value), color: (...args) => color(...args), events };
}
const item = (windowMinutes,remaining = 44) => ({label:'Codex',windowMinutes,remaining,resetsAt:NOW+10800000,pace:{state:'fast',remainingTimePercent:60}});
const cardIds = ['quota-label','status','summary','items','overflow','reset-time','reset-credits','compact-product','compact-period','secondary-quota','secondary-period','secondary-value','secondary-progress','secondary-reset','extra-credits','credits-balance','credits-unit','codex-expanded'];
const detailIds = ['details-panel','details-title','details-content','details-close','details-back'];

test('v20 单双周期保留真实值；全局机会仅一处，未知数量不显示0，按钮不切换收起',() => {
  const h = harness('quota-label-renderer.js',cardIds,'petQuotaLabel');
  h.receive({state:'ready',expanded:true,items:[item(300),item(10080,62)],activity:{runningCount:null,unreadCount:1},resetCreditsAvailable:2,extraCredits:{state:'balance',balance:'2480'}});
  const expanded = h.nodes['codex-expanded'];
  assert.equal(expanded.querySelectorAll('.v20-period').length,2);
  assert.equal(expanded.querySelector('.v20-periods').className,'v20-periods dual');
  assert.equal(expanded.querySelectorAll('button').filter(button => button.dataset.action === 'opportunities').length,1);
  assert.match(expanded.textContent,/本周期剩余/);
  assert.match(expanded.textContent,/剩余额度 2,480.00/);
  assert.match(expanded.textContent,/进行中—待查看1/);
  expanded.querySelectorAll('button').find(button => button.dataset.action === 'trend').click();
  assert.deepEqual(h.calls,[['openDetail','trend',300]]);
  h.receive({state:'ready',expanded:true,items:[item(10080)],activity:{runningCount:0,unreadCount:0}});
  assert.equal(expanded.querySelectorAll('.v20-period').length,1);
  assert.match(expanded.textContent,/重置机会 暂未提供/);
  assert.match(expanded.textContent,/进行中0待查看0/);
});

test('重置未知与明确0区分，历史默认折叠且空态不按count造行',() => {
  const h = harness('codex-details-renderer.js',detailIds,'petCodexDetails');
  const base = {action:'opportunities',items:[item(300)],period:300,resetOpportunities:null};
  h.receive(base);
  assert.match(h.nodes['details-content'].textContent,/当前可用暂未提供.*到期明细暂未提供/);
  assert.equal(h.nodes['details-content'].querySelector('.opportunity-history').open,false);
  assert.match(h.nodes['details-content'].querySelector('.opportunity-history').textContent,/账户历史 · 未同步.*账户历史暂未同步/);
  h.receive({...base,resetCreditsAvailable:0,resetOpportunities:[],resetHistory:[{state:'expired',status:'available',expiresAt:NOW-60000}]});
  assert.match(h.nodes['details-content'].textContent,/暂无重置机会/);
  assert.equal(h.nodes['details-content'].querySelector('.opportunity-history').open,false);
  assert.match(h.nodes['details-content'].textContent,/已过期/);
  h.receive({...base,resetCreditsAvailable:9,resetOpportunities:[{status:'available',expiresAt:NOW+60000}],resetDetailsPartial:true});
  assert.equal(h.nodes['details-content'].querySelectorAll('li').length,2); // header + one actual row
  assert.match(h.nodes['details-content'].textContent,/仅返回部分明细/);
  assert.doesNotMatch(h.nodes['details-content'].textContent,/机会范围与到期时间以 Codex 返回信息为准/);
});

test('账户过去30天事件与本机过期观察独立；查询失败/partial不冒充零历史',() => {
  const h = harness('codex-details-renderer.js',detailIds,'petCodexDetails');
  const base = {action:'opportunities',resetCreditsAvailable:0,resetOpportunities:[],resetHistory:[{state:'expired',status:'available',expiresAt:NOW-60000}],
    accountResetHistory:{state:'ready',updatedAt:NOW,events:[{kind:'granted',occurredAt:NOW-3600000},{kind:'redeemed',occurredAt:NOW-600000}]}};
  h.receive(base);
  const account = h.nodes['details-content'].querySelector('.opportunity-history');
  assert.match(account.textContent,/账户历史 · 过去 30 天 · 2.*发生时间.*已获得.*已使用/);
  assert.doesNotMatch(account.textContent,/已过期/);
  assert.match(h.nodes['details-content'].querySelector('.local-opportunity-history').textContent,/本机观察记录 · 1.*已过期/);
  h.receive({...base,accountResetHistory:{state:'error',events:[]}});
  assert.match(h.nodes['details-content'].querySelector('.opportunity-history').textContent,/未同步.*不代表账户没有记录/);
  assert.doesNotMatch(h.nodes['details-content'].querySelector('.opportunity-history').textContent,/· 0|暂无获得或使用/);
  h.receive({...base,accountResetHistory:{state:'partial',events:[]}});
  assert.doesNotMatch(h.nodes['details-content'].querySelector('.opportunity-history').textContent,/暂无获得或使用/);
  h.receive({...base,accountResetHistory:{state:'ready',events:[]}});
  assert.match(h.nodes['details-content'].querySelector('.opportunity-history').textContent,/过去 30 天 · 0 条.*暂无获得或使用记录/);
});

test('趋势只画已采样数据；单周期无切换，双周期切换传真实分钟数，预测不足显示无法预估',() => {
  const h = harness('codex-details-renderer.js',detailIds,'petCodexDetails');
  const base = {action:'trend',period:300,items:[item(300)],trend:{windowMinutes:300,resetsAt:NOW+10800000,samples:[{at:NOW-7200000,remaining:100},{at:NOW-3600000,remaining:78},{at:NOW,remaining:44}],forecast:{state:'unknown'}}};
  h.receive(base);
  assert.equal(h.nodes['details-panel'].querySelector('.trend-tabs'),null);
  const observed = h.nodes['details-content'].querySelector('.observed-line');
  assert.match(observed.attributes.d,/L158\.0 66\.8$/);
  assert.doesNotMatch(observed.attributes.d,/350/);
  assert.match(h.nodes['details-content'].textContent,/暂无法预估额度用完时间.*连续用量记录不足，稍后再查看/);
  h.receive({...base,trend:{...base.trend,forecast:{state:'unknown',summary:'暂无法预估额度用完时间',detail:'用量尚未更新，稍后再看'}}});
  assert.match(h.nodes['details-content'].textContent,/暂无法预估额度用完时间.*用量尚未更新，稍后再看/);
  h.receive(base);
  assert.match(h.nodes['details-content'].querySelector('.chart-updated').textContent,/^更新 /);
  assert.match(h.nodes['details-content'].querySelector('.chart-updated').title,/已记录至/);
  assert.equal(h.nodes['details-content'].querySelector('.record-note'),null);
  assert.equal(h.nodes['details-content'].querySelector('.reset-chevron').textContent,'›');
  assert.equal(h.nodes['details-content'].querySelector('.reset-chevron').attributes['aria-hidden'],'true');
  const css = fs.readFileSync(path.resolve(__dirname,'../codex-details.css'),'utf8');
  assert.match(css,/\.chart-legend \.time-line\s*\{[^}]*border-top:\s*1\.3px dashed/);
  assert.match(css,/\.trend-chart \.time-path\s*\{[^}]*stroke-dasharray:\s*4 3/);
  const denseSamples = Array.from({length:61},(_sample,index) => ({at:NOW-7200000+index*120000,remaining:100-index*56/60}));
  h.receive({...base,trend:{...base.trend,samples:denseSamples}});
  const points = h.nodes['details-content'].querySelectorAll('.point');
  assert.ok(points.length <= 8);
  assert.equal(points[0].attributes.r,'3');
  assert.equal(points.at(-1).attributes.r,'3');
  assert.equal(points[0].attributes.cx,'30');
  assert.equal(points.at(-1).attributes.cx,'158');
  assert.ok(points.every(point => point.querySelector('title').textContent));
  assert.equal((h.nodes['details-content'].querySelector('.observed-line').attributes.d.match(/L/g)||[]).length,denseSamples.length-1);
  h.receive({...base,items:[item(300),item(10080)],trend:{...base.trend,forecast:{state:'estimate',status:'safe',summary:'额度充裕',detail:'预计够用到重置',exhaustsAt:null}}});
  assert.equal(h.nodes['details-panel'].querySelector('.trend-tabs').children.length,2);
  h.nodes['details-panel'].querySelector('.trend-tabs').children[1].click();
  assert.ok(h.calls.some(call => JSON.stringify(call) === JSON.stringify(['openDetail','trend',10080])));
  assert.match(h.nodes['details-content'].textContent,/额度充裕.*预计够用到重置/);
  assert.doesNotMatch(h.nodes['details-content'].textContent,/预计约.*用完/);
});

test('待查看只通过打开具体会话导航；主题、返回与Escape调用对应桥接',() => {
  const h = harness('codex-details-renderer.js',detailIds,'petCodexDetails');
  h.receive({action:'results',appearance:'dark',activity:{unreadCount:1},results:[{id:'thread-1',turnId:'turn-1',title:'结果 <script>不可执行</script>',state:'completed'}],returnToTrend:true,returnPeriod:10080});
  assert.equal(h.calls.filter(call => call[0] === 'openThread').length,0);
  h.nodes['details-content'].querySelector('.activity-item').click();
  assert.deepEqual(h.calls.find(call => call[0] === 'openThread'),['openThread','thread-1','turn-1']);
  h.nodes['details-back'].click();
  assert.deepEqual(h.calls.filter(call => call[0] === 'openDetail').at(-1),['openDetail','trend',10080]);
  h.color('accessible','dark');
  assert.equal(h.root.dataset.colorMode,'accessible');
  assert.equal(h.root.dataset.accessibleAppearance,'dark');
  h.events.keydown({key:'Escape',preventDefault() {}});
  assert.ok(h.calls.some(call => call[0] === 'close'));
  assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname,'../codex-details-renderer.js'),'utf8'),/innerHTML/);
});
