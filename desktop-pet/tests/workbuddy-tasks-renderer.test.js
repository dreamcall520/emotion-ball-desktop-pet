const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { clean } = require('../workbuddy-tasks-renderer');
const report = { source: 'local-session-cache', scope: 'current-account', observedAt: 100, running: null, pendingReview: 1, total: 2, items: [
  { id: 'one', title: '<img src=x onerror=bad>', status: 'running', unread: false, updatedAt: 50, transport: 'local' },
  { id: 'two', title: '完成的任务', status: 'completed', unread: true, updatedAt: 60, transport: 'cloud' }
] };
test('metadata whitelist bounds rows and rejects global scope, invalid IDs, dates and raw errors', () => {
  assert.equal(clean({ report: { ...report, scope: 'global' } }).report, null);
  const model = clean({ error: 'secret-token', report: { ...report, items: Array.from({ length: 130 }, (_, i) => ({ id: `task-${i}`, title: 'x'.repeat(400), updatedAt: Infinity, status: 'unknown', unread: true, token: 'secret' })) } });
  assert.equal(model.report.items.length, 100); assert.equal(model.report.items[0].title.length, 240);
  assert.equal(model.report.items[0].updatedAt, null); assert.equal(JSON.stringify(model).includes('secret'), false);
  assert.equal(clean({ report: { ...report, items: [{ id: '../x' }] } }).report.items.length, 0);
});
function fixture() {
  class Element {
    constructor(tag='div') { this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.events={};this.hidden=false;this.own=''; }
    set textContent(value) { this.own=String(value); this.children=[]; }
    get textContent() { return this.own+this.children.map(c=>c.textContent).join(''); }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.own='';this.children=children; }
    setAttribute(k,v) { this.attributes[k]=String(v); }
    addEventListener(k,v) { this.events[k]=v; }
    walk() { return [this,...this.children.flatMap(c=>c.walk())]; }
  }
  const roots=['quota-view','task-view','details-title'].map(id=>Object.assign(new Element(),{id}));
  const document={createElement:tag=>new Element(tag),getElementById:id=>roots.flatMap(r=>r.walk()).find(n=>n.id===id)};
  let refreshed=0,resized=0;
  const window={document,petWorkBuddyDetails:{refreshTasks(){refreshed++;}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../workbuddy-tasks-renderer.js'),'utf8'),{window,Date});
  return { document, window, get:id=>document.getElementById(id), render:value=>window.workBuddyTasksView.render(value,()=>resized++), counts:()=>({refreshed,resized}) };
}
test('tasks and cached unread tabs use textContent, expand metadata locally and restore quota view', () => {
  const f=fixture(),value={action:'tasks',tasks:{report}};
  assert.equal(f.render(value),true); assert.equal(f.get('quota-view').hidden,true);
  assert.match(f.get('task-view').textContent,/实时状态未同步/);
  assert.match(f.get('task-view').textContent,/上次已完成/);
  assert.match(f.get('tasks-scope').textContent,/本机已同步/);
  assert.equal(f.get('tasks-list').children.length,2);
  assert.equal(f.get('task-view').walk().some(n=>n.tagName==='img'),false);
  const row=f.get('tasks-list').children[0].children[0];
  row.events.click(); assert.equal(row.attributes['aria-expanded'],'true');
  assert.equal(f.get('task-metadata-0').hidden,false); assert.equal(report.items[1].unread,true);
  assert.match(f.get('task-metadata-0').textContent,/不会读取正文或修改待查看/);
  f.get('task-tab-results').events.click(); assert.equal(f.get('tasks-list').children.length,1);
  assert.match(f.get('details-title').textContent,/待查看/);
  f.get('tasks-refresh').events.click(); assert.equal(f.counts().refreshed,1);
  assert(f.counts().resized>=3);
  assert.equal(f.render({action:'trend'}),false); assert.equal(f.get('quota-view').hidden,false);
  assert.equal(f.get('task-view').hidden,true); assert.match(f.get('details-title').textContent,/积分变化/);
});
test('loading, failure, missing cache and results empty states stay distinct', () => {
  const f=fixture();
  f.render({action:'tasks',tasks:{busy:true}}); assert.match(f.get('tasks-empty').textContent,/正在读取/); assert.equal(f.get('tasks-refresh').disabled,true);
  f.render({action:'tasks',tasks:{error:'private'}}); assert.equal(f.get('tasks-error').textContent,'任务读取失败，请刷新重试');
  assert.doesNotMatch(f.get('task-view').textContent,/private/);
  f.render({action:'results',tasks:{report:{...report,pendingReview:0,items:[]}}});
  assert.match(f.get('tasks-empty').textContent,/本机已同步记录中暂无待查看/);
  assert.match(f.get('task-tab-results').textContent,/0/);
});
