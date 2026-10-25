/* Synthetic website examples; no account, history, or persistence access. */
(() => {
  'use strict';
  const day = 86400000;
  function zcode({ now, expanded, action, bucketId, appearance, colorMode, generation }) {
    const items = [['GLM-5.3', 68], ['GLM-5.3-Flash', 82]].map(([label, remaining], index) => ({
      sourceId: 'zcode', bucketId: `zcode:demo:${index}`, label, planName: 'ZCode Start Plan',
      periodKind: 'daily', periodStart: now - 16 * 3600000, resetsAt: now + 8 * 3600000,
      windowMinutes: 1440, remaining, total: index ? 5000000 : 3000000, remainingUnits: Math.round(remaining / 100 * (index ? 5000000 : 3000000)), unit: 'token',
      pace: { state: 'slow', remainingTimePercent: 100 / 3 }
    }));
    const item = items.find(item => item.bucketId === bucketId) || items[0];
    return { sourceId: 'zcode', state: 'ready', size: 'compact', expanded, appearance, colorMode, generation,
      observedAt: now, quotaUpdatedAt: now, items, bucketId: item.bucketId, period: item.windowMinutes, action,
      activity: { runningCount: 0, unreadCount: 0 }, tasks: [], results: [],
      returnToTrend: action !== 'trend', returnPeriod: item.bucketId,
      trend: { windowMinutes: 1440, resetsAt: item.resetsAt,
        samples: Array.from({ length: 241 }, (_, index) => ({ at: item.periodStart + index * 240000,
          remaining: Math.round((100 - (100 - item.remaining) * (index / 240) ** 1.2) * 10) / 10 })),
        forecast: { state: 'estimate', status: 'safe', reason: 'estimate', reference: true,
          summary: '额度充裕', detail: '按近期用量估算，预计够用到刷新' } }
    };
  }
  function workbuddy({ now, expanded, action, appearance, colorMode }) {
    const date = at => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
    const endDate = date(now), midnight = Date.parse(`${endDate}T00:00:00+08:00`);
    const amounts = [12.8, 18.2, 9.6, 23.4, 15.2, 11.8, 8.6];
    const days = amounts.map((credits, index) => ({ date: date(midnight - (6 - index) * day), credits }));
    return { appearance, colorMode, expanded, action, busy: false, stale: false, error: null,
      report: { total: 7498.01, basic: 7000, reward: 498.01, purchased: 0, plan: '个人版', updatedAt: now,
        nextRefreshAt: midnight + 6 * day, expires: [{ amount: 98.01, at: midnight + 2 * day }] },
      activity: { runningCount: null, unreadCount: 0 },
      tasks: { report: { source: 'local-session-cache', scope: 'current-account', observedAt: now, pendingReview: 0, total: 0, items: [] } },
      usage: { report: { source: 'official-request-usage', complete: true, timezone: 'Asia/Shanghai', endDate,
        updatedAt: now, days, totalCredits: 99.6, todayCredits: 8.6,
        todayRecords: [1.2, 2.4, 5].map((credits, index) => ({ at: Math.round(midnight + (now - midnight) * (index + 1) / 3), credits })) } }
    };
  }
  window.QiuqiuIntegrationModels = Object.freeze({ zcode, workbuddy });
})();
