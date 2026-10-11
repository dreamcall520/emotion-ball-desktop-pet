const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');

// PET_SMOKE_FEEDBACK_ONLY=1 npm run smoke; the runner supplies an isolated profile.
// Add PET_SMOKE_FEEDBACK_SUBMIT=1 to submit synthetic text and a blank-form screenshot to the configured service.
async function verifyFeedbackIntegration({ open, setAppearance, getVersion }) {
  assert.equal(process.env.PET_SMOKE_TEST, '1');
  const win = open(), checks = [], output = process.env.PET_SMOKE_FEEDBACK_OUTPUT;
  for (let i = 0; i < 100 && (!win.isVisible() || win.webContents.isLoading()); i++) await wait(40);
  assert.ok(win.isVisible(), 'feedback window opens');
  for (const appearance of ['light', 'dark']) {
    setAppearance(appearance);
    await wait(160);
    const state = await win.webContents.executeJavaScript(`(async () => {
      const form = document.getElementById('feedback-form'), context = await window.qiuqiuFeedback.getContext();
      return { context, version: form.elements.version.value, os: form.elements.os.value,
        readonly: form.elements.version.readOnly && form.elements.os.readOnly,
        app: document.documentElement.dataset.context, theme: document.documentElement.dataset.theme,
        background: getComputedStyle(document.body).backgroundColor,
        noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        noWebsiteLink: getComputedStyle(document.querySelector('.website-only')).display === 'none',
        endpoint: window.QIUQIU_FEEDBACK_CONFIG.endpoint, disabled: document.getElementById('submit').disabled,
        csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content };
    })()`);
    assert.equal(state.context.source, 'app');
    assert.equal(state.context.version, getVersion());
    assert.equal(state.version, getVersion());
    assert.equal(state.os, state.context.os);
    assert.ok(state.readonly && state.noOverflow && state.noWebsiteLink);
    assert.equal(state.app, 'app');
    assert.equal(state.theme, appearance);
    assert.equal(state.disabled, !state.endpoint);
    assert.match(state.csp, /connect-src 'none'/);
    assert.equal(open(), win, 'feedback window is reused');
    checks.push(state);
    if (output) {
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, `feedback-${appearance}.png`), (await win.webContents.capturePage()).toPNG());
    }
  }
  assert.notEqual(checks[0].background, checks[1].background, 'native light/dark appearance differs');
  if (output) fs.writeFileSync(path.join(output, 'feedback-native.json'), JSON.stringify(checks, null, 2));
  if (process.env.PET_SMOKE_FEEDBACK_SUBMIT === '1') {
    assert.ok(checks[0].endpoint, 'real submission requires a configured endpoint');
    const screenshot = (await win.webContents.capturePage()).toPNG();
    assert.ok(screenshot.length > 0 && screenshot.length <= 1024 * 1024);
    if (output) fs.writeFileSync(path.join(output, 'native-smoke.png'), screenshot);
    await win.webContents.executeJavaScript(`(() => {
      const form = document.getElementById('feedback-form');
      form.elements.title.value = 'App 原生反馈合成验收';
      form.elements.detail.value = '仅用于意见反馈链路验收，使用隔离 profile 和空白表单截图，无真实用户信息。';
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(screenshot.toString('base64'))}), value => value.charCodeAt(0))], 'native-smoke.png', { type: 'image/png' }));
      form.elements.attachments.files = transfer.files;
      form.elements.attachments.dispatchEvent(new Event('change'));
      form.requestSubmit();
    })()`);
    let result;
    for (let i = 0; i < 200; i++) {
      result = await win.webContents.executeJavaScript(`({
        success: !document.getElementById('success').hidden,
        receipt: document.getElementById('receipt').textContent,
        error: document.getElementById('status').dataset.error === 'true' ? document.getElementById('status').textContent : ''
      })`);
      if (result.success || result.error) break;
      await wait(200);
    }
    assert.ok(result.success, result.error || 'native submission did not finish');
    assert.match(result.receipt, /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    if (output) fs.writeFileSync(path.join(output, 'feedback-submission.json'), JSON.stringify({
      testedAt: new Date().toISOString(), endpoint: checks[0].endpoint, context: checks[0].context,
      noProxyServer: process.argv.includes('--no-proxy-server'), screenshotBytes: screenshot.length,
      screenshotSHA256: createHash('sha256').update(screenshot).digest('hex'), ...result
    }, null, 2));
    process.stdout.write('PET_FEEDBACK_SUBMISSION_OK\n');
  }
  process.stdout.write('PET_FEEDBACK_INTEGRATION_OK\n');
}

module.exports = { verifyFeedbackIntegration };
