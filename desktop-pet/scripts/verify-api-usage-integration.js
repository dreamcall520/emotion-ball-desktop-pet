const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

const demoKey = 'sk-admin-demo-not-a-real-key';
let mode = 'normal';
let calls = 0;
async function smokeGet(url, key) {
  assert.equal(process.env.PET_SMOKE_TEST, '1');
  assert.equal(process.env.PET_SMOKE_API_USAGE_ONLY, '1');
  assert.equal(key, demoKey);
  calls++;
  await wait(30);
  if (mode === 'fail') throw new Error('untrusted diagnostic contains demo secret');
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  const results = mode === 'empty' ? [] : url.pathname.endsWith('/costs')
    ? [{ amount: { currency: 'usd', value: mode === 'small' ? 0.00006 : 27.34 } }]
    : [{ input_tokens: 1254800, output_tokens: 184200, input_cached_tokens: mode === 'small' ? null : 826000, num_model_requests: 142 }];
  return { data: [{ start_time: start, end_time: start + 86400, results }], has_more: false, next_page: null };
}

async function verifyApiUsage({ getWindow, getMenu, pet, service, powerMonitor }) {
  const poll = async (read, test, label) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const value = await read();
      if (test(value)) return value;
      await wait(30);
    }
    assert.fail(label);
  };
  const menu = getMenu().getMenuItemById('openai-api-usage');
  assert.equal(menu.enabled, true, 'API entry works without subscription integration');
  assert.equal(calls, 0, 'starting the pet does not query API statistics');
  menu.click(menu, pet, {});
  await poll(() => getWindow()?.isVisible(), Boolean, 'API window opens');
  const win = getWindow();
  const page = code => win.webContents.executeJavaScript(code);
  await poll(() => page('Boolean(window.qiuqiuApiUsage && document.querySelector("#connect-report"))'), Boolean, 'preload/renderer load');
  assert.equal(await page('typeof require'), 'undefined');
  assert.equal(win.webContents.getLastWebPreferences().sandbox, true);
  assert.equal(win.webContents.getLastWebPreferences().contextIsolation, true);
  assert.equal(await pet.webContents.executeJavaScript('typeof window.qiuqiuApiUsage'), 'undefined', 'other window has no billing bridge');
  const submit = async (key, projectId = 'proj_codex_demo', apiKeyId = 'key_codex_demo') => {
    await page(`(() => {
      document.querySelector('#connection-settings').open = true;
      document.querySelector('#admin-key').value = ${JSON.stringify(key)};
      document.querySelector('#project-id').value = ${JSON.stringify(projectId)};
      document.querySelector('#api-key-id').value = ${JSON.stringify(apiKeyId)};
      document.querySelector('#connection-form').requestSubmit();
    })()`);
    assert.equal(await page('document.querySelector("#admin-key").value'), '', 'key clears on submit');
    await poll(() => service.getState().busy, value => !value, 'query completes');
  };
  await submit(demoKey);
  await poll(() => page('document.querySelector("#month-cost").textContent'), text => text.includes('27.34'), 'cost report rendered');
  assert.equal(await page('document.querySelector("#input-tokens").textContent'), '1,254,800');
  assert.equal(await page('document.querySelector("#cached-tokens").textContent'), '826,000');
  assert.equal(await page('document.querySelector("#admin-key").required'), false);
  assert.equal(JSON.stringify(await page('window.qiuqiuApiUsage.getState()')).includes(demoKey), false);
  if (process.env.PET_SMOKE_API_USAGE_SCREENSHOT) {
    const target = process.env.PET_SMOKE_API_USAGE_SCREENSHOT;
    await page("document.querySelector('.api-header p').textContent = 'OpenAI 官方组织报告 · 模拟数据预览'");
    await page('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await wait(100);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, (await win.webContents.capturePage()).toPNG());
  }
  mode = 'fail';
  await submit('', 'proj_changed');
  assert.equal(service.getState().config.projectId, 'proj_codex_demo');
  assert.equal(await page('document.querySelector("#month-cost").textContent'), '27.34USD');
  assert.match(await page('document.querySelector("#query-status").textContent'), /未更新/);
  assert.equal((await page('document.body.textContent')).includes('untrusted diagnostic'), false);
  mode = 'small';
  await submit('', 'proj_small');
  assert.match(await page('document.querySelector("#month-cost").textContent'), /<\s*0\.01|0\.00006/);
  assert.equal(await page('document.querySelector("#cached-tokens").textContent'), '未提供');
  mode = 'empty';
  await page('window.qiuqiuApiUsage.refresh()');
  assert.equal(await page('document.querySelector("#month-cost").textContent'), '0.00USD');
  await page('window.qiuqiuApiUsage.disconnect()');
  assert.equal(await page('document.querySelector("#month-cost").textContent'), '—');
  assert.equal(service.getState().report, null);
  assert.equal(await page('document.querySelector("#refresh-report").disabled'), true);
  win.setSize(460, 520);
  assert.equal(await page('document.documentElement.scrollWidth > innerWidth'), false, 'minimum size has no horizontal page overflow');
  powerMonitor.emit('lock-screen');
  assert.equal(win.isVisible(), false, 'lock hides billing data');
  powerMonitor.emit('unlock-screen');
  process.stdout.write('PET_API_USAGE_INTEGRATION_OK\n');
}

module.exports = { smokeGet, verifyApiUsage };
