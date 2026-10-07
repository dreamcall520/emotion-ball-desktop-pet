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

test('logs add approved 0.4.04, retain 15 historical records and omit 0.4.03', () => {
  assert.match(html, /<title>球球桌宠 · 更新日志<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/qiuqiu.pet\/updates\/"/);
  assert.equal(articles.length, 16);
  assert.equal((html.match(/data-release-link/g) || []).length, 16);
  assert.equal((html.match(/<option /g) || []).length, 16);
  assert.doesNotMatch(html, /v0\.4\.03-apple|本次更新仅适用于 Apple 芯片；Intel x64 最新公开构建/);
  assert.match(articleBlocks[0], /id="v0\.4\.04-apple"/);
  assert.deepEqual([...articles[0].matchAll(/<h4>(.*?)<\/h4>/g)].map(m => m[1]), ['【升级】Codex 额度趋势', '【新增】清除未看', '【优化】已知体验问题']);
  assert.equal((articles[0].match(/<li>/g) || []).length, 7);
  for (const text of ['「趋势」与「每日消耗」', '可用重置机会的到期提醒', '清除未看标记，保留会话和任务记录', '跟随球球所在屏幕', '跟随面板所在屏幕', '色弱模式边框与文字显示', '聊天头像恢复原版节奏']) assert.ok(articles[0].includes(text));
  assert.match(articleBlocks[1], /id="v0\.4\.02-apple"/);
  for (const text of ['薄荷绿', '晴空蓝', '状态与分类筛选', '色弱模式下便签窗口四角边框缺口', '重启或短时断档不再清空已有记录', '有记录的部分历史']) assert.ok(articles[1].includes(text));
  assert.match(articleBlocks[2], /id="v0\.4\.01-apple"/);
  assert.ok(articles[2].includes('<h4>【新增】Codex 宠物导入</h4>'));
  assert.match(articles[2], /本机 Codex 自定义宠物/);
  assert.match(articles[2], /无需上传文件/);
  assert.match(articles[2], /预览原有动画后保存/);
  assert.match(articles[2], /桌面形象与聊天头像同步切换/);
  // Freeze the retained wording, excluding download links, the removed note and the new badge.
  const wording = articleBlocks.slice(1).join('\n').replace(/<a class="release-download [^"]+"[^>]*>.*?<\/a>/g, '')
    .replace(/ <small class="release-milestone">大版本更新<\/small>/g, '').replace(/[ \t]+$/gm, '');
  assert.equal(createHash('sha256').update(wording).digest('hex'), '42478fe782a63a870ed225cc63134af1892b0e0d594809ce3ca0bb25c17da7bf');
  for (const title of ['1.【新增】便签与待办', '2.【新增】来定制球球', '3.【新增】自动更新提醒', '4.【升级】额度卡片 2.0', '5.【升级】全局 UI 升级', '6.【修复】已知体验问题']) assert.ok(articles[3].includes(`<h4>${title}</h4>`));
  assert.match(articles[3], /<h4>6.【修复】已知体验问题<\/h4><\/div>/);
  assert.equal((html.match(/class="release-milestone"/g) || []).length, 2);
  assert.match(html, /0\.4\.00 Apple 芯片版 · 大版本更新<\/option>/);
  for (const version of ['0.3.25', '0.3.24', '0.3.23', '0.3.17', '0.3.14', '0.3.13', '0.3.12', '0.3.11', '0.3.10']) assert.ok(articles.slice(4).some(a => a.includes(version)));
  assert.doesNotMatch(html, /0\.3\.(?:27|28|29|30|31|32)|幻彩云|iframe/);
  assert.doesNotMatch(html, /data-release-panel[^>]*\bhidden/);
});

test('each architecture offers DMG; the ZIP-only hotfix and website event stay accurate', () => {
  assert.equal(downloads.length, 17);
  assert.equal(new Set(downloads).size, 17);
  assert.doesNotMatch(html, /release-source|查看 GitHub Release/);
  assert.ok(downloads.every(url => /^https:\/\/github\.com\/dreamcall520\/emotion-ball-desktop-pet\/releases\/download\/v[\d.]+\/.+\.(?:zip|dmg)$/.test(url)));
  for (const article of articles) {
    const title = article.match(/<h3[^>]*>(.*?)<\/h3>/)[1];
    const urls = [...article.matchAll(/class="release-download [^"]+" href="([^"]+)"/g)].map(m => m[1]);
    if (title === '公开官网上线') { assert.equal(urls.length, 0); continue; }
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
