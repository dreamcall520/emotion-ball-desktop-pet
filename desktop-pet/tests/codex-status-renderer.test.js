const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NOW = 1800000000000;
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.className = ''; this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this.style = {}; this._text = ''; this.hidden = false; this.open = false; }
  get parentElement() { return this.parent || null; }
  get classList() { return {contains:value => this.className.split(/\s+/).includes(value)}; }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  replaceChildren(...children) { this._text = ''; [...this.children].forEach(child => child.remove()); this.append(...children); }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  prepend(...children) { [...children].reverse().forEach(child => this.insertBefore(child,this.children[0])); }
  appendChild(child) { child.remove(); child.parent = this; this.children.push(child); return child; }
  insertBefore(child, before) { child.remove(); child.parent = this; const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index,0,child); return child; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'class') this.className = String(value); }
  getAttribute(key) { if (key === 'open') return this.open ? '' : null; return this.attributes[key] ?? (key.startsWith('data-') ? this.dataset[key.slice(5).replace(/-([a-z])/g,(_match,letter) => letter.toUpperCase())] : null) ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, callback) { this.events[type] = callback; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const parts = selector.split(/\s+/), matches = (child,part) => {
      const attribute = part.match(/\[([^=\]]+)(?:="([^"]*)")?\]$/);
      const [tag,...classes] = part.replace(/\[.*\]$/,'').split('.');
      return (!tag || child.tagName === tag) && classes.every(value => child.classList.contains(value))
        && (!attribute || (attribute[2] === undefined ? child.getAttribute(attribute[1]) !== null : child.getAttribute(attribute[1]) === attribute[2]));
    };
    const descendants = this.children.flatMap(child => [child,...child.querySelectorAll('*')]);
    if (selector === '*') return descendants;
    return descendants.filter(child => {
      if (!matches(child,parts.at(-1))) return false;
      let ancestor = child.parentElement;
      for (let index = parts.length - 2; index >= 0; index--) {
        while (ancestor && !matches(ancestor,parts[index])) ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    });
  }
  focus() { this.focused = (this.focused || 0) + 1; if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { top: 0, bottom: 220, height: 220 }; }
  click() { return this.events.click?.({ stopPropagation() {}, preventDefault() {} }); }
}
function harness(file, ids, apiName) {
  const nodes = Object.fromEntries(ids.map(id => [id,new Element()]));
  const root = new Element(), calls = [], events = {};
  let receive, color, now = NOW, timerId = 0;
  const timers = new Map();
  const api = { onModel(callback) { receive = callback; }, onColorMode(callback) { color = callback; },
    openDetail(...args) { calls.push(['openDetail',...args]); }, openThread(...args) { calls.push(['openThread',...args]); },
    markAllRead(...args) { calls.push(['markAllRead',...args]); return Promise.resolve(true); }, close() { calls.push(['close']); }, resize(value) { calls.push(['resize',value]); }, toggleExpanded() { calls.push(['toggle']); } };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const TrendCurve = require('../quota-trend-curve'), TrendDaily = require('../quota-daily-model');
  const document = { documentElement:root,getElementById:id => nodes[id],createElement:tag => Object.assign(new Element(tag),{ownerDocument:document}),createElementNS:(_namespace,tag) => document.createElement(tag) };
  Object.values(nodes).forEach(element => {element.ownerDocument=document;});
  const context = { TrendCurve, TrendDaily, URLSearchParams, location:{search:''}, document,
    window: { [apiName]: api, TrendCurve, TrendDaily, petCreditBalanceText: require('../credit-balance'), getComputedStyle() { return { paddingBottom: '13px', borderBottomWidth: '1px' }; }, addEventListener(type,callback) { events[type] = callback; }, setTimeout(callback,delay) { const id = ++timerId; timers.set(id,{callback,at:now+delay}); return id; }, clearTimeout(id) { timers.delete(id); }, requestAnimationFrame(callback) { callback(); }, matchMedia() { return { matches:false, addEventListener() {}, removeEventListener() {} }; } }, Date: FixedDate };
  if (apiName === 'petCodexDetails') {
    const header = new Element(); header.className = 'panel-header';
    const tools = new Element(); tools.className = 'panel-tools';
    tools.replaceChildren(nodes['details-back'],nodes['details-close']);
    header.replaceChildren(nodes['details-title'],...(nodes['details-read-all'] ? [nodes['details-read-all']] : []),tools);
    nodes['details-panel'].replaceChildren(header,nodes['details-content']);
  }
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'..',file),'utf8'),context);
  return { nodes, root, document, calls, api, receive: value => receive(value), color: (...args) => color(...args), events,
    advance(ms) { now += ms; for (const [id,timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } } };
}
const item = (windowMinutes,remaining = 44) => ({label:'Codex',windowMinutes,remaining,resetsAt:NOW+10800000,pace:{state:'fast',remainingTimePercent:60}});
const cardIds = ['quota-label','status','summary','items','overflow','reset-time','reset-credits','compact-product','compact-period','secondary-quota','secondary-period','secondary-value','secondary-progress','secondary-reset','extra-credits','credits-balance','credits-unit','codex-expanded'];
const detailIds = ['details-panel','details-title','details-content','details-close','details-back','details-read-all'];

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

test('到期时钟只使用范围内未过期可用明细，近邻合组且当前余额不冒充到期预测',() => {
  const h = harness('codex-details-renderer.js',detailIds,'petCodexDetails');
  const base = {action:'trend',state:'ready',observedAt:NOW,quotaUpdatedAt:NOW,period:300,items:[item(300)],resetCreditsAvailable:9,resetDetailsPartial:true,
    trend:{windowMinutes:300,resetsAt:NOW+10800000,samples:[{at:NOW-120000,remaining:45},{at:NOW,remaining:44}]},
    resetOpportunities:[
      {status:'available',expiresAt:null},{status:'available',expiresAt:'unknown'},
      {status:'available',expiresAt:NOW-60000},{status:'redeemed',expiresAt:NOW+120000},
      {status:'redeeming',expiresAt:NOW+180000},{status:'unknown',expiresAt:NOW+240000},
      {status:'available',expiresAt:NOW+60000},{status:'available',expiresAt:NOW+69000},
      {status:'available',expiresAt:NOW+4800000},{status:'available',expiresAt:NOW+10800000},{status:'available',expiresAt:NOW+14400000}
    ]};
  h.receive(base);
  const content = h.nodes['details-content'];
  assert.equal(content.querySelectorAll('.reset-event').length,2,'只按三条真实有效到期明细绘图，不按总数补齐');
  assert.equal(content.querySelector('.reset-event-count').textContent,'2','近邻时间共用一个时钟，保留真实次数');
  assert.equal(content.querySelectorAll('.reset-event-time').length,3);
  const popup = content.querySelector('.reset-event-popup');
  assert.match(popup.querySelector('.reset-event-balance').textContent,/当前剩余额度44%/);
  assert.equal(popup.querySelector('small').textContent,'最早到期时预计余量：暂无法预估');
  content.querySelector('.reset-event').open=true;
  content.querySelector('.reset-event-trigger').focus();
  h.receive({...base,observedAt:NOW+1});
  assert.equal(content.querySelector('.reset-event').open,true,'同一机会刷新保留展开详情');
  assert.equal(h.document.activeElement,content.querySelector('.reset-event-trigger'),'刷新后焦点落在同一机会的新节点');
  content.querySelector('[data-view="daily"]').click();
  assert.equal(content.querySelector('.reset-markers'),null,'每日消耗不是机会到期时间轴');
  content.querySelector('[data-view="line"]').click();
  assert.equal(content.querySelectorAll('.reset-event-guide').length,2,'视图返回不重复添加事件线');
  h.advance(70000);
  assert.equal(content.querySelectorAll('.reset-event').length,1,'无需新额度采样，已经到期的机会也停止提醒');
  h.receive({...base,resetCreditsAvailable:0});
  assert.equal(content.querySelector('.reset-markers'),null);
  h.receive({...base,resetCreditsAvailable:undefined,resetOpportunities:null});
  assert.equal(content.querySelector('.reset-markers'),null);
  assert.match(content.querySelector('.reset-link').textContent,/暂未提供/);
  h.receive({...base,resetOpportunities:[{status:'available',expiresAt:NOW-60000}]});
  assert.equal(content.querySelector('.reset-markers'),null);
  for (const [state,quotaUpdatedAt] of [['stale',NOW],['ready',NOW-300000],['ready',NOW+70001],['ready',undefined]]) {
    h.receive({...base,state,quotaUpdatedAt});
    assert.equal(content.querySelector('.reset-markers'),null,'未知、未来或过期额度快照不能生成到期提醒');
  }
  h.receive({...base,resetOpportunities:[{status:'available',expiresAt:NOW+4800000,estimatedRemaining:18.6}]});
  assert.equal(content.querySelector('.reset-event-popup').querySelector('small').textContent,'到期时预计余量：19%（预估）');
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
  assert.deepEqual(observed.attributes.d.match(/L([\d.]+) ([\d.]+)$/).slice(1).map(Number),[158,66.8]);
  assert.equal((observed.attributes.d.match(/M/g)||[]).length,3);
  assert.equal(h.nodes['details-content'].querySelector('.observed-area'),null);
  assert.doesNotMatch(observed.attributes.d,/350/);
  assert.match(h.nodes['details-content'].textContent,/暂无法预估额度用完时间.*连续用量记录不足，稍后再查看/);
  h.receive({...base,trend:{...base.trend,forecast:{state:'unknown',summary:'暂无法预估额度用完时间',detail:'用量尚未更新，稍后再看'}}});
  assert.match(h.nodes['details-content'].textContent,/暂无法预估额度用完时间.*用量尚未更新，稍后再看/);
  h.receive(base);
  assert.match(h.nodes['details-content'].querySelector('.chart-updated').textContent,/ 更新$/);
  assert.match(h.nodes['details-content'].querySelector('.chart-updated').title,/已记录至/);
  assert.equal(h.nodes['details-content'].querySelector('.record-note'),null);
  assert.equal(h.nodes['details-content'].querySelector('.reset-chevron').textContent,'›');
  assert.equal(h.nodes['details-content'].querySelector('.reset-chevron').attributes['aria-hidden'],'true');
  assert.match(h.nodes['details-content'].querySelector('.chart-help').textContent,/蓝色虚线中间没有记录.*灰色虚线剩余时间参考/);
  assert.match(h.nodes['details-content'].querySelector('.chart-updated').title,/蓝色虚线区间无记录/);
  const denseSamples = Array.from({length:61},(_sample,index) => ({at:NOW-7200000+index*120000,remaining:100-index*56/60}));
  h.receive({...base,trend:{...base.trend,samples:denseSamples}});
  assert.equal(h.nodes['details-content'].querySelector('.trend-chart').querySelector('.unrecorded-line'),null);
  assert.doesNotMatch(h.nodes['details-content'].querySelector('.chart-updated').title,/虚线区间无记录/);
  const points = h.nodes['details-content'].querySelectorAll('.point');
  assert.ok(points.length <= 8);
  assert.ok(points[0].classList.contains('endpoint'));
  assert.ok(points.at(-1).classList.contains('endpoint'));
  assert.equal(points[0].attributes.cx,'30');
  assert.equal(points.at(-1).attributes.cx,'158');
  assert.ok(points.every(point => point.querySelector('title').textContent));
  assert.equal((h.nodes['details-content'].querySelector('.observed-line').attributes.d.match(/C/g)||[]).length,denseSamples.length-1);
  h.receive({...base,items:[item(300),item(10080)],trend:{...base.trend,forecast:{state:'estimate',status:'safe',summary:'额度充裕',detail:'预计够用到重置',exhaustsAt:null}}});
  assert.equal(h.nodes['details-panel'].querySelector('.trend-tabs').children.length,2);
  h.nodes['details-panel'].querySelector('.trend-tabs').children[1].click();
  assert.ok(h.calls.some(call => JSON.stringify(call) === JSON.stringify(['openDetail','trend',10080])));
  assert.match(h.nodes['details-content'].textContent,/额度充裕.*预计够用到重置/);
  assert.doesNotMatch(h.nodes['details-content'].textContent,/预计约.*用完/);
});

test('额度图表在断档处仅虚线连接已知端点，余额校正和骤降仍断开，填色不跨边界',() => {
  const h=harness('codex-details-renderer.js',detailIds,'petCodexDetails');
  const samples=[
    {at:NOW-1200000,remaining:90},{at:NOW-1080000,remaining:89},
    {at:NOW-600000,remaining:85},{at:NOW-480000,remaining:84},
    {at:NOW-360000,remaining:95},{at:NOW-240000,remaining:94},
    {at:NOW-120000,remaining:40},{at:NOW,remaining:39}
  ];
  h.receive({action:'trend',period:300,items:[item(300,39)],trend:{windowMinutes:300,
    resetsAt:NOW+10800000,samples,forecast:{state:'unknown'}}});
  const content=h.nodes['details-content'];
  const line=content.querySelector('.observed-line').attributes.d;
  assert.equal((line.match(/M/g)||[]).length,4);
  assert.equal((line.match(/C/g)||[]).length,4);
  assert.equal((content.querySelector('.observed-area').attributes.d.match(/Z/g)||[]).length,4);
  assert.equal(content.querySelector('.observed-line').attributes['stroke-linecap'],'round');
  const chart = content.querySelector('.trend-chart');
  assert.equal((chart.querySelector('.unrecorded-line').attributes.d.match(/M/g)||[]).length,1);
  assert.equal((chart.querySelector('.time-path').attributes.d.match(/M/g)||[]).length,3);
});

test('日用量的大幅下降修正不误标为剩余额度增加',() => {
  const h = harness('codex-details-renderer.js',detailIds,'petCodexDetails');
  h.receive({action:'trend',period:300,items:[item(300,64)],trend:{windowMinutes:300,resetsAt:NOW+10800000,
    samples:[{at:NOW-120000,remaining:90},{at:NOW-60000,remaining:65},{at:NOW,remaining:64}]}});
  const content = h.nodes['details-content'];
  content.querySelector('[data-view="daily"]').click();
  const chart = content.querySelector('.daily-chart');
  assert.equal(chart.querySelector('.daily-point').getAttribute('data-amount'),'1','25 个百分点的修正不计入正常用量');
  assert.equal(chart.querySelector('.daily-secondary').textContent,'额度变化较大');
  assert.match(chart.querySelector('.daily-point title').textContent,/短时变化较大，该次变化未计入用量/);
  assert.doesNotMatch(chart.textContent,/剩余额度(?:曾)?增加/);
});

test('5h和周趋势的缺记录虚线只连接观测两端，长断档无填充也不延伸到未来',() => {
  for (const period of [300,10080]) {
    const h=harness('codex-details-renderer.js',detailIds,'petCodexDetails');
    const reset=NOW+3600000;
    const samples=[{at:NOW-10800000,remaining:90},{at:NOW-10680000,remaining:89},
      {at:NOW-3600000,remaining:88},{at:NOW-3480000,remaining:87},{at:NOW,remaining:86}];
    h.receive({action:'trend',period,items:[{...item(period,86),resetsAt:reset}],trend:{windowMinutes:period,
      resetsAt:reset,samples,forecast:{state:'unknown'}}});
    const chart=h.nodes['details-content'].querySelector('.trend-chart');
    const point=sample=>`${(30+(sample.at-(reset-period*60000))/(period*60000)*320).toFixed(1)} ${(102-sample.remaining*.8).toFixed(1)}`;
    const connector=chart.querySelector('.unrecorded-line');
    assert.equal(connector.attributes.d,`M${point(samples[1])}L${point(samples[2])}M${point(samples[3])}L${point(samples[4])}`);
    assert.match(connector.querySelector('title').textContent,/区间无记录.*不参与用量预估/);
    assert.match(chart.attributes['aria-label'],/蓝色虚线区间无记录/);
    assert.equal((chart.querySelector('.observed-line').attributes.d.match(/M/g)||[]).length,3);
    const areas=chart.querySelector('.observed-area').attributes.d.split('Z').filter(Boolean);
    assert.equal(areas.length,2);
    for (const [area,first,last] of [[areas[0],samples[0],samples[1]],[areas[1],samples[2],samples[3]]]) {
      const coordinates=area.split('L')[0].match(/-?\d+(?:\.\d+)?/g).map(Number);
      assert.deepEqual([...coordinates.slice(0,2),...coordinates.slice(-2)].map(value=>value.toFixed(1)),`${point(first)} ${point(last)}`.split(' '),'每段填色只覆盖连续采样两端，不跨缺口或延至未来');
    }
    assert.match(h.nodes['details-content'].querySelector('.chart-updated').title,/虚线区间无记录/);
    assert.match(h.nodes['details-content'].textContent,/暂无法预估额度用完时间/);
  }
});

test('五分钟边界使用虚线；余额回升与25点修正即使伴随缺记录也不桥接',() => {
  const h=harness('codex-details-renderer.js',detailIds,'petCodexDetails');
  const render=samples=>h.receive({action:'trend',period:300,items:[item(300,samples.at(-1).remaining)],
    trend:{windowMinutes:300,resetsAt:NOW+10800000,samples,forecast:{state:'unknown'}}});
  for (const gap of [299999,300000]) {
    render([{at:NOW-gap,remaining:90},{at:NOW,remaining:89}]);
    const chart=h.nodes['details-content'].querySelector('.trend-chart');
    assert.equal(Boolean(chart.querySelector('.unrecorded-line')),gap===300000);
    assert.equal(Boolean(chart.querySelector('.observed-area')),gap<300000);
  }
  render([{at:NOW-1200000,remaining:90},{at:NOW-600000,remaining:95},{at:NOW,remaining:70}]);
  const chart=h.nodes['details-content'].querySelector('.trend-chart');
  assert.equal(chart.querySelector('.unrecorded-line'),null);
  assert.equal(chart.querySelector('.observed-area'),null);
  assert.equal((chart.querySelector('.observed-line').attributes.d.match(/M/g)||[]).length,3);
  assert.equal((chart.querySelector('.time-path').attributes.d.match(/M/g)||[]).length,3);
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


test('清除未看仅在非空结果页显示；等待真实确认，不重复提交，失败保留列表且可重试',async () => {
  const h = harness('codex-details-renderer.js',detailIds,'petCodexDetails');
  const base = {action:'results',generation:7,activity:{unreadCount:1},results:[{id:'thread-1',turnId:'turn-1',title:'已有结果',state:'completed'}]};
  const readAll = h.nodes['details-read-all'];
  h.receive({...base,action:'tasks'}); assert.equal(readAll.hidden,true);
  h.receive({...base,results:[],activity:{unreadCount:0}}); assert.equal(readAll.hidden,true);
  h.receive(base); assert.equal(readAll.hidden,false); assert.equal(readAll.disabled,false);
  let done, calls = 0;
  h.api.markAllRead = generation => { assert.equal(generation,7); calls++; return new Promise(resolve => { done = resolve; }); };
  const pending = readAll.click();
  assert.equal(readAll.disabled,true); await readAll.click(); assert.equal(calls,1);
  assert.equal(h.nodes['details-content'].querySelectorAll('.activity-item').length,1,'确认前不清空列表');
  done(false); await pending;
  assert.equal(readAll.disabled,false); assert.match(h.nodes['details-content'].textContent,/已有结果.*未能保存已读状态，请重试/);
  h.api.markAllRead = async () => { h.receive({...base,results:[],activity:{unreadCount:0}}); return true; };
  await readAll.click();
  assert.equal(readAll.hidden,true); assert.match(h.nodes['details-content'].textContent,/暂无待查看结果/);
  assert.ok(h.nodes['details-title'].focused,'清空后键盘焦点回到标题');
  h.receive({...base,generation:8,results:[{id:'thread-1',turnId:'turn-2',title:'新的结果',state:'completed'}]});
  assert.equal(readAll.hidden,false); assert.match(h.nodes['details-content'].textContent,/新的结果/);
  h.receive({...base,generation:undefined}); assert.equal(readAll.disabled,true);
});

test('清除未看 IPC 只接受当前可见结果窗口主框架及当前连接代次',() => {
  const source = fs.readFileSync(path.resolve(__dirname,'../main.js'),'utf8');
  const start = source.indexOf("  ipcMain.handle('pet:codex-details-read-all'");
  const end = source.indexOf("  ipcMain.on('pet:codex-details-resize'",start);
  let handler, changed = 0, errors = 0;
  const trusted = {}, context = {Number, isQuitting:false, screenLocked:false,
    ipcMain:{handle(_channel,callback) { handler = callback; }},
    codexDetails:{owns:event => event === trusted,isVisible:() => true,getAction:() => 'results'},
    codexCompanion:{getSnapshot:() => ({enabled:true,generation:9}),markAllRead() { changed++; return true; }},
    writeError() { errors++; }};
  vm.runInNewContext(source.slice(start,end),context);
  assert.equal(handler({},9),false);
  assert.equal(handler(trusted,8),false); assert.equal(handler(trusted,'9'),false);
  context.codexDetails.getAction = () => 'tasks'; assert.equal(handler(trusted,9),false);
  context.codexDetails.getAction = () => 'results'; context.codexDetails.isVisible = () => false; assert.equal(handler(trusted,9),false);
  context.codexDetails.isVisible = () => true; context.screenLocked = true; assert.equal(handler(trusted,9),false);
  context.screenLocked = false; context.isQuitting = true; assert.equal(handler(trusted,9),false);
  context.isQuitting = false; context.codexCompanion.getSnapshot = () => ({enabled:false,generation:9}); assert.equal(handler(trusted,9),false);
  context.codexCompanion.getSnapshot = () => ({enabled:true,generation:9}); assert.equal(changed,0);
  assert.equal(handler(trusted,9),true); assert.equal(changed,1);
  context.codexCompanion.markAllRead = () => { throw new Error('failure'); };
  assert.equal(handler(trusted,9),false); assert.equal(errors,1);
});
