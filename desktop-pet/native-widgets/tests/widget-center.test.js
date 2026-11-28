'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const binary = path.join(__dirname, '../../build/native-widgets/widget-center.node');
const addon = require(binary);
test('NAPI module exports only refresh and bundle identity', () => assert.deepEqual(Object.keys(addon).sort(), ['bundleIdentifier', 'reload']));
test('bundle identity reports current process context synchronously', () => { const id = addon.bundleIdentifier(); assert.ok(id === null || typeof id === 'string'); });
test('empty refresh has no system requests', () => assert.equal(addon.reload([]), 0));
for (const [name, args] of [
  ['missing array', []], ['extra argument', [[], true]], ['non-array', ['QiuqiuNativeMonthProbe']],
  ['oversized array', [Array(17).fill('QiuqiuNativeMonthProbe')]], ['unknown kind', [['UnknownWidget']]],
  ['mixed invalid types', [['QiuqiuNativeMonthProbe', null]]], ['sparse array', [Array(1)]],
  ['embedded zero', [['QiuqiuNativeMonthProbe\0']]], ['oversized string', [['x'.repeat(129)]]],
]) test(`rejects ${name} before any refresh`, () => assert.throws(() => addon.reload(...args), { name: 'TypeError', code: 'WIDGET_KINDS_INVALID' }));
test('bundle metadata rejects arguments', () => assert.throws(() => addon.bundleIdentifier('ignored'), { name: 'TypeError', code: 'WIDGET_ARGUMENT_INVALID' }));
test('whitelist exactly matches the 16 configured kinds', () => {
  const root = path.join(__dirname, '..');
  const configured = fs.readdirSync(root).filter(name => name.endsWith('.swift')).flatMap(name => [...fs.readFileSync(path.join(root, name), 'utf8').matchAll(/kind:\s*"([^"]+)"/g)].map(match => match[1]));
  const native = [...fs.readFileSync(path.join(root, 'widget-center.mm'), 'utf8').matchAll(/^  ?"(QiuqiuNative[^"]+)"|"(QiuqiuNative[^"]+)"/gm)].map(match => match[1] || match[2]);
  assert.equal(new Set(configured).size, 16);
  assert.deepEqual([...new Set(native)].sort(), [...new Set(configured)].sort());
});
test('short-lived helper no longer calls WidgetCenter', () => {
  const source = fs.readFileSync(path.join(__dirname, '../WidgetBridgeSync.swift'), 'utf8');
  assert.doesNotMatch(source, /import WidgetKit|WidgetCenter\.shared/);
  assert.match(source, /reload: \(String\) -> Void = \{ _ in \}/);
});
