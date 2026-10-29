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
  const actions = [];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const page = code => win.webContents.executeJavaScript(code);
  async function load(name, width, height, zcode = false) {
    win?.destroy();
    win = new BrowserWindow({ width, height, show: false, frame: false, transparent: true,
      webPreferences: { preload: file(`${name}-preload.js`), contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false, additionalArguments: zcode ? ['--pet-source=zcode'] : [] } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('ipc-message', (_event, channel, ...args) => {
      if (channel.startsWith('pet:workbuddy-label-')) actions.push({ channel, args });
    });
    win.webContents.on('console-message', (_event, details) => { if (details.level === 'error') report.errors.push(details.message); });
    await win.loadFile(file(`${name}.html`));
  }
  async function expect(channel, value, expected, name) {
    win.webContents.send('pet:color-mode', 'standard', value.appearance || 'light');
    win.webContents.send(channel, value);
    let text = '';
    for (let i = 0; i < 100; i++) { text = await page('document.body.innerText'); if (expected.every(value => text.includes(value))) break; await wait(20); }
    for (const value of expected) assert(text.includes(value), `${name} missing ${value}`);
    assert.equal(win.isVisible(), false);
    await wait(50);
    const geometry = await page(`(()=>{const ids=['status','total','expanded-total','limit-value','metric-label','limit-label','refresh-date','expiry','links','plan','basic','reward','balance'];return Object.fromEntries(ids.flatMap(id=>{const e=document.getElementById(id),r=e?.getBoundingClientRect();if(!r?.width)return [];const s=getComputedStyle(e);return [[id,{text:e.textContent,title:e.title,width:e.clientWidth,scroll:e.scrollWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,font:s.fontSize,overflow:s.textOverflow}]]}))})()`);
    for (const [id, item] of Object.entries(geometry)) if (['status', 'total', 'expanded-total', 'limit-value', 'plan'].includes(id)) {
      assert(item.scroll <= item.width + 1, `${name} ${id} clips`);
    }
    if (value.report?.scope === 'enterprise' && value.expanded) {
      assert(Math.abs(geometry['metric-label'].top - geometry['limit-label'].top) <= 1, `${name} labels align`);
      assert(geometry['expanded-total'].right < geometry['limit-value'].left, `${name} columns do not overlap`);
      assert(geometry['limit-value'].right <= 186, `${name} limit stays inside the card: ${JSON.stringify(geometry['limit-value'])}`);
      assert(geometry['refresh-date'].bottom <= geometry.links.top, `${name} refresh stays above footer`);
      assert(geometry.links.bottom <= 120, `${name} footer stays inside window`);
      if (value.report.unlimited) assert.equal(geometry['limit-value'].font, '14px');
      else assert.equal(geometry['expanded-total'].font, geometry['limit-value'].font, `${name} numeric columns use one font size`);
    }
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
      const { quotaLabelSize } = require(file('lib/quota-label-placement'));
      const teamRows=[300,10080].map((windowMinutes,index)=>({id:`zcode:paid:CREDIT_LIMIT:${index?'6:1':'3:5'}`,
        label:'Coding Plan 积分',planName:'Coding Plan · 团队',windowMinutes,remaining:index?78:70,
        periodStart:now-60000,resetsAt:now+(windowMinutes-1)*60000,periodKind:'rolling',total:1000,remainingUnits:index?780:700,unit:'credits'}));
      const teamModel=buildZcodeQuotaLabelModel({enabled:true,quota:{state:'connected',stale:false,updatedAt:now,windows:teamRows}}, {}, now);
      const teamSize=quotaLabelSize('compact',true,2,false,false,null,'zcode',true);
      assert.deepEqual(teamSize,{width:196,height:149});
      for(const appearance of ['light','dark'])for(const state of ['ready','stale']){
        await load('quota-label',teamSize.width,teamSize.height,true);
        await expect('pet:zcode-quota-label',{...teamModel,state,appearance,size:'compact',expanded:true},
          ['5小时额度','周额度','70%','78%','查看额度明细',...(state==='stale'?['待更新']:[])],`zcode-team-${appearance}-${state}`);
        const geometry=await page(`(()=>{const root=document.querySelector('#quota-label'),card=document.querySelector('#codex-expanded'),footer=document.querySelector('.v20-links'),r=card.getBoundingClientRect();return{width:innerWidth,height:innerHeight,appearance:document.documentElement.dataset.appearance,text:card.innerText,labels:[...card.querySelectorAll('.v20-cell-label')].map(n=>({text:n.textContent,width:n.clientWidth,scroll:n.scrollWidth,height:n.clientHeight})),footerBottom:footer.getBoundingClientRect().bottom,bottomGap:innerHeight-r.bottom,scroll:root.scrollHeight,client:root.clientHeight}})()`);
        assert.equal(geometry.appearance,appearance);assert.equal(geometry.height,149);
        assert(!/Coding Plan|团队/.test(geometry.text),'team identity belongs to quota details');
        assert.deepEqual(geometry.labels.map(item=>item.text),['5小时额度','周额度']);
        assert(geometry.labels.every(item=>item.height===16&&item.scroll<=item.width+1));
        assert(geometry.footerBottom<=149&&geometry.bottomGap<=14&&geometry.bottomGap>=7,'card ends close to footer without clipping');
        assert(geometry.scroll<=geometry.client+1);report.cases.at(-1).teamGeometry=geometry;
      }
      await load('quota-label',128,32,true);
      await expect('pet:zcode-quota-label',{...teamModel,appearance:'light',size:'compact',expanded:false},['额度','70%'],'zcode-team-compact');
      assert.equal(await page("document.querySelector('.summary-period-label').textContent"),'额度');
      await load('quota-label',196,166,true);
      await expect('pet:zcode-quota-label',{...teamModel,items:teamModel.items.map(item=>({...item,planName:'Coding Plan'})),appearance:'light',size:'compact',expanded:true},
        ['Coding Plan','Coding Plan 积分','70%','78%'],'zcode-personal-unchanged');
      assert.equal(await page("document.querySelectorAll('.v20-plan-name').length"),2);
      const base = { scope: 'enterprise', unlimited: false, total: 900, used: 100, limit: 1000, basic: null, reward: null,
        purchased: null, plan: '企业版', nextRefreshAt: now + 86400000, expires: [], updatedAt: now };
      for (const unlimited of [false, true]) {
        const raw = { ...base, ...(unlimited ? { unlimited: true, total: null, limit: null } : {}) };
        const value = safeState({ enabled: true, report: raw }); assert(value.report);
        await load('workbuddy-label', 196, 120);
        await expect('pet:workbuddy-label', { ...value, expanded: true, appearance: 'light' },
          ['企业版', '100', '额度上限', ...(unlimited ? ['本期已用', '不限额'] : ['剩余额度', '900', '1,000'])], `workbuddy-${unlimited ? 'unlimited' : 'limited'}`);
        const visible = await page('document.body.innerText'); assert(!visible.includes('奖励')); assert(!visible.includes('购买'));
        assert(!visible.includes('到期'), 'enterprise has no fictitious personal expiry row');
        await load('workbuddy-label', 128, 32);
        await expect('pet:workbuddy-label', { ...value, expanded: false, appearance: 'light' },
          unlimited ? ['已用', '100'] : ['900'], `workbuddy-${unlimited ? 'unlimited' : 'limited'}-compact`);
        if (unlimited) {
          await load('workbuddy-label', 196, 120);
          await expect('pet:workbuddy-label', { ...value, expanded: true, appearance: 'dark' },
            ['本期已用', '企业版', '不限额', '100'], 'workbuddy-unlimited-dark');
        }
      }
      await page(`document.getElementById('expanded-header').click();document.getElementById('tasks').click();document.getElementById('results').click();document.getElementById('trend').click();document.getElementById('expanded-header').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));`);
      await wait(50);
      assert.deepEqual(actions, [
        { channel: 'pet:workbuddy-label-toggle', args: [] },
        { channel: 'pet:workbuddy-label-tasks', args: ['tasks'] },
        { channel: 'pet:workbuddy-label-tasks', args: ['results'] },
        { channel: 'pet:workbuddy-label-trend', args: [] },
        { channel: 'pet:workbuddy-label-refresh', args: [] }
      ]);
      report.actions = actions;
      const enterprise = (report, extra = {}) => ({ ...safeState({ enabled: true, report, ...extra }), expanded: true, appearance: 'light' });
      await expect('pet:workbuddy-label', enterprise({ ...base, total: 0, used: 1000 }), ['剩余额度', '0', '1,000'], 'workbuddy-enterprise-zero');
      await expect('pet:workbuddy-label', enterprise({ ...base, unlimited: true, total: null, limit: null, used: 0 }), ['本期已用', '0', '不限额'], 'workbuddy-unlimited-zero');
      await expect('pet:workbuddy-label', enterprise({ ...base, unlimited: true, total: null, limit: null }, { stale: true }), ['待更新', '不限额'], 'workbuddy-unlimited-stale');
      await expect('pet:workbuddy-label', enterprise({ ...base, unlimited: true, total: null, limit: null }, { busy: true }), ['查询中', '不限额'], 'workbuddy-unlimited-busy');
      const limit = 1234567.89, used = 2345.67;
      const large = { ...base, total: limit - used, limit, used };
      await expect('pet:workbuddy-label', enterprise(large), ['额度上限', '1,232,222.22', '1,234,567.89'], 'workbuddy-enterprise-large');
      await expect('pet:workbuddy-label', enterprise(large, { busy: true }), ['查询中', '1,232,222.22', '1,234,567.89'], 'workbuddy-enterprise-large-busy');
      await expect('pet:workbuddy-label', enterprise(base), ['剩余额度', '900', '1,000'], 'workbuddy-enterprise-small-restored');
      assert.equal(await page("getComputedStyle(document.getElementById('expanded-total')).fontSize"), '22px');
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
