const test = require('node:test');
const assert = require('node:assert/strict');
const { createWeatherService, parseForecast, parseAirQuality, CACHE_MS } = require('../lib/weather-service');
const modelTime = Date.parse('2026-10-28T06:00Z');
const location = { latitude: 39.9, longitude: 116.4, name: '北京', mode: 'current' };
const fixture = () => ({ timezone: 'Asia/Shanghai', utc_offset_seconds: 28800,
  current: { time: '2026-10-28T14:00', temperature_2m: -2, apparent_temperature: -4, weather_code: 3, is_day: 1, relative_humidity_2m: 45, wind_speed_10m: 12, wind_direction_10m: 30 },
  hourly: { time: ['2026-10-28T13:00', '2026-10-28T14:00', '2026-10-28T15:00'], temperature_2m: [0, -2, null], weather_code: [1, 3, 3], precipitation_probability: [0, 20, null] },
  daily: { time: ['2026-10-28'], temperature_2m_min: [-5], temperature_2m_max: [0], weather_code: [3], sunrise: ['2026-10-28T06:00'], sunset: ['2026-10-28T18:00'], precipitation_probability_max: [30] } });
const response = body => ({ ok: true, json: async () => body });
const air = () => ({ utc_offset_seconds: 28800, current: { time: '2026-10-28T14:00', us_aqi: 120, pm2_5: 32 } });
test('negative/zero temperature, missing fields, city timezone and AQI standard remain truthful', () => {
  const data = parseForecast(fixture(), location);
  assert.equal(data.current.temperature, -2); assert.equal(data.current.apparentTemperature, -4);
  assert.equal(data.current.time, Date.parse('2026-10-28T06:00Z'));
  assert.equal(data.daily[0].max, 0); assert.equal(data.daily[0].uvIndex, null);
  assert.equal(data.hourly.length, 2); assert.equal(data.hourly[1].temperature, null);
  assert.equal(parseAirQuality(air()).standard, 'us'); assert.equal(parseAirQuality(air()).ringIntensity, .22);
  assert.equal(parseAirQuality({ current: { us_aqi: null } }), null);
  const missing = fixture(); missing.current.temperature_2m = null;
  assert.throws(() => parseForecast(missing, location), { code: 'INVALID_RESPONSE' });
  const reversed = fixture(); reversed.daily.temperature_2m_max = [-9];
  assert.throws(() => parseForecast(reversed, location), { code: 'INVALID_RESPONSE' });
});
test('concurrent requests deduplicate, cache for 30 minutes, expired failure returns same-city stale data', async () => {
  let count = 0, time = modelTime, fail = false;
  const service = createWeatherService({ now: () => time, fetch: async url => { count++; if (fail) throw Error('private upstream'); return response(url.includes('air-quality') ? air() : fixture()); } });
  const [first, second] = await Promise.all([service.getWeather(location), service.getWeather(location, { force: true })]);
  assert.equal(count, 2); assert.equal(first.updatedAt, second.updatedAt); assert.equal(first.status, 'ready');
  assert.equal((await service.getWeather(location)).fromCache, true); assert.equal(count, 2);
  time += CACHE_MS; fail = true;
  const stale = await service.getWeather(location); assert.equal(stale.status, 'stale'); assert.equal(stale.data.current.temperature, -2);
  const other = await service.getWeather({ ...location, latitude: 31 }); assert.equal(other.status, 'error'); assert.equal(other.data, null);
  assert(!JSON.stringify(other).includes('private upstream'));
});
test('AQI failure does not discard weather and invalid coordinates never send a request', async () => {
  let count = 0;
  const service = createWeatherService({ now: () => modelTime, fetch: async url => { count++; if (url.includes('air-quality')) throw Error('offline'); return response(fixture()); } });
  const result = await service.getWeather(location); assert.equal(result.status, 'ready'); assert.equal(result.data.airQuality, null);
  await assert.rejects(service.getWeather({ latitude: 91, longitude: 0 }), { code: 'INVALID_LOCATION' }); assert.equal(count, 2);
});
test('city search encodes input and filters malformed remote locations', async () => {
  let called;
  const service = createWeatherService({ fetch: async url => { called = new URL(url); return response({ results: [{ ...location, id: 1, admin1: '北京市', country: '中国' }, { latitude: null, longitude: 0 }] }); } });
  assert.deepEqual(await service.searchCities('北'), []);
  const cities = await service.searchCities('北京 &'); assert.equal(cities.length, 1); assert.equal(called.searchParams.get('name'), '北京 &'); assert.equal(called.searchParams.get('language'), 'zh');
});
test('timeout covers stalled fetch and stalled JSON; rate limits are safe failures', async () => {
  for (const fetch of [() => new Promise(() => {}), async () => ({ ok: true, json: () => new Promise(() => {}) })]) {
    const result = await createWeatherService({ fetch, timeoutMs: 10 }).getWeather(location); assert.equal(result.error.code, 'TIMEOUT');
  }
  const result = await createWeatherService({ fetch: async () => ({ ok: false, status: 429 }) }).getWeather(location);
  assert.equal(result.error.code, 'RATE_LIMITED');
});

test('model time ahead by more than 15 minutes is rejected, not relabeled with retrieval time', async () => {
  for (const difference of [15 * 60000, 15 * 60000 + 1]) {
    const fetchedAt = modelTime - difference;
    const service = createWeatherService({ now: () => fetchedAt, fetch: async url => response(url.includes('air-quality') ? air() : fixture()) });
    const result = await service.getWeather(location);
    if (difference === 15 * 60000) { assert.equal(result.status, 'ready'); assert.equal(result.data.current.time, modelTime); assert.equal(result.updatedAt, fetchedAt); }
    else { assert.equal(result.status, 'error'); assert.equal(result.error.code, 'INVALID_RESPONSE'); assert.equal(result.data, null); }
  }
});
test('weather older than 90 minutes is retained as stale even after a successful fetch and cached reread', async () => {
  let fetchedAt = modelTime + 90 * 60000;
  const service = createWeatherService({ now: () => fetchedAt, fetch: async url => response(url.includes('air-quality') ? air() : fixture()) });
  const boundary = await service.getWeather(location); assert.equal(boundary.status, 'ready');
  fetchedAt++;
  const cached = await service.getWeather(location); assert.equal(cached.status, 'stale'); assert.equal(cached.fromCache, true);
  assert.equal(cached.error.code, 'DATA_OLD'); assert.equal(cached.error.message, '数据时间较早'); assert.equal(cached.updatedAt, boundary.updatedAt);
  const refreshed = await service.getWeather(location, { force: true }); assert.equal(refreshed.status, 'stale'); assert.equal(refreshed.fromCache, false);
  assert.equal(refreshed.data.current.time, modelTime); assert.equal(refreshed.updatedAt, fetchedAt);
  assert.notEqual(refreshed.updatedAt, refreshed.data.current.time);
});
test('invalid calendar model time does not enter cache', async () => {
  const raw = fixture(); raw.current.time = '2026-99-99T99:99';
  const result = await createWeatherService({ now: () => modelTime, fetch: async url => response(url.includes('air-quality') ? air() : raw) }).getWeather(location);
  assert.equal(result.status, 'error'); assert.equal(result.error.code, 'INVALID_RESPONSE');
});
