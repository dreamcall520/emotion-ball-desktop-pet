'use strict';

// IPC/card projection for the website summary. `total` means the remaining
// website credits, not the cycle grant. No account metadata crosses this seam.
function safeWebsiteSummaryReport(value) {
  if (value?.scope !== 'website-summary' || !Number.isFinite(value.total) || value.total < 0) return null;
  const timestamp = value.updatedAt;
  return {
    scope: 'website-summary', total: value.total,
    basic: null, reward: null, purchased: null,
    plan: typeof value.plan === 'string' ? value.plan.slice(0, 60) : '网站汇总',
    updatedAt: Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= 8640000000000000 ? timestamp : null,
    nextRefreshAt: null, expires: [],
    coverage: { packages: 'credits-only', basicRewardPurchased: 'not-separated',
      cycleReset: 'not-queried', enterpriseLimit: 'not-verified' }
  };
}
module.exports = { safeWebsiteSummaryReport };
