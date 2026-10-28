const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const formatBalance = require('../credit-balance');

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.className = ''; this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this.style = {}; this.scrollLeft = 0; this._text = ''; }
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
  contains(target) { return target === this || this.children.some(child => child.contains(target)); }
  getBoundingClientRect() { return {top:0,bottom:220,height:220}; }
  scrollIntoView(options) { (this.scrollRequests ||= []).push(options); }
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

test('ZCode team quota and trend empty states retain actionable reasons without changing Codex', () => {
  const h = renderer(), content = h.nodes['details-content'];
  for (const [code, reason] of [
    ['ZCODE_TEAM_SELECTION_REQUIRED', /选择完整的团队、项目和套餐/],
    ['ZCODE_TEAM_KEY_MISSING', /尚未配置可用 API Key/],
    ['ZCODE_TEAM_ACCESS_DENIED', /检查成员和席位权限/]
  ]) for (const action of ['quota', 'trend']) {
    h.receive({ sourceId: 'zcode', state: 'disconnected', statusCode: code, action, items: [] });
    assert.match(content.textContent, reason); assert.match(content.textContent, /刷新 ZCode 状态/);
    assert.equal(content.querySelectorAll('.empty-state').length, 1); assert.doesNotMatch(content.textContent, /0%/);
  }
  h.receive({ sourceId: 'zcode', state: 'connected', action: 'quota', items: [] });
  assert.equal(content.textContent, '暂未提供额度明细');
  h.receive({ sourceId: 'codex', state: 'disconnected', statusCode: 'ZCODE_TEAM_KEY_MISSING', action: 'trend', items: [] });
  assert.equal(content.textContent, '暂无周期额度');
});

test('ZCode custom and failed quota states survive model, window, preload and details rendering', () => {
  const { EventEmitter } = require('node:events');
  const { buildZcodeDetailsModel } = require('../lib/zcode-quota-view');
  const { createCodexDetailsWindow } = require('../lib/codex-details-window');
  const h = renderer(), handlers = new Map(), errors = []; let api;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../codex-details-preload.js'), 'utf8'), {
    process: { argv: ['electron', '--pet-source=zcode'] },
    require: () => ({ contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
      ipcRenderer: { on(channel, callback) { handlers.set(channel, callback); }, removeListener() {}, send() {} } })
  });
  api.onModel(h.receive);
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.bounds = options; this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = (channel, model) => handlers.get(channel)?.({}, model);
    }
    getBounds() { return this.bounds; }
    setBounds(value) { this.bounds = value; }
    isDestroyed() { return false; }
    setAlwaysOnTop() {}
    loadFile() { return Promise.resolve(); }
    show() {}
    hide() {}
    destroy() { this.emit('closed'); }
  }
  const details = createCodexDetailsWindow({ BrowserWindow: Window, sourceId: 'zcode',
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
    getAnchor: () => ({ x: 500, y: 350, width: 80, height: 80 }), onError: error => errors.push(error) });
  const now = Date.now(), cases = [
    [{ enabled: true, hasCustomProviders: true, quota: { state: 'unsupported', updatedAt: null } },
      'ZCODE_CUSTOM_QUOTA_UNAVAILABLE', /已识别自定义供应商.*暂无可读取的额度数据/],
    [{ enabled: true, quota: { state: 'disconnected', updatedAt: null, code: 'ZCODE_NETWORK_ERROR', queryFailed: true } },
      'ZCODE_QUOTA_QUERY_FAILED', /暂时无法获取 ZCode 额度.*刷新 ZCode 状态/],
    [{ enabled: true, quota: { state: 'connected', updatedAt: now - 1000, windows: [], code: 'ZCODE_NETWORK_ERROR', queryFailed: true } },
      'ZCODE_QUOTA_UPDATE_FAILED', /本次额度查询失败.*保留上次成功结果/]
  ];
  for (const [snapshot, code, expected] of cases) for (const action of ['quota', 'trend']) {
    const model = buildZcodeDetailsModel(snapshot, { action }, now);
    assert.equal(model.statusCode, code);
    assert.equal(details.open(model), true);
    details.getWindow().webContents.emit('did-finish-load');
    assert.match(h.nodes['details-content'].textContent, expected);
    assert.doesNotMatch(h.nodes['details-content'].textContent, /0%|0 元|未连接|不支持|填写|添加供应商/);
  }
  details.destroy(); assert.deepEqual(errors, []);
});

test('ZCode retained quota is visibly pending update in quota and trend details', () => {
  const h = renderer(), content = h.nodes['details-content'];
  const model = { sourceId: 'zcode', state: 'stale', items: [{ ...item(300), bucketId: 'zcode:paid:1',
    label: 'Coding Plan', planName: '团队套餐', periodKind: 'rolling', pace: { state: 'unknown' } }] };
  h.receive({ ...model, action: 'quota' }); assert.match(content.querySelector('.zcode-quota-deadline').textContent, /^待更新/);
  h.receive({ ...model, action: 'trend' }); assert.equal(content.querySelector('.trend-pace').textContent, '待更新');
  h.receive({ ...model, state: 'ready', action: 'quota' }); assert.doesNotMatch(content.textContent, /待更新/);
});

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

test('ZCode 趋势按桶切换，同周期不同模型互不串，明细和到期语义独立',() => {
  const h = renderer();
  const items = ['activity-glm','trial-glm','activity-flash','trial-flash'].map((bucketId,i) => ({...item(1440),bucketId,label:bucketId,periodKind:'expiry',total:200000000,remainingUnits:150000000,unit:'tokens'}));
  h.receive({sourceId:'zcode',action:'trend',bucketId:'trial-glm',items});
  assert.match(h.nodes['details-title'].textContent,/ZCODE/);
  assert.equal(h.nodes['details-panel'].querySelector('.trend-tabs'),null);
  const options = h.nodes['details-content'].querySelectorAll('.zcode-bucket-button');
  assert.equal(options.length,4);
  assert.equal(options[1].attributes['aria-pressed'],'true');
  options[2].events.click();
  assert.deepEqual(h.calls.at(-1),['trend','activity-flash']);
  assert.match(h.nodes['details-content'].textContent,/到期/);
  assert.doesNotMatch(h.nodes['details-content'].textContent,/重置机会/);
  h.receive({sourceId:'zcode',action:'quota',items});
  assert.match(h.nodes['details-content'].textContent,/activity-flash/);
  assert.match(h.nodes['details-content'].querySelector('.zcode-quota-row').getAttribute('aria-label'),/150,000,000/);
});

test('ZCode 详情 preload 仅绑定独立 IPC 且桶参数不能降级成 Codex 周期', () => {
  const handlers=new Map(),calls=[];let api;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../codex-details-preload.js'),'utf8'),{
    process:{argv:['electron','--pet-source=zcode']},
    require:()=>({contextBridge:{exposeInMainWorld(_name,value){api=value;}},ipcRenderer:{on(channel,callback){handlers.set(channel,callback);},removeListener(){},send(...args){calls.push(args);},invoke(){return Promise.resolve(true);}}})
  });
  let model;api.onModel(value=>{model=value;});
  assert.equal(handlers.has('pet:codex-details'),false);
  handlers.get('pet:zcode-details')({}, {action:'quota',sourceId:'codex'});
  assert.equal(model.sourceId,'zcode');
  api.openDetail('trend',10080);api.openDetail('opportunities','activity-glm');assert.equal(calls.length,0);
  api.openDetail('trend','activity-glm');api.close();
  assert.deepEqual(calls,[['pet:zcode-details-open','trend','activity-glm'],['pet:zcode-details-close']]);
});

test('ZCode MCP 月额无周期起点仍保留余额，趋势明确不可绘制', () => {
  const h=renderer();const bucketId='zcode:'+ 'p'.repeat(160) + ':' + 'e'.repeat(160);
  const items=[{bucketId,label:'MCP 工具',windowMinutes:null,periodStart:null,periodKind:'monthly',remaining:80,total:1000,remainingUnits:800,unit:'次',resetsAt:Date.now()+1000000}];
  h.receive({sourceId:'zcode',action:'quota',bucketId,items});
  assert.match(h.nodes['details-content'].textContent,/剩余 800 \/ 1,000 次/);
  h.nodes['details-content'].querySelector('.zcode-quota-row').events.click();assert.deepEqual(h.calls.at(-1),['trend',bucketId]);
  h.receive({sourceId:'zcode',action:'trend',bucketId,items});
  assert.match(h.nodes['details-content'].textContent,/接口未提供周期起点，暂无法绘制趋势/);
  assert.equal(h.nodes['details-content'].querySelector('.trend-chart'),null);
});

const zcodeItems = () => ['ZCode Start Plan','ZCode Start Plan','ZCode 1024 Dev Day','ZCode 1024 Dev Day'].map((planName,i)=>({...item(1440),bucketId:`zcode:${i}`,label:i%2?'GLM-5.3-Flash':'GLM-5.3',planName,periodKind:i<2?'daily':'one_time',periodStart:Date.now()-3600000,total:200000000,remainingUnits:199999123.456789,unit:'tokens'}));

test('ZCode 四桶用可直接单击的短按钮，真实全名保留，Codex 原标签不变', () => {
  const h=renderer(),items=zcodeItems();
  h.receive({sourceId:'zcode',action:'trend',bucketId:'zcode:0',items});
  const c=h.nodes['details-content'], buttons=c.querySelectorAll('.zcode-bucket-button');
  assert.deepEqual(buttons.map(b=>b.textContent),['体验·5.3','体验·Flash','活动·5.3','活动·Flash']);
  assert.equal(buttons[0].getAttribute('aria-pressed'),'true');
  assert.equal(c.querySelector('.zcode-bucket-menu'),null);
  buttons[3].events.click();assert.deepEqual(h.calls,[['trend','zcode:3']]);
  assert.equal(c.querySelector('.zcode-bucket-description'),null);assert.equal(buttons[0].title,'ZCode Start Plan · GLM-5.3');assert.equal(buttons[0].getAttribute('aria-label'),'ZCode Start Plan · GLM-5.3');
  h.receive({sourceId:'zcode',action:'trend',bucketId:'zcode:unknown',items:[{...items[0],bucketId:'zcode:unknown',planName:'新权益计划',label:'新模型'}]});
  assert.equal(c.querySelector('.zcode-bucket-button').textContent,'新权益计划 · 新模型');
  h.receive({action:'trend',period:300,items:[item(300),item(10080)]});
  assert.deepEqual(h.nodes['details-panel'].querySelector('.trend-tabs').children.map(tab=>tab.textContent),['5 小时','周']);
});

test('ZCode 按钮支持方向键定位、Enter一次切换、刷新保留焦点', () => {
  const h=renderer(),items=zcodeItems(),model={sourceId:'zcode',action:'trend',bucketId:'zcode:0',items};h.receive(model);
  const key=key=>({key,preventDefault(){},stopPropagation(){}});
  let buttons=h.nodes['details-content'].querySelectorAll('.zcode-bucket-button');buttons[0].focus();buttons[0].events.keydown(key('End'));
  assert.equal(buttons[0].ownerDocument.activeElement,buttons[3]);assert.equal(h.calls.length,0);
  h.receive({...model,items:items.map(value=>({...value,remaining:61}))});
  buttons=h.nodes['details-content'].querySelectorAll('.zcode-bucket-button');assert.equal(buttons[0].ownerDocument.activeElement,buttons[3]);
  buttons[3].events.keydown(key('Enter'));assert.deepEqual(h.calls,[['trend','zcode:3']]);
  h.receive({...model,bucketId:'zcode:3'});buttons=h.nodes['details-content'].querySelectorAll('.zcode-bucket-button');assert.equal(buttons[0].ownerDocument.activeElement,buttons[3]);
});

test('ZCode 显示事实倒计时、实测图例、采样与真实用量，不把100%当作未使用', () => {
  const h=renderer(),now=Date.now(),items=zcodeItems();items[0].remaining=100;
  const model={sourceId:'zcode',action:'trend',bucketId:'zcode:0',items,trend:{samples:[{at:now-60000,remaining:100},{at:now,remaining:100}],forecast:{state:'unknown',reason:'no-decline',summary:'余额未下降',detail:'已记录时段内额度未下降，暂不预估用完时间'}}};
  h.receive(model);let c=h.nodes['details-content'];
  assert.match(c.querySelector('.trend-stats').textContent,/距刷新/);assert.doesNotMatch(c.querySelector('.trend-stats').textContent,/剩余时间|64%/);
  assert.equal(c.querySelector('.zcode-chart-caption'),null);assert.match(c.querySelector('.chart-help-body').textContent,/实测余额.*时间基准/);
  assert.equal(c.querySelector('.zcode-sample-info'),null);assert.doesNotMatch(c.querySelector('.chart-help-body').textContent,/\d+\s*次采样|\d{2}\/\d{2}/);assert.match(c.querySelector('.zcode-usage-note').textContent,/已用/);
  assert.equal(c.querySelector('.forecast-badge'),null);assert.match(c.querySelector('.forecast-copy').textContent,/当前记录尚无消耗.*记录到消耗后/);assert.doesNotMatch(c.querySelector('.panel-bottom').textContent,/每天重新计算额度/);assert.match(c.querySelector('.panel-bottom p').title,/每天重新计算额度/);
  h.receive({...model,bucketId:'zcode:2'});assert.match(c.querySelector('.panel-bottom').textContent,/使用截止/);assert.match(c.querySelector('.panel-bottom p').title,/到期后剩余额度失效/);
  h.receive({...model,items:[{...items[0],resetsAt:null,periodStart:null,windowMinutes:null,periodKind:'unknown'}]});
  assert.doesNotMatch(c.querySelector('.trend-stats').textContent,/距|—/);assert.equal(c.querySelector('.time-path'),null);
});

test('ZCode 额度明细按已知来源分组，整行可点且保留精确数字和真实单位', () => {
  const h=renderer(),items=zcodeItems();h.receive({sourceId:'zcode',action:'quota',items});
  const c=h.nodes['details-content'];assert.deepEqual(c.querySelectorAll('.zcode-quota-group-title').map(n=>n.textContent),['每日体验','限时活动']);
  const rows=c.querySelectorAll('.zcode-quota-row');assert.equal(rows.length,4);
  assert.match(rows[0].getAttribute('aria-label'),/199,999,123.456789 \/ 200,000,000 tokens/);
  assert.match(rows[0].textContent,/GLM-5.3/);assert.ok(rows[0].querySelector('.zcode-quota-progress'));
  rows[2].events.click();assert.deepEqual(h.calls,[['trend','zcode:2']]);
});

test('ZCode 月活动每日消耗仅显示今日及前六个本地自然日，未知天不伪造用量，完整走势不截断', () => {
  const h=renderer(),now=Date.now(),end=now+86400000,start=now-30*86400000;
  const items=[{...zcodeItems()[2],periodStart:start,resetsAt:end,windowMinutes:31*1440}];
  const samples=[{at:now-60000,remaining:100},{at:now,remaining:100}];
  h.receive({sourceId:'zcode',action:'trend',bucketId:items[0].bucketId,items,trend:{samples}});
  const c=h.nodes['details-content'],line=c.querySelector('.trend-chart');
  c.querySelector('[data-view="daily"]').events.click();
  const daily=c.querySelector('.daily-chart'),dates=daily.querySelectorAll('text').map(n=>n.textContent).filter(s=>/^\d\d\/\d\d$/.test(s));
  assert.equal(dates.length,7);assert.equal(daily.querySelectorAll('.daily-point').length,1);
  assert.equal(daily.querySelectorAll('.daily-empty').length,6);assert.match(c.querySelector('[data-view="daily"]').textContent,/近7日/);assert.match(c.querySelector('.chart-help-body').textContent,/不代表全天/);
  const localStart=new Date(now);localStart.setHours(0,0,0,0);localStart.setDate(localStart.getDate()-6);
  assert.equal(dates[0],`${String(localStart.getMonth()+1).padStart(2,'0')}/${String(localStart.getDate()).padStart(2,'0')}`);
  c.querySelector('[data-view="line"]').events.click();assert.equal(c.querySelector('.trend-chart'),line);
  assert.doesNotMatch(c.querySelector('.chart-help-body').textContent,/次采样|\d{2}\/\d{2}/);
  h.receive({sourceId:'zcode',action:'trend',bucketId:items[0].bucketId,items,trend:{samples:samples.map(sample=>({...sample,at:sample.at-86400000}))}});
  c.querySelector('[data-view="daily"]').events.click();
  assert.equal(c.querySelector('.daily-chart').querySelectorAll('text').filter(n=>/^\d\d\/\d\d$/.test(n.textContent)).length,7,'today remains an unknown day when latest samples were yesterday');
});


test('ZCode 仅有效预估保留直白风险等级，Codex未知预估徽标不变', () => {
  const h=renderer(),items=zcodeItems(),base={sourceId:'zcode',action:'trend',bucketId:items[0].bucketId,items};
  ['missing-period','stale','insufficient-records','discontinuity','value-mismatch','no-decline'].forEach(reason=>{
    h.receive({...base,trend:{forecast:{state:'unknown',reason,summary:'真实原因',detail:'真实说明'}}});
    assert.equal(h.nodes['details-content'].querySelector('.forecast-badge'),null);
  });
  [['risk','可能提前用完'],['tight','接近用完'],['safe','预计够用']].forEach(([status,label])=>{
    h.receive({...base,trend:{forecast:{state:'estimate',reason:'estimate',status,summary:'后端预测',detail:'后端说明',reference:true}}});
    assert.equal(h.nodes['details-content'].querySelector('.forecast-badge').textContent,label);
  });
  h.receive({action:'trend',period:300,items:[item(300)]});
  assert.equal(h.nodes['details-content'].querySelector('.forecast-badge').textContent,'待预估');
});

test('ZCode 百分比不隐藏细小消耗，显示精确已用数量，Codex仍取整', () => {
  const h=renderer(),base=zcodeItems()[0];
  [[100,'100%'],[0,'0%'],[99.8706,'99.9%'],[99.99,'<100%'],[99.95,'<100%'],[0.01,'<0.1%'],[0.05,'0.1%'],[30.333,'30.3%']].forEach(([remaining,text])=>{
    const bucket={...base,remaining,total:5000000,remainingUnits:remaining/100*5000000,unit:'token'};
    h.receive({sourceId:'zcode',action:'trend',bucketId:base.bucketId,items:[bucket]});
    assert.equal(h.nodes['details-content'].querySelector('.trend-stats strong').textContent,text);
    h.receive({sourceId:'zcode',action:'quota',items:[bucket]});
    assert.equal(h.nodes['details-content'].querySelector('.zcode-quota-heading strong').textContent,text);
  });
  h.receive({sourceId:'zcode',action:'trend',bucketId:base.bucketId,items:[{...base,remaining:99.8706,total:5000000,remainingUnits:4993530,unit:'token'}]});
  assert.equal(h.nodes['details-content'].querySelector('.zcode-usage-note').textContent,'本周期已用 6,470 token');
  h.receive({sourceId:'zcode',action:'trend',bucketId:base.bucketId,items:[{...base,remaining:100,total:5000000,remainingUnits:5000000,unit:'token'}]});
  assert.equal(h.nodes['details-content'].querySelector('.zcode-usage-note'),null);
  h.receive({action:'trend',period:300,items:[{...item(300),remaining:99.8706}]});
  assert.equal(h.nodes['details-content'].querySelector('.trend-stats strong').textContent,'100%');
});


test('ZCode 趋势仅展示同类同排的按钮，完整名称留title/aria，选中与原始桶身份不变', () => {
  const h=renderer(),items=zcodeItems(),start=Date.now()-3600000;items.forEach(item=>{item.periodStart=start;item.resetsAt=start+86400000;});
  const mixed=[items[0],items[3],items[2],items[1]],original=mixed.map(item=>item.bucketId);
  h.receive({sourceId:'zcode',action:'trend',bucketId:items[3].bucketId,items:mixed});
  const c=h.nodes['details-content'],buttons=c.querySelectorAll('.zcode-bucket-button');
  assert.deepEqual(buttons.map(b=>b.dataset.bucketOption),[items[0],items[1],items[2],items[3]].map(item=>item.bucketId));
  assert.deepEqual(buttons.map(b=>b.textContent),['体验·5.3','体验·Flash','活动·5.3','活动·Flash']);
  assert.equal(buttons[3].getAttribute('aria-pressed'),'true');assert.equal(c.querySelector('.zcode-bucket-description'),null);
  buttons.forEach((button,index)=>{assert.equal(button.title,`${items[index].planName} · ${items[index].label}`);assert.equal(button.getAttribute('aria-label'),button.title);});
  buttons[1].events.click();assert.deepEqual(h.calls,[['trend',items[1].bucketId]]);assert.deepEqual(mixed.map(item=>item.bucketId),original);
  const unknown=mixed.map((item,index)=>({...item,planName:`真实新套餐${index}`,periodKind:'unknown'}));
  h.receive({sourceId:'zcode',action:'trend',bucketId:unknown[0].bucketId,items:unknown});
  assert.deepEqual(c.querySelectorAll('.zcode-bucket-button').map(b=>b.dataset.bucketOption),original);
  assert.ok(c.querySelectorAll('.zcode-bucket-button').every((button,index)=>button.textContent.includes(unknown[index].planName)));
});


test('ZCode 标签键盘目标滚入视野，普通刷新保留横向位置且不强拉回选中项', () => {
  const h=renderer(),items=zcodeItems(),model={sourceId:'zcode',action:'trend',bucketId:items[0].bucketId,items};h.receive(model);
  const c=h.nodes['details-content'],key=key=>({key,preventDefault(){},stopPropagation(){}});
  let buttons=c.querySelectorAll('.zcode-bucket-button');buttons[0].focus();buttons[0].events.keydown(key('End'));
  assert.equal(buttons[0].ownerDocument.activeElement,buttons[3]);assert.equal(buttons[3].scrollRequests.at(-1).inline,'nearest');
  c.querySelector('.zcode-bucket-grid').scrollLeft=72;h.receive(model);
  assert.equal(c.querySelector('.zcode-bucket-grid').scrollLeft,72);
  buttons=c.querySelectorAll('.zcode-bucket-button');assert.equal(buttons[0].ownerDocument.activeElement,buttons[3]);assert.equal(buttons[3].scrollRequests?.length || 0,0,'ordinary refresh must not reveal or jump rail');
  buttons[3].events.keydown(key('Home'));assert.equal(buttons[0].ownerDocument.activeElement,buttons[0]);assert.equal(buttons[0].scrollRequests.at(-1).inline,'nearest');
});


test('ZCode 图表帮助只留线型与分段短说明，不重复采样次数或起止串，Codex保持原说明', () => {
  const h=renderer(),items=zcodeItems(),now=Date.now(),samples=Array.from({length:180},(_,i)=>({at:now-(179-i)*60000,remaining:100}));
  h.receive({sourceId:'zcode',action:'trend',bucketId:items[0].bucketId,items,trend:{samples}});
  const c=h.nodes['details-content'];let help=c.querySelector('.chart-help-body');
  assert.match(help.textContent,/实测余额.*时间基准.*额度增加或重置时/);
  assert.equal(help.querySelectorAll('.chart-help-foot').length,1);
  assert.doesNotMatch(help.textContent,/次采样|\d{2}\/\d{2}|尚无本周期采样/);
  assert.doesNotMatch(c.querySelector('.chart-updated').title,/次采样|\d{2}\/\d{2}| — /);
  c.querySelector('[data-view="daily"]').events.click();help=c.querySelector('.chart-help-body');
  assert.equal(help.querySelectorAll('.chart-help-foot').length,1);assert.match(help.textContent,/近7日/);assert.doesNotMatch(help.textContent,/次采样|\d{2}\/\d{2}/);
  h.receive({action:'trend',period:300,items:[item(300)],trend:{samples}});
  assert.match(c.querySelector('.chart-updated').title,/已记录至/);assert.match(c.querySelector('.chart-help-body').textContent,/剩余时间参考/);
});
