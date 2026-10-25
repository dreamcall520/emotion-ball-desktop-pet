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
    appendChild(child) { child.parentNode=this;this.children.push(child);return child; }
    insertBefore(child,before) { child.parentNode=this;this.children.splice(this.children.indexOf(before),0,child);return child; }
    replaceChildren(...children) { this.own='';this.children=[];children.forEach(c=>this.appendChild(c)); }
    setAttribute(k,v) { this.attributes[k]=String(v); }
    addEventListener(k,v) { this.events[k]=v; }
    walk() { return [this,...this.children.flatMap(c=>c.walk())]; }
  }
  const roots=['quota-view','task-view','panel-header'].map(id=>Object.assign(new Element(),{id}));
  roots[2].appendChild(Object.assign(new Element('h1'),{id:'details-title'}));
  roots[2].appendChild(Object.assign(new Element('nav'),{className:'panel-tools'}));
  const all=()=>roots.flatMap(r=>r.walk());
  const document={createElement:tag=>new Element(tag),createElementNS:(_ns,tag)=>new Element(tag),getElementById:id=>all().find(n=>n.id===id),querySelector:selector=>all().find(n=>n.className===selector.slice(1))};
  let refreshed=0,resized=0,cleared=0;const opened=[];
  const window={document,petWorkBuddyDetails:{refreshTasks(){refreshed++;},openTask(id){opened.push(id);},clearTasks(){cleared++;}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../workbuddy-tasks-renderer.js'),'utf8'),{window,Date});
  return {document,window,get:id=>document.getElementById(id),render:value=>window.workBuddyTasksView.render(value,()=>resized++),counts:()=>({refreshed,resized,cleared,opened})};
}
test('running view never treats historical status as confirmed activity; results open sessions and clear only via owned bridge', () => {
  const f=fixture(),value={action:'tasks',tasks:{report}};
  assert.equal(f.render(value),true);assert.equal(f.get('quota-view').hidden,true);
  assert.equal(f.get('tasks-empty').textContent,'暂无可确认的进行中任务');
  assert.equal(f.get('tasks-list'),undefined);
  assert.doesNotMatch(f.get('task-view').textContent,/实时进行中数量|最近任务|完成的任务/);
  assert.equal(f.get('details-read-all').hidden,true);
  f.get('task-tab-results').events.click();assert.equal(f.get('tasks-list').children.length,1);
  assert.match(f.get('details-title').textContent,/待查看/);
  const row=f.get('tasks-list').children[0].children[0];row.events.click();
  assert.deepEqual(f.counts().opened,['two']);assert.equal(report.items[1].unread,true);
  assert.equal(f.get('task-metadata-0'),undefined);
  f.get('details-read-all').events.click();assert.equal(f.counts().cleared,1);
  assert.match(f.get('details-read-all').title,/不修改 WorkBuddy/);
  f.get('tasks-refresh').events.click();assert.equal(f.counts().refreshed,1);
  assert.equal(f.get('task-view').walk().some(n=>n.tagName==='img'),false);
  assert.equal(f.render({action:'trend'}),false);assert.equal(f.get('quota-view').hidden,false);
  assert.equal(f.get('task-view').hidden,true);assert.equal(f.get('details-read-all').hidden,true);
});
test('loading, failure and empty states remain safe; text markup never becomes HTML', () => {
  const f=fixture();
  f.render({action:'tasks',tasks:{busy:true}});assert.match(f.get('tasks-empty').textContent,/正在读取/);assert.equal(f.get('tasks-refresh').disabled,true);
  f.render({action:'tasks',tasks:{error:'private'}});assert.equal(f.get('tasks-error').textContent,'任务读取失败，请刷新重试');assert.doesNotMatch(f.get('task-view').textContent,/private/);
  f.render({action:'results',tasks:{report:{...report,pendingReview:0,items:[]}}});assert.equal(f.get('tasks-empty').textContent,'暂无待查看任务');
  assert.equal(f.get('details-read-all').hidden,true);
  f.render({action:'results',tasks:{report:{...report,items:[{...report.items[0],unread:true}]}}});
  assert.match(f.get('tasks-list').textContent,/<img src=x onerror=bad>/);
  assert.equal(f.get('task-view').walk().some(n=>n.tagName==='img'),false);
});
