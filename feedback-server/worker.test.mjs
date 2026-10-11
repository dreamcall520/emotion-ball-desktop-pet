import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
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
  const listing = await (await fetch(`${base}/api/admin/feedback`, { headers: adminHeaders })).json();
  assert.equal(listing.items[0].id, original.submissionId);
  assert.equal(listing.items[0].attachments[0].name, '截图.png');
  assert.ok(!JSON.stringify(listing).includes('data_base64'));
  const savedImage = await fetch(imagePath, { headers: adminHeaders });
  assert.equal(savedImage.status, 200);
  assert.equal(savedImage.headers.get('Content-Type'), 'image/png');
  assert.deepEqual(Buffer.from(await savedImage.arrayBuffer()), png);

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
});
