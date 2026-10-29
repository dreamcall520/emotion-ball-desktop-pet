(() => {
  'use strict';
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const number = (value, suffix = '') => finite(value) ? `${Math.round(value)}${suffix}` : '—';
  const description = code => code === 0 ? '晴朗' : [1, 2].includes(code) ? '晴间多云' : code === 3 ? '阴天' : [45, 48].includes(code) ? '有雾' : code >= 95 ? '雷雨' : [71, 73, 75, 77, 85, 86].includes(code) ? '下雪' : code >= 51 && code <= 82 ? '下雨' : '天气未知';
  const ICON_ROOT = 'assets/weather/meteocons';
  function iconName(code, isDay = true) {
    const period = isDay ? 'day' : 'night';
    if (code === 0) return `clear-${period}`;
    if ([1, 2].includes(code)) return `partly-cloudy-${period}`;
    if (code === 3) return 'overcast';
    if ([45, 48].includes(code)) return `fog-${period}`;
    if ([51, 53, 55].includes(code)) return `overcast-${period}-drizzle`;
    if ([56, 57, 66, 67].includes(code)) return `overcast-${period}-sleet`;
    if ([61, 63, 65].includes(code)) return `overcast-${period}-rain`;
    if ([71, 73, 75, 77, 85, 86].includes(code)) return `overcast-${period}-snow`;
    if ([80, 81, 82].includes(code)) return `partly-cloudy-${period}-rain`;
    if (code === 95) return `thunderstorms-${period}-rain`;
    if ([96, 99].includes(code)) return `thunderstorms-${period}-hail`;
    return 'not-available';
  }
  const iconPath = (code, isDay = true, animated = false) => `${ICON_ROOT}/${animated ? 'animated' : 'static'}/${iconName(code, isDay)}.svg`;
  const icon = (code, isDay = true) => `<img src="${iconPath(code, isDay)}" alt="" aria-hidden="true" draggable="false">`;
  const heroIcon = (code, isDay, animated) => animated ? `<picture><source media="(prefers-reduced-motion: reduce)" srcset="${iconPath(code, isDay)}"><img src="${iconPath(code, isDay, true)}" alt="" aria-hidden="true" draggable="false"></picture>` : icon(code, isDay);
  const dateLabel = (date, index) => index === 0 ? '今天' : /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)) : '—';
  function localTime(value, timezone) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value.slice(11, 16);
    if (value == null || !Number.isFinite(new Date(value).getTime())) return '—';
    try { return new Intl.DateTimeFormat('zh-CN', { timeZone: timezone || undefined, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)); } catch { return '—'; }
  }
  function localDate(value, timezone) {
    if (value == null || !Number.isFinite(new Date(value).getTime())) return '';
    try { return new Intl.DateTimeFormat('zh-CN', { timeZone: timezone || undefined, month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(value)); } catch { return ''; }
  }
  function locationLabels(city) {
    const name = typeof city?.name === 'string' ? city.name.trim() : '';
    const displayName = typeof city?.displayName === 'string' ? city.displayName.trim() : '';
    if (city?.mode === 'current') return { title: '当前位置', source: displayName || (name && name !== '当前位置' ? name : '设备定位') };
    return { title: name || '选择城市', source: '手动选择' };
  }
  function locationMessage(code) {
    return ({ LOCATION_DENIED: '定位未授权', LOCATION_RESTRICTED: '定位受系统限制', LOCATION_SERVICES_DISABLED: '系统定位已关闭', LOCATION_TIMEOUT: '定位超时，请重试', LOCATION_BUSY: '定位中…', LOCATION_NATIVE_UNAVAILABLE: '定位暂不可用', LOCATION_UNSUPPORTED: '暂不支持定位', LOCATION_MAIN_THREAD_REQUIRED: '定位暂不可用', LOCATION_UNAVAILABLE: '定位失败，请选城市', denied: '定位未授权', restricted: '定位受系统限制', 'services-disabled': '系统定位已关闭', timeout: '定位超时，请重试', unavailable: '定位失败，请选城市' })[code] || '定位失败，请选城市';
  }
  function emptyPresentation(state) {
    if (state.status === 'loading') return { kind: 'loading', title: '正在获取天气', message: '', retry: '获取中…' };
    if (state.status === 'unconfigured' || !state.city) return { kind: 'unconfigured', title: '选择天气位置', message: '使用定位或手动选择', retry: '使用当前位置' };
    return { kind: 'error', title: '暂时无法获取天气', message: '请重试或选择城市', retry: '重试' };
  }
  function chart(data) {
    const valid = data.filter(day => finite(day.min) && finite(day.max));
    if (!valid.length) return '<p class="forecast-empty">暂无预报</p>';
    const low = Math.min(...valid.map(d => d.min)) - 2, high = Math.max(...valid.map(d => d.max)) + 2;
    const x = i => 26 + i * 308 / Math.max(1, data.length - 1), y = value => 180 - (value - low) / (high - low) * 110;
    const lines = ['max', 'min'].map((key, index) => {
      const color = index ? '#70a7cf' : '#dba15d';
      let path = '', previous = false;
      data.forEach((day, i) => { if (finite(day[key])) { path += `${previous ? 'L' : 'M'}${x(i).toFixed(2)},${y(day[key]).toFixed(2)} `; previous = true; } else previous = false; });
      return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('');
    const points = data.map((day, i) => `<g><text x="${x(i)}" y="17">${dateLabel(day.date, i)}</text><image href="${iconPath(day.weatherCode)}" x="${x(i) - 17}" y="22" width="34" height="34"/>${['max', 'min'].map((key, series) => finite(day[key]) ? `<circle cx="${x(i)}" cy="${y(day[key])}" r="3" fill="${series ? '#70a7cf' : '#dba15d'}"/><text x="${x(i)}" y="${y(day[key]) + (series ? 19 : -12)}"${series ? ' class="muted"' : ''}>${number(day[key], '°')}</text>` : '').join('')}<text class="muted" x="${x(i)}" y="224">${number(day.precipitationProbability, '%')}</text></g>`).join('');
    return `<div class="chart-legend"><span class="high">最高温</span><span class="low">最低温</span><span class="rain-key" title="下方百分比为降水概率" aria-label="降水概率">雨 %</span></div><div class="chart-scroll"><svg viewBox="0 0 350 238" role="img" aria-label="未来七天最高温与最低温趋势"><rect x="7" y="0" width="38" height="228" rx="10" fill="var(--weather-sub)"/>${[low, (low + high) / 2, high].map(t => `<line x1="16" x2="344" y1="${y(t)}" y2="${y(t)}" stroke="var(--quota-line)" stroke-dasharray="2 5"/>`).join('')}${lines}${points}</svg></div>`;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = { chart, description, number, localTime, localDate, emptyPresentation, iconName, iconPath, heroIcon, locationMessage, locationLabels };
    if (require.main === module) {
      const assert = require('node:assert/strict');
      assert.equal(number(null, '°'), '—'); assert.equal(number(-5, '°'), '-5°');
      assert.equal(description(45), '有雾'); assert.equal(description(71), '下雪');
      const output = chart([{ date: '2026-10-28', min: -5, max: 4 }, { date: '2026-10-29', min: null, max: null }, { date: '2026-10-30', min: 2, max: 2 }]);
      assert(!output.includes('NaN')); assert(output.includes('最高温')); assert(output.includes('M26.00'));
      assert.equal(chart([]), '<p class="forecast-empty">暂无预报</p>');
      assert.equal(localTime(Date.UTC(2026, 9, 28, 6, 30), 'Asia/Shanghai'), '14:30');
      assert.equal(localTime(Date.UTC(2026, 9, 28, 6, 30), 'America/New_York'), '02:30');
      assert.equal(localTime(null, 'Asia/Shanghai'), '—');
      assert.match(localDate(Date.UTC(2026, 9, 28, 20), 'Asia/Shanghai'), /10月29日/);
      assert.equal(emptyPresentation({ status: 'loading' }).kind, 'loading');
      assert.equal(emptyPresentation({ status: 'unconfigured' }).retry, '使用当前位置');
      assert.equal(emptyPresentation({ status: 'error', city: { name: '北京' } }).kind, 'error');
      assert.deepEqual(locationLabels({ mode: 'current', name: '当前位置', displayName: '北京市 · 朝阳区' }), { title: '当前位置', source: '北京市 · 朝阳区' });
      assert.equal(locationLabels({ mode: 'current', name: '北京' }).source, '北京');
      assert.equal(locationLabels({ mode: 'current', name: '当前位置' }).source, '设备定位');
      assert.deepEqual(locationLabels({ mode: 'manual', name: '上海', displayName: '旧定位' }), { title: '上海', source: '手动选择' });
      assert.equal(locationMessage('LOCATION_DENIED'), '定位未授权'); assert.equal(locationMessage('LOCATION_TIMEOUT'), '定位超时，请重试'); assert.equal(locationMessage('unsafe detail'), '定位失败，请选城市');
      assert.equal(iconName(0, false), 'clear-night'); assert.equal(iconName(2, false), 'partly-cloudy-night');
      assert.equal(iconName(3, true), 'overcast'); assert.equal(iconName(3, false), 'overcast'); assert.equal(iconName(45), 'fog-day'); assert.equal(iconName(71, false), 'overcast-night-snow');
      assert.equal(iconName(95), 'thunderstorms-day-rain'); assert.equal(iconName(96), 'thunderstorms-day-hail');
      assert.equal(iconName('<script>'), 'not-available'); assert(!iconPath(null).includes('animated'));
      assert(heroIcon(2, false, true).includes('prefers-reduced-motion: reduce'));
      assert(!output.includes('chart-caption')); assert(output.includes('降水概率'));
      const fs = require('node:fs'), path = require('node:path');
      const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, ICON_ROOT, 'SOURCE.json'), 'utf8'));
      for (const entry of manifest.files) {
        const bytes = fs.readFileSync(path.join(__dirname, ICON_ROOT, entry.path));
        assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'), entry.sha256);
        if (entry.path.includes('night')) { assert(bytes.toString().includes('#F4E5BD')); assert(bytes.toString().includes('#DCC48A')); assert.equal(entry.adaptation, 'moon-warm-beige'); }
      }
      for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99, null]) for (const day of [true, false]) for (const animated of [true, false]) assert(fs.existsSync(path.join(__dirname, iconPath(code, day, animated))));
      console.log('weather renderer self-check passed: WMO day/night assets, 48 hashes, static/reduced-motion icons, chart, city time and empty states');
    }
    return;
  }
  const api = window.qiuqiuWeather;
  const el = id => document.getElementById(id);
  let state = {}, expanded = false, picker = false, tab = 'today', layout = 'horizontal', searchRevision = 0, locationGeneration = 0, locationWarning = '', searchTimer = null, contentAnimation = null, composing = false;
  const text = (id, value) => { el(id).textContent = value; };
  const timezone = () => state.timezone || (state.city?.timezone !== 'auto' ? state.city?.timezone : undefined);
  const time = value => localTime(value, timezone());
  function resize() {
    if (!expanded) return api.resize({ width: 128, height: 32, expanded: false }).catch(() => {});
    api.resize({ width: 390, height: Math.min(680, Math.max(picker ? 210 : 280, Math.ceil(el(picker ? 'city-picker' : 'weather-details').getBoundingClientRect().height) + 2)), expanded: true }).catch(() => {});
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function updateHero() { const current = state.current || {}; el('hero-icon').innerHTML = heroIcon(current.weatherCode, current.isDay !== false && current.isDay !== 0, expanded && !picker); }
  function fadeContent(target) { if (reducedMotion.matches) return; contentAnimation?.cancel(); contentAnimation = target.animate?.([{ opacity: .55 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' }); }
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) contentAnimation?.cancel(); updateHero(); });
  function setExpanded(value) {
    const wasExpanded = expanded;
    expanded = value; if (!expanded) picker = false;
    el('quota-label').dataset.expanded = String(expanded);
    el('folded').hidden = expanded; el('weather-details').hidden = !expanded || picker; el('city-picker').hidden = !expanded || !picker;
    el('folded').setAttribute('aria-expanded', String(expanded)); updateHero(); resize(); if (expanded && !wasExpanded) fadeContent(el(picker ? 'city-picker' : 'weather-details'));
  }
  function showPicker(value) {
    clearTimeout(searchTimer); searchRevision++;
    if (value && !picker) {
      el('search-input').value = ''; el('search-results').replaceChildren();
      text('search-status', state.city ? `已选择：${locationLabels(state.city).source === '手动选择' ? state.city.name : locationLabels(state.city).source}` : '');
    }
    picker = value; setExpanded(true); if (picker) el('search-input').focus();
  }
  function selectTab(value) {
    tab = value; el('hourly-hint').hidden = tab !== 'today'; el('week-layout').hidden = tab !== 'week'; el('today-panel').hidden = tab !== 'today'; el('week-panel').hidden = tab !== 'week';
    for (const value of ['today', 'week']) el(`${value}-tab`).setAttribute('aria-selected', String(value === tab)); resize(); fadeContent(el(`${tab}-panel`));
  }
  function render(next) {
    state = next || {}; const current = state.current || {}, daily = Array.isArray(state.daily) ? state.daily.slice(0, 7) : [], hourly = Array.isArray(state.hourly) ? state.hourly : [];
    if (['light', 'dark', 'system'].includes(state.appearance)) document.documentElement.dataset.appearance = state.appearance;
    if (state.colorMode) document.documentElement.dataset.colorMode = state.colorMode;
    el('folded').dataset.empty = String(!finite(current.temperature));
    text('small-temperature', finite(current.temperature) ? number(current.temperature, '°') : state.status === 'loading' ? '加载中' : '暂无'); el('quota-label').dataset.empty = String(!finite(current.temperature)); text('temperature', number(current.temperature, '°')); text('condition', description(current.weatherCode)); text('feels', finite(current.apparentTemperature) ? `体感 ${number(current.apparentTemperature, '°')}` : '');
    el('small-icon').innerHTML = icon(current.weatherCode, current.isDay !== false && current.isDay !== 0); updateHero();
    const caret = document.createElement('span'); caret.className = 'city-chevron'; caret.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg>';
    const labels = locationLabels(state.city);
    el('city').replaceChildren(document.createTextNode(labels.title), caret);
    text('location-mode', labels.source); el('location-mode').title = labels.source;
    const cityDate = current.time || hourly[0]?.time;
    text('date', localDate(cityDate, timezone()));
    const updated = state.updatedAt == null ? NaN : new Date(state.updatedAt).getTime(), stale = Number.isFinite(updated) && Date.now() - updated > 60 * 60 * 1000;
    const failed = ['error', 'stale'].includes(state.status) || Boolean(state.error);
    const hasData = finite(current.temperature), empty = emptyPresentation(state);
    el('weather-empty').hidden = hasData; el('weather-content').hidden = !hasData;
    el('weather-empty').dataset.kind = empty.kind;
    text('empty-title', empty.title); text('empty-message', empty.message); el('empty-message').hidden = !empty.message; text('empty-retry', empty.retry);
    el('empty-retry').disabled = empty.kind === 'loading';
    el('empty-icon').innerHTML = icon(null);
    let notice = stale ? '已过期' : state.status === 'loading' ? '更新中' : failed ? '更新失败' : '';
    if (locationWarning) notice = '定位未更新' + (stale ? ' · 已过期' : '');
    el('notice').dataset.state = failed || stale || locationWarning ? 'cached' : 'normal';
    const quietNotice = (failed || stale || locationWarning || state.status === 'loading') ? notice : '';
    text('notice', quietNotice); el('notice').hidden = !quietNotice; el('folded').title = `${state.city?.name || '天气'} · ${notice}`;
    const formatUpdated = () => { try { return new Intl.DateTimeFormat('zh-CN', { timeZone: timezone(), hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(updated)); } catch { return '未知'; } };
    text('updated', Number.isFinite(updated) ? `${stale || failed ? '缓存' : '更新'} ${finite(current.time) ? time(current.time) : formatUpdated()}` : '尚未更新');
    el('updated').title = Number.isFinite(updated) ? `获取于 ${formatUpdated()}` : '';
    el('refresh').disabled = state.status === 'loading';
    el('hours').innerHTML = hourly.filter((_, index) => index % 3 === 0).slice(0, 9).map((hour, index) => `<div class="hour"><time>${index ? time(hour.time) : '现在'}</time><span class="mini">${icon(hour.weatherCode, hour.isDay !== false && hour.isDay !== 0)}</span><b>${number(hour.temperature, '°')}</b><span class="rain">${number(hour.precipitationProbability, '%')}</span></div>`).join('') || '<p class="help">暂无小时预报</p>';
    const valid = daily.filter(day => finite(day.min) && finite(day.max)), min = valid.length ? Math.min(...valid.map(day => day.min)) : 0, max = valid.length ? Math.max(...valid.map(day => day.max)) : 1, extent = Math.max(1, max - min);
    el('week-list').innerHTML = daily.map((day, i) => `<div class="day"><span>${dateLabel(day.date, i)}</span><span class="mini">${icon(day.weatherCode)}</span><span class="low">${number(day.min, '°')}</span><span class="range">${finite(day.min) && finite(day.max) ? `<i data-left="${(day.min - min) / extent * 100}" data-width="${Math.max(1, (day.max - day.min) / extent * 100)}"></i>` : ''}</span><span>${number(day.max, '°')}</span><span class="rain">${number(day.precipitationProbability, '%')}</span></div>`).join('') || '<p class="help">暂无一周预报</p>';
    el('week-list').querySelectorAll('.range i').forEach(bar => { bar.style.left = `${bar.dataset.left}%`; bar.style.width = `${bar.dataset.width}%`; });
    el('week-chart').innerHTML = chart(daily);
    el('metrics').innerHTML = `<div><small>风速</small>${number(current.windSpeed, ' km/h')}</div><div><small>湿度</small>${number(current.humidity, '%')}</div><div><small>紫外线</small>${number(daily[0]?.uvIndex)}</div><div><small>日落</small>${time(daily[0]?.sunset)}</div>`;
    resize();
  }
  el('source-toggle').onclick = () => { el('source-details').open = !el('source-details').open; };
  el('source-details').addEventListener('toggle', () => { el('source-toggle').setAttribute('aria-expanded', String(el('source-details').open)); resize(); });
  const contentSizeObserver = new ResizeObserver(resize);
  contentSizeObserver.observe(el('weather-details')); contentSizeObserver.observe(el('city-picker'));
  async function act(action) { try { const next = await action(); if (next && !next.needsLocation) render(next); return next; } catch (error) { render({ ...state, status: 'error', error: '暂时无法获取天气' }); return null; } }
  async function locate(openPicker = true) {
    const generation = ++locationGeneration;
    if (openPicker) { showPicker(true); text('search-status', '定位中…'); }
    el('use-location').disabled = true;
    try {
      const next = await api.useLocation();
      const failure = next?.locationError || (next?.error?.code && !next?.current ? next.error : null);
      if (failure) throw Object.assign(new Error('location failed'), { code: failure.code });
      if (generation !== locationGeneration || next?.cancelled) return;
      if (next && !next.needsLocation) { locationWarning = ''; render(next); if (openPicker) { text('search-status', ''); showPicker(false); } }
      else if (openPicker) text('search-status', '定位失败，请选城市');
    } catch (error) {
      if (generation !== locationGeneration) return;
      const message = locationMessage(error?.code);
      if (openPicker) text('search-status', message);
      if (state.city?.mode === 'current') { locationWarning = '定位未更新，沿用上次位置'; render(state); }
    } finally { if (generation === locationGeneration) { el('use-location').disabled = false; resize(); } }
  }
  el('folded').onclick = () => setExpanded(true); el('collapse').onclick = () => { setExpanded(false); if (document.documentElement.dataset.inputMode === 'keyboard') el('folded').focus(); }; el('city').onclick = () => showPicker(true); el('close-picker').onclick = () => showPicker(false); el('today-tab').onclick = () => selectTab('today'); el('week-tab').onclick = () => selectTab('week');
  document.querySelectorAll('#week-layout button').forEach(button => button.onclick = () => { layout = button.dataset.layout; el('week-list').hidden = layout === 'horizontal'; el('week-chart').hidden = layout !== 'horizontal'; document.querySelectorAll('#week-layout button').forEach(item => item.setAttribute('aria-pressed', String(item === button))); resize(); });
  el('refresh').onclick = () => act(() => api.refresh()); el('use-location').onclick = () => locate(true);
  el('empty-city').onclick = () => showPicker(true);
  el('empty-retry').onclick = () => emptyPresentation(state).kind === 'unconfigured' ? locate(true) : act(() => api.refresh());
  async function searchCities(query, revision) {
    if (!query || query.length < 2) { text('search-status', query ? '至少输入2个字' : ''); resize(); return; }
    text('search-status', '搜索中…');
    try {
      const results = await api.search(query);
      if (revision !== searchRevision) return;
      const cities = Array.isArray(results) ? results : [];
      text('search-status', cities.length ? '' : '未找到城市');
      cities.forEach(city => {
        const button = document.createElement('button'); button.type = 'button';
        const title = document.createElement('span'); title.textContent = city.name;
        const detail = document.createElement('small'); detail.textContent = [city.admin1, city.country].filter(Boolean).join(' · ');
        button.append(title, detail);
        button.onclick = async () => { locationGeneration++; locationWarning = ''; el('use-location').disabled = false; button.disabled = true; const next = await act(() => api.selectCity(city)); if (next) showPicker(false); else button.disabled = false; };
        el('search-results').append(button);
      });
    } catch { if (revision === searchRevision) text('search-status', '搜索失败，请重试'); }
    if (revision === searchRevision) resize();
  }
  el('search-input').addEventListener('input', () => {
    clearTimeout(searchTimer); const revision = ++searchRevision, query = el('search-input').value.trim();
    el('search-results').replaceChildren(); text('search-status', ''); resize();
    if (!composing) searchTimer = setTimeout(() => searchCities(query, revision), 250);
  });
  el('search-input').addEventListener('compositionstart', () => { composing = true; clearTimeout(searchTimer); searchRevision++; });
  el('search-input').addEventListener('compositionend', () => { composing = false; clearTimeout(searchTimer); const revision = ++searchRevision; searchTimer = setTimeout(() => searchCities(el('search-input').value.trim(), revision), 250); });
  el('search-form').onsubmit = event => {
    event.preventDefault(); if (composing) return; clearTimeout(searchTimer); const revision = ++searchRevision;
    el('search-results').replaceChildren(); void searchCities(el('search-input').value.trim(), revision);
  };
  document.addEventListener('pointerdown', () => { document.documentElement.dataset.inputMode = 'pointer'; }, true);
  document.addEventListener('keydown', event => { if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) document.documentElement.dataset.inputMode = 'keyboard'; }, true);
  document.querySelector('.tabs').addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); selectTab(tab === 'today' ? 'week' : 'today'); el(`${tab}-tab`).focus(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') picker ? showPicker(false) : setExpanded(false); });
  api.onChooseCity?.(() => showPicker(true));
  api.onCollapse?.(() => { picker = false; clearTimeout(searchTimer); searchRevision++; locationGeneration++; setExpanded(false); });
  let liveRevision = 0;
  api.onState(next => { liveRevision++; render(next); });
  const initialRevision = liveRevision;
  api.get().then(next => {
    if (initialRevision !== liveRevision) return;
    render(next);
    if (next?.status === 'unconfigured') showPicker(true);
  }).catch(() => { render({ status: 'error', city: { name: '天气' } }); });
  const resetPointerFocus = () => { document.documentElement.dataset.inputMode = 'pointer'; document.activeElement?.blur(); };
  window.addEventListener('blur', resetPointerFocus);
  api.onPointerReset?.(resetPointerFocus);
  window.addEventListener('unload', () => { clearTimeout(searchTimer); searchRevision++; locationGeneration++; });
})();
