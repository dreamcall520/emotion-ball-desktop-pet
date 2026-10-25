const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');

if (process.versions.electron && process.argv.includes('--integration-child')) {
  const { app, BrowserWindow, session } = require('electron');
  const http = require('node:http');
  app.setPath('userData', process.env.QIUQIU_INTEGRATIONS_TEST_DATA);
  app.setActivationPolicy('accessory');
  app.whenReady().then(async () => {
    let win, server;
    const missing = [], external = [], errors = [];
    try {
      server = http.createServer((request, response) => {
        const file = path.resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          missing.push(request.url); response.writeHead(404); response.end(); return;
        }
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': mime }); fs.createReadStream(file).pipe(response);
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const origin = `http://127.0.0.1:${server.address().port}`;
      session.defaultSession.webRequest.onBeforeRequest((details, done) => {
        const blocked = /^https?:/.test(details.url) && !details.url.startsWith(origin + '/');
        if (blocked) external.push(details.url);
        done({ cancel: blocked });
      });
      win = new BrowserWindow({ width: 1100, height: 950, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
      win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
      await win.loadURL(`${origin}/demos/quota/index.html?v=test`);
      const run = code => win.webContents.executeJavaScript(code);
      const settled = expression => run(`new Promise((resolve,reject)=>{const started=Date.now();const tick=()=>{try{if(${expression})return resolve(true);}catch{}if(Date.now()-started>5000)return reject(Error('Timed out: '+${JSON.stringify(expression)}));setTimeout(tick,25);};tick();})`);
      const frame = id => `document.getElementById('${id}').contentDocument`;
      const quota = frame('quota-frame'), details = frame('detail-frame');
      await settled(`${details}.querySelector('.observed-line')`);
      assert.equal(await run("QiuqiuQuotaDemo.getState().source"), 'codex');
      assert.equal(await run(`${quota}.getElementById('quota-label').dataset.expanded`), 'true');
      for (const source of ['zcode', 'workbuddy']) {
        await run(`document.querySelector('button[data-source="${source}"]').click()`);
        await settled(`${details}.querySelector('.observed-line') && ${details}.getElementById('details-panel').textContent.includes('${source==='zcode'?'ZCODE':'WorkBuddy'}')`);
        assert.equal(await run("document.getElementById('api-card').hidden"), true);
        assert.equal(await run("document.getElementById('api-label-frame').getAttribute('src')"), 'about:blank');
        if (source === 'zcode') {
          assert.match(await run(`${quota}.body.textContent`), /68%.*82%/s);
          assert.match(await run(`${details}.body.textContent`), /token/);
          assert.match(await run(`${details}.querySelector('.zcode-usage-note').textContent`), /已用 960,000 token/);
          await run(`${details}.querySelector('button[data-bucket-option="zcode:demo:1"]').click()`);
          await settled(`${details}.querySelector('button[data-bucket-option="zcode:demo:1"]').getAttribute('aria-pressed')==='true'`);
          assert.match(await run(`${details}.querySelector('.trend-stats').textContent`), /82%/);
          await run(`${details}.querySelector('button[data-view="daily"]').click()`);
          assert.ok(await run(`Boolean(${details}.querySelector('.daily-chart'))`));
          await run(`${details}.querySelector('button[data-view="line"]').click()`);
          await run(`${quota}.querySelector('.v20-header').click()`);
        } else {
          assert.equal(await run(`${details}.getElementById('balance').textContent`), '7,498.01');
          assert.equal(await run(`${details}.getElementById('change').textContent`), '8.6');
          await run(`${details}.getElementById('week').click()`);
          assert.equal(await run(`${details}.getElementById('change').textContent`), '99.6');
          await run(`${details}.getElementById('view-daily').click()`);
          assert.equal(await run(`${details}.querySelectorAll('.daily-bar').length`), 7);
          await run(`${details}.getElementById('view-records').click()`);
          await run(`${quota}.getElementById('expanded-header').click()`);
        }
        await settled(`QiuqiuQuotaDemo.getState().expanded===false`);
        await run(`${quota}.getElementById('${source==='workbuddy'?'toggle':'quota-label'}').click()`);
        await settled(`QiuqiuQuotaDemo.getState().expanded===true`);
        await run(`${details}.getElementById('details-close').click()`);
        await settled(`document.getElementById('detail-reopen').hidden===false`);
        await run("document.getElementById('detail-reopen').click()");
        await settled(`document.getElementById('detail-frame').hidden===false`);
        for (const width of [320, 700, 1100]) {
          win.setContentSize(width, 950);
          await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          assert.ok(await run('document.documentElement.scrollWidth <= innerWidth'), `${source} must not overflow ${width}px`);
          assert.ok(await run(`${details}.documentElement.scrollWidth <= document.getElementById('detail-frame').clientWidth + 1`), `${source} detail fits ${width}px`);
        }
        await run(`window.postMessage({type:'qiuqiu-demo-theme',appearance:'dark',colorMode:'accessible',uiTheme:'green'},location.origin);window.postMessage({type:'qiuqiu-demo-motion',paused:true},location.origin)`);
        await settled(`${details}.documentElement.dataset.colorMode==='accessible'`);
        assert.equal(await run(`${quota}.documentElement.dataset.appearance`), 'dark');
        assert.equal(await run(`${quota}.documentElement.dataset.demoPaused`), 'true');
        await run(`window.dispatchEvent(new MessageEvent('message',{origin:'https://foreign.invalid',source:window,data:{type:'qiuqiu-demo-theme',appearance:'light',colorMode:'standard'}}))`);
        assert.equal(await run('QiuqiuQuotaDemo.getState().appearance'), 'dark');
      }
      await run("window.postMessage({type:'qiuqiu-demo-task',state:'completed'},location.origin)");
      await settled(`${details}.querySelector('.observed-line') && QiuqiuQuotaDemo.getState().source==='codex'`);
      assert.equal(await run('QiuqiuQuotaDemo.getState().unread'), true);
      assert.equal(await run("document.getElementById('api-card').hidden"), false);
      assert.deepEqual(external, [], 'examples never make an external account request');
      assert.deepEqual(missing, [], 'all embedded resources exist');
      assert.deepEqual(errors, [], 'renderers report no console errors');
      assert.equal(win.isVisible(), false);
      console.log('PASS: three native integration examples, switching, trends, close/reopen, themes, 320–1100px, and message boundaries');
      win.destroy(); server.close(); app.exit(0);
    } catch (error) { console.error(error.stack); win?.destroy(); server?.close(); app.exit(1); }
  });
} else {
  require('node:test')('integration demos preserve real native models and interaction contracts', async () => {
    const electron = process.env.QIUQIU_ELECTRON || require.resolve('electron', { paths: [path.resolve(root, '../../../个人创作/emotion-ball-desktop-pet')] });
    const executable = typeof electron === 'string' && electron.endsWith('.js') ? require(electron) : electron;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-integrations-'));
    try {
      const env = { ...process.env, QIUQIU_INTEGRATIONS_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
      await new Promise((resolve, reject) => {
        const child = require('node:child_process').spawn(executable, [__filename, '--integration-child'], { env });
        let output = ''; child.stdout.on('data', value => output += value); child.stderr.on('data', value => output += value);
        child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(output)));
      });
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
}
