const test = require('node:test');
const assert = require('node:assert/strict');
const { syntheticSnapshot, detailFixtures, assertCardLayout, assertContentEdges,
  assertDetailsSurface, assertFilledPixels, isRenderedDetailNode, contrast, sampleContrast } = require('../scripts/verify-codex-status-v20');
const { buildQuotaLabelModel, buildCodexDetailsModel } = require('../lib/codex-quota-view');

test('v20 原生验收只用合成数据，比例与重置剩余时间一致且不虚构缺失周期', () => {
  const now = Date.parse('2026-10-04T12:00:00+08:00');
  for (const periods of [[300], [10080], [300, 10080]]) {
    const snapshot = syntheticSnapshot(now, periods);
    const model = buildQuotaLabelModel(snapshot, {}, now);
    assert.equal(model.items.length, periods.length);
    if (periods[0] === 300) assert.equal(model.items[0].pace.state, 'fast');
    else assert.equal(model.items[0].pace.state, 'balanced');
    assert.equal(model.activity.runningCount, 3);
    assert.equal(snapshot.history.results.length, 0);
    assert.ok(snapshot.history.windows.every(window => window.samples.at(-1).remaining === window.remaining));
    assert.doesNotMatch(JSON.stringify(snapshot), /sk-|auth\.json|chat\.json|\/Users\//);
  }
  const weekly = buildCodexDetailsModel(syntheticSnapshot(now, [10080]), { action: 'trend' }, now);
  assert.ok(weekly.trend.samples.length > 721, '周验收包含超过24小时连续观察，不被旧192条上限挡住');
});

test('v20 可见布局检查会拒绝旧尺寸、裁切与误把周期比例叫余额', () => {
  const view = { width: 196, height: 144, periodCount: 2, caption: '本周期剩余',
    overflow: false, fits: true, unreadBorder: '0px', values: ['44%', '62%'],
    panel:{left:0,top:0,right:196,bottom:144},viewport:{width:196,height:144},contentBounds:{width:196,height:144} };
  assert.doesNotThrow(() => assertCardLayout(view, 2));
  for (const patch of [{ height: 128 }, { width: 168 }, { fits: false }, { overflow: true },
    { caption: '剩余额度' }, { unreadBorder: '1px' }]) assert.throws(() => assertCardLayout({ ...view, ...patch }, 2));
});

test('native 四边检查拒绝内缩、高度差、透明带和系统黑边，允许完整玻璃底层及1px绘制舍入', () => {
  const view={panel:{left:0,top:0,right:320,bottom:180},viewport:{width:320,height:180},
    contentBounds:{width:320,height:180},overflow:false,contentFits:true,nativeHasShadow:false,
    surface:{color:'rgba(0, 0, 0, 0)',image:'linear-gradient(rgb(255, 255, 255),rgb(247, 251, 255),rgb(239, 245, 255))',opacity:1}};
  assert.doesNotThrow(()=>assertDetailsSurface(view));
  assert.doesNotThrow(()=>assertDetailsSurface({...view,surface:{color:'rgba(244, 249, 255, .94)',image:'linear-gradient(rgba(255, 255, 255, .52), transparent)',opacity:1}}));
  assert.doesNotThrow(()=>assertDetailsSurface({...view,panel:{...view.panel,bottom:179.5}}));
  for(const patch of [{panel:{left:8,top:8,right:312,bottom:172}},
    {contentBounds:{width:320,height:196}},{contentFits:false},{overflow:true},{nativeHasShadow:true},
    {surface:{...view.surface,image:'linear-gradient(rgba(255, 255, 255, .4), transparent)'}},
    {surface:{...view.surface,opacity:.9}}])assert.throws(()=>assertDetailsSurface({...view,...patch}));
  assert.throws(()=>assertContentEdges({...view,panel:{...view.panel,left:2}},'收起主卡'));
  const pixels=Array.from({length:8},(_,index)=>({name:`edge-${index}`,alpha:255}));
  assert.doesNotThrow(()=>assertFilledPixels(pixels));
  assert.doesNotThrow(()=>assertFilledPixels(pixels.map(pixel=>({...pixel,alpha:240}))));
  assert.throws(()=>assertFilledPixels([...pixels.slice(0,7),{name:'inner-corner',alpha:0}]));
  assert.throws(()=>assertFilledPixels([...pixels.slice(0,7),{name:'inner-corner',alpha:239}]));
});

test('R2 打包矩阵同时保留任务与结果空态、单周/双周期、精确长数余额', () => {
  const now=Date.parse('2026-10-04T12:00:00+08:00');
  const fixtures=detailFixtures(now);
  assert.deepEqual(fixtures.map(value=>value.name),['tasks-data','tasks-empty','results-data','results-empty',
    'trend-both','trend-five','trend-week','reset-available','reset-no-history','credits-decimal','credits-long']);
  const models=Object.fromEntries(fixtures.map(fixture=>[fixture.name,buildCodexDetailsModel(fixture.snapshot,{action:fixture.action},now)]));
  assert.equal(models['tasks-data'].activity.runningCount,3);
  assert.equal(models['tasks-empty'].activity.runningCount,0);
  assert.equal(models['results-data'].results.length,1);
  assert.equal(models['results-empty'].results.length,0);
  assert.deepEqual(models['trend-week'].items.map(item=>item.windowMinutes),[10080]);
  assert.equal(models['trend-week'].items[0].pace.state,'balanced');
  assert.equal(models['trend-both'].items.length,2);
  assert.equal(models['reset-available'].resetOpportunities.length,2);
  assert.equal(models['reset-no-history'].resetCreditsAvailable,2);
  assert.equal(models['reset-no-history'].resetHistory.length,0);
  assert.equal(models['credits-long'].extraCredits.balance,'12345678901234567890.125');
  assert.equal(fixtures.at(-1).expectedBalance,'12,345,678,901,234,567,890.13');
});

test('历史折叠时仅其首个 summary 可见，不把仍有 rect 的隐藏表格算作裁切', () => {
  const node=tagName=>({tagName,children:[],getClientRects:()=>[{}],
    contains(target){return this.children.some(child=>child===target||child.contains(target));}});
  const details=node('DETAILS'),summary=node('SUMMARY'),summaryText=node('SPAN'),table=node('UL'),row=node('SPAN');
  const append=(parent,child)=>{parent.children.push(child);child.parentElement=parent;};
  append(details,summary);append(summary,summaryText);append(details,table);append(table,row);
  const styleOf=value=>({display:value.hidden?'none':'block'});
  assert.equal(isRenderedDetailNode(summary,styleOf),true);
  assert.equal(isRenderedDetailNode(summaryText,styleOf),true);
  assert.equal(isRenderedDetailNode(row,styleOf),false);
  details.open=true;
  assert.equal(isRenderedDetailNode(row,styleOf),true);
  table.hidden=true;
  assert.equal(isRenderedDetailNode(row,styleOf),false);
  summary.getClientRects=()=>[];
  assert.equal(isRenderedDetailNode(summary,styleOf),false);
});

test('色弱对比采样包含不透明渐变最弱端点和半透明角标底色', () => {
  assert.ok(Math.abs(contrast([255, 224, 138], [24, 36, 50]) - 12.175) < .001);
  const sample = { color: 'rgb(113, 82, 0)', opacity: 1, backgrounds: [
    { color: 'rgba(0, 0, 0, 0)', image: 'linear-gradient(rgb(255, 255, 255), rgb(247, 251, 255), rgb(239, 245, 255))' }
  ] };
  assert.ok(sampleContrast(sample) > 6.59 && sampleContrast(sample) < 6.60);
  assert.ok(sampleContrast({ ...sample, color: 'rgb(7, 86, 155)', backgrounds: [
    { color: 'rgba(7, 86, 155, 0.08)', image: 'none' }, ...sample.backgrounds
  ] }) >= 4.5);
});
