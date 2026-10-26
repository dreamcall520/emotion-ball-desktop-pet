// Hidden native rendering with synthetic data; never loads app main, accounts or network services.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-team-ui-'));
  const env = { ...process.env, PET_TEAM_UI_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  const timer = setTimeout(() => child.kill('SIGTERM'), 60000);
  const cleanup = () => { clearTimeout(timer); fs.rmSync(profile, { recursive: true, force: true }); };
  child.on('error', error => { cleanup(); console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { cleanup(); process.exitCode = code ?? 1; });
} else {
  const { app, BrowserWindow, session } = require('electron');
  const root = path.resolve(process.env.PET_TEAM_UI_SOURCE_ROOT || path.resolve(__dirname, '../..'));
  const out = path.resolve(process.env.PET_TEAM_UI_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-team-evidence-')));
  assert(process.env.PET_TEAM_UI_PROFILE); app.setPath('userData', process.env.PET_TEAM_UI_PROFILE);
  app.setActivationPolicy('accessory'); app.on('window-all-closed', () => {});
  const file = name => path.join(root, 'desktop-pet', name);
  const report = { passed: false, root, fixturesOnly: true, realAccountCalls: 0, windowsHidden: true, cases: [], errors: [] };
  let win;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const page = code => win.webContents.executeJavaScript(code);
  async function load(name, width, height, zcode = false) {
    win?.destroy();
    win = new BrowserWindow({ width, height, show: false, frame: false, transparent: true,
      webPreferences: { preload: file(`${name}-preload.js`), contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false, additionalArguments: zcode ? ['--pet-source=zcode'] : [] } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('console-message', (_event, details) => { if (details.level === 'error') report.errors.push(details.message); });
    await win.loadFile(file(`${name}.html`));
  }
  async function expect(channel, value, expected, name) {
    win.webContents.send(channel, value);
    let text = '';
    for (let i = 0; i < 100; i++) { text = await page('document.body.innerText'); if (expected.every(value => text.includes(value))) break; await wait(20); }
    for (const value of expected) assert(text.includes(value), `${name} missing ${value}`);
    assert.equal(win.isVisible(), false);
    await wait(50);
    const geometry = await page(`(()=>{const ids=['status','total','expanded-total','plan','basic','reward','balance'];return Object.fromEntries(ids.flatMap(id=>{const e=document.getElementById(id);if(!e||!e.getBoundingClientRect().width)return [];return [[id,{text:e.textContent,width:e.clientWidth,scroll:e.scrollWidth}]]}))})()`);
    for (const [id, value] of Object.entries(geometry)) if (['status', 'total', 'expanded-total', 'plan'].includes(id)) assert(value.scroll <= value.width + 1, `${name} ${id} clips`);
    const image = await win.webContents.capturePage(); assert(!image.isEmpty());
    fs.writeFileSync(path.join(out, `${name}.png`), image.toPNG());
    report.cases.push({ name, expected, geometry });
  }
  app.whenReady().then(async () => {
    fs.mkdirSync(out, { recursive: true });
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, done) => { report.errors.push('Unexpected network request'); done({ cancel: true }); });
    try {
      const { buildZcodeQuotaLabelModel } = require(file('lib/zcode-quota-view'));
      const { safeState } = require(file('lib/workbuddy-label-window'));
      await load('quota-label', 128, 32, true);
      for (const [code, expected] of [['ZCODE_TEAM_SELECTION_REQUIRED', '请选择团队'], ['ZCODE_TEAM_KEY_MISSING', '团队待配置'], ['ZCODE_TEAM_ACCESS_DENIED', '团队权限不足']]) {
        const value = buildZcodeQuotaLabelModel({ enabled: true, quota: { state: 'disconnected', code } });
        await expect('pet:zcode-quota-label', { ...value, appearance: 'light', size: 'compact', expanded: false }, [expected], `zcode-${code}`);
        assert((await page("document.getElementById('status').title")).includes('ZCode'));
      }
      const now = Date.now();
      const base = { scope: 'enterprise', unlimited: false, total: 900, used: 100, limit: 1000, basic: null, reward: null,
        purchased: null, plan: '企业版', nextRefreshAt: now + 86400000, expires: [], updatedAt: now };
      for (const unlimited of [false, true]) {
        const raw = { ...base, ...(unlimited ? { unlimited: true, total: null, limit: null } : {}) };
        const value = safeState({ enabled: true, report: raw }); assert(value.report);
        await load('workbuddy-label', 196, 120);
        await expect('pet:workbuddy-label', { ...value, expanded: true, appearance: 'light' },
          ['企业版', '100', ...(unlimited ? ['本期已用', '未设上限'] : ['900', '1,000'])], `workbuddy-${unlimited ? 'unlimited' : 'limited'}`);
        const visible = await page('document.body.innerText'); assert(!visible.includes('奖励')); assert(!visible.includes('购买'));
        await load('workbuddy-label', 128, 32);
        await expect('pet:workbuddy-label', { ...value, expanded: false, appearance: 'light' },
          unlimited ? ['已用', '100'] : ['900'], `workbuddy-${unlimited ? 'unlimited' : 'limited'}-compact`);
        if (unlimited) {
          await load('workbuddy-label', 196, 120);
          await expect('pet:workbuddy-label', { ...value, expanded: true, appearance: 'dark' },
            ['本期已用', '企业版', '未设上限', '100'], 'workbuddy-unlimited-dark');
        }
      }
      await load('workbuddy-label', 196, 120);
      await expect('pet:workbuddy-label', { ...safeState({ enabled: true, report: { total: 7598.01, basic: 500,
        reward: 7098.01, purchased: 0, plan: '体验版', expires: [], updatedAt: now } }), expanded: true, appearance: 'dark' },
        ['体验版', '7,598.01', '基础', '奖励', '购买'], 'workbuddy-personal');
      assert.equal(report.errors.length, 0); report.passed = true;
    } catch (error) { report.errors.push(String(error.stack || error)); }
    finally {
      win?.destroy(); report.windowDestroyed = !win || win.isDestroyed();
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, out, errors: report.errors })); app.exit(report.passed ? 0 : 1);
    }
  });
}
