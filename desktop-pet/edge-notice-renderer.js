(() => {
  const WMO_CODES = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
  function weatherView(weather, text) {
    if (!weather || typeof weather !== 'object' || Array.isArray(weather) || !WMO_CODES.includes(weather.code) || ![true, false, 0, 1].includes(weather.isDay)) return null;
    if (typeof text !== 'string' || !text.trim() || text.length > 28 || /[\x00-\x1f\x7f]/.test(text)) return null;
    if (weather.temperature != null && (typeof weather.temperature !== 'number' || !Number.isFinite(weather.temperature) || weather.temperature < -100 || weather.temperature > 70)) return null;
    const code = weather.code, period = weather.isDay ? 'day' : 'night';
    const name = code === 0 ? `clear-${period}` : [1, 2].includes(code) ? `partly-cloudy-${period}` : code === 3 ? 'overcast' : [45, 48].includes(code) ? `fog-${period}` : [51, 53, 55].includes(code) ? `overcast-${period}-drizzle` : [56, 57, 66, 67].includes(code) ? `overcast-${period}-sleet` : [61, 63, 65].includes(code) ? `overcast-${period}-rain` : [71, 73, 75, 77, 85, 86].includes(code) ? `overcast-${period}-snow` : [80, 81, 82].includes(code) ? `partly-cloudy-${period}-rain` : code === 95 ? `thunderstorms-${period}-rain` : `thunderstorms-${period}-hail`;
    return { icon: `assets/weather/meteocons/static/${name}.svg`, label: weather.temperature == null ? '天气' : `${Math.round(weather.temperature)}°`, text };
  }
  if (typeof module === 'object' && module.exports) { module.exports = { weatherView }; return; }
  const notice = document.getElementById('notice');
  let previous = null;
  function fitWeatherText() {
    const text = document.getElementById('text');
    if (document.body.dataset.weather !== 'true' || !text?.getBoundingClientRect) return;
    text.style.fontSize = ''; text.style.lineHeight = ''; text.style.whiteSpace = '';
    const width = text.getBoundingClientRect().width;
    if (width <= 0 || text.scrollWidth <= width) return;
    const size = Math.floor(12 * width / text.scrollWidth * 10) / 10;
    if (size >= 10.5) text.style.fontSize = `${size}px`;
    else { text.style.fontSize = '11px'; text.style.lineHeight = '13px'; text.style.whiteSpace = 'normal'; }
  }
  window.addEventListener('resize', fitWeatherText);
  const unsubscribe = window.edgeNotice.onUpdate(value => {
    if (!value || !['text', 'quota', 'workbuddy'].includes(value.kind)) return;
    const weather = value.kind === 'text' ? weatherView(value.weather, value.text) : null;
    document.documentElement.dataset.appearance = ['light', 'dark'].includes(value.appearance) ? value.appearance : 'system';
    document.body.dataset.side = value.side === 'right' ? 'right' : 'left';
    document.body.dataset.kind = value.kind;
    document.body.dataset.weather = String(Boolean(weather));
    const image = document.getElementById('weather-icon'), dot = document.getElementById('dot');
    if (image) { image.hidden = !weather; if (weather) image.src = weather.icon; else image.removeAttribute('src'); }
    if (dot) dot.hidden = Boolean(weather);
    const content = document.getElementById('text');
    if (content.style) { content.style.fontSize = ''; content.style.lineHeight = ''; content.style.whiteSpace = ''; }

    document.getElementById('brand').textContent = value.kind === 'quota' ? value.sourceId === 'zcode' ? 'ZCode' : 'Codex' : value.kind === 'workbuddy' ? 'WorkBuddy' : weather ? weather.label : '';
    const status = ['偏低', '紧张', '已用尽'].includes(value.statusLabel) ? ` · ${value.statusLabel}` : '';
    document.getElementById('text').textContent = value.kind === 'quota'
      ? `${value.period} · 剩余 ${value.remaining}%${status}` : value.text;
    fitWeatherText();
    notice.title = weather ? `${weather.label} · ${weather.text}` : value.kind === 'quota' && value.sourceId === 'zcode'
      ? `ZCode ${value.model || '额度'} · 剩余 ${value.remaining}%${status}` : '';
    if (previous !== value.id) {
      notice.classList.remove('appear');
      void notice.offsetWidth;
      notice.classList.add('appear');
      previous = value.id;
    }
  });
  window.addEventListener('beforeunload', unsubscribe, { once: true });
})();
