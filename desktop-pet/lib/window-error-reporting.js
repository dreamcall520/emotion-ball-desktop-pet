const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { sourceLocation, normalizeDiagnostic } = require('./error-diagnostics');

// No console text, external URLs or Electron details object crosses this boundary.
function trackWindowErrors(win, { capture, isQuitting, root = path.resolve(__dirname, '..') }) {
  const contents = win.webContents;
  function page(url) {
    try {
      const file = fileURLToPath(url || contents.getURL());
      if (path.dirname(file) !== root) return {};
      return normalizeDiagnostic('', {}, {page:path.basename(file)}).context;
    } catch { return {}; }
  }
  function report(scope, code, context = {}) {
    if (!isQuitting()) capture(scope, {code}, {...page(), process:'renderer', ...context});
  }
  win.on('unresponsive', () => report('窗口无响应', 'WINDOW_UNRESPONSIVE', {severity:'error',stage:'renderer-exception'}));
  contents.on('render-process-gone', (_event, details) => {
    if (['crashed','oom','abnormal-exit','integrity-failure','launch-failed'].includes(details?.reason)) {
      report('窗口崩溃', 'RENDER_PROCESS_GONE', {stage:'renderer-exception',severity:'fatal',reason:details.reason});
    }
  });
  contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) report('页面加载失败', 'PAGE_LOAD_FAILED', {...page(_url),stage:'window-load',netErrorCode:code,severity:'error'});
  });
  contents.on('preload-error', (_event, preloadPath, error) => {
    if (!isQuitting()) capture('预加载脚本错误', {name:error?.name,code:'PRELOAD_ERROR'}, {
      ...page(), ...sourceLocation(error,root), ...sourceLocation(preloadPath,root), stage:'renderer-exception', process:'preload', severity:'error'});
  });
  contents.on('console-message', event => {
    if (event.level !== 'error') return;
    // Console error is evidence of a console event, not proof of a script crash.
    const location = sourceLocation(event.sourceId, root);
    report('页面控制台错误', 'RENDERER_CONSOLE_ERROR', {stage:'renderer-console',severity:'error',...location,
      ...(location.source ? {line:event.lineNumber} : {})});
  });
}
module.exports = { trackWindowErrors };
