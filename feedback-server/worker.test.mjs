import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { MAX_BODY_BYTES, MAX_IMAGE_BYTES } from './validation.mjs';

const cwd = fileURLToPath(new URL('.', import.meta.url));
const run = promisify(execFile);
const cli = ['exec', '--yes', '--package=wrangler@4.149.0', '--', 'wrangler'];
const token = 'local-integration-test-token';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jE7sAAAAASUVORK5CYII=', 'base64');

test('real workerd + D1 feedback API', { timeout: 180_000 }, async (t) => {
  const state = await mkdtemp(`${tmpdir()}/qiuqiu-feedback-test-`);
  const available = createServer();
  available.listen(0, '127.0.0.1');
  await once(available, 'listening');
  const port = available.address().port;
  await new Promise((resolve) => available.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const wrangler = async (args) => (await run('npm', [...cli, ...args], { cwd, timeout: 60_000, maxBuffer: 1024 * 1024 })).stdout;
  const sql = async (command) => JSON.parse(await wrangler(['d1', 'execute', 'qiuqiu-feedback', '--local', '--persist-to', state, '--command', command, '--json']))[0].results;
  await wrangler(['d1', 'execute', 'qiuqiu-feedback', '--local', '--persist-to', state, '--file', 'schema.sql']);
  const child = spawn('npm', [...cli, 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', state, '--var', `ADMIN_TOKEN:${token}`, '--var', 'CORS_ORIGINS:https://qiuqiu.example'], { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output = (output + chunk).slice(-20_000); });
  t.after(async () => {
    if (child.exitCode === null) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
      if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    }
    await rm(state, { recursive: true, force: true });
  });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) assert.fail(`wrangler exited before startup: ${output}`);
    try { if ((await fetch(`${base}/health`)).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, `wrangler did not start: ${output}`);
  let address = 1;
  const payload = () => ({ submissionId: crypto.randomUUID(), type: 'problem', title: '截图上传', detail: '测试说明', source: 'website', contact: 'test@example.invalid', attachments: [{ name: '截图.png', type: 'image/png', data: png.toString('base64') }] });
  const post = (body, headers = {}) => fetch(`${base}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `192.0.2.${address++}`, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const adminHeaders = { Authorization: `Bearer ${token}` };
  const adminPost = (path, body, headers = {}) => fetch(`${base}/api/admin/${path}`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'CF-Connecting-IP': `192.0.2.${address++}`, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

  const original = payload();
  const first = await post(original, { Origin: 'https://qiuqiu.example' });
  assert.equal(first.status, 201);
  assert.equal(first.headers.get('Access-Control-Allow-Origin'), 'https://qiuqiu.example');
  assert.deepEqual(await first.json(), { id: original.submissionId });
  assert.equal((await post(original)).status, 200);
  assert.equal((await post({ ...original, detail: '不同内容' })).status, 409);
  assert.equal((await sql(`SELECT count(*) AS count FROM feedback WHERE id = '${original.submissionId}'`))[0].count, 1);
  assert.equal((await sql(`SELECT count(*) AS count FROM feedback_attachments WHERE feedback_id = '${original.submissionId}'`))[0].count, 1);

  const malformed = payload();
  malformed.attachments[0].data = Buffer.from('<svg onload="alert(1)"></svg>').toString('base64');
  assert.equal((await post(malformed)).status, 400);
  assert.equal((await post({ ...payload(), detail: '' })).status, 400);
  assert.equal((await post({ ...payload(), attachments: [{ name: '../image.png', type: 'image/png', data: png.toString('base64') }] })).status, 400);
  const oversizedImage = payload();
  oversizedImage.attachments[0].data = Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64');
  assert.equal((await post(oversizedImage)).status, 400);
  assert.equal((await post(' '.repeat(MAX_BODY_BYTES + 1))).status, 413);
  const streamed = new ReadableStream({ start(controller) { controller.enqueue(Buffer.alloc(MAX_BODY_BYTES + 1, 32)); controller.close(); } });
  const streamResponse = await fetch(`${base}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `192.0.2.${address++}` }, body: streamed, duplex: 'half' });
  assert.equal(streamResponse.status, 413);

  const disallowed = await post(payload(), { Origin: 'https://untrusted.example' });
  assert.equal(disallowed.status, 403);
  assert.equal(disallowed.headers.get('Access-Control-Allow-Origin'), null);
  const preflight = await fetch(`${base}/api/feedback`, { method: 'OPTIONS', headers: { Origin: 'https://qiuqiu.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(preflight.status, 204);
  assert.equal((await fetch(`${base}/api/admin/feedback`)).status, 401);
  const imagePath = `${base}/api/admin/feedback/${original.submissionId}/attachments/attachment-1.png`;
  assert.equal((await fetch(imagePath)).status, 401);
  const listingResponse = await fetch(`${base}/api/admin/feedback`, { headers: adminHeaders });
  assert.equal(listingResponse.headers.get('Cache-Control'), 'no-store');
  const listing = await listingResponse.json();
  assert.equal(listing.items[0].id, original.submissionId);
  assert.equal(listing.items[0].attachments[0].name, '截图.png');
  assert.ok(!JSON.stringify(listing).includes('data_base64'));
  const savedImage = await fetch(imagePath, { headers: adminHeaders });
  assert.equal(savedImage.status, 200);
  assert.equal(savedImage.headers.get('Content-Type'), 'image/png');
  assert.equal(savedImage.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(Buffer.from(await savedImage.arrayBuffer()), png);

  // Management is same-origin even when the public feedback CORS origin is allowed.
  for (const origin of ['https://qiuqiu.example', 'https://untrusted.example']) {
    for (const path of ['session', 'logout']) assert.equal((await adminPost(path, { password: token }, { Origin: origin })).status, 403);
    for (const url of [`${base}/api/admin/feedback`, imagePath]) {
      const blocked = await fetch(url, { headers: { ...adminHeaders, Origin: origin } });
      assert.equal(blocked.status, 403);
      assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), null);
    }
  }
  const adminPreflight = await fetch(`${base}/api/admin/feedback`, { method: 'OPTIONS', headers: { Origin: 'https://qiuqiu.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  assert.equal(adminPreflight.status, 403);
  assert.equal(adminPreflight.headers.get('Access-Control-Allow-Origin'), null);
  for (const path of ['session', 'logout']) {
    assert.equal((await fetch(`${base}/api/admin/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await adminPost(path, {}, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await adminPost(path, ' '.repeat(4097))).status, 413);
  }
  for (const password of ['wrong-password', null, 1]) assert.equal((await adminPost('session', { password })).status, 401);
  assert.equal((await adminPost('session', '{')).status, 400);
  const login = await adminPost('session', { password: token });
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { ok: true });
  assert.equal(login.headers.get('Cache-Control'), 'no-store');
  assert.equal(login.headers.get('Access-Control-Allow-Origin'), null);
  const setCookie = login.headers.get('Set-Cookie');
  assert.match(setCookie, /^__Host-qiuqiu-admin=[\w.-]+;/);
  for (const attribute of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=604800']) assert.ok(setCookie.includes(attribute), attribute);
  assert.ok(!setCookie.includes('Domain='));
  assert.ok(!setCookie.includes(token));
  const cookie = setCookie.split(';')[0];
  for (const url of [`${base}/api/admin/feedback`, imagePath]) {
    const authenticated = await fetch(url, { headers: { Cookie: cookie } });
    assert.equal(authenticated.status, 200);
    assert.equal(authenticated.headers.get('Cache-Control'), 'no-store');
    const forged = cookie.replace(/\.([\w-])([\w-]{42})$/, (_, first, rest) => `.${first === 'a' ? 'b' : 'a'}${rest}`);
    assert.equal((await fetch(url, { headers: { Cookie: forged } })).status, 401);
    assert.equal((await fetch(url, { headers: { Cookie: '__Host-qiuqiu-admin=invalid' } })).status, 401);
  }
  const expired = String(Math.floor(Date.now() / 1000) - 1), nonce = crypto.randomUUID();
  const signature = createHmac('sha256', token).update(`${base}\n${expired}\n${nonce}`).digest('base64url');
  assert.equal((await fetch(`${base}/api/admin/feedback`, { headers: { Cookie: `__Host-qiuqiu-admin=${expired}.${nonce}.${signature}` } })).status, 401);
  assert.equal((await fetch(base.replace('127.0.0.1', 'localhost') + '/api/admin/feedback', { headers: { Cookie: cookie } })).status, 401, 'a valid cookie cannot be replayed on a different origin');
  const logout = await adminPost('logout', {}, { Cookie: cookie });
  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), { ok: true });
  assert.match(logout.headers.get('Set-Cookie'), /^__Host-qiuqiu-admin=;.*Max-Age=0/);
  assert.equal((await adminPost('logout', {})).status, 200, 'logout may clear an already-expired browser session');

  // An attachment failure must roll the feedback row back, and a retry must work.
  await sql("CREATE TRIGGER force_attachment_failure BEFORE INSERT ON feedback_attachments BEGIN SELECT RAISE(ABORT, 'test storage failure'); END");
  const failed = payload();
  const failure = await post(failed);
  assert.equal(failure.status, 503);
  assert.equal((await failure.json()).error, 'unavailable');
  assert.equal((await sql(`SELECT count(*) AS count FROM feedback WHERE id = '${failed.submissionId}'`))[0].count, 0);
  await sql('DROP TRIGGER force_attachment_failure');
  assert.equal((await post(failed)).status, 201);

  const concurrent = payload();
  const concurrentResults = await Promise.all([post(concurrent), post(concurrent)]);
  assert.deepEqual(concurrentResults.map((response) => response.status).sort(), [200, 201]);
  assert.equal((await sql(`SELECT count(*) AS count FROM feedback_attachments WHERE feedback_id = '${concurrent.submissionId}'`))[0].count, 1);

  const fullImage = Buffer.alloc(MAX_IMAGE_BYTES);
  png.copy(fullImage);
  const maximum = payload();
  maximum.attachments = [1, 2, 3].map((index) => ({ name: `截图${index}.png`, type: 'image/png', data: fullImage.toString('base64') }));
  assert.equal((await post(maximum)).status, 201, 'three full-size screenshots must fit actual D1 rows');
  const fullImageReadback = await fetch(`${base}/api/admin/feedback/${maximum.submissionId}/attachments/attachment-3.png`, { headers: adminHeaders });
  assert.equal(fullImageReadback.status, 200);
  assert.deepEqual(Buffer.from(await fullImageReadback.arrayBuffer()), fullImage);

  const pageOne = await (await fetch(`${base}/api/admin/feedback?limit=1`, { headers: adminHeaders })).json();
  assert.equal(pageOne.items.length, 1);
  assert.ok(pageOne.nextCursor);
  const pageTwo = await (await fetch(`${base}/api/admin/feedback?limit=1&cursor=${encodeURIComponent(pageOne.nextCursor)}`, { headers: adminHeaders })).json();
  assert.equal(pageTwo.items.length, 1);
  assert.notEqual(pageOne.items[0].id, pageTwo.items[0].id);
  assert.equal((await fetch(`${base}/api/admin/feedback?cursor=invalid`, { headers: adminHeaders })).status, 400);

  // The configured native limiter, rather than a mock/in-process Map, enforces the burst.
  const limitedPayload = payload();
  let limited = false;
  for (let i = 0; i < 15; i++) {
    const response = await post(limitedPayload, { 'CF-Connecting-IP': '198.51.100.8' });
    if (response.status === 429) { limited = true; assert.equal(response.headers.get('Retry-After'), '60'); break; }
    assert.ok([200, 201].includes(response.status));
  }
  assert.ok(limited, 'native rate-limit binding must reject a burst');
  assert.equal((await adminPost('session', { password: token }, { 'CF-Connecting-IP': '198.51.100.8' })).status, 200, 'feedback throttling must not block admin login');
  let loginLimited = false;
  for (let i = 0; i < 15; i++) {
    const response = await adminPost('session', { password: 'wrong-password' }, { 'CF-Connecting-IP': '198.51.100.9' });
    if (response.status === 429) { loginLimited = true; assert.equal(response.headers.get('Retry-After'), '60'); break; }
    assert.equal(response.status, 401);
  }
  assert.ok(loginLimited, 'native rate-limit binding must reject a login burst');
  assert.equal((await post(payload(), { 'CF-Connecting-IP': '198.51.100.9' })).status, 201, 'login throttling must not block feedback submission');
});
