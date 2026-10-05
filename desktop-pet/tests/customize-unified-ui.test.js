const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

test('定制页唯一保存位于固定底栏，恢复位于顶部，沿用全部实际资源', () => {
  const html = fs.readFileSync(path.join(__dirname, '../customize.html'), 'utf8');
  assert.equal((html.match(/id="save"/g) || []).length, 1);
  assert.doesNotMatch(html, /save-bottom|runtime\/|theme\.js|foundation\.css|设计稿/);
  assert.match(html, /<header class="studio-header">[\s\S]*?id="reset-appearance"[\s\S]*?<\/header>/);
  assert.match(html, /<footer class="studio-footer">[\s\S]*?id="startup-default"[\s\S]*?id="save"[\s\S]*?<\/footer>/);
  assert.match(html, /id="manual-toggle"[^>]*type="button"[^>]*aria-controls="manual-controls"[^>]*aria-expanded="false"/);
  assert.match(html, /<section class="controls"/);
  assert.match(html, /<section class="preview-pane"/);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.equal(fs.existsSync(path.resolve(__dirname, '..', match[1])), true, match[1]);
  }
});

test('定制preload只转发现有API与安全归一的主题消息，可取消订阅', async () => {
  const ipc = new EventEmitter();
  const invoked = [], sent = [];
  ipc.invoke = async (...args) => { invoked.push(args); return true; };
  ipc.send = (...args) => sent.push(args);
  let bridge;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../customize-preload.js'), 'utf8'), {
    require: name => {
      assert.equal(name, 'electron');
      return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(name, value) {
        assert.equal(name, 'petCustomizer'); bridge = value;
      } } };
    }
  });
  const messages = [];
  const unsubscribe = bridge.onColorMode((...message) => messages.push(message));
  ipc.emit('pet:color-mode', {}, 'accessible', 'dark');
  ipc.emit('pet:color-mode', {}, 'unexpected', 'unexpected');
  assert.deepEqual(messages, [['accessible', 'dark'], ['standard', 'system']]);
  unsubscribe();
  ipc.emit('pet:color-mode', {}, 'accessible', 'light');
  assert.equal(messages.length, 2);
  assert.equal(ipc.listenerCount('pet:color-mode'), 0);
  assert.doesNotThrow(() => bridge.onColorMode(null)());
  const customization = { appearance: { shape: 'square' } };
  await bridge.load();
  await bridge.save(customization, false);
  bridge.preview(customization.appearance);
  assert.deepEqual(invoked, [['pet:customization-get'], ['pet:customization-save', customization, false]]);
  assert.deepEqual(sent, [['pet:customization-preview', customization.appearance]]);
});
