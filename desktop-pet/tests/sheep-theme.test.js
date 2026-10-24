const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { THEMES, normalizeTheme, resolveTheme } = require('../lib/sheep-theme');

test('节日配置缺省无妆造，拒绝未知值，手动选择不随日期变化', () => {
  assert.ok(Object.isFrozen(THEMES));
  for (const value of [undefined, null, '', '__proto__', 'constructor', {}, [], 'Halloween']) {
    assert.equal(normalizeTheme(value), 'none');
    assert.equal(resolveTheme(value, new Date(2026, 9, 31)), 'none');
  }
  for (const theme of ['none', 'halloween', 'christmas', 'spring-festival']) {
    for (const date of [new Date(2026, 0, 1), new Date(2026, 9, 31), new Date(2026, 11, 25), new Date('bad')]) {
      assert.equal(resolveTheme(theme, date), theme);
    }
  }
});

test('万圣与圣诞自动妆造保持原本提前五天至节日当日', () => {
  const cases = [
    [9,25,23,59,'none'], [9,26,0,0,'halloween'], [9,31,23,59,'halloween'], [10,1,0,0,'none'],
    [11,19,23,59,'none'], [11,20,0,0,'christmas'], [11,25,23,59,'christmas'], [11,26,0,0,'none'],
    [0,1,0,0,'none'], [11,31,23,59,'none']
  ];
  for (const year of [2026,2027,2028]) {
    for (const [month,day,hour,minute,expected] of cases) {
      assert.equal(resolveTheme('auto', new Date(year,month,day,hour,minute)), expected, `${year}/${month+1}/${day}`);
    }
  }
  assert.equal(resolveTheme('auto', new Date('bad')), 'none');
  assert.equal(resolveTheme('auto', '2026-10-31'), 'none');
  assert.equal(resolveTheme('auto'), 'none', '纯解析函数只使用调用方提供的日期');
});

test('春节跟随中国农历正月初一，覆盖跨月、跨年、闰月和整日边界', () => {
  for (const [year, month, day] of [[2026,1,17], [2027,1,6], [2028,0,26], [2029,1,13], [2033,0,31], [2034,1,19]]) {
    const start = new Date(year, month, day - 6);
    assert.equal(resolveTheme('auto', new Date(year, month, day - 7, 23, 59)), 'none');
    const before = start.getTime();
    assert.equal(resolveTheme('auto', start), 'spring-festival');
    assert.equal(start.getTime(), before, '不修改调用方的日期');
    assert.equal(resolveTheme('auto', new Date(year, month, day, 23, 59)), 'spring-festival');
    assert.equal(resolveTheme('auto', new Date(year, month, day + 14, 23, 59, 59, 999)), 'spring-festival', '十五全天保留');
    assert.equal(resolveTheme('auto', new Date(year, month, day + 15)), 'none', '十六零点回日常');
  }
  for (const date of [new Date(2023,2,22), new Date(2025,6,25), new Date(2026,11,31), new Date(2027,0,1)]) {
    assert.equal(resolveTheme('auto', date), 'none', '闰月初一与公历跨年不能触发春节');
  }
});

test('春节离线日期表覆盖2026至2040，范围外不猜测，手动春节不受年份限制', () => {
  const dates = [[2026,1,17], [2027,1,6], [2028,0,26], [2029,1,13], [2030,1,3], [2031,0,23],
    [2032,1,11], [2033,0,31], [2034,1,19], [2035,1,8], [2036,0,28], [2037,1,15], [2038,1,4],
    [2039,0,24], [2040,1,12]];
  for (const [year, month, day] of dates) {
    for (let offset = -7; offset <= 15; offset++) {
      assert.equal(resolveTheme('auto', new Date(year, month, day + offset)),
        offset >= -6 && offset <= 14 ? 'spring-festival' : 'none', `${year}: ${offset}`);
    }
  }
  assert.equal(resolveTheme('auto', new Date(2041,1,1)), 'none');
  assert.equal(resolveTheme('spring-festival', new Date(2041,1,1)), 'spring-festival');
});

test('浏览器入口与 CommonJS 共用纯函数，不修改选择或日期', () => {
  const window = {};
  const source = fs.readFileSync(path.join(__dirname, '../lib/sheep-theme.js'), 'utf8');
  vm.runInNewContext(source, { window, Date });
  const date = new Date(2026, 9, 26), before = date.getTime();
  assert.equal(window.SheepTheme.resolveTheme('auto', date), 'halloween');
  assert.equal(date.getTime(), before);
  assert.equal(window.SheepTheme.normalizeTheme('christmas'), 'christmas');
});


test('春节新窗口跨公历月并在公历年切换后仍按对应农历初一计算', () => {
  for (const [date, expected] of [
    [new Date(2026,11,31,23,59,59,999),'none'], [new Date(2027,0,1),'none'],
    [new Date(2027,0,30,23,59,59,999),'none'], [new Date(2027,0,31),'spring-festival'],
    [new Date(2027,1,6),'spring-festival'], [new Date(2027,1,20,23,59,59,999),'spring-festival'],
    [new Date(2027,1,21),'none'],
    [new Date(2028,0,19,23,59,59,999),'none'], [new Date(2028,0,20),'spring-festival'],
    [new Date(2028,1,9,23,59,59,999),'spring-festival'], [new Date(2028,1,10),'none'],
    [new Date(2034,1,12,23,59,59,999),'none'], [new Date(2034,1,13),'spring-festival'],
    [new Date(2034,2,5,23,59,59,999),'spring-festival'], [new Date(2034,2,6),'none']
  ]) assert.equal(resolveTheme('auto', date), expected, date.toString());
});
