// Small HTTP helpers shared by every route module.
import { createHash, timingSafeEqual } from 'node:crypto';

export function send(res, code, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

export function redirect(res, location, headers = {}) {
  res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', ...headers });
  res.end();
}

export async function readRaw(req, limit = 10000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw Object.assign(new Error('body too large'), { status: 413 });
  }
  return raw;
}

/**
 * Reads a JSON body. Requiring the JSON content type also blocks cross-site
 * form posts: a browser cannot send it to another site without CORS approval.
 */
export async function readJson(req) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw Object.assign(new Error('Content-Type must be application/json'), { status: 415 });
  }
  const raw = await readRaw(req);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}

/** Compares secrets in constant time, whatever their length. */
export function sameText(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function getCookie(req, name) {
  const m = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function cookie(req, name, value, maxAgeSeconds) {
  const https = req.headers['x-forwarded-proto'] === 'https';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${https ? '; Secure' : ''}`;
}

export function clientIp(req) {
  return (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress;
}

/** Counts attempts per key; `hit` returns false once `max` is reached within the window. */
export function limiter(max, windowMs) {
  const seen = new Map(); // key -> { n, until }
  return {
    hit(key) {
      const now = Date.now();
      if (seen.size > 5000) for (const [k, v] of seen) if (v.until <= now) seen.delete(k);
      const e = seen.get(key);
      if (!e || e.until <= now) {
        seen.set(key, { n: 1, until: now + windowMs });
        return true;
      }
      e.n++;
      return e.n <= max;
    },
    reset(key) {
      seen.delete(key);
    },
  };
}

/** Reads a binary body (an uploaded file) up to `limit` bytes. */
export async function readBytes(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error(`Tệp quá lớn (tối đa ${Math.round(limit / 1048576)} MB).`), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
