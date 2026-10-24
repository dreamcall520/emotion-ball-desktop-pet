const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('renderer distinguishes zero/stale/no data and only sums matching expiry times', () => {
  const elements = new Map(); let render, colorMode;
  const document = { documentElement:{dataset:{}},body:{dataset:{}},getElementById(id) {
    if (!elements.has(id)) elements.set(id,{textContent:'',dataset:{},addEventListener(){},setAttribute(){}});
    return elements.get(id);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../workbuddy-label-renderer.js'),'utf8'),{document,window:{qiuqiuWorkBuddyLabel:{onState(cb){render=cb;},onColorMode(cb){colorMode=cb;}}}});
  colorMode('accessible','dark','blue');
  assert.equal(document.documentElement.dataset.colorMode,'accessible');
  assert.equal(document.documentElement.dataset.uiTheme,'blue');
  assert.equal(document.documentElement.dataset.accessibleAppearance,'dark');
  const report={total:0,basic:0,reward:0,purchased:0,plan:'体验版',nextRefreshAt:20,updatedAt:10,expires:[{amount:100,at:30},{amount:20,at:30},{amount:6000,at:40}]};
  render({report,expanded:true,appearance:'dark'});
  assert.equal(elements.get('total').textContent,'0');
  assert.equal(elements.get('expanded-total').textContent,'0');
  assert.match(elements.get('expiry').title,/120 积分/);
  assert.doesNotMatch(elements.get('expiry').title,/6,120/);
  render({report:{...report,total:7400},expanded:true});
  assert.equal(elements.get('expanded-total').textContent,'7,400');
  render({report,stale:true,expanded:true});
  assert.equal(elements.get('total').textContent,'0');
  assert.equal(elements.get('expanded-total').textContent,'0');
  assert.match(elements.get('status').textContent,/失效/);
  assert.equal(elements.get('period').textContent,'失效');
  assert.match(elements.get('api-month-cost').title,/旧数据已失效/);
  render({report:null,expanded:false,spaceError:true});
  assert.equal(elements.get('total').textContent,'—');
  assert.equal(elements.get('expanded-total').textContent,'—');
  assert.equal(elements.get('api-month-cost').dataset.empty,'true');
  assert.match(elements.get('toggle').title,/空间不足/);
});

test('card reuses quota/API visual styles and shared accessibility tokens', () => {
  const html = fs.readFileSync(path.join(__dirname,'../workbuddy-label.html'),'utf8');
  const css = fs.readFileSync(path.join(__dirname,'../workbuddy-label.css'),'utf8');
  for (const sheet of ['quota-label.css','api-usage-label.css','color-mode.css']) assert.ok(html.includes(sheet));
  for (const name of ['quota-beam','quota-label','summary-badge','summary-value','compact-header','period-pill']) assert.ok(html.includes(name));
  assert.match(css,/var\(--quota-subtle\)/);
  assert.doesNotMatch(css,/#[0-9a-f]{3,8}\b/i);
});
