'use strict';

const ACTIONS = new Set(['calendar', 'todos', 'connect-todos', 'connect-weather']);

function nativeWidgetAction(value) {
  if (typeof value !== 'string' || value.length > 256) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'qiuqiu-widget:' || url.username || url.password || url.port ||
        url.search || url.hash || !['', '/'].includes(url.pathname) || !ACTIONS.has(url.hostname)) return null;
    return url.hostname;
  } catch { return null; }
}

module.exports = { nativeWidgetAction };
