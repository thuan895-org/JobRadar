// The personal job feed (/api/feed/*) and the user's profile (/api/profile).
// Every user sees the same jobs, scored and filtered by their own profile;
// saving, hiding, AI scores and apply kits are kept per user in user_jobs.
import { q, getJob, getMeta, setMeta } from './db.js';
import { aiConfigured, scoreJobs, applyKit, prepareProfile } from './ai.js';
import { highlightsFor } from './highlights.js';
import { CATALOG, LEVELS, getProfile, saveProfile, scoringConfig, scoreRow, profileText, claimLegacyData } from './profiles.js';
import { publicUser } from './accounts.js';
import { requireUser, HttpError } from './routes-account.js';
import { send, readJson } from './http.js';

const STATUSES = ['new', 'saved', 'applied', 'hidden'];
const FEED_DAYS = 21; // jobs older than this only show if the user saved or applied to them
const FEED_LIMIT = 150;
const now = () => new Date().toISOString();

async function setUserJob(userId, jobId, fields) {
  const keys = Object.keys(fields);
  const cols = keys.join(', ');
  const vals = keys.map((_, i) => `$${i + 3}`).join(', ');
  const updates = keys.map((k) => `${k} = excluded.${k}`).join(', ');
  await q(`
    INSERT INTO user_jobs (user_id, job_id, ${cols}, updated_at) VALUES ($1, $2, ${vals}, $${keys.length + 3})
    ON CONFLICT (user_id, job_id) DO UPDATE SET ${updates}, updated_at = excluded.updated_at
  `, [userId, jobId, ...keys.map((k) => fields[k]), now()]);
}

async function getUserJob(userId, jobId) {
  const { rows } = await q('SELECT * FROM user_jobs WHERE user_id = $1 AND job_id = $2', [userId, jobId]);
  return rows[0] ?? null;
}

/** What the apps get for one job in the feed. */
function feedItem(row, scored) {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    company: row.company,
    url: row.url,
    description: row.description,
    tags: row.tags ?? [],
    kind: row.kind,
    location: row.location,
    budgetText: row.budget_text,
    bidCount: row.bid_count,
    postedAt: row.posted_at || row.first_seen,
    vietnameseClient: (row.language || '') === 'vi' || (row.matched ?? []).includes('Khách Việt'),
    score: scored.score,
    matched: scored.matched,
    regionOk: scored.regionOk,
    status: row.my_status ?? 'new',
    ai: row.ai_checked_at ? { score: row.ai_score, reason: row.ai_reason, flags: row.ai_flags ?? [], scam: row.ai_scam } : null,
    hasKit: Boolean(row.has_kit),
    highlights: row.ai_highlights ?? null,
  };
}

async function feed(user, params, config) {
  const profile = await getProfile(user.id);
  const scoring = scoringConfig(profile, config);
  const cutoff = new Date(Date.now() - FEED_DAYS * 864e5).toISOString();
  const { rows } = await q(`
    SELECT j.id, j.source, j.title, j.company, j.url, LEFT(j.description, 6000) AS description, j.tags, j.kind, j.location,
      j.budget_text, j.budget_min_usd, j.budget_max_usd, j.posted_at, j.bid_count, j.matched, j.first_seen, j.language, j.ai_highlights,
      uj.status AS my_status, uj.ai_score, uj.ai_reason, uj.ai_flags, uj.ai_scam, uj.ai_checked_at, (uj.apply_kit IS NOT NULL) AS has_kit
    FROM jobs j LEFT JOIN user_jobs uj ON uj.job_id = j.id AND uj.user_id = $1
    WHERE COALESCE(j.posted_at, j.first_seen) >= $2 OR uj.status IN ('saved', 'applied')
  `, [user.id, cutoff]);

  const items = rows.map((r) => feedItem(r, scoreRow(r, scoring)));
  const counts = Object.fromEntries([...STATUSES, 'all'].map((s) => [s, 0]));
  for (const it of items) {
    counts[it.status]++;
    counts.all++;
  }

  const tab = STATUSES.includes(params.get('tab')) || params.get('tab') === 'all' ? params.get('tab') : 'new';
  const regionOnly = (params.get('regionOnly') ?? (profile.region_only ? '1' : '0')) === '1';
  const minScore = Number(params.get('minScore') ?? (tab === 'new' ? 0 : -999));
  const source = params.get('source') ?? '';
  const text = (params.get('q') ?? '').trim().toLowerCase().slice(0, 100);
  const shown = items.filter((it) =>
    (tab === 'all' || it.status === tab)
    && (!regionOnly || it.regionOk)
    && it.score >= minScore
    && (!source || it.source === source)
    && (!text || `${it.title} ${it.company} ${it.description}`.toLowerCase().includes(text)));

  const sort = params.get('sort') ?? 'fit';
  const date = (it) => Date.parse(it.postedAt) || 0;
  shown.sort(sort === 'new' ? (a, b) => date(b) - date(a)
    : sort === 'score' ? (a, b) => b.score - a.score || date(b) - date(a)
    : (a, b) => (b.ai?.score ?? -1) - (a.ai?.score ?? -1) || b.score - a.score || date(b) - date(a));

  return {
    jobs: shown.slice(0, FEED_LIMIT),
    total: shown.length,
    counts,
    sources: [...new Set(items.map((it) => it.source))].sort(),
    hasProfile: scoring.skills.length > 0,
    regionOnly,
    ai: aiConfigured(),
  };
}

/** Handles /api/feed* and /api/profile. Returns false for anything else. */
export async function handleFeedRoutes(req, res, url, ctx) {
  const path = url.pathname;
  if (!(path === '/api/feed' || path.startsWith('/api/feed/') || path === '/api/profile')) return false;
  try {
    await route(req, res, url, path, ctx);
  } catch (err) {
    if (err.status) send(res, err.status, { error: err.message });
    else {
      console.error(err);
      send(res, 500, { error: 'Có lỗi ở server. Vui lòng thử lại.' });
    }
  }
  return true;
}

async function route(req, res, url, path, ctx) {
  const user = await requireUser(req);
  if (publicUser(user).role === 'admin') await claimLegacyData(user, ctx.config, getMeta, setMeta);

  if (req.method === 'GET' && path === '/api/profile') {
    const profile = await getProfile(user.id);
    return send(res, 200, { profile, catalog: CATALOG.map(({ id, label }) => ({ id, label })), levels: Object.keys(LEVELS) });
  }
  if (req.method === 'POST' && path === '/api/profile') {
    try {
      return send(res, 200, { profile: await saveProfile(user.id, await readJson(req)) });
    } catch (err) {
      throw err.status ? err : new HttpError(400, err.message);
    }
  }

  if (req.method === 'GET' && path === '/api/feed') return send(res, 200, await feed(user, url.searchParams, ctx.config));

  if (req.method === 'POST' && path === '/api/feed/highlights') {
    if (!aiConfigured()) throw new HttpError(400, 'AI chưa được bật trên server.');
    const { ids } = await readJson(req);
    if (!Array.isArray(ids)) throw new HttpError(400, 'ids must be a list');
    // At most 10 per request: only what is on screen. The summary is shared by every user.
    return send(res, 200, await highlightsFor([...new Set(ids.map(String))].slice(0, 10)));
  }

  const m = path.match(/^\/api\/feed\/(.+)\/(status|ai-score|apply-kit)$/);
  if (req.method === 'POST' && m) {
    const id = decodeURIComponent(m[1]);
    const job = await getJob(id);
    if (!job) throw new HttpError(404, 'Không tìm thấy job.');
    if (m[2] === 'status') {
      const { status } = await readJson(req);
      if (!STATUSES.includes(status)) throw new HttpError(400, 'Trạng thái không hợp lệ.');
      await setUserJob(user.id, id, { status });
      return send(res, 200, { ok: true, status });
    }
    if (!aiConfigured()) throw new HttpError(400, 'AI chưa được bật trên server.');
    const text = prepareProfile(profileText(await getProfile(user.id), user));
    const mine = await getUserJob(user.id, id);
    if (m[2] === 'ai-score') {
      if (mine?.ai_checked_at) return send(res, 200, { ai: { score: mine.ai_score, reason: mine.ai_reason, flags: mine.ai_flags, scam: mine.ai_scam } });
      const [r] = await scoreJobs([job], text);
      if (!r) throw new HttpError(502, 'AI không trả lời được. Thử lại sau.');
      await setUserJob(user.id, id, { ai_score: r.fit, ai_reason: r.reason_vi, ai_flags: JSON.stringify(r.red_flags_vi ?? []), ai_scam: r.scam_risk, ai_checked_at: now() });
      return send(res, 200, { ai: { score: r.fit, reason: r.reason_vi, flags: r.red_flags_vi ?? [], scam: r.scam_risk } });
    }
    const { regenerate } = await readJson(req);
    if (mine?.apply_kit && !regenerate) return send(res, 200, { kit: mine.apply_kit });
    const kit = await applyKit(job, text);
    await setUserJob(user.id, id, { apply_kit: JSON.stringify(kit) });
    return send(res, 200, { kit });
  }

  throw new HttpError(404, 'not found');
}
