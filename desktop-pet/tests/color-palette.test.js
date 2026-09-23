'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'color-mode.css'), 'utf8');
const palette = Object.fromEntries([...css.matchAll(/--accessible-([\w-]+):\s*(#[0-9a-f]{6});/g)]
  .map(([, name, color]) => [name, color]));

function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function contrast(foreground, background) {
  assert.ok(palette[foreground], `Missing foreground ${foreground}`);
  assert.ok(palette[background], `Missing background ${background}`);
  const values = [luminance(palette[foreground]), luminance(palette[background])].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

test('accessible text, labels and disabled controls maintain 4.5:1 on every used surface', () => {
  const pairs = [
    ['text', 'panel'], ['muted', 'panel'], ['blue', 'panel'], ['yellow', 'panel'],
    ['text', 'surface'], ['muted', 'surface'], ['blue', 'surface'],
    ['text', 'raised'], ['muted', 'raised'], ['blue', 'raised'],
    ['muted', 'disabled'], ['yellow', 'warning'], ['panel', 'blue'],
  ];
  for (const [foreground, background] of pairs) {
    const ratio = contrast(foreground, background);
    assert.ok(ratio >= 4.5, `${foreground}/${background} is ${ratio.toFixed(2)}:1`);
  }
});

test('accessible progress, outlines and focus indicators maintain 3:1', () => {
  for (const [foreground, background] of [
    ['blue', 'track'], ['yellow', 'track'],
    ['line', 'panel'], ['line', 'surface'], ['line', 'raised'],
    ['yellow', 'panel'], ['yellow', 'surface'], ['panel', 'text'],
  ]) {
    const ratio = contrast(foreground, background);
    assert.ok(ratio >= 3, `${foreground}/${background} is ${ratio.toFixed(2)}:1`);
  }
});

test('shared accessibility stylesheet cannot change the standard mode', () => {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...source.matchAll(/([^{}]+)\{[^{}]*\}/g)];
  assert.ok(rules.length > 20, 'expected all window surfaces to have scoped rules');
  for (const [, selectorList] of rules) {
    // Ignore commas inside :is(...); each top-level selector is independently scoped.
    const selectors = selectorList.replace(/\([^()]*\)/g, '').split(',');
    for (const selector of selectors) {
      assert.ok(selector.trim().startsWith(':root[data-color-mode="accessible"]'), selector.trim());
    }
  }
});
