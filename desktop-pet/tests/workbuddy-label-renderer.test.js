const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('renderer distinguishes zero/stale/no data and only sums matching expiry times', () => {
  const elements = new Map(); let render;
  const document = { documentElement:{dataset:{}},body:{dataset:{}},getElementById(id) {
    if (!elements.has(id)) elements.set(id,{textContent:'',addEventListener(){},setAttribute(){}});
    return elements.get(id);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../workbuddy-label-renderer.js'),'utf8'),{document,window:{qiuqiuWorkBuddyLabel:{onState(cb){render=cb;}}}});
  const report={total:0,basic:0,reward:0,purchased:0,plan:'体验版',nextRefreshAt:20,updatedAt:10,expires:[{amount:100,at:30},{amount:20,at:30},{amount:6000,at:40}]};
  render({report,expanded:true,appearance:'dark'});
  assert.equal(elements.get('total').textContent,'0 积分');
  assert.match(elements.get('expiry').textContent,/120 积分/);
  assert.doesNotMatch(elements.get('expiry').textContent,/6,120/);
  render({report,stale:true,expanded:true});
  assert.equal(elements.get('total').textContent,'0 · 失效');
  assert.match(elements.get('status').textContent,/失效/);
  render({report:null,expanded:false,spaceError:true});
  assert.equal(elements.get('total').textContent,'未更新');
  assert.match(elements.get('toggle').title,/空间不足/);
});
