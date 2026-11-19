'use strict';

const path = require('node:path');
const ERRORS = Object.freeze({
  CANCELLED: '定位已取消。',
  LOCATION_UNSUPPORTED: '此系统暂不支持定位，请手动选择城市。',
  LOCATION_NATIVE_UNAVAILABLE: '系统定位组件不可用，请手动选择城市。',
  LOCATION_DENIED: '定位未授权，可在系统设置中允许球球使用定位，或手动选择城市。',
  LOCATION_RESTRICTED: '系统限制了定位访问，请手动选择城市。',
  LOCATION_SERVICES_DISABLED: '系统定位服务已关闭，请手动选择城市。',
  LOCATION_NO_FIX: '系统暂时无法确定当前位置，请稍后重试或手动选择城市。',
  LOCATION_TIMEOUT: '定位超时，请重试或手动选择城市。',
  LOCATION_BUSY: '正在获取位置，请稍候。',
  LOCATION_MAIN_THREAD_REQUIRED: '系统定位组件暂不可用，请手动选择城市。',
  LOCATION_UNAVAILABLE: '暂时无法获取位置，请重试或手动选择城市。'
});
function locationError(code) {
  const safeCode = Object.hasOwn(ERRORS, code) ? code : 'LOCATION_UNAVAILABLE';
  return Object.assign(new Error(ERRORS[safeCode]), { code: safeCode });
}
function safeDiagnostic(value) {
  const result = {};
  if (['not-determined', 'restricted', 'denied', 'granted', 'unknown'].includes(value?.locationAuthorization)) result.locationAuthorization = value.locationAuthorization;
  for (const key of ['locationMainThread', 'locationStarted', 'locationAppActive']) if (typeof value?.[key] === 'boolean') result[key] = value[key];
  for (const key of ['locationAuthorizationCallbacks', 'locationCallbacks', 'locationUnknownFailures', 'locationSamplesRejected']) {
    if (Number.isSafeInteger(value?.[key]) && value[key] >= 0 && value[key] <= 1000000) result[key] = value[key];
  }
  if (['authorization', 'acquisition', 'geocode'].includes(value?.locationPhase)) result.locationPhase = value.locationPhase;
  for (const key of ['locationElapsedMs', 'locationPhaseElapsedMs']) {
    if (Number.isSafeInteger(value?.[key]) && value[key] >= 0 && value[key] <= 3600000) result[key] = value[key];
  }
  return result;
}
function createLocationBridge({ native, platform = process.platform, onDiagnostic = () => {} } = {}) {
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
  function report(outcome, code, diagnostic) {
    try { onDiagnostic({ outcome, ...(code ? { code } : {}), diagnostic: { ...diagnostic } }); }
    catch { /* Local diagnostics must never change location results. */ }
  }
  function locate() {
    if (pending) return pending.promise;
    const request = { promise: null, nativePromise: null, started: false, cancelled: false };
    pending = request;
    request.promise = Promise.resolve().then(() => {
      if (request.cancelled) throw locationError('CANCELLED');
      request.nativePromise = getBinding().locate(); request.started = true;
      return request.nativePromise;
    }).then(value => {
      if (request.cancelled) throw locationError('CANCELLED');
      if (!value || !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 ||
          !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180 || !Number.isFinite(value.accuracy) || value.accuracy < 0) throw locationError('LOCATION_UNAVAILABLE');
      const result = { latitude: value.latitude, longitude: value.longitude, accuracy: value.accuracy };
      for (const key of ['name', 'locationLabel']) {
        if (typeof value[key] !== 'string') continue;
        const text = value[key].replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
        if (text && text.length <= 80) result[key] = text;
      }
      const diagnostic = safeDiagnostic(value.diagnostic);
      if (Object.keys(diagnostic).length) result.diagnostic = diagnostic;
      report('success', undefined, diagnostic);
      return result;
    }).catch(error => {
      const failure = locationError(request.cancelled ? 'CANCELLED' : error?.code), diagnostic = safeDiagnostic(error?.diagnostic);
      if (Object.keys(diagnostic).length) failure.diagnostic = diagnostic;
      report(failure.code === 'CANCELLED' ? 'cancelled' : 'failure', failure.code === 'CANCELLED' ? undefined : failure.code, diagnostic);
      throw failure;
    }).finally(() => { if (pending === request) pending = null; });
    return request.promise;
  }
  function cancel() {
    const request = pending;
    if (!request) return false;
    if (request.started) {
      // Native must synchronously retire this exact manager before a new request starts.
      // Older/missing bindings or a failed cancel retain the pending owner to avoid BUSY.
      try { if (getBinding().cancel?.(request.nativePromise) !== true) return false; }
      catch { return false; }
    }
    request.cancelled = true;
    if (pending === request) pending = null;
    return true;
  }
  return { status, locate, cancel };
}
module.exports = { createLocationBridge, locationError };
