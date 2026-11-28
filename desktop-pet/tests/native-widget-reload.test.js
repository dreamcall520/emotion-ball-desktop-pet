'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reloadNativeWidgetChanges, TODO_KINDS, WEATHER_KINDS } = require('../lib/native-widget-reload');
test('parent requests only the timelines affected by a successful publication', () => {
  let kinds;
  const load = () => ({ reload(value) { kinds = value; return value.length; } });
  assert.equal(reloadNativeWidgetChanges({ ok: true, todo: { changed: true }, weather: { changed: false } }, load), 6);
  assert.deepEqual(kinds, TODO_KINDS);
  assert.equal(reloadNativeWidgetChanges({ ok: true, weather: { changed: true } }, load), 2);
  assert.deepEqual(kinds, WEATHER_KINDS);
});
test('unchanged, failed or malformed reports do not load a native module or refresh timelines', () => {
  const load = () => { throw Error('must not load'); };
  for (const report of [null, {}, { ok: false, todo: { changed: true } }, { ok: true }, { ok: true, todo: { changed: 1 } }]) {
    assert.equal(reloadNativeWidgetChanges(report, load), 0);
  }
});
