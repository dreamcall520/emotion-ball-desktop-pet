const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'updates/index.html'), 'utf8');
const articles = [...html.matchAll(/<article[^>]*data-release-panel[^>]*>([\s\S]*?)<\/article>/g)].map(m => m[1]);
const downloads = [...html.matchAll(/class="release-download [^"]+" href="([^"]+)"/g)].map(m => m[1]);
const articleBlocks = html.match(/<article[^>]*data-release-panel[^>]*>[\s\S]*?<\/article>/g);

const globalArticles = articles.slice(1), globalBlocks = articleBlocks.slice(1);
const oldArticles = articles.slice(3), oldBlocks = articleBlocks.slice(3);

test('0.4.12 Apple release preserves every 0.4.09 platform and the retained history',()=>{
 assert.match(articleBlocks[0], /id="v0\.4\.12-apple"/);
 assert.match(articles[0], /datetime="2026-11-01"/);
 for(const text of ['1.【新增】官方皮肤','新增小白、小宇两款官方皮肤。','2.【新增】主题配色','新增暮光紫主题配色。','3.【新增】意见反馈','支持上传截图、查看提交记录。','4.【新增】官方定制活动上线','让喜欢的它，住进你的桌面。'])assert.ok(articles[0].includes(text));
 assert.equal((articles[0].match(/<h4>/g)||[]).length,4);
 assert.equal((articles[0].match(/<li>/g)||[]).length,4);
 assert.doesNotMatch(articles[0], /release-download-note|Intel|Windows|排在|咩咩之后|小宇之前|等待就绪|回调|首帧|焦点|验收/);
 assert.match(articles[0], /v0\.4\.12\/Qiuqiu-0\.4\.12-macOS-arm64\.dmg/);
 assert.doesNotMatch(articles[0], /macOS-x64\.dmg|Windows-x64-Setup|mac-app-store|Windows r6/);
});

test('0.4.09 adds weather and card improvements while retaining 0.4.08', () => {
  assert.match(globalBlocks[0], /id="v0\.4\.09-apple"/);
  assert.match(globalArticles[0], /datetime="2026-10-29"/);
  assert.match(globalArticles[0], /新增天气卡/);
  assert.match(globalArticles[0], /云朵感知天气/);
  assert.match(globalArticles[0], /高低温折线和温度区间视图/);
  assert.match(globalArticles[0], /v0\.4\.9\/Qiuqiu-0\.4\.09-macOS-arm64\.dmg/);
  assert.match(globalArticles[0], /<h3[^>]*>0\.4\.09<\/h3>/);
  assert.doesNotMatch(globalArticles[0], /天气随身看|优化城市搜索|重复定位提示|天气获取失败时的展示/);
  const groups = [...globalArticles[0].matchAll(/<div class="update-group">([\s\S]*?)<\/div>/g)].map(m => m[1]);
  assert.deepEqual(groups.map(group => (group.match(/<li>/g) || []).length), [3, 2, 3, 1]);
  assert.match(groups[3], /<li>修复部分窗口关闭后的报错。<\/li>/);
  const articles = globalArticles.slice(1), articleBlocks = globalBlocks.slice(1);
  assert.match(articleBlocks[0], /id="v0\.4\.08-apple"/);
  assert.match(articles[0], /datetime="2026-10-26"/);
  assert.deepEqual([...articles[0].matchAll(/<h4>(.*?)<\/h4>/g)].map(m=>m[1].replace(/^\d+\.\s*/, '')), ['【新增】咩咩四季主题', '【新增】ZCode 与 WorkBuddy 联动', '【新增】联动样式管理', '【新增】更多桌面伙伴', '【升级】统一设置中心', '【焕新】应用图标与聊天界面', '【优化】已知问题']);
  assert.equal((articles[0].match(/<li>/g) || []).length, 11);
  assert.match(articles[0], /<h4>7\.【优化】已知问题<\/h4><\/div>/);
  assert.doesNotMatch(articles[0], /主题记忆|靠边位置|卡面|小角色/);
  assert.equal(articles.length,18);
  assert.match(articles[0], /href="https:\/\/github\.com\/dreamcall520\/emotion-ball-desktop-pet\/releases\/download\/v0\.4\.8\/Qiuqiu-0\.4\.08-macOS-arm64\.dmg"/);
  assert.doesNotMatch(html, /0\.4\.06/);
  assert.match(html, /0\.4\.08 Apple 芯片版 · 大版本更新<\/option>/);
});

test('0.4.05 and sixteen earlier historical blocks retain their content with numbered headings, omitting 0.4.03', () => {
  const articles = oldArticles, articleBlocks = oldBlocks;
  assert.match(html, /<title>球球桌宠 · 更新日志<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/qiuqiu.pet\/updates\/"/);
  assert.equal(articles.length, 17);
  assert.equal((html.match(/data-release-link/g) || []).length, 20);
  assert.equal((html.match(/<option /g) || []).length, 20);
  assert.doesNotMatch(html, /v0\.4\.03-apple|本次更新仅适用于 Apple 芯片；Intel x64 最新公开构建/);
  assert.match(articleBlocks[0], /id="v0\.4\.05-apple"/);
  assert.deepEqual([...articles[0].matchAll(/<h4>(.*?)<\/h4>/g)].map(m => m[1].replace(/^\d+\.\s*/, '')), ['【新增】悬浮快捷面板', '【新增】番茄钟', '【新增】额度展示定制', '【新增】球球守护战', '【优化】额度预估', '【优化】使用体验']);
  for (const text of ['悬浮快捷面板', '番茄钟', '六种展示样式', '额度预估参考', '球球守护战', '色弱模式']) assert.ok(articles[0].includes(text));
  assert.equal(createHash('sha256').update(articleBlocks.slice(1).join('\n')).digest('hex'), '601fd16d3279c29bdcf0909e61b18272c8222cdf55f38fdb1a0642e56f72d26d', 'all sixteen historical release blocks preserve the numbered baseline');
  assert.match(articleBlocks[1], /id="v0\.4\.04-apple"/);
  assert.deepEqual([...articles[1].matchAll(/<h4>(.*?)<\/h4>/g)].map(m => m[1].replace(/^\d+\.\s*/, '')), ['【升级】Codex 额度趋势', '【新增】清除未看', '【优化】已知体验问题']);
  assert.equal((articles[1].match(/<li>/g) || []).length, 7);
  for (const text of ['「趋势」与「每日消耗」', '可用重置机会的到期提醒', '清除未看标记，保留会话和任务记录', '跟随球球所在屏幕', '跟随面板所在屏幕', '色弱模式边框与文字显示', '聊天头像恢复原版节奏']) assert.ok(articles[1].includes(text));
  assert.match(articleBlocks[2], /id="v0\.4\.02-apple"/);
  for (const text of ['薄荷绿', '晴空蓝', '状态与分类筛选', '色弱模式下便签窗口四角边框缺口', '重启或短时断档不再清空已有记录', '有记录的部分历史']) assert.ok(articles[2].includes(text));
  assert.match(articleBlocks[3], /id="v0\.4\.01-apple"/);
  assert.ok(articles[3].includes('<h4>1.【新增】Codex 宠物导入</h4>'));
  assert.match(articles[3], /本机 Codex 自定义宠物/);
  assert.match(articles[3], /无需上传文件/);
  assert.match(articles[3], /预览原有动画后保存/);
  assert.match(articles[3], /桌面形象与聊天头像同步切换/);
  // Freeze the retained wording, excluding download links, the removed note and the new badge.
  const wording = articleBlocks.slice(2).join('\n').replace(/<a class="release-download [^"]+"[^>]*>.*?<\/a>/g, '')
    .replace(/ <small class="release-milestone">大版本更新<\/small>/g, '').replace(/[ \t]+$/gm, '');
  assert.equal(createHash('sha256').update(wording).digest('hex'), 'f6566a805defa743ecb3eb8a041c4fee7c661b921a30c5090de41072aab3f093');
  for (const title of ['1.【新增】便签与待办', '2.【新增】来定制球球', '3.【新增】自动更新提醒', '4.【升级】额度卡片 2.0', '5.【升级】全局 UI 升级', '6.【修复】已知体验问题']) assert.ok(articles[4].includes(`<h4>${title}</h4>`));
  assert.match(articles[4], /<h4>6.【修复】已知体验问题<\/h4><\/div>/);
  assert.equal((html.match(/class="release-milestone"/g) || []).length, 4);
  assert.match(html, /0\.4\.00 Apple 芯片版 · 大版本更新<\/option>/);
  for (const version of ['0.3.25', '0.3.24', '0.3.23', '0.3.17', '0.3.14', '0.3.13', '0.3.12', '0.3.11', '0.3.10']) assert.ok(articles.slice(5).some(a => a.includes(version)));
  assert.doesNotMatch(html, /0\.3\.(?:27|28|29|30|31|32)|幻彩云|iframe/);
  assert.doesNotMatch(html, /data-release-panel[^>]*\bhidden/);
});

test('platform installer links and historical downloads stay accurate', () => {
  assert.equal(downloads.length, 23);
  assert.equal(new Set(downloads).size, 23);
  assert.doesNotMatch(html, /release-source|查看 GitHub Release/);
  assert.ok(downloads.every(url => ['https://share.weiyun.com/6WH6LkRl', 'https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.9-windows/Qiuqiu-0.4.09-Windows-x64-Setup.exe'].includes(url) || /^https:\/\/github\.com\/dreamcall520\/emotion-ball-desktop-pet\/releases\/download\/v[\d.]+\/.+\.(?:zip|dmg)$/.test(url)));
  for (const article of articles) {
    const title = article.match(/<h3[^>]*>(.*?)<\/h3>/)[1];
    const urls = [...article.matchAll(/class="release-download [^"]+" href="([^"]+)"/g)].map(m => m[1]);
    if (title === '公开官网上线') { assert.equal(urls.length, 0); continue; }
    if (title === '0.4.09') {
      assert.deepEqual(urls, ['https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.9/Qiuqiu-0.4.09-macOS-arm64.dmg', 'https://share.weiyun.com/6WH6LkRl', 'https://github.com/dreamcall520/emotion-ball-desktop-pet/releases/download/v0.4.9-windows/Qiuqiu-0.4.09-Windows-x64-Setup.exe']);
      assert.match(article, /Intel 芯片 · DMG/);
      assert.match(article, /Windows · EXE/);
      assert.match(article, /Windows 试用版 · Windows 10\/11 x64/);
      assert.match(article, /天气需手动选城/);
      const windowsButton = article.match(/<a[^>]*href="https:\/\/github\.com\/dreamcall520\/emotion-ball-desktop-pet\/releases\/download\/v0\.4\.9-windows\/[^"]+\.exe"[^>]*>/)[0];
      assert.doesNotMatch(windowsButton, /target="_blank"/);
      continue;
    }
    assert.ok(urls.length > 0, title);
    const version = title.match(/^[\d.]+/)[0];
    const tag = `v${version.split('.').map(Number).join('.')}`;
    assert.ok(urls.every(url => url.includes(`/download/${tag}/`)), title);
    if (title.includes('Apple')) assert.ok(urls.every(url => !url.includes('x64')), title);
    if (title.includes('Intel')) assert.ok(urls.every(url => url.includes('x64')), title);
    if (title.includes('热修复')) { assert.equal(urls.length, 1); assert.match(urls[0], /hotfix-20260831[^/]*\.zip$/); }
    else assert.ok(urls.every(url => url.endsWith('.dmg')), title);
  }
  assert.doesNotMatch(html, /data-download-arch|data-download-position/);
});

test('log navigation, local resources and legacy routes preserve their destinations', () => {
  assert.match(html, /href="\.\.\/product\/#install" target="_blank" rel="noopener"/);
  assert.match(html, /href="\.\.\/product\/#download" target="_blank" rel="noopener"/);
  for (const ref of html.matchAll(/(?:src|href)="([^"#][^"]+)"/g)) {
    const value = ref[1].split(/[?#]/)[0];
    if (!/^https?:/.test(value)) assert.ok(fs.existsSync(path.join(root, 'updates', value)), `missing ${value}`);
  }
  const product = fs.readFileSync(path.join(root, 'product/index.html'), 'utf8');
  assert.doesNotMatch(product, /<section[^>]+id="updates"|class="updates-history"/);
  const legacy = fs.readFileSync(path.join(root, 'product.html'), 'utf8');
  assert.match(legacy, /destination.search = location.search/);
  assert.match(fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8'), /https:\/\/qiuqiu.pet\/updates\//);
});
