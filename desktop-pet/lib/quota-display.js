(function (root) {
  'use strict';
  const STYLES = Object.freeze(['card', 'pool', 'ring', 'duo', 'split', 'stages']);
  function normalize(value, legacy = {}) {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      style: STYLES.includes(raw.style) ? raw.style : 'card',
      material: raw.material === 'glass' ? 'glass' : 'soft',
      period: ['fiveHour', 'weekly', 'both'].includes(raw.period) ? raw.period
        : ['fiveHour', 'weekly'].includes(legacy.codexQuotaPeriod) ? legacy.codexQuotaPeriod : 'both',
      cardSize: ['standard', 'compact'].includes(raw.cardSize) ? raw.cardSize
        : legacy.codexQuotaLabelSize === 'standard' ? 'standard' : 'compact',
      showNumbers: raw.showNumbers === true
    };
  }
  function periods(config, model) {
    if (model !== undefined) {
      const available = ['fiveHour', 'weekly'].filter(period =>
        model?.items?.some(item => item.windowMinutes === (period === 'fiveHour' ? 300 : 10080) &&
          typeof item.remaining === 'number' && Number.isFinite(item.remaining) && item.remaining >= 0 && item.remaining <= 100));
      return ['pool', 'ring'].includes(config.style) ? available.slice(0, 1) : available;
    }
    return ['duo', 'split', 'stages'].includes(config.style) || config.period === 'both' && config.style === 'card'
      ? ['fiveHour', 'weekly'] : [config.period === 'weekly' ? 'weekly' : 'fiveHour'];
  }
  function values(model) {
    const result = { fiveHour: null, weekly: null };
    if (model?.state !== 'ready') return result;
    for (const item of Array.isArray(model.items) ? model.items : []) {
      const key = item.windowMinutes === 300 ? 'fiveHour' : item.windowMinutes === 10080 ? 'weekly' : null;
      if (key && typeof item.remaining === 'number' && Number.isFinite(item.remaining) && item.remaining >= 0 && item.remaining <= 100) result[key] = item.remaining;
    }
    return result;
  }
  const api = { STYLES, normalize, periods, values };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QuotaDisplay = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
