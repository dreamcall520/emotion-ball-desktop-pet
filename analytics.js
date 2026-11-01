(() => {
  'use strict';

  const config = document.currentScript;
  const websiteId = config?.dataset.websiteId || '';
  const ga4Id = config?.dataset.ga4Id || '';
  const hostname = 'qiuqiu.pet';
  const dnt = [navigator.doNotTrack, window.doNotTrack, navigator.msDoNotTrack];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const umamiEnabled = uuid.test(websiteId);
  const ga4Enabled = /^G-[A-Z0-9]{6,20}$/.test(ga4Id);
  const pagePath = (location.pathname || '/').replace(/\/index\.html$/, '/');
  const pages = ['/', '/product/', '/updates/', '/privacy/', '/feedback/', '/thanks/', '/shop/',
    '/shop/handle-cup/', '/shop/cup/', '/shop/vest/', '/shop/mousepad/', '/works/'];

  // Empty provider IDs, previews, demos and opt-outs never load third-party scripts.
  if ((!umamiEnabled && !ga4Enabled) || location.protocol !== 'https:' ||
      location.hostname !== hostname || !pages.includes(pagePath) ||
      dnt.some(value => value === '1' || value === 'yes')) return;
  try {
    if (localStorage.getItem('umami.disabled') === '1' ||
        localStorage.getItem('qiuqiu.analytics.disabled') === '1') return;
  } catch (_error) {}
  if (window.qiuqiuAnalyticsInitialized) return;
  window.qiuqiuAnalyticsInitialized = true;

  const sourceOrigin = value => {
    try {
      const source = new URL(value);
      return /^https?:$/.test(source.protocol) &&
        source.hostname !== hostname && source.hostname !== `www.${hostname}`
        ? source.origin : '';
    } catch (_error) {
      return '';
    }
  };

  // Rebuild an allowlisted payload: never forward form text, query strings or IDs.
  window.qiuqiuAnalyticsBeforeSend = (type, payload) => {
    if (type !== 'event' || !payload || payload.website !== websiteId) return false;
    const cleaned = {
      website: websiteId,
      hostname,
      url: '/',
      title: '球球桌宠 - 免费的 macOS 桌面伙伴',
      referrer: sourceOrigin(payload.referrer),
    };
    if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(payload.language || '')) {
      cleaned.language = payload.language;
    }
    if (/^\d{1,5}x\d{1,5}$/.test(payload.screen || '')) cleaned.screen = payload.screen;

    if (payload.name) {
      const { architecture, position } = payload.data || {};
      if (payload.name !== 'download' || !['arm64', 'x64'].includes(architecture) ||
          !['hero', 'download'].includes(position)) return false;
      cleaned.name = 'download';
      cleaned.data = { architecture, position };
    }
    return cleaned;
  };

  const track = (...args) => {
    if (!umamiEnabled) return;
    try {
      // Tracking must never block navigation, even when the service is unavailable.
      Promise.resolve(window.umami?.track(...args)).catch(() => {});
    } catch (_error) {}
  };

  if (umamiEnabled) {
    const tracker = document.createElement('script');
    tracker.src = 'https://cloud.umami.is/script.js';
    tracker.async = true;
    tracker.referrerPolicy = 'origin';
    tracker.dataset.websiteId = websiteId;
    tracker.dataset.domains = hostname;
    tracker.dataset.autoTrack = 'false';
    tracker.dataset.excludeSearch = 'true';
    tracker.dataset.excludeHash = 'true';
    tracker.dataset.doNotTrack = 'true';
    tracker.dataset.beforeSend = 'qiuqiuAnalyticsBeforeSend';
    tracker.addEventListener('load', () => track(), { once: true });
    document.head.appendChild(tracker);
  }

  const page = {
    page_location: `https://${hostname}${pagePath}`,
    page_referrer: sourceOrigin(document.referrer),
    page_title: '球球官网',
  };
  const gaTrack = (...args) => {
    if (!ga4Enabled) return;
    try { Promise.resolve(window.gtag(...args)).catch(() => {}); } catch (_error) {}
  };
  if (ga4Enabled) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    const params = new URLSearchParams(location.search || '');
    const source = params.get('utm_source') || '';
    const medium = params.get('utm_medium') || '';
    const sources = ['google', 'bing', 'baidu', 'github', 'wechat', 'weixin', 'xiaohongshu', 'douyin',
      'bilibili', 'x', 'twitter', 'instagram', 'facebook', 'linkedin', 'newsletter', 'email'];
    const mediums = ['organic', 'referral', 'social', 'email', 'cpc', 'display', 'qr', 'offline'];
    // Override raw UTM fields; only a known source/medium pair may reach Analytics.
    const campaign = { campaign_source: '', campaign_medium: '', campaign_name: '',
      campaign_id: '', campaign_content: '', campaign_term: '' };
    if (sources.includes(source) && mediums.includes(medium)) {
      campaign.campaign_source = source;
      campaign.campaign_medium = medium;
    }
    gaTrack('js', new Date());
    gaTrack('config', ga4Id, { ...page, ...campaign, send_page_view: false,
      allow_google_signals: false, allow_ad_personalization_signals: false });
    gaTrack('event', 'page_view', { ...page, send_to: ga4Id });
    const tracker = document.createElement('script');
    tracker.src = `https://www.googletagmanager.com/gtag/js?id=${ga4Id}`;
    tracker.async = true;
    tracker.referrerPolicy = 'origin';
    document.head.appendChild(tracker);
  }

  const downloadClick = event => {
    if (event.type === 'click' ? event.button !== 0 : event.button !== 1) return;
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    const { downloadArch: architecture, downloadPosition: position } = link.dataset;
    const release = /^https:\/\/github\.com\/dreamcall520\/emotion-ball-desktop-pet\/releases\/download\/v([\d.]+)(?:-intel)?\/Qiuqiu-([\d.]+)-macOS-(arm64|x64)(?:-share\.zip|\.dmg)$/;
    const match = release.exec(link.href);
    if (match?.[3] === architecture && ['hero', 'download'].includes(position)) {
      track('download', { architecture, position });
      if (match[2].split('.').map(Number).join('.') === match[1]) {
        gaTrack('event', 'download_click', { ...page, send_to: ga4Id, architecture, position,
          download_source: 'github', version: match[2] });
      }
    } else if (link.href === 'https://share.weiyun.com/6WH6LkRl' && architecture === 'x64' && position === 'download') {
      track('download', { architecture, position });
      gaTrack('event', 'download_click', { ...page, send_to: ga4Id, architecture, position,
        download_source: 'weiyun', version: '0.4.09' });
    } else if (link.href === 'https://share.weiyun.com/7K7UEsDa') {
      const position = link.closest?.('nav') ? 'navigation' : link.closest?.('.hero-actions') ? 'hero' : 'download';
      gaTrack('event', 'download_click', { ...page, send_to: ga4Id, architecture: 'arm64', position,
        download_source: 'weiyun', version: '0.4.12' });
    }
  };
  document.addEventListener('click', downloadClick, { capture: true });
  document.addEventListener('auxclick', downloadClick, { capture: true });
})();
