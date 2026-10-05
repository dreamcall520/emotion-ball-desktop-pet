const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const updates = html.slice(html.indexOf('id="updates"'), html.indexOf('id="license"'));
assert.match(updates, /0\.4\.00 Apple 芯片版/);
assert.match(updates, /<time datetime="2026-10-06">2026-10-06<\/time>/);
assert.doesNotMatch(html, /download-checks|app-capture|data-showcase-try/);
assert.doesNotMatch(updates, /0\.3\.(?:27|28|29|30|31|32)/);
for (const title of ['1.【新增】便签与待办', '2.【新增】来定制球球', '3.【新增】自动更新提醒', '4.【升级】额度卡片 2.0', '5.【升级】全局 UI 升级', '6.【修复】已知体验问题']) assert.ok(updates.includes(`<h4>${title}</h4>`));
assert.match(updates, /<h4>6.【修复】已知体验问题<\/h4><\/div>/);
const history = updates.match(/<details class="updates-history">([\s\S]*?)<\/details>\s*<\/div>/)[1];
assert.equal((history.match(/<article>/g) || []).length, 12);
assert.match(history, /查看更早更新（12 条）/);
for (const version of ['0.3.25','0.3.24','0.3.23','0.3.17','0.3.14','0.3.13','0.3.12','0.3.11','0.3.10']) assert.ok(history.includes(version));
const arm64 = [...html.matchAll(/data-download-arch="arm64"[^>]*href="([^"]+)"/g)];
assert.equal(arm64.length, 3);
assert.ok(arm64.every(m => /\/v0\.4\.0\/Qiuqiu-0\.4\.00-macOS-arm64(?:-share\.zip|\.dmg)$/.test(m[1])));
assert.match(html, /<dt>发布日期<\/dt><dd>2026-10-05<\/dd>/);
assert.match(html, /v0\.3\.13\/Qiuqiu-0\.3\.13-macOS-x64-share\.zip/);
assert.match(html, /解压 ZIP，得到“球球桌宠\.app”/);
assert.doesNotMatch(html, /幻彩云|圆角方|尚不包含此功能|0\.4\.1/);
for (const ref of html.matchAll(/(?:src|href)="([^"#][^"]+)"/g)) {
  const file = ref[1].split('?')[0];
  if (!/^https?:/.test(file)) assert.ok(fs.existsSync(path.join(__dirname, '..', file)), `missing ${file}`);
}
console.log('Milestone: six sections, removed range, retained history, release downloads and local resources passed');
