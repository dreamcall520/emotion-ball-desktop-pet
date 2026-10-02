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
    ? [{ amount: { currency: 'usd', value: mode === 'small' ? 0.00006 : mode === 'negative' ? -0.00006 : mode === 'large' ? 123456.789 : 27.34 } },
      ...(mode === 'mixed' ? [{ amount: { currency: 'eur', value: 2.14 } }] : [])]
    : [{ input_tokens: 1254800, output_tokens: 184200, input_cached_tokens: mode === 'small' ? null : 826000, num_model_requests: 142 }];
  return { data: [{ start_time: start, end_time: start + 86400, results }], has_more: false, next_page: null };
}

async function verifyApiUsage({ getWindow, getMenu, pet, service, powerMonitor, apiLabel, quotaLabel, screen, showDemoQuota }) {
  const poll = async (read, test, label) => {
    let value;
    for (let attempt = 0; attempt < 120; attempt++) {
      value = await read();
      if (test(value)) {
        process.stdout.write(`PET_API_CHECK_OK ${label}\n`);
        return value;
      }
      await wait(30);
    }
    assert.fail(`${label}: ${JSON.stringify(value)}`);
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
  const visibleItem = getMenu().getMenuItemById('openai-api-visible');
  assert.equal(visibleItem.enabled, true, 'API card does not require subscription integration');
  visibleItem.click({ checked: true }, pet, {});
  await poll(() => apiLabel.getWindow()?.isVisible(), Boolean, 'unconnected API card appears');
  const card = apiLabel.getWindow();
  const cardPage = code => card.webContents.executeJavaScript(code);
  await poll(() => cardPage('document.querySelector("#api-period").textContent'), value => value === '未连接', 'unconnected state');
  assert.equal(await cardPage('typeof require'), 'undefined');
  assert.equal(card.webContents.getLastWebPreferences().sandbox, true);
  assert.equal(card.webContents.getLastWebPreferences().contextIsolation, true);
  assert.equal(await cardPage('typeof window.qiuqiuApiUsage'), 'undefined', 'card has no credential mutation bridge');
  win.hide();
  await cardPage('document.querySelector("#quota-label").click()');
  await poll(() => win.isVisible(), Boolean, 'unconnected card opens connection settings');
  assert.equal(calls, 0, 'turning on an unconnected card makes no requests');
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
  await poll(() => cardPage('document.querySelector("#api-compact-cost").textContent'), text => text === '$27.34', 'folded card renders cost');
  assert.equal(card.getBounds().width, 128);
  assert.equal(card.getBounds().height, 32);
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const area = screen.getDisplayMatching(pet.getBounds()).workArea;
  pet.setBounds({ x: Math.round(area.x + area.width / 2), y: Math.round(area.y + area.height / 2), width: 80, height: 80 }, false);
  showDemoQuota();
  await poll(() => quotaLabel.getWindow()?.isVisible(), Boolean, 'simulated subscription card appears');
  const quotaWin = quotaLabel.getWindow();
  const quotaPage = code => quotaWin.webContents.executeJavaScript(code);
  await poll(() => quotaPage('document.querySelector(".summary-value").textContent'), value => value === '79%', 'existing subscription renderer');
  await poll(() => ({ api: card.getBounds(), codex: quotaWin.getBounds(), pet: pet.getBounds(),
    apiVisible: card.isVisible(), quotaVisible: quotaWin.isVisible(), listeners: quotaWin.listenerCount('resize') }),
    bounds => !overlaps(bounds.api, bounds.codex), 'two folded cards do not overlap');
  const screenshotDirectory = process.env.PET_SMOKE_API_LABEL_SCREENSHOTS;
  const captures = {};
  const capture = async name => {
    if (!screenshotDirectory) return;
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    captures[name] = {};
    for (const [kind, target] of Object.entries({ pet, codex: quotaWin, api: card })) {
      await target.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const filename = `${name}-${kind}.png`;
      fs.writeFileSync(path.join(screenshotDirectory, filename), (await target.webContents.capturePage()).toPNG());
      captures[name][kind] = { file: filename, bounds: target.getBounds() };
    }
    fs.writeFileSync(path.join(screenshotDirectory, 'native-label-bounds.json'), JSON.stringify(captures, null, 2));
  };
  await capture('folded');
  await cardPage('document.querySelector("#quota-label").click()');
  await poll(() => card.getBounds().height, value => value === 128, 'API card expands');
  assert.equal(card.getBounds().width, 196);
  assert.match(await cardPage('document.querySelector("#api-month-cost").textContent'), /27\.34USD/);
  assert.equal(await cardPage('document.documentElement.scrollHeight > innerHeight'), false, 'expanded card fits native window');
  assert.equal(overlaps(card.getBounds(), quotaWin.getBounds()), false);
  await quotaPage('document.querySelector("#quota-label").click()');
  await poll(() => quotaWin.getBounds().height, value => value > 32, 'subscription expands independently');
  await wait(100);
  assert.equal(overlaps(card.getBounds(), quotaWin.getBounds()), false, 'API avoids expanded subscription card');
  assert.equal(overlaps(card.getBounds(), pet.getBounds()), false);
  await capture('expanded');
  win.hide();
  await cardPage('document.querySelector("#api-open-details").click()');
  await poll(() => win.isVisible(), Boolean, 'card opens full report');
  assert.equal(card.getBounds().height, 128, 'details button does not also collapse');
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
  assert.match(await cardPage('document.querySelector("#api-query-status").textContent'), /未更新/);
  assert.match(await cardPage('document.querySelector("#api-month-cost").textContent'), /27\.34/);
  assert.equal((await page('document.body.textContent')).includes('untrusted diagnostic'), false);
  mode = 'small';
  await submit('', 'proj_small');
  assert.match(await page('document.querySelector("#month-cost").textContent'), /<\s*0\.01|0\.00006/);
  assert.equal(await page('document.querySelector("#cached-tokens").textContent'), '未提供');
  await poll(() => cardPage('document.querySelector("#api-month-cost").textContent'), value => value.includes('0.00006'), 'small nonzero fees stay nonzero');
  for (const next of ['negative', 'large', 'mixed']) {
    mode = next;
    await page('window.qiuqiuApiUsage.refresh()');
    await poll(() => cardPage('document.querySelector("#api-month-cost").textContent'), value =>
      next === 'negative' ? value.includes('-0.00006') : next === 'large' ? value.includes('123,456.789') : value.includes('EUR') && value.includes('USD'), next);
    assert.equal(await cardPage('document.documentElement.scrollWidth > innerWidth'), false, 'amounts fit the native card');
  }
  mode = 'empty';
  await page('window.qiuqiuApiUsage.refresh()');
  assert.equal(await page('document.querySelector("#month-cost").textContent'), '0.00USD');
  await page('window.qiuqiuApiUsage.disconnect()');
  assert.equal(await page('document.querySelector("#month-cost").textContent'), '—');
  assert.equal(service.getState().report, null);
  await poll(() => cardPage('document.querySelector("#api-period").textContent'), value => value === '未连接', 'disconnect clears card');
  assert.equal(await cardPage('document.querySelector("#api-compact-cost").textContent'), '↗');
  assert.equal(await page('document.querySelector("#refresh-report").disabled'), true);
  win.setSize(460, 520);
  assert.equal(await page('document.documentElement.scrollWidth > innerWidth'), false, 'minimum size has no horizontal page overflow');
  powerMonitor.emit('lock-screen');
  assert.equal(win.isVisible(), false, 'lock hides billing data');
  assert.equal(card.isVisible(), false, 'lock hides persistent API card');
  powerMonitor.emit('unlock-screen');
  await poll(() => card.isVisible(), Boolean, 'unlock restores card');
  pet.hide();
  await poll(() => card.isVisible(), value => !value, 'hiding pet hides API card');
  process.stdout.write('PET_API_LABEL_INTEGRATION_OK\n');
  process.stdout.write('PET_API_USAGE_INTEGRATION_OK\n');
}

module.exports = { smokeGet, verifyApiUsage };
