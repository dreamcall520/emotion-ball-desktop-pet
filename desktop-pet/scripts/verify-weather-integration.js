'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');
const { pointerClick } = require('./verify-chat-integration');

const PUBLIC_CITIES = {
  shanghai: { name: '上海', latitude: 31.2304, longitude: 121.4737, timezone: 'Asia/Shanghai' },
  chengdu: { name: '成都', latitude: 30.5728, longitude: 104.0668, timezone: 'Asia/Shanghai' },
  guangzhou: { name: '广州', latitude: 23.1291, longitude: 113.2644, timezone: 'Asia/Shanghai' },
  shenzhen: { name: '深圳', latitude: 22.5431, longitude: 114.0579, timezone: 'Asia/Shanghai' }
};
function forecastFixture(temperature, now = Date.now()) {
  const at = offset => new Date(now + offset).toISOString().slice(0, 16);
  const dates = Array.from({ length: 7 }, (_, i) => at(i * 86400000).slice(0, 10));
  return { timezone: 'UTC', utc_offset_seconds: 0,
    current: { time: at(0), temperature_2m: temperature, apparent_temperature: temperature, weather_code: 0,
      is_day: 1, relative_humidity_2m: 50, wind_speed_10m: 5, wind_direction_10m: 90 },
    daily: { time: dates, temperature_2m_min: dates.map(() => temperature - 3), temperature_2m_max: dates.map(() => temperature + 3),
      weather_code: dates.map(() => 0), precipitation_probability_max: dates.map(() => 0),
      sunrise: dates.map(date => date + 'T06:00'), sunset: dates.map(date => date + 'T18:00'), uv_index_max: dates.map(() => 2) },
    hourly: { time: Array.from({ length: 25 }, (_, i) => at(i * 3600000)),
      temperature_2m: Array(25).fill(temperature), weather_code: Array(25).fill(0),
      precipitation_probability: Array(25).fill(0), is_day: Array(25).fill(1) } };
}
function assertIsolated(root, profile, output) {
  assert(path.isAbsolute(root) && path.isAbsolute(profile) && path.isAbsolute(output));
  const realRoot = fs.realpathSync(root), realProfile = fs.realpathSync(profile), realOutput = fs.realpathSync(output);
  assert(/^qiuqiu-weather-qa-[A-Za-z0-9]+$/.test(path.basename(realRoot)), 'Weather QA requires a newly created dedicated root');
  assert.equal(realProfile, path.join(realRoot, 'profile'), 'Weather QA never uses formal userData');
  assert(realOutput.startsWith(realRoot + path.sep), 'Weather QA evidence stays in its isolated root');
}
async function verifyWeatherIntegration({ app, pet, weather, net, feedback, getSettings, getProfile }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1'); assert.equal(process.env.PET_SMOKE_WEATHER_ONLY, '1');
  const root = process.env.PET_WEATHER_QA_ROOT, output = process.env.PET_WEATHER_QA_OUT;
  assertIsolated(root, getProfile(), output);
  assert.equal(app.isPackaged, true, 'Run the final App executable');
  assert.equal(feedback.getState().enabled, false); assert.equal(feedback.getState().pending, 0);
  if (process.mas === true) assert.equal(getSettings().autoReportErrors, false, 'Fresh MAS profile defaults to automatic reporting off');
  const originalFs = require('original-fs');
  const hash = file => createHash('sha256').update(originalFs.readFileSync(file)).digest('hex');
  const identity = { executable: process.execPath, executableSHA256: hash(process.execPath), version: app.getVersion(),
    asarSHA256: hash(path.join(process.resourcesPath, 'app.asar')), packaged: app.isPackaged, mas: process.mas === true,
    userData: getProfile() };
  const cases = [], requests = [], originalFetch = net.fetch;
  let mode = 'live', lateResolve, forecastCalls = 0, blockedRequests = 0;
  const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  async function controlledFetch(input, options) {
    const endpoint = new URL(typeof input === 'string' ? input : input.url);
    const kind = endpoint.hostname === 'geocoding-api.open-meteo.com' && endpoint.pathname === '/v1/search' ? 'geocoding'
      : endpoint.hostname === 'api.open-meteo.com' && endpoint.pathname === '/v1/forecast' ? 'forecast'
      : endpoint.hostname === 'air-quality-api.open-meteo.com' && endpoint.pathname === '/v1/air-quality' ? 'air' : null;
    if (!kind) { blockedRequests++; throw Error('Weather QA blocked a non-weather network request'); }
    requests.push({ kind, mode });
    if (mode === 'live') return originalFetch.call(net, input, options);
    if (kind === 'air') return response({ current: { time: new Date().toISOString().slice(0, 16), us_aqi: 35, pm2_5: 5 }, utc_offset_seconds: 0 });
    assert.equal(kind, 'forecast', 'Injected phases must not perform new city searches'); forecastCalls++;
    if (mode === '503') return response({}, 503);
    if (mode === '429') return response({}, 429);
    if (mode === 'body-timeout') return { ok: true, status: 200, json: () => new Promise(() => {}) };
    if (mode === 'late') return new Promise(resolve => { assert.equal(lateResolve, undefined); lateResolve = () => resolve(response(forecastFixture(-5))); });
    return response(forecastFixture(mode === 'new-city' ? 29 : 24));
  }
  net.fetch = controlledFetch; assert.equal(net.fetch, controlledFetch, 'Native net.fetch must accept the scoped QA adapter');
  const until = async (read, matches, label, timeout = 22000) => {
    const end = Date.now() + timeout;
    do { const value = await read(); if (matches(value)) return value; await wait(25); } while (Date.now() < end);
    assert.fail(label);
  };
  let win;
  const page = code => win.webContents.executeJavaScript(code, true);
  const ui = () => page(`({city:document.getElementById('city').textContent,temperature:document.getElementById('temperature').textContent,
    small:document.getElementById('small-temperature').textContent,emptyKind:document.getElementById('weather-empty').dataset.kind,
    emptyMessage:document.getElementById('empty-message').textContent,notice:document.getElementById('notice').textContent,
    pickerHidden:document.getElementById('city-picker').hidden,detailsVisible:!document.getElementById('weather-details').hidden,weekVisible:!document.getElementById('week-panel').hidden,weekPoints:document.querySelectorAll('#week-chart svg g').length})`);
  const select = city => page(`window.qiuqiuWeather.selectCity(${JSON.stringify(city)})`);
  const capture = async name => { fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const countPhase = () => { forecastCalls = 0; };
  const assertNoReporting = () => {
    assert.equal(feedback.getState().enabled, false); assert.equal(feedback.getState().pending, 0);
    assert.equal(fs.existsSync(path.join(getProfile(), 'diagnostics', 'feedback-outbox.json')), false);
    assert.equal(blockedRequests, 0, 'No production feedback or unrelated requests attempted');
  };
  try {
    weather.openCity(); win = weather.getWindow(); assert(win && !win.isDestroyed());
    await until(() => page("Boolean(window.qiuqiuWeather && document.getElementById('city-picker'))"), Boolean, 'Real weather document and preload are ready');
    const prefs = win.webContents.getLastWebPreferences();
    assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.sandbox, true);
    if (process.env.PET_WEATHER_QA_PHASE === 'restart') {
      const baseline = JSON.parse(fs.readFileSync(path.join(root, 'weather-restart-baseline.json')));
      const state = await until(() => weather.getState(), value => value.city?.name === baseline.cityName && Number.isFinite(value.current?.temperature), 'Restart restores selected city and cached weather');
      await pointerClick(win, '#close-picker');
      await until(ui, value => value.detailsVisible && value.city.includes(baseline.cityName) && value.temperature !== '—', 'Restart paints visible restored weather');
      cases.push({ name: 'restart', selectedCityPreserved: true, cachedOrRefreshedDataRendered: true, dailyCount: state.daily.length });
    } else {
      if (process.mas === true) {
        await pointerClick(win, '#use-location');
        await until(() => page("document.getElementById('location-consent').open"), Boolean, 'Existing location disclosure opens');
        await pointerClick(win, '#location-cancel');
        assert.equal(await page("document.getElementById('location-consent').open"), false);
        cases.push({ name: 'location-disclosure-cancel', cancelled: true, gpsNotRequestedByQA: true });
      }
      const cities = await page("window.qiuqiuWeather.search('北京')");
      const beijing = cities.find(city => /北京/.test(city.name)); assert(beijing, 'Live public Beijing search succeeds');
      const accepted = await select(beijing); assert.equal(accepted.city.name, beijing.name);
      await pointerClick(win, '#close-picker');
      const live = await until(() => weather.getState(), state => state.status === 'ready' && state.daily?.length === 7 && Number.isFinite(state.current?.temperature), 'Live Beijing forecast succeeds', 45000);
      await until(ui, value => value.detailsVisible && value.temperature !== '—' && value.weekPoints >= 7, 'Live forecast visibly paints');
      await pointerClick(win, '#week-tab');
      await until(ui, value => value.weekVisible && value.weekPoints >= 7, 'Live seven-day chart is visible');
      await capture('01-public-beijing-live'); cases.push({ name: 'public-beijing-live', cityName: beijing.name, status: live.status, dailyCount: live.daily.length, rendered: true });

      mode = '503'; countPhase(); const started = Date.now();
      const saved = await select(PUBLIC_CITIES.shanghai);
      assert.equal(saved.city.name, PUBLIC_CITIES.shanghai.name); assert(Date.now() - started < 2000, 'City save responds before weather requests complete');
      const failed = await until(() => weather.getState(), state => state.city?.name === PUBLIC_CITIES.shanghai.name && state.status === 'error', '503 cold-city failure completes');
      assert.equal(forecastCalls, 2, 'Retryable forecast retries exactly once'); assert.match(failed.error, /天气服务暂不可用/);
      await until(ui, value => value.detailsVisible && value.emptyKind === 'error' && /天气服务暂不可用/.test(value.emptyMessage), 'Real document shows specific service failure');
      assert.equal(JSON.parse(fs.readFileSync(path.join(getProfile(), 'weather.json'))).city.name, PUBLIC_CITIES.shanghai.name);
      await capture('02-service-failure'); cases.push({ name: '503-retry-and-city-save', forecastAttempts: forecastCalls, citySavedBeforeForecast: true, specificErrorRendered: true });

      mode = 'recover'; countPhase(); await page('window.qiuqiuWeather.refresh()');
      await until(() => weather.getState(), state => state.status === 'ready' && state.current?.temperature === 24, 'Manual retry recovers');
      await until(ui, value => value.temperature === '24°' && value.notice === '', 'Recovery clears failure message');
      cases.push({ name: 'manual-retry', forecastAttempts: forecastCalls, recovered: true });

      mode = '429'; countPhase(); await page('window.qiuqiuWeather.refresh()');
      const limited = weather.getState(); assert.equal(forecastCalls, 1, 'Rate limiting is not immediately retried');
      assert.equal(limited.status, 'stale'); assert.equal(limited.current.temperature, 24); assert.match(limited.error, /较频繁/);
      cases.push({ name: '429-cache', forecastAttempts: forecastCalls, cachedWeatherRetained: true });

      mode = 'body-timeout'; countPhase(); const timeoutStarted = Date.now(); await select(PUBLIC_CITIES.chengdu);
      const timedOut = await until(() => weather.getState(), state => state.city?.name === PUBLIC_CITIES.chengdu.name && state.status === 'error', 'Response body timeout remains bounded', 22000);
      assert.equal(forecastCalls, 2); assert.match(timedOut.error, /超时/);
      await until(ui, value => value.detailsVisible && value.emptyKind === 'error' && /超时/.test(value.emptyMessage), 'Body timeout reason renders');
      cases.push({ name: 'body-timeout', forecastAttempts: forecastCalls, elapsedMs: Date.now() - timeoutStarted, specificErrorRendered: true });

      mode = 'late'; countPhase(); await select(PUBLIC_CITIES.guangzhou);
      await until(() => lateResolve, Boolean, 'Old city forecast is held');
      mode = 'new-city'; await select(PUBLIC_CITIES.shenzhen);
      await until(() => weather.getState(), state => state.city?.name === PUBLIC_CITIES.shenzhen.name && state.status === 'ready' && state.current?.temperature === 29, 'New city succeeds first');
      lateResolve(); await wait(200);
      assert.equal(weather.getState().city.name, PUBLIC_CITIES.shenzhen.name); assert.equal(weather.getState().current.temperature, 29);
      await until(ui, value => value.city.includes(PUBLIC_CITIES.shenzhen.name) && value.temperature === '29°', 'Late response never replaces current document');
      await capture('03-late-city-response');
      cases.push({ name: 'late-city-response', currentCityPreserved: true, currentTemperaturePreserved: true });
      fs.writeFileSync(path.join(root, 'weather-restart-baseline.json'), JSON.stringify({ cityName: PUBLIC_CITIES.shenzhen.name }));
    }
    assertNoReporting();
    assert.equal(hash(path.join(process.resourcesPath, 'app.asar')), identity.asarSHA256, 'Signed ASAR stays unchanged');
    assert.equal(hash(process.execPath), identity.executableSHA256, 'Final executable stays unchanged');
    fs.writeFileSync(path.join(output, 'weather-integration.json'), JSON.stringify({ ok: true, identity, cases, requests,
      defaultAutomaticReportingDisabled: !feedback.getState().enabled, productionFeedbackRequests: 0,
      gpsNotRequestedByQA: true, originalRuntimeAndAsarUnchanged: true,
      boundary: 'Real final App/main/controller/preload/document; public Beijing uses live network. Fault phases inject only weather HTTP responses via scoped net.fetch. Actual GPS is a separate user-authorized check.' }, null, 2));
    console.log('PET_WEATHER_INTEGRATION_OK');
  } finally { net.fetch = originalFetch; assert.equal(net.fetch, originalFetch); }
}
module.exports = { verifyWeatherIntegration, forecastFixture, assertIsolated };
