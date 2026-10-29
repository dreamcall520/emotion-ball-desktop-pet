'use strict';

const MAX_AGE = 60 * 60 * 1000;
const WEATHER_TOPIC = /天气|出门|出去|出行|外面|下雨|下雪|雨伞|带伞|冷|热|温度|气温|风|空气|雾霾|weather|outside|rain|snow|temperature|forecast|\baqi\b/i;
function weatherName(code) {
  if (code === 0) return '晴';
  if ([1, 2].includes(code)) return '晴间多云';
  if (code === 3) return '阴';
  if ([45, 48].includes(code)) return '雾';
  if ([51, 53, 55].includes(code)) return '毛毛雨';
  if ([56, 57, 66, 67].includes(code)) return '冻雨';
  if ([61, 63, 65].includes(code)) return '雨';
  if ([71, 73, 75, 77].includes(code)) return '雪';
  if ([80, 81, 82].includes(code)) return '阵雨';
  if ([85, 86].includes(code)) return '阵雪';
  if ([95, 96, 99].includes(code)) return '雷雨';
  return '';
}
function validWeather(state, now) {
  const updated = typeof state?.updatedAt === 'number' ? state.updatedAt : Date.parse(state?.updatedAt);
  return state?.enabled !== false && state?.status !== 'stale' && state?.status !== 'error' && (!Number.isFinite(state?.current?.time) || (state.current.time <= now + 15 * 60000 && now - state.current.time <= 90 * 60000)) && state?.current && Number.isFinite(state.current.temperature) &&
    state.current.temperature >= -100 && state.current.temperature <= 70 && Number.isFinite(updated) &&
    updated <= now + 60000 && now - updated <= MAX_AGE;
}
const value = number => Math.round(number * 10) / 10;
function weatherContext(state, text, now = Date.now()) {
  if (typeof text !== 'string' || !WEATHER_TOPIC.test(text) || !validWeather(state, now)) return '';
  const current = state.current, today = state.daily?.[0], city = state.city || state.location;
  const name = typeof city?.name === 'string' ? city.name.replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 80) : '所选位置';
  const facts = [`城市=${JSON.stringify(name)}`, `当前${value(current.temperature)}°C`];
  if (Number.isFinite(current.apparentTemperature)) facts.push(`体感${value(current.apparentTemperature)}°C`);
  const condition = weatherName(current.weatherCode);
  if (condition) facts.push(condition);
  if (Number.isFinite(today?.min) && Number.isFinite(today?.max) && today.min <= today.max) facts.push(`今日${value(today.min)}～${value(today.max)}°C`);
  if (Number.isFinite(today?.precipitationProbability) && today.precipitationProbability >= 0 && today.precipitationProbability <= 100) facts.push(`今日预报降水概率${Math.round(today.precipitationProbability)}%`);
  const air = state.airQuality;
  if (air?.standard === 'us' && Number.isFinite(air.aqi) && air.aqi >= 0) facts.push(`US AQI（美国标准）${Math.round(air.aqi)}`);
  facts.push(`数据更新于${new Date(state.updatedAt).toISOString()}`);
  return '天气模型参考数据（不是气象站实测，只在相关对话中使用；预报不代表一定发生；US AQI不得改称中国AQI）：' + facts.join('；') + '。';
}
function weatherReminder(state, context, now = Date.now()) {
  const event = typeof context === 'string' ? context : context?.event;
  if (!['play', 'pet', 'edge'].includes(event) || !validWeather(state, now) || context?.quiet === true || context?.sleeping === true) return '';
  const current = state.current, code = current.weatherCode, edge = event === 'edge';
  if ([95, 96, 99].includes(code)) return edge ? '可能有雷雨，出门留意呀。' : '可能有雷雨，出门前看一眼天气呀。';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return edge ? '外面可能有雨，带把伞呀。' : '可能有雨，出门带把伞呀。';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return edge ? '可能有雪，走路慢一点呀。' : '可能有雪，穿暖点，慢慢走呀。';
  if (current.temperature <= 10 || (Number.isFinite(current.apparentTemperature) && current.apparentTemperature <= 8)) return edge ? '外面有点冷，穿暖一点呀。' : '外面有点冷，出门加件衣服呀。';
  if (current.temperature >= 32 || (Number.isFinite(current.apparentTemperature) && current.apparentTemperature >= 35)) return edge ? '外面有点热，记得喝水呀。' : '玩一会儿也喝口水吧，出门记得防晒。';
  if (Number.isFinite(current.windSpeed) && current.windSpeed >= 28) return edge ? '风有点大，我先贴稳啦。' : '外面风有点大，出门留意一下呀。';
  const air = state.airQuality;
  if (air?.standard === 'us' && Number.isFinite(air.aqi) && air.aqi > 100) return edge ? `US AQI ${Math.round(air.aqi)}，出门留意空气呀。` : `US AQI ${Math.round(air.aqi)}，出门前看看空气质量呀。`;
  const probability = state.daily?.[0]?.precipitationProbability;
  if (Number.isFinite(probability) && probability >= 60 && probability <= 100) return edge ? '今天可能下雨，带把伞呀。' : `今天预报降水概率${Math.round(probability)}%，带把伞更安心。`;
  return '';
}
module.exports = { MAX_AGE, validWeather, weatherName, weatherContext, weatherReminder };
