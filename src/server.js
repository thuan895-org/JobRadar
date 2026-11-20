import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { ROOT, loadConfig, loadEnv } from './util.js';
import { initDb, listJobs, setStatus, counts, getMeta, getJob, saveApplyKit, saveHighlights } from './db.js';
import { runOnce, aiScoreOne, scanRunning } from './run.js';
import { telegramConfigured } from './telegram.js';
import { aiConfigured, applyKit, summarizeJobs } from './ai.js';

loadEnv();
const config = loadConfig();
const STATUSES = new Set(['new', 'saved', 'applied', 'hidden']);

// On Render, PORT is set and the server must listen on every interface.
// Locally it stays on localhost.
const PORT = Number(process.env.PORT || config.port);
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const PUBLIC = HOST !== '127.0.0.1' && HOST !== 'localhost';
const PASSWORD = process.env.APP_PASSWORD || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

if (PUBLIC && PASSWORD.length < 8) {
  console.error('APP_PASSWORD (at least 8 characters) is required when the server is reachable from the internet.');
  process.exit(1);
}

// ---- Login: one password, a signed cookie valid for 30 days ----
const COOKIE = 'jr_session';
const SESSION_DAYS = 30;
const signKey = createHash('sha256').update(`jobradar-session:${process.env.SESSION_SECRET || PASSWORD}`).digest();
const sign = (s) => createHmac('sha256', signKey).update(s).digest('base64url');
const sameText = (a, b) => {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
};

function newSession() {
  const expires = String(Date.now() + SESSION_DAYS * 864e5);
  return `${expires}.${sign(expires)}`;
}

function loggedIn(req) {
  if (!PASSWORD) return true; // local use without a password
  const m = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [expires, mac] = m[1].split('.');
  return Boolean(expires && mac) && sameText(mac, sign(expires)) && Number(expires) > Date.now();
}

function sessionCookie(req, value, maxAgeSeconds) {
  const https = req.headers['x-forwarded-proto'] === 'https';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${https ? '; Secure' : ''}`;
}

// Slows down password guessing: 10 wrong tries per IP per 15 minutes.
const failures = new Map(); // ip -> { n, until }
function clientIp(req) {
  return (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress;
}

const loginPage = (error = '') => `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>JobRadar</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f5f7;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#fff;padding:28px;border-radius:12px;box-shadow:0 2px 12px #0001;width:min(320px,90vw)}
h1{margin:0 0 16px;font-size:20px}input,button{width:100%;box-sizing:border-box;padding:10px;font-size:16px;border-radius:8px}
input{border:1px solid #ccd}button{margin-top:12px;border:0;background:#2563eb;color:#fff;cursor:pointer}
p{color:#c00;margin:10px 0 0}@media(prefers-color-scheme:dark){body{background:#111}form{background:#1d1f24;color:#eee}input{background:#111;color:#eee;border-color:#444}}</style>
</head><body><form method="post" action="/login"><h1>JobRadar</h1>
<input type="password" name="password" placeholder="Mật khẩu" autofocus required>
<button>Đăng nhập</button>${error ? `<p>${error}</p>` : ''}</form></body></html>`;

// ---- AI highlights: one Gemini call per job at most, even if the page asks twice while it runs ----
const inflight = new Map(); // id -> Promise<points[] | null>

async function highlightsFor(ids) {
  const result = {};
  const missing = [];
  for (const id of ids) {
    const job = await getJob(id);
    if (!job) continue;
    if (job.ai_highlights) result[id] = job.ai_highlights;
    else if (!inflight.has(id)) missing.push(job);
  }
  if (missing.length) {
    const call = summarizeJobs(missing).then(async (rows) => {
      const byId = new Map(rows.map((r) => [r.id, r.points]));
      for (const job of missing) if (byId.get(job.id)?.length) await saveHighlights(job.id, byId.get(job.id));
      return byId;
    });
    for (const job of missing) {
      inflight.set(job.id, call.then((byId) => byId.get(job.id) ?? null).finally(() => inflight.delete(job.id)));
    }
  }
  const waiting = ids.filter((id) => !(id in result) && inflight.has(id));
  const settled = await Promise.allSettled(waiting.map((id) => inflight.get(id)));
  let error = null;
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled' && s.value) result[waiting[i]] = s.value;
    else if (s.status === 'rejected') error = s.reason.message;
  });
  return { highlights: result, error };
}

// Apply kits: the same, so two clicks never pay for two kits.
const kitInflight = new Map(); // id -> Promise<kit>

function send(res, code, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readRaw(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10000) throw new Error('body too large');
  }
  return raw;
}

async function readBody(req) {
  const raw = await readRaw(req);
  return raw ? JSON.parse(raw) : {};
}

function cronAllowed(req, url) {
  if (!CRON_SECRET) return false;
  const auth = req.headers.authorization ?? '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('key') ?? '';
  return given !== '' && sameText(given, CRON_SECRET);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    // Open to everyone: health check, login, and the cron trigger (it has its own secret).
    if (url.pathname === '/healthz') return send(res, 200, { ok: true, scanning: scanRunning() });

    if (url.pathname === '/api/cron/scan' && (req.method === 'GET' || req.method === 'POST')) {
      if (!cronAllowed(req, url)) return send(res, 401, { error: 'bad cron secret' });
      // Answer at once (cron services wait ~30s at most); the scan goes on in the background.
      const already = scanRunning();
      runOnce().catch((err) => console.error('cron scan failed:', err));
      return send(res, 202, { started: !already, alreadyRunning: already });
    }

    if (url.pathname === '/login') {
      if (req.method === 'GET') return send(res, 200, loginPage(), 'text/html; charset=utf-8');
      if (req.method === 'POST') {
        const ip = clientIp(req);
        const f = failures.get(ip);
        if (f && f.n >= 10 && f.until > Date.now()) {
          return send(res, 429, loginPage('Sai quá nhiều lần. Thử lại sau 15 phút.'), 'text/html; charset=utf-8');
        }
        const password = new URLSearchParams(await readRaw(req)).get('password') ?? '';
        if (PASSWORD && sameText(password, PASSWORD)) {
          failures.delete(ip);
          return send(res, 303, '', 'text/plain', { Location: '/', 'Set-Cookie': sessionCookie(req, newSession(), SESSION_DAYS * 86400) });
        }
        if (failures.size > 1000) for (const [k, v] of failures) if (v.until <= Date.now()) failures.delete(k);
        const n = f && f.until > Date.now() ? f.n + 1 : 1;
        failures.set(ip, { n, until: Date.now() + 15 * 60000 });
        return send(res, 401, loginPage('Sai mật khẩu.'), 'text/html; charset=utf-8');
      }
    }
    if (url.pathname === '/logout') {
      return send(res, 303, '', 'text/plain', { Location: '/login', 'Set-Cookie': sessionCookie(req, '', 0) });
    }

    if (!loggedIn(req)) {
      if (req.method === 'GET' && url.pathname === '/') return send(res, 303, '', 'text/plain', { Location: '/login' });
      return send(res, 401, { error: 'login required' });
    }

    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, readFileSync(join(ROOT, 'public', 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/jobs') {
      const p = url.searchParams;
      const jobs = await listJobs({
        status: STATUSES.has(p.get('status')) || p.get('status') === 'all' ? p.get('status') : 'new',
        minScore: Number(p.get('minScore') ?? 0),
        source: p.get('source') ?? '',
        q: (p.get('q') ?? '').slice(0, 100),
        regionOnly: p.get('regionOnly') === '1',
        sort: p.get('sort') ?? 'ai',
      });
      return send(res, 200, {
        jobs: jobs.map(({ apply_kit, ...j }) => ({ ...j, has_kit: Boolean(apply_kit) })),
        counts: await counts(), lastRun: await getMeta('lastRun'), sources: (await getMeta('sourceStatus')) ?? {},
        telegram: telegramConfigured(), ai: aiConfigured(), aiStatus: await getMeta('aiStatus'),
        intervalMinutes: config.intervalMinutes, scanning: scanRunning(), loginEnabled: Boolean(PASSWORD),
      });
    }
    const m = url.pathname.match(/^\/api\/jobs\/(.+)\/(status|ai-score|apply-kit)$/);
    if (req.method === 'POST' && m) {
      const id = decodeURIComponent(m[1]);
      if (m[2] === 'status') {
        const { status } = await readBody(req);
        if (!STATUSES.has(status)) return send(res, 400, { error: 'bad status' });
        return send(res, (await setStatus(id, status)) ? 200 : 404, { ok: true });
      }
      if (!aiConfigured()) return send(res, 400, { error: 'Chưa có GEMINI_API_KEY trong .env' });
      if (m[2] === 'ai-score') {
        const job = await aiScoreOne(id);
        return job ? send(res, 200, { job }) : send(res, 404, { error: 'not found' });
      }
      const job = await getJob(id);
      if (!job) return send(res, 404, { error: 'not found' });
      const { regenerate } = await readBody(req);
      if (job.apply_kit && !regenerate) return send(res, 200, { kit: job.apply_kit });
      if (!kitInflight.has(id)) {
        kitInflight.set(id, applyKit(job)
          .then(async (kit) => { await saveApplyKit(id, kit); return kit; })
          .finally(() => kitInflight.delete(id)));
      }
      return send(res, 200, { kit: await kitInflight.get(id) });
    }
    if (req.method === 'POST' && url.pathname === '/api/highlights') {
      if (!aiConfigured()) return send(res, 400, { error: 'Chưa có GEMINI_API_KEY trong .env' });
      const { ids } = await readBody(req);
      if (!Array.isArray(ids)) return send(res, 400, { error: 'ids must be a list' });
      // At most 10 per request: only what is on screen.
      return send(res, 200, await highlightsFor([...new Set(ids.map(String))].slice(0, 10)));
    }
    if (req.method === 'POST' && url.pathname === '/api/refresh') {
      // Waits for the scan already running, if there is one, instead of starting a second.
      return send(res, 200, await runOnce({ force: true }));
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
});

await initDb();
server.listen(PORT, HOST, () => {
  console.log(`JobRadar: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}${PUBLIC ? ' (public, login required)' : ''}`);
  console.log(`Login: ${PASSWORD ? 'on' : 'off (set APP_PASSWORD to turn it on)'}`);
  console.log(`Cron endpoint: ${CRON_SECRET ? 'on (/api/cron/scan)' : 'off (set CRON_SECRET to turn it on)'}`);
  console.log(`Telegram: ${telegramConfigured() ? 'on' : 'off (fill in .env to turn it on)'}`);
  console.log(`Gemini AI: ${aiConfigured() ? 'on' : 'off (add GEMINI_API_KEY to .env to turn it on)'}`);
});

// Scans while the server is awake. On Render's free plan the server sleeps when
// nobody visits, so the cron job calling /api/cron/scan does the regular scans.
// Each source keeps its own minimum interval, so extra triggers cost nothing.
const tick = () => runOnce().catch((err) => console.error('run failed:', err));
tick();
setInterval(tick, config.intervalMinutes * 60000);
