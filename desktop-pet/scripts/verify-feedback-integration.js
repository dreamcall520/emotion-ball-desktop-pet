// Run with Electron; real main/preload/renderer, with feedback requests confined to a local receiver.
const { app, BrowserWindow, net, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-feedback-integration-'));
const appData = path.join(temporary, 'app-data'), userData = path.join(temporary, 'user-data');
const packageAsar = process.env.PET_FEEDBACK_APP_ASAR, kind = packageAsar ? 'package' : 'source';
const output = process.env.PET_SMOKE_ARTIFACT_DIR || path.join(os.tmpdir(), 'qiuqiu-feedback-results');
const endpoint = 'https://qiuqiu-feedback-entry.pages.dev/api/feedback', received = [], blocked = [];
const report = { kind, transport: 'local HTTP receiver only; not the production service', passed: false, checks: {} };
for (const directory of [userData, path.join(appData, '球球桌宠-反馈验收')]) {
  fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ autoUpdateCheck: false }));
}
app.setPath('appData', appData); app.setPath('userData', userData); process.argv.push('--settings-preview');
delete process.env.PET_SMOKE_TEST;
const server = http.createServer(async (request, response) => {
  let data = ''; for await (const chunk of request) data += chunk;
  const body = JSON.parse(data); received.push(body);
  const manual = !body.title.startsWith('[自动异常]');
  response.writeHead(manual && received.filter(item => !item.title.startsWith('[自动异常]')).length === 1 ? 503 : 201, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(manual && received.filter(item => !item.title.startsWith('[自动异常]')).length === 1 ? { error: 'local-test-failure' } : { id: body.submissionId }));
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check, label) => {
  const end = Date.now() + 10000;
  while (!await check()) { if (Date.now() > end) throw Error(`Timed out: ${label}`); await sleep(40); }
};
let finished = false;
async function finish(error) {
  if (finished) return; finished = true; clearTimeout(timeout);
  if (error) {
    report.error = String(error.stack || error);
    const settingsWindow = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/global-settings.html'));
    if (settingsWindow && !settingsWindow.isDestroyed()) report.failureWindow = { visible: settingsWindow.isVisible(), status: await settingsWindow.webContents.executeJavaScript('document.querySelector("#report-status")?.textContent || ""') };
  }
  report.received = received; report.network = { realExternalRequests: 0, blockedRequests: blocked.length };
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.destroy();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true }); report.cleanup = { temporaryProfileRemoved: !fs.existsSync(temporary), receiverClosed: !server.listening };
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, `feedback-integration-${kind}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(`FEEDBACK_INTEGRATION_${report.passed ? 'OK' : 'FAILED'} ${kind}`); app.exit(error ? 1 : 0);
}
const timeout = setTimeout(() => { void finish(Error('Feedback integration timed out after 45 seconds')); }, 45000);
process.on('uncaughtException', error => { void finish(error); }); process.on('unhandledRejection', error => { void finish(error); });
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); await app.whenReady();
  const receiver = `http://127.0.0.1:${server.address().port}/api/feedback`, originalFetch = net.fetch.bind(net);
  net.fetch = (url, options) => String(url) === endpoint ? originalFetch(receiver, options) : Promise.reject(Error('External request blocked by integration test'));
  globalThis.fetch = async () => { throw Error('External fetch blocked by integration test'); };
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, done) => {
    const allowed = details.url === receiver; if (!allowed) blocked.push(details.url); done({ cancel: !allowed });
  });
  require(packageAsar ? path.join(packageAsar, 'desktop-pet/main.js') : '../main');
  let win; await until(() => {
    win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('/global-settings.html'));
    return win && !win.webContents.isLoading();
  }, 'real settings window');
  await until(() => win.isVisible(), 'settings window visible for user input');
  const evaluate = code => win.webContents.executeJavaScript(code);
  await until(() => evaluate('Boolean(document.querySelector("[data-view=feedback]"))'), 'feedback navigation');
  await evaluate('document.querySelector("[data-view=feedback]").click()');
  await until(() => evaluate('Boolean(document.querySelector("#report-title"))'), 'real feedback form');
  const initial = await evaluate('window.qiuqiuSettings.get()');
  assert.equal(initial.feedback.enabled, true); report.checks.defaultAutomaticEnabled = true;
  assert(app.getPath('userData').startsWith(temporary + path.sep)); assert(app.getPath('appData').startsWith(temporary + path.sep));
  report.checks.profileIsolated = true; report.checks.acceptanceProfileRedirected = !packageAsar || path.basename(app.getPath('userData')) === '球球桌宠-反馈验收';
  assert(report.checks.acceptanceProfileRedirected);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBuoAAAAASUVORK5CYII=';
  await evaluate(`(() => {
    document.querySelector('#report-title').value = '本机反馈闭环验收'; document.querySelector('#report-detail').value = '原始说明：仅本机接收器验证';
    document.querySelector('#report-contact').value = 'local-test@example.invalid';
    const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), c => c.charCodeAt(0));
    const transfer = name => { const data = new DataTransfer(); data.items.add(new File([bytes], name, {type:'image/png'})); return data; };
    const input = document.querySelector('#report-attachments'); input.files = transfer('choose.png').files; input.dispatchEvent(new Event('change'));
    const zone = document.querySelector('#report-dropzone'); zone.dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:transfer('drop.png')}));
    zone.dispatchEvent(new ClipboardEvent('paste', {bubbles:true,cancelable:true,clipboardData:transfer('paste.png')}));
    document.querySelector('#report-form').requestSubmit();
  })()`);
  await until(() => evaluate('document.querySelector("#report-status").textContent.includes("保留") && !document.querySelector("#report-fields").disabled'), '503 error retains draft');
  assert.equal(await evaluate('document.querySelector("#report-title").value'), '本机反馈闭环验收');
  assert.equal(await evaluate('document.querySelectorAll("#report-files li").length'), 3); report.checks.failedDraftAndAttachmentsRetained = true;
  await evaluate('document.querySelector("#report-form").requestSubmit()');
  await until(() => evaluate('!document.querySelector("#report-success").hidden'), 'same UUID retry succeeds');
  const manual = received.filter(item => !item.title.startsWith('[自动异常]'));
  assert.equal(manual.length, 2); assert.deepEqual(manual[0], manual[1]);
  assert.equal(manual[1].detail.startsWith('原始说明：仅本机接收器验证\n\n【使用环境】'), true);
  assert.equal(manual[1].version, initial.feedback.context.version); assert.equal(manual[1].os, initial.feedback.context.os);
  assert.deepEqual(manual[1].attachments.map(item => item.name), ['choose.png', 'drop.png', 'paste.png']);
  assert(manual[1].attachments.every(item => item.data === png && item.type === 'image/png'));
  report.checks.sameUuidAndExactPayloadRetry = true; report.checks.realPreloadEnvironment = true; report.checks.chooseDropPasteAttachments = true;
  await evaluate('document.querySelector("#report-auto").click()');
  await until(async () => (await evaluate('window.qiuqiuSettings.get()')).feedback.enabled === false, 'automatic disabled');
  assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'))).autoReportErrors, false);
  await until(() => evaluate('!document.querySelector("#report-auto").disabled'), 'toggle idle');
  await evaluate('document.querySelector("#report-auto").click()');
  await until(async () => (await evaluate('window.qiuqiuSettings.get()')).feedback.enabled === true, 'automatic re-enabled');
  assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'))).autoReportErrors, true); report.checks.togglePersistsThroughMain = true;
  const hidden = new BrowserWindow({ show:false, webPreferences:{ sandbox:true, nodeIntegration:false, contextIsolation:true } });
  await hidden.loadURL('data:text/html,<title>Local integration probe</title>');
  await hidden.webContents.executeJavaScript('console.error("PRIVATE_FEEDBACK_SENTINEL_do_not_upload", "private original error body")');
  await until(() => received.some(item => item.title === '[自动异常] 页面脚本错误'), 'real console event auto-report');
  const automatic = received.filter(item => item.title.startsWith('[自动异常]'));
  assert.doesNotMatch(JSON.stringify(automatic), /PRIVATE_FEEDBACK_SENTINEL|private original error body/);
  assert(automatic.some(item => JSON.parse(item.detail).errorCode === 'RENDERER_ERROR'));
  await until(async () => (await evaluate('window.qiuqiuSettings.get()')).feedback.pending === 0, 'automatic queue drained');
  report.checks.realConsoleEventCaptured = true; report.checks.automaticPayloadSanitized = true; report.checks.queueDrained = true;
  report.passed = true; await finish();
})().catch(error => { void finish(error); });
