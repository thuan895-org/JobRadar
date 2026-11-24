// The personal job feed (/api/feed/*) and the user's profile (/api/profile).
// Every user sees the same jobs, scored and filtered by their own profile;
// saving, hiding, AI scores and apply kits are kept per user in user_jobs.
import { q, getJob, getMeta, setMeta } from './db.js';
import { aiConfigured, scoreJobs, applyKit, prepareProfile, analyzeCv, aiContext } from './ai.js';
import { addReport, REPORT_KINDS } from './reports.js';
import { highlightsFor } from './highlights.js';
import { CATALOG, LEVELS, getProfile, saveProfile, scoringConfig, scoreRow, profileText, claimLegacyData, saveCv, saveCvAnalysis, getCv, clearCv, cleanDraftSkills } from './profiles.js';
import { publicUser, hasPro } from './accounts.js';
import { requireUser, HttpError } from './routes-account.js';
import { send, readJson, readBytes, limiter } from './http.js';

const CV_MAX = 2 * 1048576;
const cvAnalyses = limiter(5, 24 * 3600000); // AI reads of a CV per user per day
const FREE_SUMMARIES = 20; // new job summaries a Free user can open per day
const freeSeen = new Map(); // `${userId}:${day}` -> job ids summarised for them that day
function freeAllowance(userId, jobId) {
  const key = `${userId}:${new Date().toISOString().slice(0, 10)}`;
  if (!freeSeen.has(key)) {
    if (freeSeen.size > 10000) freeSeen.clear();
    freeSeen.set(key, new Set());
  }
  const seen = freeSeen.get(key);
  if (seen.has(jobId)) return true;
  if (seen.size >= FREE_SUMMARIES) return false;
  seen.add(jobId);
  return true;
}
const aiScores = limiter(200, 24 * 3600000); // fair use for trial/Pro
const kits = limiter(40, 24 * 3600000);
const reportsPerDay = limiter(20, 24 * 3600000);

/** Keeps letters, digits and a few safe characters from an uploaded file name. */
function cleanFileName(header) {
  let name = 'cv.pdf';
  try {
    name = decodeURIComponent(String(header ?? 'cv.pdf'));
  } catch {}
  return name.replace(/[^\p{L}\p{N}\p{Pd} ._()-]/gu, '').slice(0, 120) || 'cv.pdf';
}

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
    flag: row.flag ?? null,
    highlights: row.ai_highlights ?? null,
  };
}

// Scores depend only on the job and the user's profile, so they are kept per
// user until the profile changes (or the server restarts). Opening another tab
// or changing a filter then costs no scoring at all, and job descriptions are
// read from the database only for jobs not scored yet and for the jobs shown.
const scoreCache = new Map(); // userId -> { version, scores: Map(jobId -> { score, matched, regionOk }) }
const SCORE_CACHE_USERS = 300;

function scoresFor(user, profile) {
  const version = `${profile.updated_at ?? ''}`;
  let entry = scoreCache.get(user.id);
  if (!entry || entry.version !== version) {
    entry = { version, scores: new Map() };
    if (scoreCache.size >= SCORE_CACHE_USERS) scoreCache.delete(scoreCache.keys().next().value);
  }
  scoreCache.delete(user.id); // re-insert: most recently used last
  scoreCache.set(user.id, entry);
  return entry.scores;
}

async function descriptions(ids, length) {
  if (!ids.length) return new Map();
  const { rows } = await q(`SELECT id, LEFT(description, ${length}) AS description FROM jobs WHERE id = ANY($1)`, [ids]);
  return new Map(rows.map((r) => [r.id, r.description ?? '']));
}

async function feed(user, params, config) {
  const profile = await getProfile(user.id);
  const scoring = scoringConfig(profile, config);
  const cutoff = new Date(Date.now() - FEED_DAYS * 864e5).toISOString();
  // Text search runs in the database, over the full description too.
  const searchText = (params.get('q') ?? '').trim().slice(0, 100);
  const { rows } = await q(`
    SELECT j.id, j.source, j.title, j.company, j.url, j.tags, j.kind, j.location,
      j.budget_text, j.budget_min_usd, j.budget_max_usd, j.posted_at, j.bid_count, j.matched, j.first_seen, j.language, j.ai_highlights, j.flag,
      uj.status AS my_status, uj.ai_score, uj.ai_reason, uj.ai_flags, uj.ai_scam, uj.ai_checked_at, (uj.apply_kit IS NOT NULL) AS has_kit
    FROM jobs j LEFT JOIN user_jobs uj ON uj.job_id = j.id AND uj.user_id = $1
    WHERE (COALESCE(j.posted_at, j.first_seen) >= $2 OR uj.status IN ('saved', 'applied'))
      AND ($3 = '' OR j.title ILIKE $4 OR j.company ILIKE $4 OR j.description ILIKE $4)
  `, [user.id, cutoff, searchText, `%${searchText.replace(/[\\%_]/g, (c) => `\\${c}`)}%`]);

  // A job the admin marked as a scam disappears from New; if the user saved it, it stays there with a warning.
  // Scam or closed jobs leave New; anyone who saved or applied keeps them, with a mark.
  const scores = scoresFor(user, profile);
  const unscored = rows.filter((r) => !scores.has(r.id));
  const texts = await descriptions(unscored.map((r) => r.id), 6000);
  for (const r of unscored) scores.set(r.id, scoreRow({ ...r, description: texts.get(r.id) ?? '' }, scoring));
  const items = rows.map((r) => feedItem(r, scores.get(r.id))).filter((it) => !((it.flag === 'scam' || it.flag === 'closed') && it.status === 'new'));
  const tab = STATUSES.includes(params.get('tab')) || params.get('tab') === 'all' ? params.get('tab') : 'new';
  const regionOnly = (params.get('regionOnly') ?? (profile.region_only ? '1' : '0')) === '1';
  // New jobs below 0 do not fit the profile at all; saved/applied/hidden ones always show.
  const minScore = Number(params.get('minScore') ?? (tab === 'new' ? 0 : -999));

  // Tab counts follow the same region filter and fit threshold as the list, so the numbers match what is shown.
  const counts = Object.fromEntries([...STATUSES, 'all'].map((s) => [s, 0]));
  for (const it of items) {
    if (regionOnly && !it.regionOk && it.status === 'new') continue;
    if (it.status === 'new' && it.score < 0) continue;
    counts[it.status]++;
    counts.all++;
  }
  const source = params.get('source') ?? '';
  const shown = items.filter((it) =>
    (tab === 'all' || it.status === tab)
    && (!regionOnly || it.regionOk || it.status !== 'new') // the region filter is for discovering; saved/applied jobs always show
    && it.score >= minScore
    && (!source || it.source === source));

  const sort = params.get('sort') ?? 'fit';
  const date = (it) => Date.parse(it.postedAt) || 0;
  shown.sort(sort === 'new' ? (a, b) => date(b) - date(a)
    : sort === 'score' ? (a, b) => b.score - a.score || date(b) - date(a)
    : (a, b) => (b.ai?.score ?? -1) - (a.ai?.score ?? -1) || b.score - a.score || date(b) - date(a));

  const page = shown.slice(0, FEED_LIMIT);
  const shownTexts = await descriptions(page.map((it) => it.id), 3000);
  for (const it of page) it.description = shownTexts.get(it.id) ?? '';
  return {
    jobs: page,
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
  if (!(path === '/api/feed' || path.startsWith('/api/feed/') || path === '/api/profile' || path.startsWith('/api/profile/'))) return false;
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
  return aiContext.run({ userId: user.id }, () => routeFor(user, req, res, url, path, ctx));
}

async function routeFor(user, req, res, url, path, ctx) {
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

  if (req.method === 'POST' && path === '/api/profile/cv') {
    // Raw PDF bytes; the file name comes in a header. Analysis by the AI only with the user's explicit consent.
    if (!String(req.headers['content-type'] ?? '').startsWith('application/pdf')) throw new HttpError(415, 'Chỉ nhận CV dạng PDF.');
    const data = await readBytes(req, CV_MAX);
    if (data.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'Tệp này không phải PDF.');
    const name = cleanFileName(req.headers['x-file-name']);
    await saveCv(user.id, { name, mime: 'application/pdf', data });
    if (url.searchParams.get('analyze') !== '1') return send(res, 200, { profile: await getProfile(user.id), draft: null });
    if (req.headers['x-ai-consent'] !== 'yes') throw new HttpError(400, 'Bạn cần đồng ý gửi CV cho AI để phân tích.');
    if (!aiConfigured()) throw new HttpError(400, 'AI chưa được bật trên server. CV đã được lưu; bạn điền bảng hỏi giúp nhé.');
    if (!cvAnalyses.hit(user.id)) throw new HttpError(429, 'Bạn đã phân tích CV 5 lần hôm nay. CV đã được lưu; thử lại vào ngày mai.');
    const result = await analyzeCv(data.toString('base64'), CATALOG);
    if (!result?.is_cv) throw new HttpError(400, 'Tệp này có vẻ không phải CV. Hãy tải lên CV của bạn hoặc điền bảng hỏi.');
    await saveCvAnalysis(user.id, result.cv_text);
    return send(res, 200, {
      profile: await getProfile(user.id),
      draft: {
        skills: cleanDraftSkills(result.skills),
        extraKeywords: (Array.isArray(result.extra_keywords) ? result.extra_keywords : []).map((k) => String(k).toLowerCase().trim()).filter(Boolean).slice(0, 20),
        years: result.years, english: result.english, intro: String(result.intro_vi ?? '').slice(0, 2000), headline: result.headline ?? '',
      },
    });
  }
  if (req.method === 'GET' && path === '/api/profile/cv') {
    const cv = await getCv(user.id);
    if (!cv) throw new HttpError(404, 'Bạn chưa tải CV lên.');
    res.writeHead(200, { 'Content-Type': cv.cv_mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(cv.cv_name)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end(cv.cv_data);
  }
  if (req.method === 'POST' && path === '/api/profile/cv/remove') {
    await clearCv(user.id);
    return send(res, 200, { profile: await getProfile(user.id) });
  }

  if (req.method === 'GET' && path === '/api/feed') return send(res, 200, await feed(user, url.searchParams, ctx.config));

  if (req.method === 'POST' && path === '/api/feed/highlights') {
    if (!aiConfigured()) throw new HttpError(400, 'AI chưa được bật trên server.');
    const { ids } = await readJson(req);
    if (!Array.isArray(ids)) throw new HttpError(400, 'ids must be a list');
    if (!hasPro(user)) {
      // Free: each job summarised for this user counts once against 20 a day. Already-made summaries are free to show.
      const wanted = [...new Set(ids.map(String))].slice(0, 10);
      const allowed = [];
      for (const id of wanted) {
        const job = await getJob(id);
        if (job?.ai_highlights || freeAllowance(user.id, id)) allowed.push(id);
      }
      const result = await highlightsFor(allowed);
      return send(res, 200, { ...result, limited: allowed.length < wanted.length });
    }
    // At most 10 per request: only what is on screen. The summary is shared by every user.
    return send(res, 200, await highlightsFor([...new Set(ids.map(String))].slice(0, 10)));
  }

  const m = path.match(/^\/api\/feed\/(.+)\/(status|ai-score|apply-kit|report)$/);
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
    if (m[2] === 'report') {
      const { kind, note } = await readJson(req);
      if (!REPORT_KINDS.includes(kind)) throw new HttpError(400, 'Loại báo cáo không hợp lệ.');
      if (!reportsPerDay.hit(user.id)) throw new HttpError(429, 'Bạn đã gửi 20 báo cáo hôm nay. Cảm ơn bạn, thử lại vào ngày mai.');
      await addReport(user.id, id, kind, String(note ?? '').trim().slice(0, 1000));
      return send(res, 200, { ok: true });
    }
    if (!aiConfigured()) throw new HttpError(400, 'AI chưa được bật trên server.');
    if (!hasPro(user)) throw new HttpError(402, 'pro_required');
    const text = prepareProfile(profileText(await getProfile(user.id), user));
    const mine = await getUserJob(user.id, id);
    if (m[2] === 'ai-score') {
      if (mine?.ai_checked_at) return send(res, 200, { ai: { score: mine.ai_score, reason: mine.ai_reason, flags: mine.ai_flags, scam: mine.ai_scam } });
      if (!aiScores.hit(user.id)) throw new HttpError(429, 'Bạn đã dùng AI chấm 200 lần hôm nay. Thử lại vào ngày mai.');
      const [r] = await scoreJobs([job], text);
      if (!r) throw new HttpError(502, 'AI không trả lời được. Thử lại sau.');
      await setUserJob(user.id, id, { ai_score: r.fit, ai_reason: r.reason_vi, ai_flags: JSON.stringify(r.red_flags_vi ?? []), ai_scam: r.scam_risk, ai_checked_at: now() });
      return send(res, 200, { ai: { score: r.fit, reason: r.reason_vi, flags: r.red_flags_vi ?? [], scam: r.scam_risk } });
    }
    const { regenerate } = await readJson(req);
    if (mine?.apply_kit && !regenerate) return send(res, 200, { kit: mine.apply_kit });
    if (!kits.hit(user.id)) throw new HttpError(429, 'Bạn đã soạn 40 bộ apply hôm nay. Thử lại vào ngày mai.');
    const kit = await applyKit(job, text);
    await setUserJob(user.id, id, { apply_kit: JSON.stringify(kit) });
    return send(res, 200, { kit });
  }

  throw new HttpError(404, 'not found');
}
