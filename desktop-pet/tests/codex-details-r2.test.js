const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const formatBalance = require('../credit-balance');

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.className = ''; this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  replaceChildren(...children) { this._text = ''; this.children = []; children.forEach(child => this.appendChild(child)); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  insertBefore(child, before) { child.parent = this; const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index,0,child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(key,value) { this.attributes[key] = String(value); if (key === 'class') this.className = String(value); }
  addEventListener(type,callback) { this.events[type] = callback; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const matches = child => selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tagName === selector;
    return this.children.flatMap(child => [...(matches(child) ? [child] : []),...child.querySelectorAll(selector)]);
  }
  getBoundingClientRect() { return {top:0,bottom:220,height:220}; }
  focus() {}
}
function renderer() {
  const root = new Element(), nodes = Object.fromEntries(['details-panel','details-title','details-content','details-close','details-back'].map(id => [id,new Element()]));
  const header = new Element(), tools = new Element(); header.className = 'panel-header'; tools.className = 'panel-tools';
  tools.replaceChildren(nodes['details-back'],nodes['details-close']); header.replaceChildren(nodes['details-title'],tools);
  nodes['details-panel'].replaceChildren(header,nodes['details-content']);
  let receive;
  const computedStyle = () => ({paddingTop:'0px',paddingBottom:'0px',borderTopWidth:'0px',borderBottomWidth:'0px'});
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../codex-details-renderer.js'),'utf8'),{
    getComputedStyle:computedStyle,
    document: {documentElement:root,body:new Element('body'),getElementById:id => nodes[id],createElement:tag => new Element(tag),createElementNS:(_namespace,tag) => new Element(tag)},
    window: {getComputedStyle:computedStyle,petCreditBalanceText:formatBalance,petCodexDetails:{onModel(callback) {receive = callback;},resize() {}},addEventListener() {},requestAnimationFrame(callback) {callback();},matchMedia() {return {matches:false,addEventListener() {}};}}
  });
  return {root,nodes,receive:value => receive(value)};
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
