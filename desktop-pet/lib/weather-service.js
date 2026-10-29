'use strict';

const CACHE_MS = 30 * 60 * 1000;
const MAX_DATA_AGE_MS = 90 * 60 * 1000, MAX_FUTURE_MS = 15 * 60 * 1000;
const MESSAGES = { INVALID_LOCATION: '请选择有效城市。', INVALID_RESPONSE: '天气数据不完整，本次未更新。',
  TIMEOUT: '天气查询超时，稍后重试。', RATE_LIMITED: '天气查询较频繁，请稍后重试。',
  DATA_OLD: '数据时间较早', CONNECTION_FAILED: '暂时无法连接天气服务。', SERVICE_UNAVAILABLE: '天气服务暂不可用。' };
const errorFor = code => Object.assign(new Error(MESSAGES[code]), { code, publicMessage: MESSAGES[code] });
const number = (value, min = -Infinity, max = Infinity) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
const text = value => typeof value === 'string' ? value.slice(0, 120) : '';
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(value) ? value : null;
function normalizeLocation(value) {
  const latitude = number(value?.latitude, -90, 90), longitude = number(value?.longitude, -180, 180);
  if (latitude === null || longitude === null) throw errorFor('INVALID_LOCATION');
  return { latitude, longitude, id: Number.isSafeInteger(value.id) ? value.id : null,
    name: text(value.name), admin1: text(value.admin1), country: text(value.country), timezone: text(value.timezone), mode: value.mode === 'current' ? 'current' : 'manual' };
}
function parseForecast(raw, location) {
  const c = raw?.current;
  if (!c || number(c.temperature_2m, -100, 70) === null || !date(c.time)
    || !Array.isArray(raw.daily?.time) || !Array.isArray(raw.hourly?.time)) throw errorFor('INVALID_RESPONSE');
  const epoch = value => date(value) ? Date.parse(value + 'Z') - (number(raw.utc_offset_seconds) || 0) * 1000 : null;
  const at = (group, field, index, min, max) => number(group[field]?.[index], min, max);
  const daily = raw.daily.time.slice(0, 7).map((time, i) => ({ date: date(time),
    min: at(raw.daily, 'temperature_2m_min', i, -100, 70), max: at(raw.daily, 'temperature_2m_max', i, -100, 70),
    weatherCode: at(raw.daily, 'weather_code', i, 0, 99), precipitationProbability: at(raw.daily, 'precipitation_probability_max', i, 0, 100),
    sunrise: epoch(raw.daily.sunrise?.[i]), sunset: epoch(raw.daily.sunset?.[i]), uvIndex: at(raw.daily, 'uv_index_max', i, 0, 100) }));
  if (!daily.length || daily.some(d => !d.date || d.min === null || d.max === null || d.min > d.max)) throw errorFor('INVALID_RESPONSE');
  const hourly = raw.hourly.time.map((time, i) => ({ time: date(time), temperature: at(raw.hourly, 'temperature_2m', i, -100, 70),
    weatherCode: at(raw.hourly, 'weather_code', i, 0, 99), precipitationProbability: at(raw.hourly, 'precipitation_probability', i, 0, 100),
    isDay: at(raw.hourly, 'is_day', i, 0, 1) })).filter(h => h.time && h.time >= c.time.slice(0, 13) + ':00').slice(0, 25).map(h => ({ ...h, time: epoch(h.time) }));
  return { location, timezone: text(raw.timezone) || location.timezone, utcOffsetSeconds: number(raw.utc_offset_seconds),
    current: { time: epoch(c.time), temperature: c.temperature_2m, apparentTemperature: number(c.apparent_temperature, -110, 80),
      weatherCode: number(c.weather_code, 0, 99), isDay: number(c.is_day, 0, 1), humidity: number(c.relative_humidity_2m, 0, 100),
      windSpeed: number(c.wind_speed_10m, 0, 500), windDirection: number(c.wind_direction_10m, 0, 360) },
    hourly, daily, airQuality: null,
    attribution: { weather: 'Weather data by Open-Meteo.com (CC BY 4.0)', geocoding: 'GeoNames', airQuality: 'CAMS ENSEMBLE / Open-Meteo',
      url: 'https://open-meteo.com/', termsUrl: 'https://open-meteo.com/en/terms', usage: 'non-commercial' } };
}
function parseAirQuality(raw) {
  const current = raw?.current, aqi = number(current?.us_aqi, 0, 1000);
  if (aqi === null || !date(current.time)) return null;
  // US AQI categories must not be displayed as Chinese AQI pollution grades.
  const level = aqi <= 50 ? 'good' : aqi <= 100 ? 'moderate' : aqi <= 150 ? 'sensitive' : aqi <= 200 ? 'unhealthy' : aqi <= 300 ? 'very-unhealthy' : 'hazardous';
  return { time: Date.parse(current.time + 'Z') - (number(raw.utc_offset_seconds) || 0) * 1000, aqi, standard: 'us', standardLabel: 'US AQI', level, pm25: number(current.pm2_5, 0, 5000),
    ringIntensity: aqi <= 100 ? 0 : aqi <= 150 ? 0.22 : aqi <= 200 ? 0.45 : 0.72 };
}
function createWeatherService({ fetch: fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 12000 } = {}) {
  const cache = new Map(), pending = new Map();
  function resultFor(data, updatedAt, fromCache, location = data.location) {
    const stale = now() - data.current.time > MAX_DATA_AGE_MS;
    return { status: stale ? 'stale' : 'ready', data: { ...data, location }, updatedAt, fromCache,
      error: stale ? { code: 'DATA_OLD', message: MESSAGES.DATA_OLD } : null };
  }
  async function request(url) {
    const controller = new AbortController(); let timer;
    try {
      const response = await Promise.race([fetchImpl(url, { signal: controller.signal, redirect: 'error' }),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(errorFor('TIMEOUT')); }, timeoutMs); })]);
      if (!response.ok) throw errorFor(response.status === 429 ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE');
      // Keep the timeout active until the response body has completed too.
      const body = await Promise.race([response.json(), new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(errorFor('TIMEOUT')), { once: true });
      })]);
      if (!body || typeof body !== 'object' || body.error) throw errorFor('INVALID_RESPONSE');
      return body;
    } catch (error) { throw error?.publicMessage ? error : errorFor(controller.signal.aborted ? 'TIMEOUT' : 'CONNECTION_FAILED'); }
    finally { clearTimeout(timer); }
  }
  function url(origin, path, params) { const value = new URL(path, origin); value.search = new URLSearchParams(params).toString(); return value.href; }
  async function searchCities(query) {
    if (typeof query !== 'string' || query.trim().length < 2) return [];
    if (query.trim().length > 120) throw errorFor('INVALID_LOCATION');
    const raw = await request(url('https://geocoding-api.open-meteo.com', '/v1/search', { name: query.trim(), count: '10', language: 'zh', format: 'json' }));
    if (raw.results !== undefined && !Array.isArray(raw.results)) throw errorFor('INVALID_RESPONSE');
    return (raw.results || []).slice(0, 10).flatMap(item => { try { return [normalizeLocation(item)]; } catch { return []; } });
  }
  async function getWeather(value, { force = false } = {}) {
    const location = normalizeLocation(value), key = `${location.latitude},${location.longitude}`;
    let entry = cache.get(key);
    if (entry && (!Number.isFinite(entry.data.current.time) || entry.data.current.time > now() + MAX_FUTURE_MS)) { cache.delete(key); entry = null; }
    if (pending.has(key)) return pending.get(key);
    if (!force && entry && now() - entry.updatedAt < CACHE_MS) return resultFor(entry.data, entry.updatedAt, true, location);
    const task = (async () => {
      const params = { latitude: String(location.latitude), longitude: String(location.longitude), timezone: 'auto' };
      const air = request(url('https://air-quality-api.open-meteo.com', '/v1/air-quality', { ...params, current: 'us_aqi,pm2_5' }))
        .then(parseAirQuality).catch(() => null);
      try {
        const raw = await request(url('https://api.open-meteo.com', '/v1/forecast', { ...params, forecast_days: '7', wind_speed_unit: 'kmh',
          current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m',
          hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
          daily: 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset,uv_index_max' }));
        const data = parseForecast(raw, location);
        if (!Number.isFinite(data.current.time) || data.current.time > now() + MAX_FUTURE_MS) throw errorFor('INVALID_RESPONSE');
        data.airQuality = await air;
        // updatedAt is retrieval time; current.time is the model's represented weather time.
        const result = resultFor(data, now(), false);
        cache.set(key, result);
        if (cache.size > 20) cache.delete(cache.keys().next().value);
        return result;
      } catch (error) {
        return { status: entry ? 'stale' : 'error', data: entry ? { ...entry.data, location } : null,
          updatedAt: entry?.updatedAt ?? null, fromCache: Boolean(entry), error: { code: error.code, message: error.publicMessage } };
      }
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  return { searchCities, getWeather, clearCache() { cache.clear(); } };
}
module.exports = { createWeatherService, normalizeLocation, parseForecast, parseAirQuality, CACHE_MS };
