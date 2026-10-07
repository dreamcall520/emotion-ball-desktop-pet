const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const formatBalance = require('../credit-balance');

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.className = ''; this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this.style = {}; this._text = ''; }
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
  setAttribute(key,value) { this.attributes[key] = String(value); if (key === 'class') this.className = String(value); }
  getAttribute(key) { if (key === 'open') return this.open ? '' : null; return this.attributes[key] ?? (key.startsWith('data-') ? this.dataset[key.slice(5).replace(/-([a-z])/g,(_match,letter) => letter.toUpperCase())] : null) ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type,callback) { this.events[type] = callback; }
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
  getBoundingClientRect() { return {top:0,bottom:220,height:220}; }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
}
function renderer(search = '') {
  const TrendCurve = require('../quota-trend-curve'), TrendDaily = require('../quota-daily-model');
  const root = new Element(), nodes = Object.fromEntries(['details-panel','details-title','details-content','details-close','details-back'].map(id => [id,new Element()]));
  const header = new Element(), tools = new Element(); header.className = 'panel-header'; tools.className = 'panel-tools';
  tools.replaceChildren(nodes['details-back'],nodes['details-close']); header.replaceChildren(nodes['details-title'],tools);
  nodes['details-panel'].replaceChildren(header,nodes['details-content']);
  let receive;
  const calls = [];
  const computedStyle = () => ({paddingTop:'0px',paddingBottom:'0px',borderTopWidth:'0px',borderBottomWidth:'0px'});
  const document = {documentElement:root,body:new Element('body'),getElementById:id => nodes[id],createElement:tag => Object.assign(new Element(tag),{ownerDocument:document}),createElementNS:(_namespace,tag) => document.createElement(tag)};
  Object.values(nodes).forEach(element => {element.ownerDocument=document;});
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../codex-details-renderer.js'),'utf8'),{
    getComputedStyle:computedStyle, TrendCurve, TrendDaily, URLSearchParams, location:{search},
    document,
    window: {getComputedStyle:computedStyle,TrendCurve,TrendDaily,petCreditBalanceText:formatBalance,petCodexDetails:{onModel(callback) {receive = callback;},resize() {},openDetail(...args) {calls.push(args);}},addEventListener() {},setTimeout() {return 1;},clearTimeout() {},requestAnimationFrame(callback) {callback();},matchMedia() {return {matches:false,addEventListener() {}};}}
  });
  return {root,nodes,calls,receive:value => receive(value)};
}
const item = windowMinutes => ({windowMinutes,remaining:62,resetsAt:Date.now()+10000000,pace:{state:'balanced',remainingTimePercent:64}});

test('R2 单周标题与指标顺序按认可稿，双周期仍提供切换',() => {
  const h = renderer();
  h.receive({action:'trend',period:10080,items:[item(10080)]});
  assert.equal(h.nodes['details-title'].textContent,'周额度趋势CODEX');
  assert.equal(h.nodes['details-title'].querySelector('.title-product').tagName,'small');
  assert.equal(h.nodes['details-panel'].querySelector('.trend-tabs'),null);
  const stats = h.nodes['details-content'].querySelector('.trend-stats');
  assert.deepEqual(stats.children.slice(0,2).map(stat => stat.children.map(child => [child.tagName,child.textContent])),[[['span','剩余额度'],['strong','62%']],[['span','剩余时间'],['strong','64%']]]);
  assert.equal(stats.querySelector('.balanced').textContent,'节奏均衡');
  h.receive({action:'trend',period:10080,items:[item(300),item(10080)]});
  assert.equal(h.nodes['details-title'].textContent,'额度趋势CODEX');
  assert.equal(h.nodes['details-panel'].querySelector('.trend-tabs').children.length,2);
  assert.equal(h.nodes['details-panel'].querySelector('.trend-tabs').children[1].attributes['aria-pressed'],'true');
});

const trendModel = () => {
  const at = value => Date.parse(value+'+08:00'), resetsAt = at('2026-10-10T05:14:00');
  return {action:'trend',period:10080,items:[300,10080].map(windowMinutes => ({...item(windowMinutes),resetsAt})),
    trend:{windowMinutes:10080,resetsAt,samples:[
      ['2026-10-05T23:37:00',63],['2026-10-06T23:36:59',55],['2026-10-06T23:40:07',54],
      ['2026-10-07T09:00:00',54],['2026-10-07T09:01:00',53],['2026-10-07T09:02:00',54],['2026-10-07T09:03:00',53]
    ].map(([time,remaining]) => ({at:at(time),remaining}))}};
};

test('趋势以走势启动，日用量切换同时更新图表、参考状态和说明',() => {
  const h = renderer('?view=daily&line=straight');
  h.receive(trendModel());
  const content = h.nodes['details-content'];
  assert.equal(content.querySelector('.chart-block').dataset.view,'line','独立预览的 URL 参数不能决定正式视图');
  const tabs = content.querySelector('.chart-view-switch');
  tabs.querySelector('[data-view="daily"]').events.click();
  assert.equal(content.querySelector('.chart-block').dataset.view,'daily');
  assert.equal(content.querySelector('.chart-status').textContent,'仅供参考');
  assert.equal(tabs.querySelector('[data-view="daily"]').attributes['aria-selected'],'true');
  assert.equal(tabs.querySelector('[data-view="line"]').attributes['aria-selected'],'false');
  assert.ok(content.querySelector('.daily-chart'));
  assert.match(content.querySelector('.daily-chart').attributes['aria-label'],/不是每日末余额/);
  assert.match(content.querySelector('.chart-help').textContent,/仅 1 次记录无法计算用量/);
  assert.match(content.querySelector('.chart-help').textContent,/仅部分时段不代表全天用量/);
  tabs.querySelector('[data-view="line"]').events.click();
  assert.equal(content.querySelector('.chart-block').dataset.view,'line');
  assert.equal(content.querySelector('.chart-status').textContent,'');
  assert.equal(content.querySelector('.daily-chart'),null);
  assert.ok(content.querySelector('.observed-line'));
});

test('日用量选择在同周期刷新及重置机会返回后保留，各周期分别记住视图',() => {
  const h = renderer(), model = trendModel(), content = h.nodes['details-content'];
  h.receive(model);
  content.querySelector('[data-view="daily"]').events.click();
  h.receive({...model,appearance:'dark',trend:{...model.trend,samples:[...model.trend.samples,{at:model.trend.samples.at(-1).at+60000,remaining:52}]}});
  assert.equal(content.querySelector('.chart-block').dataset.view,'daily');
  assert.equal(content.querySelector('.chart-status').textContent,'仅供参考');
  content.querySelector('.reset-link').events.click();
  assert.deepEqual(h.calls.at(-1),['opportunities',10080]);
  h.receive({action:'opportunities',period:10080,items:model.items,returnToTrend:true,returnPeriod:10080});
  h.nodes['details-back'].events.click();
  assert.deepEqual(h.calls.at(-1),['trend',10080]);
  h.receive(model);
  assert.equal(content.querySelector('.chart-block').dataset.view,'daily');
  h.receive({...model,period:300,trend:{...model.trend,windowMinutes:300}});
  assert.equal(content.querySelector('.chart-block').dataset.view,'line');
  h.receive(model);
  assert.equal(content.querySelector('.chart-block').dataset.view,'daily');
});

test('空历史视图往返只保留当前的一个空态',() => {
  const h = renderer(), model = trendModel(), content = h.nodes['details-content'];
  h.receive({...model,trend:{...model.trend,samples:[]}});
  for (const view of ['daily','line','daily','line']) {
    content.querySelector(`[data-view="${view}"]`).events.click();
    const empty = content.querySelectorAll('.empty-state');
    assert.equal(empty.length,1);
    assert.equal(empty[0].textContent,view === 'daily' ? '暂无已记录用量' : '暂无已采样趋势');
  }
});

test('同周期刷新保留图表说明展开及键盘焦点',() => {
  const h = renderer(), model = trendModel(), content = h.nodes['details-content'];
  h.receive(model);
  content.querySelector('[data-view="daily"]').events.click();
  const summary = content.querySelector('.chart-help summary');
  content.querySelector('.chart-help').open = true;
  summary.focus();
  h.receive({...model,trend:{...model.trend,samples:[...model.trend.samples,{at:model.trend.samples.at(-1).at+60000,remaining:52}]}});
  const next = content.querySelector('.chart-help summary');
  assert.notEqual(next,summary);
  assert.equal(content.querySelector('.chart-help').open,true);
  assert.equal(summary.ownerDocument.activeElement,next);
});

test('R2 正重置次数的xx次加蓝色状态，标签、0与未知保持中性',() => {
  const h = renderer();
  for (const [value,text,positive] of [[2,'2',true],[0,'0',false],[undefined,'暂未提供',false]]) {
    h.receive({action:'opportunities',resetCreditsAvailable:value,resetOpportunities:null});
    const summary = h.nodes['details-content'].querySelector('.reset-summary');
    assert.equal(summary.querySelector('strong').textContent,text);
    assert.equal(summary.querySelector('strong').className,positive ? 'positive-count' : '');
    assert.equal(summary.children[0].className,'');
    if (value !== undefined) assert.equal(summary.children.at(-1).className,positive ? 'positive-count' : '');
  }
});

test('R2 余额使用共享格式器，保留精确title及两位小数层级，不显示原始长小数或费用语义',() => {
  const h = renderer();
  for (const [balance,expected] of [['62234.123456789','62,234.12'],['0','0.00'],['99.999','100.00'],['0.00001','<0.01'],['12345678901234567890.125','12,345,678,901,234,567,890.13']]) {
    h.receive({action:'credits',extraCredits:{state:'balance',balance}});
    const content = h.nodes['details-content'], value = content.querySelector('.balance-value');
    assert.equal(content.querySelector('.balance-caption').textContent,'当前余额');
    assert.equal(value.textContent,expected);
    assert.equal(value.title,balance);
    assert.equal(value.attributes['aria-label'],expected);
    assert.match(value.querySelector('.balance-decimal').textContent,/^\.\d{2}$/);
    assert.equal(content.querySelector('.panel-note'),null);
    assert.doesNotMatch(content.textContent,/\$|USD|美元|API|分别统计/);
  }
});

test('R2 余额空态、不限额、未知、过期与限制保持真实区分，主题独立',() => {
  const h = renderer();
  for (const [state,text] of [['none','暂无余额'],['unlimited','不限额'],['unknown','暂未提供'],['stale','暂未提供']]) {
    h.receive({action:'credits',appearance:'dark',colorMode:'accessible',extraCredits:{state}});
    assert.equal(h.nodes['details-content'].querySelector('.balance-state').textContent,text);
    assert.equal(h.root.dataset.resolvedAppearance,'dark');
    assert.equal(h.root.dataset.colorMode,'accessible');
    if (state === 'stale') assert.match(h.nodes['details-content'].textContent,/余额已过期/);
  }
  h.receive({action:'credits',appearance:'light',colorMode:'standard',extraCredits:{state:'balance',balance:'2480',usageStatus:'blocked'}});
  assert.equal(h.nodes['details-content'].querySelector('.balance-value').textContent,'2,480.00');
  assert.equal(h.nodes['details-content'].querySelector('.blocked').textContent,'已达花费限制');
  assert.equal(h.root.dataset.resolvedAppearance,'light');
  assert.equal(h.root.dataset.colorMode,'standard');
  const css = fs.readFileSync(path.resolve(__dirname,'../codex-details.css'),'utf8');
  const surfaces = [...css.matchAll(/--detail-surface:\s*rgba\(([^)]+)\)/g)].map(match => match[1].split(',').map(Number));
  assert.equal(surfaces.length,2);
  assert.ok(surfaces.every(surface => surface[3] >= .94 && surface[3] < 1),'标准浅深玻璃底层高覆盖，正文区域不漏空');
  assert.equal((css.match(/--detail-solid-bg:\s*linear-gradient\(145deg,#[^;]+\);/g)||[]).length,2,'减少透明时保留不透明浅深底层');
  assert.match(css,/@media \(prefers-reduced-transparency: reduce\) \{ #details-panel \{ background: var\(--detail-solid-bg\)/);
  assert.match(css,/\.trend-pace\.balanced\s*\{\s*color:\s*var\(--detail-blue\)/);
});


test('八个日期的密集周图用简短辅助标签，完整含义保留给提示和读屏',() => {
  const h=renderer(),model=trendModel(),start=new Date(2026,9,1,12).getTime(),end=start+7*86400000;
  const samples=Array.from({length:8},(_,i)=>i===1?[{at:start+i*86400000,remaining:50}]:[
    {at:start+i*86400000-120000,remaining:50},{at:start+i*86400000-60000,remaining:60},{at:start+i*86400000,remaining:59}]).flat();
  h.receive({...model,trend:{windowMinutes:10080,resetsAt:end,samples}});
  const content=h.nodes['details-content'];content.querySelector('[data-view="daily"]').events.click();
  const labels=content.querySelectorAll('.daily-secondary');
  assert.ok(labels.length>=6);
  for(const label of labels){
    assert.ok(label.textContent.startsWith('余额增加'));
    assert.equal(label.getAttribute('aria-label'),'剩余额度增加');
    assert.equal(label.querySelector('title').textContent,'剩余额度增加');
  }
  const single=content.querySelectorAll('.daily-empty').find(label=>label.textContent==='仅1次');
  assert.ok(single);assert.match(single.getAttribute('aria-label'),/仅 1 次记录/);
});
