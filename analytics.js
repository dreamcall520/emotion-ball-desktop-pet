(() => {
  'use strict';

  const config = document.currentScript;
  const websiteId = config?.dataset.websiteId || '';
  const hostname = 'qiuqiu.pet';
  const dnt = [navigator.doNotTrack, window.doNotTrack, navigator.msDoNotTrack];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // An empty ID keeps the integration disabled, including third-party requests.
  if (!uuid.test(websiteId) || location.protocol !== 'https:' ||
      location.hostname !== hostname || dnt.some(value => value === '1' || value === 'yes')) return;
  try {
    if (localStorage.getItem('umami.disabled') === '1') return;
  } catch (_error) {}

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
    try {
      // Tracking must never block navigation, even when the service is unavailable.
      Promise.resolve(window.umami?.track(...args)).catch(() => {});
    } catch (_error) {}
  };

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

  const downloadClick = event => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = event.target.closest?.('a[data-download-arch][data-download-position]');
    if (!link) return;
    const { downloadArch: architecture, downloadPosition: position } = link.dataset;
    const release = /^https:\/\/github\.com\/dreamcall520\/emotion-ball-desktop-pet\/releases\/download\/v[\d.]+\/Qiuqiu-[\d.]+-macOS-(arm64|x64)-share\.zip$/;
    if (release.exec(link.href)?.[1] !== architecture) return;
    track('download', { architecture, position });
  };
  document.addEventListener('click', downloadClick, { capture: true });
  document.addEventListener('auxclick', downloadClick, { capture: true });
})();
