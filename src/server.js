import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadConfig, loadEnv } from './util.js';
import { listJobs, setStatus, counts, getMeta, getJob, saveApplyKit, saveHighlights } from './db.js';
import { runOnce, aiScoreOne } from './run.js';
import { telegramConfigured } from './telegram.js';
import { aiConfigured, applyKit, summarizeJobs } from './ai.js';

// One Gemini call per job at most, even if the page asks twice while it runs.
const inflight = new Map(); // id -> Promise<points[] | null>

async function highlightsFor(ids) {
  const result = {};
  const missing = [];
  for (const id of ids) {
    const job = getJob(id);
    if (!job) continue;
    if (job.ai_highlights) result[id] = job.ai_highlights;
    else if (!inflight.has(id)) missing.push(job);
  }
  if (missing.length) {
    const call = summarizeJobs(missing).then((rows) => {
      const byId = new Map(rows.map((r) => [r.id, r.points]));
      for (const job of missing) if (byId.get(job.id)?.length) saveHighlights(job.id, byId.get(job.id));
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

loadEnv();
const config = loadConfig();
const STATUSES = new Set(['new', 'saved', 'applied', 'hidden']);

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10000) throw new Error('body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, readFileSync(join(ROOT, 'public', 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/jobs') {
      const p = url.searchParams;
      const jobs = listJobs({
        status: STATUSES.has(p.get('status')) || p.get('status') === 'all' ? p.get('status') : 'new',
        minScore: Number(p.get('minScore') ?? 0),
        source: p.get('source') ?? '',
        q: (p.get('q') ?? '').slice(0, 100),
        regionOnly: p.get('regionOnly') === '1',
        sort: p.get('sort') ?? 'ai',
      });
      return send(res, 200, {
        jobs: jobs.map(({ apply_kit, ...j }) => ({ ...j, has_kit: Boolean(apply_kit) })), counts: counts(), lastRun: getMeta('lastRun'), sources: getMeta('sourceStatus') ?? {},
        telegram: telegramConfigured(), ai: aiConfigured(), aiStatus: getMeta('aiStatus'),
        intervalMinutes: config.intervalMinutes,
      });
    }
    const m = url.pathname.match(/^\/api\/jobs\/(.+)\/(status|ai-score|apply-kit)$/);
    if (req.method === 'POST' && m) {
      const id = decodeURIComponent(m[1]);
      if (m[2] === 'status') {
        const { status } = await readBody(req);
        if (!STATUSES.has(status)) return send(res, 400, { error: 'bad status' });
        return send(res, setStatus(id, status) ? 200 : 404, { ok: true });
      }
      if (!aiConfigured()) return send(res, 400, { error: 'Chưa có GEMINI_API_KEY trong .env' });
      if (m[2] === 'ai-score') {
        const job = await aiScoreOne(id);
        return job ? send(res, 200, { job }) : send(res, 404, { error: 'not found' });
      }
      const job = getJob(id);
      if (!job) return send(res, 404, { error: 'not found' });
      const { regenerate } = await readBody(req);
      if (job.apply_kit && !regenerate) return send(res, 200, { kit: job.apply_kit });
      const kit = await applyKit(job);
      saveApplyKit(id, kit);
      return send(res, 200, { kit });
    }
    if (req.method === 'POST' && url.pathname === '/api/highlights') {
      if (!aiConfigured()) return send(res, 400, { error: 'Chưa có GEMINI_API_KEY trong .env' });
      const { ids } = await readBody(req);
      if (!Array.isArray(ids)) return send(res, 400, { error: 'ids must be a list' });
      // At most 10 per request: only what is on screen.
      return send(res, 200, await highlightsFor([...new Set(ids.map(String))].slice(0, 10)));
    }
    if (req.method === 'POST' && url.pathname === '/api/refresh') {
      const result = await runOnce({ force: true });
      return send(res, 200, result);
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
});

// Listen on localhost only: this page is for you, not your network.
server.listen(config.port, '127.0.0.1', () => {
  console.log(`JobRadar: http://localhost:${config.port}`);
  console.log(`Telegram: ${telegramConfigured() ? 'on' : 'off (fill in .env to turn it on)'}`);
  console.log(`Gemini AI: ${aiConfigured() ? 'on' : 'off (add GEMINI_API_KEY to .env to turn it on)'}`);
});

const tick = () => runOnce().catch((err) => console.error('run failed:', err));
tick();
setInterval(tick, config.intervalMinutes * 60000);
