const test = require('node:test');
const assert = require('node:assert/strict');
const { weatherContext, weatherReminder, MAX_AGE } = require('../lib/weather-context');
const now = Date.now();
const state = { enabled: true, updatedAt: now, city: { name: '北京' }, current: { temperature: 19, apparentTemperature: 18, weatherCode: 2, windSpeed: 8 },
  daily: [{ min: 12, max: 21, precipitationProbability: 80 }], airQuality: { aqi: 88, standard: 'us' } };

test('context supplies measured facts only for weather and outing messages', () => {
  const context = weatherContext(state, '一会儿出门吃饭', now);
  for (const text of ['北京', '当前19°C', '体感18°C', '晴间多云', '今日12～21°C', '概率80%', 'US AQI（美国标准）88', new Date(now).toISOString()]) assert(context.includes(text), text);
  assert.equal(weatherContext(state, '帮我修改代码', now), '');
  assert.equal(weatherContext(state, null, now), '');
});
test('context rejects disabled, stale, incomplete and future weather', () => {
  for (const s of [null, { ...state, enabled: false }, { ...state, updatedAt: now - MAX_AGE - 1 },
    { ...state, updatedAt: now + 120000 }, { ...state, current: { temperature: null } }]) {
    assert.equal(weatherContext(s, '天气', now), '');
    assert.equal(weatherReminder(s, 'play', now), '');
  }
  assert(weatherContext({ ...state, current: { ...state.current, temperature: 0 } }, '天气', now).includes('当前0°C'));
});
test('unknown AQI standard is omitted rather than relabeled US AQI', () => {
  const context = weatherContext({ ...state, airQuality: { aqi: 88, standard: 'cn' } }, '空气', now);
  assert(!context.includes('美国标准）88'));
});
test('reminders are grounded, contextual and suppressible', () => {
  assert(weatherReminder(state, 'pet', now).includes('预报降水概率80%'));
  assert(weatherReminder({ ...state, current: { ...state.current, weatherCode: 61 } }, 'play', now).includes('可能有雨'));
  assert(weatherReminder({ ...state, current: { ...state.current, windSpeed: 30 } }, 'edge', now).includes('贴稳'));
  assert.equal(weatherReminder(state, { event: 'pet', quiet: true }, now), '');
  assert.equal(weatherReminder(state, 'unrelated', now), '');
  assert.equal(weatherReminder({ ...state, daily: [{ precipitationProbability: 10 }] }, 'play', now), '');
});

test('old model data cannot drive reminders or conversation even if freshly retrieved', () => {
  const old = { ...state, current: { ...state.current, time: now - 91 * 60000, weatherCode: 61 } };
  assert.equal(weatherContext(old, '天气怎么样', now), '');
  assert.equal(weatherReminder(old, 'play', now), '');
});


test('rain, cold and air reminders use compact edge copy and natural interaction copy', () => {
 const cases=[
  [{current:{...state.current,weatherCode:61}},'外面可能有雨，带把伞呀。','可能有雨，出门带把伞呀。'],
  [{current:{...state.current,temperature:5}},'外面有点冷，穿暖一点呀。','外面有点冷，出门加件衣服呀。'],
  [{airQuality:{aqi:155,standard:'us'}},'US AQI 155，出门留意空气呀。','US AQI 155，出门前看看空气质量呀。']
 ];
 for(const [patch,edge,interaction] of cases){
  const sample={...state,daily:[],...patch};
  assert.equal(weatherReminder(sample,'edge',now),edge);
  assert.equal(weatherReminder(sample,'pet',now),interaction);
  assert.equal(weatherReminder(sample,'play',now),interaction);
 }
 assert.equal(weatherReminder({...state,daily:[],airQuality:{aqi:155,standard:'cn'}},'edge',now),'');
});
test('stale and failed snapshots do not remind even with recent retrieval and model timestamps',()=>{
 for(const status of ['stale','error']) assert.equal(weatherReminder({...state,status,current:{...state.current,time:now,weatherCode:61}},'edge',now),'');
 assert.equal(weatherReminder(state,{event:'edge',sleeping:true},now),'');
});
