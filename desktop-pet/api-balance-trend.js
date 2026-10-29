/* A view of the selected account's observations, never a consumption ledger. */
(function (root) {
  function balanceTrend(history, period, now = Date.now()) {
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const days = period === 'today' ? [] : Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today); date.setDate(date.getDate() - 6 + index); return date.getTime();
    });
    const start = days[0] ?? today.getTime();
    const observations = [...new Map((Array.isArray(history) ? history : []).filter(point =>
      Number.isSafeInteger(point?.at) && point.at >= start && point.at <= now && Number.isFinite(point.available)
    ).map(point => [point.at, { at: point.at, available: point.available }])).values()].sort((a, b) => a.at - b.at);
    // Weekly points are the last actual observation on each local calendar day.
    // Keep original timestamps for inspection and all observations for the period's net change.
    const daily = new Map();
    if (days.length) for (const point of observations) {
      const date = new Date(point.at); date.setHours(0, 0, 0, 0);
      daily.set(date.getTime(), { ...point, day: date.getTime() });
    }
    const points = days.length ? [...daily.values()] : observations, segments = [];
    for (const point of points) {
      const last = segments.at(-1);
      const missing = last && (days.length ? days.indexOf(point.day) - days.indexOf(last.at(-1).day) > 1 : point.at - last.at(-1).at > 45 * 60000);
      if (!last || missing) segments.push([point]); else last.push(point);
    }
    return { start, end: now, days, points, segments, net: observations.length > 1 ? observations.at(-1).available - observations[0].available : null };
  }
  if (typeof module !== 'undefined') module.exports = { balanceTrend }; else root.BalanceTrend = { balanceTrend };
})(typeof window === 'undefined' ? this : window);
