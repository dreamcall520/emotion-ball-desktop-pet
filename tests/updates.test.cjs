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

test('independent logs add 0.4.03 and retain all 15 original records and the full 0.4.00 wording', () => {
  assert.match(html, /<title>球球桌宠 · 更新日志<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/qiuqiu.pet\/updates\/"/);
  assert.equal(articles.length, 16);
  assert.equal((html.match(/data-release-link/g) || []).length, 16);
  assert.equal((html.match(/<option /g) || []).length, 16);
  assert.match(articleBlocks[0], /id="v0\.4\.03-apple"/);
  assert.equal((articles[0].match(/class="update-group"/g) || []).length, 1);
  assert.ok(articles[0].includes('<h4>【修复】额度趋势连线和显示</h4>'));
  assert.match(articles[0], /真实断档不计入连续用量预测/);
  assert.match(articleBlocks[1], /id="v0\.4\.02-apple"/);
  for (const text of ['薄荷绿', '晴空蓝', '状态与分类筛选', '色弱模式下便签窗口四角边框缺口', '重启或短时断档不再清空已有记录', '有记录的部分历史']) assert.ok(articles[1].includes(text));
  assert.match(articleBlocks[2], /id="v0\.4\.01-apple"/);
  assert.ok(articles[2].includes('<h4>【新增】Codex 宠物导入</h4>'));
  assert.match(articles[2], /本机 Codex 自定义宠物/);
  assert.match(articles[2], /无需上传文件/);
  assert.match(articles[2], /预览原有动画后保存/);
  assert.match(articles[2], /桌面形象与聊天头像同步切换/);
  // The complete 15 articles from gh-pages@a38bb2c include their original downloads.
  assert.equal(createHash('sha256').update(articleBlocks.slice(1).join('\n')).digest('hex'), '29d226504b26f4e6b000f04cbc34230c42b2ded8262611c48a1edc813f3b8f68');
  for (const title of ['1.【新增】便签与待办', '2.【新增】来定制球球', '3.【新增】自动更新提醒', '4.【升级】额度卡片 2.0', '5.【升级】全局 UI 升级', '6.【修复】已知体验问题']) assert.ok(articles[3].includes(`<h4>${title}</h4>`));
  assert.match(articles[3], /<h4>6.【修复】已知体验问题<\/h4><\/div>/);
  assert.match(articles[3], /<time datetime="2026-10-06">2026-10-06<\/time>/);
  for (const version of ['0.3.25', '0.3.24', '0.3.23', '0.3.17', '0.3.14', '0.3.13', '0.3.12', '0.3.11', '0.3.10']) assert.ok(articles.slice(4).some(a => a.includes(version)));
  assert.doesNotMatch(html, /0\.3\.(?:27|28|29|30|31|32)|幻彩云|iframe/);
  assert.doesNotMatch(html, /data-release-panel[^>]*\bhidden/);
});

test('each App record has architecture-specific public assets; website event and hotfix stay accurate', () => {
  assert.equal(downloads.length, 33);
  assert.equal(new Set(downloads).size, 33);
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
