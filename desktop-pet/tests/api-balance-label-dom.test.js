const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
if (process.versions.electron && process.argv.includes('--balance-label-child')) {
  const { app, BrowserWindow, session } = require('electron');
  const { safeState } = require('../lib/api-balance-label-window');
  app.setPath('userData', process.env.PET_BALANCE_LABEL_DATA); app.setActivationPolicy('accessory');
  app.whenReady().then(async () => {
    let win;
    try {
      const output = process.env.PET_BALANCE_LABEL_ARTIFACTS || '/tmp/qiuqiu-api-balance-ui'; fs.mkdirSync(output, { recursive: true });
      session.defaultSession.webRequest.onBeforeRequest((details, done) => done({ cancel: /^https?:/.test(details.url) || /\/api-balance-label-renderer\.js$/.test(details.url) }));
      win = new BrowserWindow({ width: 196, height: 120, show: false, frame: false, transparent: true, webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false } });
      await win.loadFile(path.join(__dirname, '../api-balance-label.html'));
      const run = code => win.webContents.executeJavaScript(code);
      const capture = async () => {
        let image;
        for (let attempt = 0; attempt < 3; attempt++) {
          image = await win.webContents.capturePage(undefined, { stayHidden: true });
          await run('new Promise(resolve=>requestAnimationFrame(resolve))');
        }
        return image.toPNG();
      };
      await run(`window.calls=[];window.qiuqiuApiBalanceLabel={onState(cb){window.receive=cb},onColorMode(cb){window.color=cb},toggle(){calls.push('toggle')},trend(){calls.push('trend')},refresh(){calls.push('refresh')},settings(){calls.push('settings')},selectAccount(id){calls.push(id)}};void 0`);
      await run(fs.readFileSync(path.join(__dirname, '../api-balance-label-renderer.js'), 'utf8'));
      const now = Date.now(), id = 'a'.repeat(64), other = 'b'.repeat(64), unknown = 'c'.repeat(64);
      const report = { available: 44.24, cash: 44.24, voucher: 0, currency: 'CNY', updatedAt: now };
      const account = { id, name: '个人账户', provider: 'moonshot', currency: 'CNY', supported: true, status: 'ready', report };
      const accounts = [account, { ...account, id: other, name: '工作账户', report: { ...report, available: 8.42, cash: 7, voucher: 1.42, updatedAt: now - 3600000 } },
        { id: unknown, name: '其他供应商', provider: 'unknown', supported: false, status: 'unsupported' }];
      const history = [{ at: now - 6 * 86400000, available: 70 }, { at: now - 3 * 86400000, available: 41 }, { at: now - 2 * 86400000, available: 55 }, { at: now, available: 44.24 }];
      const base = { enabled: true, status: 'ready', accounts, selectedAccountId: id, report, history };
      const render = async (state = base, expanded = true, appearance = 'light', accessible = false) => {
        win.setContentSize(expanded ? 196 : 128, expanded ? 120 : 32);
        await run(`color(${JSON.stringify(accessible ? 'accessible' : 'standard')},${JSON.stringify(appearance)},'blue');receive(${JSON.stringify({ ...safeState(state), expanded, appearance })});`);
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      };
      const snapshot = () => run(`(()=>{const $=id=>document.getElementById(id),r=$('full').getBoundingClientRect();return {period:$('mini-label').textContent,amount:$('amount').textContent,mini:$('mini-amount').textContent,health:$('health').textContent,footer:$('update').textContent,cash:$('cash').textContent,voucher:$('voucher').textContent,trendDisabled:$('trend').disabled,chevronHidden:$('account-chevron').hidden,buttons:[...document.querySelectorAll('.footer button:not([hidden])')].map(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height,icon:b.querySelector('svg')?.getBoundingClientRect().width})),theme:document.documentElement.dataset.appearance,accessible:document.documentElement.dataset.colorMode,background:getComputedStyle($('quota-label')).backgroundColor,footerInside:$('update').getBoundingClientRect().bottom<=innerHeight,fullInside:r.right<=innerWidth&&r.bottom<=innerHeight,refreshDisabled:$('refresh').disabled,refreshHidden:$('refresh').hidden,settingsHidden:$('settings').hidden,imageHidden:$('source-image').hidden,account:$('selected-name').textContent,tooltip:$('update').title}})()`);
      const checks = [];
      for (const appearance of ['light', 'dark']) for (const accessible of [false, true]) {
        await render(base, true, appearance, accessible); const value = await snapshot();
        assert.equal(value.amount, '44.24'); assert.equal(value.cash, '44.24'); assert.equal(value.voucher, '0.00'); assert.equal(value.health, '已更新');
        assert.equal(value.theme, appearance); assert.equal(value.accessible, accessible ? 'accessible' : 'standard');
        assert.equal(value.fullInside, true); assert.equal(value.footerInside, true);
        assert.equal(value.buttons.length, 2); assert.equal(value.buttons[0].width, value.buttons[1].width); assert.equal(value.buttons[0].height, value.buttons[1].height); assert.equal(value.buttons[0].icon, 10); assert.equal(value.buttons[1].icon, 10);
        if (accessible) assert.equal(await run("getComputedStyle(document.getElementById('amount')).color"), appearance === 'light' ? 'rgb(20, 33, 46)' : 'rgb(247, 249, 252)');
        fs.writeFileSync(path.join(output, `${appearance}${accessible ? '-accessible' : ''}.png`), await capture());
        checks.push({ appearance, accessible, ...value });
        await render(base, false, appearance, accessible); assert.equal((await snapshot()).mini, '¥44.24');
        assert.deepEqual(await run("['source-icon','source-image'].map(id=>document.getElementById(id).getBoundingClientRect().width)"), [20,16]);
        assert.deepEqual(await run("(()=>{const card=getComputedStyle(document.getElementById('quota-label')),caption=getComputedStyle(document.querySelector('.summary-period'));return [card.paddingLeft,card.paddingRight,caption.fontSize,caption.fontWeight,caption.lineHeight,caption.gap]})()"), ['4px','4px','10px','600','14px','4px']);
      }
      for (const available of [8.42, 0, -3.2]) {
        await render({ ...base, report: { ...report, available, cash: available } }); const value = await snapshot();
        assert.equal(value.amount, available.toFixed(2)); assert.equal(value.health, available > 0 ? '余额偏低' : '余额不足');
        assert.match(await run("document.getElementById('health').title"), /10 元/);
      }
      let value;
      await render({ ...base, accounts: [account] }); assert.equal((await snapshot()).chevronHidden, true);
      await run("document.getElementById('trend').click()"); assert.equal(await run('calls.at(-1)'), 'trend');
      for (const selector of ['#header','#selected-name','#collapse svg','#collapse','#provider-name']) {
        const before=await run("calls.filter(x=>x==='toggle').length");
        await run(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
        assert.equal(await run("calls.filter(x=>x==='toggle').length"),before+1,selector+' collapses exactly once');
        assert.equal(await run("document.getElementById('account-menu').hidden"),true,'single account keeps menu closed');
      }
      assert.equal(await run("document.querySelectorAll('#header button button').length"),0,'header has no nested buttons');
      assert.deepEqual(await run("(()=>{const b=document.getElementById('collapse');return {tag:b.tagName,type:b.type,tabIndex:b.tabIndex,label:b.getAttribute('aria-label')}})()"),{tag:'BUTTON',type:'button',tabIndex:0,label:'收起 API 账户余额'},'collapse keeps native keyboard button semantics');
      await render(base);
      const beforeMenu=await run("calls.filter(x=>x==='toggle').length");
      await run("document.getElementById('account-toggle').click()"); assert.equal(await run("document.getElementById('account-menu').hidden"), false);
      assert.equal(await run("calls.filter(x=>x==='toggle').length"),beforeMenu,'multiple-account menu does not collapse');
      await run("document.getElementById('account-settings').click()"); assert.equal(await run('calls.at(-1)'), 'settings');
      await render({ ...base, stale: true, status: 'stale', error: 'private raw error', errorCode: 'TIMEOUT', nextRetryAt: now + 15000 });
      value = await snapshot(); assert.equal(value.amount, '44.24'); assert.equal(value.health, '待更新'); assert.match(value.tooltip, /下次重试/); assert.doesNotMatch(value.tooltip, /private/);
      await render({ ...base, stale: true, busy: true, status: 'loading', error: 'private', errorCode: 'TIMEOUT' });
      value = await snapshot(); assert.equal(value.health, '更新中'); assert.equal(value.refreshDisabled, true); assert.equal(value.amount, '44.24');
      await render(base); await run("document.getElementById('account-toggle').click()");
      const list = await run(`(()=>{const menu=document.getElementById('account-menu'),list=document.getElementById('account-list');return {hidden:menu.hidden,labels:[...list.children].map(x=>x.textContent),selected:[...list.children].filter(x=>x.getAttribute('aria-selected')==='true').length,focused:document.activeElement.dataset.accountId}})()`);
      assert.equal(list.hidden, false); assert.equal(list.selected, 1); assert.equal(list.focused, id);
      assert.match(list.labels[0], /个人账户.*44.24.*已更新/); assert.match(list.labels[1], /工作账户.*8.42/); assert.match(list.labels[2], /暂无余额接口/);
      await run("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));document.activeElement.click()");
      assert.equal(await run('calls.at(-1)'), other); assert.equal((await snapshot()).amount, '44.24', 'click alone cannot invent the next account balance');
      await render({ ...base, selectedAccountId: other, report: accounts[1].report, history: [] }); value = await snapshot(); assert.equal(value.amount, '8.42'); assert.equal(value.account, 'CNY'); assert.equal(value.trendDisabled, false);
      await render({ ...base, selectedAccountId: unknown, status: 'unsupported' }); value = await snapshot();
      assert.equal(value.amount, '—'); assert.equal(value.footer, '暂无余额接口'); assert.equal(value.imageHidden, true); assert.equal(value.trendDisabled, true); assert.equal(value.refreshHidden, true); assert.equal(value.settingsHidden, false);
      await render({ enabled: true, status: 'empty', accounts: [] }); value = await snapshot(); assert.equal(value.amount, '—'); assert.equal(value.trendDisabled, true); assert.equal(value.settingsHidden, false);
      await render({ ...base, status: 'unauthenticated', errorCode: 'UNAUTHENTICATED', error: 'private' }); value = await snapshot(); assert.equal(value.amount, '—'); assert.equal(value.health, '需更新密钥'); assert.equal(value.trendDisabled, true);
      await render({ ...base, status: 'disabled', accounts: [{ ...account, status: 'disabled' }] }); value = await snapshot(); assert.equal(value.amount, '—'); assert.equal(value.health, '已停用'); assert.equal(value.refreshHidden, true); assert.equal(value.settingsHidden, false);
      const many = Array.from({ length: 20 }, (_, index) => ({ ...account, id: index.toString(16).padStart(64, '0'), name: `账户 ${index + 1}` }));
      await render({ ...base, accounts: many, selectedAccountId: many[0].id }); await run("document.getElementById('account-toggle').click();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))");
      const scroll = await run("(()=>{const l=document.getElementById('account-list'),m=document.getElementById('account-menu').getBoundingClientRect();return {scroll:l.scrollTop,overflow:l.scrollHeight>l.clientHeight,inside:m.bottom<=innerHeight,focused:document.activeElement.dataset.accountId}})()");
      assert(scroll.scroll > 0); assert.equal(scroll.overflow, true); assert.equal(scroll.inside, true); assert.equal(scroll.focused, many.at(-1).id);
      await run("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"); assert.equal(await run("document.getElementById('account-menu').hidden"), true);
      await render(base); await run("document.getElementById('account-toggle').click()");
      fs.writeFileSync(path.join(output, 'accounts.png'), await capture());
      assert.equal(win.isVisible(), false); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, fixture: true, nativeHidden: true, checks, multiAccount: true, realHistoryOnly: true }, null, 2));
      console.log(`PASS API balance DOM states, keyboard account switching, real history, four theme variants; ${output}`); win.destroy(); app.exit(0);
    } catch (error) { console.error(error.stack); win?.destroy(); app.exit(1); }
  });
} else require('node:test')('API balance card matches dimensions, opens trends and switches accounts accessibly in hidden Chromium', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'balance-label-'));
  try {
    const env = { ...process.env, PET_BALANCE_LABEL_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve, reject) => {
      const child = require('node:child_process').spawn(require('electron'), [__filename, '--balance-label-child'], { env }); let output = '';
      child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(output)));
    });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
