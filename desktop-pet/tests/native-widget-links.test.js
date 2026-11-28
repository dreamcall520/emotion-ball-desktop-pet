'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nativeWidgetAction } = require('../lib/native-widget-links');

test('native widget links accept only the four internal destinations', () => {
  for (const action of ['calendar', 'todos', 'connect-todos', 'connect-weather']) {
    assert.equal(nativeWidgetAction(`qiuqiu-widget://${action}`), action);
    assert.equal(nativeWidgetAction(`qiuqiu-widget://${action}/`), action);
  }
});
test('widget links cannot carry executable paths, arguments, credentials or external destinations', () => {
  for (const value of [null, '', '--calendar-preview', 'file:///tmp/app', 'https://calendar',
    'qiuqiu-widget://calendar/../../settings', 'qiuqiu-widget://calendar?path=/tmp',
    'qiuqiu-widget://user@calendar', 'qiuqiu-widget://calendar:80', 'qiuqiu-widget://todos#reset',
    'qiuqiu-widget://delete', 'qiuqiu-widget://calendar/' + 'a'.repeat(256)]) {
    assert.equal(nativeWidgetAction(value), null);
  }
});
