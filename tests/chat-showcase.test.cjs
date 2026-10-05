const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

test('new chat preserves history, cancels cleanly and blocks switching during reply', () => {
  let focus, reply;
  const nodes = {};
  const choices = [];
  function element() {
    return {
      dataset: {}, children: [], attributes: {}, listeners: {}, hidden: false,
      textContent: '', disabled: false,
      addEventListener(name, fn) { this.listeners[name] = fn; },
      click() { this.listeners.click?.({ target: this }); },
      focus() { focus = this; },
      setAttribute(name, value) { this.attributes[name] = value; },
      append(...items) { this.children.push(...items); },
      replaceChildren() { this.children = []; },
      contains(item) { return item === this; },
      remove() { choices.splice(choices.indexOf(this), 1); },
      querySelector() { return nodes.summary; }
    };
  }
  for (const name of ['model-picker', 'records', 'confirm', 'history', 'model-label', 'status', 'messages', 'send', 'draft', 'subtitle', 'new', 'cancel', 'create', 'reset', 'summary', 'reopen', 'close']) nodes[name] = element();
  nodes.records.append = button => choices.push(button);
  for (const key of ['today', 'earlier']) { const button = element(); button.dataset.chatSelect = key; choices.push(button); }
  const root = element();
  root.querySelector = selector => nodes[selector.match(/data-chat-(.*)\]/)[1]];
  root.querySelectorAll = selector => selector === '[data-chat-select]' ? [...choices] : [];
  const document = { querySelector: selector => selector === '[data-chat-demo]' ? root : selector === '[data-chat-reopen]' ? nodes.reopen : nodes.reset, addEventListener() {}, createElement: element };
  vm.runInNewContext(readFileSync(new URL('../chat-showcase.js', `file://${__filename}`), 'utf8'), {
    document, structuredClone, setTimeout: fn => { reply = fn; return 1; }, clearTimeout: () => { reply = null; }
  });
  const messages = () => nodes.messages.children.map(item => item.children[1].textContent);
  const initial = messages();
  nodes['model-picker'].open = true;
  nodes.new.click();
  assert.equal(nodes.confirm.hidden, false);
  assert.equal(nodes.records.hidden, true);
  assert.equal(nodes['model-picker'].open, false);
  nodes.cancel.click();
  assert.equal(nodes.confirm.hidden, true);
  assert.equal(nodes.records.hidden, true);
  assert.equal(focus, nodes.new);
  assert.deepEqual(messages(), initial);
  nodes.new.click(); nodes.create.click();
  assert.equal(nodes.new.hidden, false);
  assert.equal(choices.length, 2, 'confirming alone does not create history');
  nodes.send.click();
  assert.equal(choices.length, 3);
  assert.equal(nodes.new.hidden, false);
  assert.equal(nodes.new.disabled, true);
  assert.equal(nodes.history.disabled, true);
  assert.ok(choices.every(button => button.disabled));
  nodes.new.click(); nodes.history.click(); choices[0].click();
  assert.equal(nodes.confirm.hidden, true);
  assert.equal(nodes.records.hidden, true);
  assert.deepEqual(messages(), ['你好呀，球球。']);
  reply();
  assert.equal(nodes.new.disabled, false);
  const firstNew = messages();
  nodes.new.click(); nodes.create.click(); nodes.send.click(); reply();
  assert.equal(choices.length, 4);
  choices[2].click(); assert.deepEqual(messages(), firstNew);
  choices[0].click(); assert.deepEqual(messages(), initial);
  nodes.reset.click();
  assert.equal(choices.length, 2);
  assert.deepEqual(messages(), initial);
});
