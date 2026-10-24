(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SheepTheme = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const THEMES = Object.freeze(['none', 'halloween', 'christmas', 'spring-festival', 'auto']);
  // ICU 78 shifts 2027 New Year by one day; use the HKO calendar: https://www.hko.gov.hk/tc/gts/time/conversion.htm
  // shortcut: Spring Festival auto-switch covers 2026–2040; extend from HKO before supporting later years.
  const SPRING_FESTIVALS = Object.freeze({
    2026: [1, 17], 2027: [1, 6], 2028: [0, 26], 2029: [1, 13], 2030: [1, 3],
    2031: [0, 23], 2032: [1, 11], 2033: [0, 31], 2034: [1, 19], 2035: [1, 8],
    2036: [0, 28], 2037: [1, 15], 2038: [1, 4], 2039: [0, 24], 2040: [1, 12]
  });
  function normalizeTheme(value) { return THEMES.includes(value) ? value : 'none'; }
  function resolveTheme(value, date) {
    const theme = normalizeTheme(value);
    if (theme !== 'auto') return theme;
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return 'none';
    const month = date.getMonth() + 1, day = date.getDate();
    if (month === 10 && day >= 26 && day <= 31) return 'halloween';
    if (month === 12 && day >= 20 && day <= 25) return 'christmas';
    const springFestival = SPRING_FESTIVALS[date.getFullYear()];
    if (springFestival) {
      const [springMonth, springDay] = springFestival;
      const daysUntil = (Date.UTC(date.getFullYear(), springMonth, springDay) - Date.UTC(date.getFullYear(), month - 1, day)) / 86400000;
      // Six days before New Year's Day through lunar January 15, inclusive.
      if (daysUntil >= -14 && daysUntil <= 6) return 'spring-festival';
    }
    return 'none';
  }

  return Object.freeze({ THEMES, normalizeTheme, resolveTheme });
}));
