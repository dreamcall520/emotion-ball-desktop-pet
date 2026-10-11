import { Buffer } from 'node:buffer';
import { HttpError, invalid, validateSubmission, MAX_BODY_BYTES, UUID } from './validation.mjs';

async function readJson(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'unsupported_media_type', '请使用JSON提交反馈。');
  }
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new HttpError(413, 'payload_too_large', '反馈内容过大，请减少截图后重试。');
  if (!request.body) invalid('反馈内容不能为空。');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, 'payload_too_large', '反馈内容过大，请减少截图后重试。');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } catch {
    invalid('反馈内容不是有效JSON。');
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}

function repeatResult(existing, submission) {
  if (existing.request_hash !== submission.requestHash) throw new HttpError(409, 'submission_conflict', '这个编号已提交过不同内容，请重新打开反馈后提交。');
  return json({ id: submission.id }, 200);
}

async function saveSubmission(db, submission) {
  const existing = await db.prepare('SELECT request_hash FROM feedback WHERE id = ?').bind(submission.id).first();
  if (existing) return repeatResult(existing, submission);
  const statements = [db.prepare('INSERT INTO feedback (id, created_at, request_hash, type, title, detail, contact, version, os, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(submission.id, new Date().toISOString(), submission.requestHash, submission.type, submission.title, submission.detail, submission.contact, submission.version, submission.os, submission.source)];
  for (const attachment of submission.attachments) {
    statements.push(db.prepare('INSERT INTO feedback_attachments (feedback_id, filename, original_name, content_type, size_bytes, sha256, data_base64) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(submission.id, attachment.filename, attachment.originalName, attachment.type, attachment.size, attachment.sha256, attachment.data));
  }
  try {
    // D1 batch commits all statements together, including every screenshot.
    const results = await db.batch(statements);
    if (results.some((result) => !result.success)) throw new Error('D1 batch did not commit');
  } catch (error) {
    // A concurrent retry can win the unique-id insert; return its committed result.
    const committed = await db.prepare('SELECT request_hash FROM feedback WHERE id = ?').bind(submission.id).first();
    if (committed) return repeatResult(committed, submission);
    throw error;
  }
  return json({ id: submission.id }, 201);
}

async function authorized(request, token) {
  if (typeof token !== 'string' || !token) return false;
  const supplied = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1] ?? '';
  const hashes = await Promise.all([supplied, token].map((value) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
  const left = new Uint8Array(hashes[0]);
  const right = new Uint8Array(hashes[1]);
  let different = 0;
  for (let i = 0; i < left.length; i++) different |= left[i] ^ right[i];
  return different === 0;
}

async function listFeedback(db, url) {
  const limitText = url.searchParams.get('limit') ?? '50';
  if (!/^\d+$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 100) invalid('limit需要是1–100。');
  const limit = Number(limitText);
  let cursor;
  const encoded = url.searchParams.get('cursor');
  if (encoded) {
    try { cursor = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { invalid('分页标记不正确。'); }
    if (!Array.isArray(cursor) || cursor.length !== 2 || typeof cursor[0] !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(cursor[0]) || typeof cursor[1] !== 'string' || !UUID.test(cursor[1])) invalid('分页标记不正确。');
  }
  const rows = await db.prepare(`SELECT f.id, f.created_at, f.type, f.title, f.detail, f.contact, f.version, f.os, f.source,
    (SELECT json_group_array(json_object('filename', a.filename, 'name', a.original_name, 'type', a.content_type, 'size', a.size_bytes)) FROM feedback_attachments a WHERE a.feedback_id = f.id) AS attachments
    FROM feedback f ${cursor ? 'WHERE (f.created_at, f.id) < (?, ?)' : ''} ORDER BY f.created_at DESC, f.id DESC LIMIT ?`).bind(...(cursor ?? []), limit + 1).all();
  const items = rows.results.slice(0, limit).map((row) => ({ ...row, attachments: JSON.parse(row.attachments) }));
  const last = items.at(-1);
  const nextCursor = rows.results.length > limit ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString('base64url') : null;
  return json({ items, nextCursor });
}

async function route(request, env) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true });
  if (request.method === 'POST' && url.pathname === '/api/feedback') {
    if (!env.FEEDBACK_DB || !env.FEEDBACK_RATE_LIMIT) throw new Error('Missing service binding');
    // ponytail: anonymous per-IP, per-Cloudflare-location burst limit; add WAF rules if abuse grows.
    const key = request.headers.get('CF-Connecting-IP') || 'local-development';
    if (!(await env.FEEDBACK_RATE_LIMIT.limit({ key: `feedback:${key}` })).success) throw new HttpError(429, 'rate_limited', '提交太频繁，请稍后再试。');
    return saveSubmission(env.FEEDBACK_DB, await validateSubmission(await readJson(request)));
  }
  if (url.pathname.startsWith('/api/admin/')) {
    if (!(await authorized(request, env.ADMIN_TOKEN))) throw new HttpError(401, 'unauthorized', '需要管理员授权。');
    if (request.method === 'GET' && url.pathname === '/api/admin/feedback') return listFeedback(env.FEEDBACK_DB, url);
    const match = url.pathname.match(/^\/api\/admin\/feedback\/([0-9a-f-]{36})\/attachments\/(attachment-[1-3]\.(?:png|jpg|gif|webp))$/i);
    if (request.method === 'GET' && match && UUID.test(match[1])) {
      const image = await env.FEEDBACK_DB.prepare('SELECT content_type, data_base64 FROM feedback_attachments WHERE feedback_id = ? AND filename = ?').bind(match[1].toLowerCase(), match[2]).first();
      if (image) return new Response(Buffer.from(image.data_base64, 'base64'), { headers: { 'Content-Type': image.content_type, 'Content-Disposition': `attachment; filename="${match[2]}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
    }
  }
  throw new HttpError(404, 'not_found', '页面不存在。');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = new Set((env.CORS_ORIGINS ?? '').split(',').map((value) => value.trim()).filter((value) => value && value !== '*'));
    let response;
    try {
      if (origin && !allowed.has(origin)) throw new HttpError(403, 'origin_forbidden', '这个页面暂不能提交反馈。');
      if (request.method === 'OPTIONS') {
        const method = request.headers.get('Access-Control-Request-Method');
        const headers = (request.headers.get('Access-Control-Request-Headers') ?? '').toLowerCase().split(',').map((header) => header.trim()).filter(Boolean);
        if (!origin || !['POST', 'GET'].includes(method) || headers.some((header) => !['content-type', 'authorization'].includes(header))) throw new HttpError(403, 'origin_forbidden', '跨域请求未获允许。');
        response = new Response(null, { status: 204, headers: { 'Access-Control-Allow-Methods': 'POST, GET', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' } });
      } else {
        response = await route(request, env);
      }
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('feedback service failure');
      response = json({ error: error instanceof HttpError ? error.code : 'unavailable', message: error instanceof HttpError ? error.message : '反馈暂未保存，请稍后重试。' }, error instanceof HttpError ? error.status : 503);
      if (error instanceof HttpError && error.status === 429) response.headers.set('Retry-After', '60');
    }
    response.headers.set('Vary', 'Origin');
    if (origin && allowed.has(origin)) response.headers.set('Access-Control-Allow-Origin', origin);
    return response;
  },
};
