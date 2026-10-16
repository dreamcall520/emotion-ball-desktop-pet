const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const entries = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(match => match[1]);
const paths = ['', 'product/', 'updates/', 'privacy/', 'feedback/', 'thanks/', 'shop/',
  'shop/handle-cup/', 'shop/cup/', 'shop/vest/', 'shop/mousepad/', 'works/'];

test('sitemap contains only the twelve public canonical pages with valid modification dates', () => {
  const urls = entries.map(entry => entry.match(/<loc>(.*?)<\/loc>/)[1]);
  assert.deepEqual(new Set(urls), new Set(paths.map(value => `https://qiuqiu.pet/${value}`)));
  assert.equal(urls.length, paths.length, 'no duplicate URLs');
  for (const entry of entries) {
    const date = entry.match(/<lastmod>(.*?)<\/lastmod>/)?.[1];
    assert.match(date || '', /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10), date);
  }
  assert.match(fs.readFileSync(path.join(root, 'robots.txt'), 'utf8'),
    /^Sitemap: https:\/\/qiuqiu\.pet\/sitemap\.xml$/m);
});

test('public pages have unique search metadata, matching share tags and existing cover assets', () => {
  const titles = new Set(), descriptions = new Set();
  for (const entry of entries) {
    const canonical = entry.match(/<loc>(.*?)<\/loc>/)[1];
    const pagePath = new URL(canonical).pathname;
    const html = fs.readFileSync(path.join(root, pagePath, 'index.html'), 'utf8');
    const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
    const titleTags = [...head.matchAll(/<title>(.*?)<\/title>/g)];
    assert.equal(titleTags.length, 1, pagePath);
    const title = titleTags[0][1];
    assert.ok(title.trim() && !titles.has(title), `${pagePath}: unique title`);
    titles.add(title);
    const links = [...head.matchAll(/<link rel="canonical" href="([^"]+)">/g)];
    assert.deepEqual(links.map(match => match[1]), [canonical]);
    const metadata = new Map();
    for (const match of head.matchAll(/<meta (?:name|property)="([^"]+)" content="([^"]*)">/g)) {
      assert.ok(!metadata.has(match[1]), `${pagePath}: duplicate ${match[1]}`);
      metadata.set(match[1], match[2]);
    }
    const description = metadata.get('description');
    assert.ok(description?.trim() && !descriptions.has(description), `${pagePath}: unique description`);
    descriptions.add(description);
    assert.doesNotMatch(metadata.get('robots') || '', /noindex/i, pagePath);
    for (const prefix of ['og', 'twitter']) {
      assert.equal(metadata.get(`${prefix}:title`), title, pagePath);
      assert.equal(metadata.get(`${prefix}:description`), description, pagePath);
      const image = new URL(metadata.get(`${prefix}:image`));
      assert.equal(image.origin, 'https://qiuqiu.pet');
      assert.ok(fs.existsSync(path.join(root, image.pathname)), `${pagePath}: cover exists`);
      assert.ok(metadata.get(`${prefix}:image:alt`)?.trim(), pagePath);
    }
    assert.equal(metadata.get('og:url'), canonical);
    assert.equal(metadata.get('twitter:card'), 'summary_large_image');
    for (const match of head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      const data = JSON.parse(match[1]);
      assert.equal(data['@context'], 'https://schema.org');
      assert.equal(data.url, canonical);
      assert.ok(['WebSite', 'SoftwareApplication'].includes(data['@type']));
      if (data['@type'] === 'SoftwareApplication') assert.equal(data.operatingSystem, 'macOS');
    }
  }
});

test('complete demo pages stay out of standalone search results and the sitemap', () => {
  const demoRoot = path.join(root, 'demos');
  let count = 0;
  for (const file of fs.readdirSync(demoRoot, { recursive: true }).filter(file => file.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(demoRoot, file), 'utf8');
    if (!/<head>/i.test(html)) continue; // notes/embed-fragment.html is injected into the product page.
    count++;
    const directives = html.match(/<meta name="robots" content="([^"]+)">/)?.[1].split(/\s*,\s*/);
    for (const directive of ['noindex', 'follow', 'indexifembedded']) assert.ok(directives?.includes(directive), `${file}: ${directive}`);
    assert.ok(!sitemap.includes(`/demos/${file}`), `${file}: excluded from sitemap`);
  }
  assert.equal(count, 10);
});
