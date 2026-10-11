import { Buffer } from 'node:buffer';

export const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 1024 * 1024;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function invalid(message) {
  throw new HttpError(400, 'invalid_request', message);
}

function textField(value, name, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') invalid(`${name}格式不正确。`);
  const text = value.trim();
  if (text.length > max || text.includes('\0') || (required && !text)) invalid(`${name}${required ? '不能为空，且' : ''}不能超过${max}字。`);
  return text;
}

function imageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

async function sha256(value) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', value)).toString('hex');
}

export async function validateSubmission(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('反馈格式不正确。');
  if (typeof input.submissionId !== 'string' || !UUID.test(input.submissionId)) invalid('提交编号格式不正确，请重新打开反馈。');
  if (!['problem', 'suggestion', 'feature'].includes(input.type)) invalid('请选择反馈类型。');
  if (!['app', 'website'].includes(input.source)) invalid('反馈来源格式不正确。');
  const fields = {
    id: input.submissionId.toLowerCase(),
    type: input.type,
    title: textField(input.title, '标题', 100),
    detail: textField(input.detail, '详细说明', 5000, true),
    contact: textField(input.contact, '联系方式', 200),
    version: textField(input.version, '版本', 80),
    os: textField(input.os, '系统信息', 120),
    source: input.source,
  };
  const supplied = input.attachments === undefined ? [] : input.attachments;
  if (!Array.isArray(supplied) || supplied.length > 3) invalid('最多上传3张截图。');
  const attachments = [];
  for (const [index, attachment] of supplied.entries()) {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) invalid('截图格式不正确。');
    const name = textField(attachment.name, '截图文件名', 255, true);
    if (/[\\/]/.test(name)) invalid('截图文件名不能包含路径。');
    if (typeof attachment.type !== 'string' || !Object.hasOwn(MIME_EXTENSIONS, attachment.type)) invalid('截图仅支持PNG、JPEG、GIF、WebP。');
    const data = attachment.data;
    if (typeof data !== 'string' || !data || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) invalid('每张截图不能超过1MiB。');
    if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) invalid('截图编码不正确。');
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== data) invalid('截图编码或大小不正确。');
    if (imageType(bytes) !== attachment.type) invalid('截图内容与文件类型不符，请选择有效图片。');
    attachments.push({ filename: `attachment-${index + 1}.${MIME_EXTENSIONS[attachment.type]}`, originalName: name, type: attachment.type, size: bytes.length, sha256: await sha256(bytes), data });
  }
  const fingerprint = { ...fields, attachments: attachments.map(({ data, ...metadata }) => metadata) };
  return { ...fields, attachments, requestHash: await sha256(new TextEncoder().encode(JSON.stringify(fingerprint))) };
}

