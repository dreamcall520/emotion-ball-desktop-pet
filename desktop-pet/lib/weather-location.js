'use strict';

const path = require('node:path');
const ERRORS = Object.freeze({
  LOCATION_UNSUPPORTED: '此系统暂不支持定位，请手动选择城市。',
  LOCATION_NATIVE_UNAVAILABLE: '系统定位组件不可用，请手动选择城市。',
  LOCATION_DENIED: '定位未授权，可在系统设置中允许球球使用定位，或手动选择城市。',
  LOCATION_RESTRICTED: '系统限制了定位访问，请手动选择城市。',
  LOCATION_SERVICES_DISABLED: '系统定位服务已关闭，请手动选择城市。',
  LOCATION_TIMEOUT: '定位超时，请重试或手动选择城市。',
  LOCATION_BUSY: '正在获取位置，请稍候。',
  LOCATION_MAIN_THREAD_REQUIRED: '系统定位组件暂不可用，请手动选择城市。',
  LOCATION_UNAVAILABLE: '暂时无法获取位置，请重试或手动选择城市。'
});
function locationError(code) {
  const safeCode = Object.hasOwn(ERRORS, code) ? code : 'LOCATION_UNAVAILABLE';
  return Object.assign(new Error(ERRORS[safeCode]), { code: safeCode });
}
function createLocationBridge({ native, platform = process.platform } = {}) {
  let binding = native, loaded = native !== undefined, pending = null;
  function getBinding() {
    if (platform !== 'darwin') throw locationError('LOCATION_UNSUPPORTED');
    if (!loaded) {
      loaded = true;
      try { binding = require(path.join(__dirname, '../native/weather-location.node')); }
      catch { binding = null; }
    }
    if (!binding || typeof binding.status !== 'function' || typeof binding.locate !== 'function') throw locationError('LOCATION_NATIVE_UNAVAILABLE');
    return binding;
  }
  function status() {
    try {
      const current = getBinding().status();
      if (!current || !['not-determined', 'restricted', 'denied', 'granted', 'unknown'].includes(current.status) || typeof current.servicesEnabled !== 'boolean') throw locationError('LOCATION_UNAVAILABLE');
      return { status: current.status, servicesEnabled: current.servicesEnabled };
    } catch (error) { throw locationError(error?.code); }
  }
  function locate() {
    if (pending) return pending;
    pending = Promise.resolve().then(() => getBinding().locate()).then(value => {
      if (!value || !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 ||
          !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180 || !Number.isFinite(value.accuracy) || value.accuracy < 0) throw locationError('LOCATION_UNAVAILABLE');
      const result = { latitude: value.latitude, longitude: value.longitude, accuracy: value.accuracy };
      for (const key of ['name', 'locationLabel']) {
        if (typeof value[key] !== 'string') continue;
        const text = value[key].replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
        if (text && text.length <= 80) result[key] = text;
      }
      return result;
    }).catch(error => { throw locationError(error?.code); }).finally(() => { pending = null; });
    return pending;
  }
  return { status, locate };
}
module.exports = { createLocationBridge, locationError };
