// Phase 2: employers post jobs on JobRadar, candidates apply inside JobRadar.
//
// A post waits for an admin. Once approved it becomes an ordinary row in
// `jobs` (source "JobRadar", flagged verified), so every feed, alert and the
// channel pick it up and score it per user. It closes after 30 days or when
// the employer closes it; closed jobs leave every "new" list.
//
// Applying shares the applicant's name, email, profile text and (if they tick
// it) their CV with that employer only.
import { randomUUID } from 'node:crypto';
import { q } from './db.js';
import { getProfile, profileText, getCv } from './profiles.js';
import { findUserById } from './accounts.js';
import { requireUser, HttpError } from './routes-account.js';
import { send, readJson, limiter } from './http.js';
import { sendApplicationEmail } from './email.js';

const POST_DAYS = 30;
const MAX_OPEN_POSTS = 5;
const KINDS = ['Freelance (trọn gói)', 'Freelance (theo giờ)', 'Part-time remote', 'Full-time remote'];
const APP_STATUSES = ['sent', 'viewed', 'shortlisted', 'rejected'];
const applies = limiter(20, 24 * 3600000);
const now = () => new Date().toISOString();
const jobIdOf = (postId) => `jobradar:${postId}`;

// ---- Validation ----

function cleanPost(input) {
  const s = (v, max) => String(v ?? '').trim().slice(0, max);
  const p = {
    title: s(input.title, 150),
    company: s(input.company, 120),
    company_url: s(input.companyUrl, 300),
    description: s(input.description, 20000),
    skills: (Array.isArray(input.skills) ? input.skills : []).map((x) => s(x, 40).toLowerCase()).filter(Boolean).slice(0, 15),
    kind: KINDS.includes(input.kind) ? input.kind : KINDS[0],
    budget_text: s(input.budgetText, 80),
    budget_min_usd: Number.isFinite(Number(input.budgetMinUsd)) && Number(input.budgetMinUsd) > 0 ? Math.round(Number(input.budgetMinUsd)) : null,
    budget_max_usd: Number.isFinite(Number(input.budgetMaxUsd)) && Number(input.budgetMaxUsd) > 0 ? Math.round(Number(input.budgetMaxUsd)) : null,
    apply_mode: input.applyMode === 'url' ? 'url' : 'in_app',
    apply_url: s(input.applyUrl, 500),
    contact_email: s(input.contactEmail, 254).toLowerCase(),
  };
  if (p.title.length < 8) throw new HttpError(400, 'Tiêu đề cần ít nhất 8 ký tự.');
  if (!p.company) throw new HttpError(400, 'Cần tên công ty hoặc tên người tuyển.');
  if (p.description.length < 80) throw new HttpError(400, 'Mô tả cần ít nhất 80 ký tự: việc cần làm, yêu cầu, thời hạn.');
  if (p.company_url && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(p.company_url)) throw new HttpError(400, 'Website công ty phải bắt đầu bằng http:// hoặc https://');
  if (p.apply_mode === 'url' && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(p.apply_url)) throw new HttpError(400, 'Link ứng tuyển phải bắt đầu bằng http:// hoặc https://');
  if (p.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.contact_email)) throw new HttpError(400, 'Email nhận thông báo không hợp lệ.');
  if (p.budget_min_usd && p.budget_max_usd && p.budget_min_usd > p.budget_max_usd) throw new HttpError(400, 'Ngân sách tối thiểu lớn hơn tối đa.');
  return p;
}

// ---- Data ----

export async function getPost(id) {
  const { rows } = await q('SELECT * FROM job_posts WHERE id = $1', [id]);
  return rows[0] ?? null;
}

const publicPost = (p) => ({
  id: p.id, jobId: p.job_id, title: p.title, company: p.company, companyUrl: p.company_url, description: p.description, skills: p.skills ?? [],
  kind: p.kind, budgetText: p.budget_text, budgetMinUsd: p.budget_min_usd, budgetMaxUsd: p.budget_max_usd, applyMode: p.apply_mode,
  applyUrl: p.apply_mode === 'url' ? p.apply_url : null, status: p.status, createdAt: p.created_at, approvedAt: p.approved_at, expiresAt: p.expires_at,
});

/** The approved post, if it is still open, for public pages and candidates. */
export async function openPost(id) {
  const p = await getPost(id);
  return p && p.status === 'approved' && Date.parse(p.expires_at) > Date.now() ? p : null;
}

/** Admin approval: the post becomes a job everyone can see, verified, for 30 days. */
export async function approvePost(id, appUrl) {
  const p = await getPost(id);
  if (!p || p.status !== 'pending') return null;
  const t = now();
  const expires = new Date(Date.now() + POST_DAYS * 864e5).toISOString();
  const jobId = jobIdOf(p.id);
  const budget = p.budget_text || (p.budget_min_usd || p.budget_max_usd ? `$${p.budget_min_usd ?? ''}${p.budget_max_usd ? `–$${p.budget_max_usd}` : '+'}` : '');
  await q(`
    INSERT INTO jobs (id, source, title, company, url, description, tags, kind, location, budget_text, budget_min_usd, budget_max_usd,
      posted_at, score, matched, region_ok, status, first_seen, last_seen, notified, language, flag)
    VALUES ($1, 'JobRadar', $2, $3, $4, $5, $6, $7, 'Remote · Vietnam', $8, $9, $10, $11, 0, '[]', TRUE, 'new', $11, $11, TRUE, 'vi', 'verified')
    ON CONFLICT (id) DO UPDATE SET title = excluded.title, description = excluded.description, tags = excluded.tags, kind = excluded.kind,
      budget_text = excluded.budget_text, budget_min_usd = excluded.budget_min_usd, budget_max_usd = excluded.budget_max_usd,
      posted_at = excluded.posted_at, first_seen = excluded.first_seen, last_seen = excluded.last_seen, flag = 'verified'
  `, [jobId, p.title, p.company, `${appUrl}/viec-lam/${p.id}`, p.description, JSON.stringify(p.skills ?? []), p.kind, budget, p.budget_min_usd, p.budget_max_usd, t]);
  await q(`UPDATE job_posts SET status = 'approved', job_id = $2, approved_at = $3, expires_at = $4, reject_reason = NULL, updated_at = $3 WHERE id = $1`, [id, jobId, t, expires]);
  return getPost(id);
}

export async function rejectPost(id, reason) {
  const { rowCount } = await q(`UPDATE job_posts SET status = 'rejected', reject_reason = $2, updated_at = $3 WHERE id = $1 AND status = 'pending'`, [id, reason, now()]);
  return rowCount > 0;
}

/** Closes a post: its job leaves every "new" list; people who saved it still see it, marked closed. */
export async function closePost(id) {
  const p = await getPost(id);
  if (!p) return false;
  await q(`UPDATE job_posts SET status = 'closed', updated_at = $2 WHERE id = $1`, [id, now()]);
  if (p.job_id) await q(`UPDATE jobs SET flag = 'closed' WHERE id = $1`, [p.job_id]);
  return true;
}

/** Run after each scan: posts past their 30 days close themselves. */
export async function closeExpiredPosts() {
  const { rows } = await q(`SELECT id FROM job_posts WHERE status = 'approved' AND expires_at <= $1`, [now()]);
  for (const r of rows) await closePost(r.id);
  return rows.length;
}

export async function listPostsForAdmin(status = 'pending') {
  const { rows } = await q(`SELECT p.*, u.email AS employer_email FROM job_posts p LEFT JOIN users u ON u.id = p.employer_id
    WHERE ($1 = 'all' OR p.status = $1) ORDER BY p.created_at DESC LIMIT 300`, [status]);
  return rows.map((p) => ({ ...publicPost(p), employerEmail: p.employer_email, rejectReason: p.reject_reason, contactEmail: p.contact_email }));
}

// ---- Routes ----

/** /api/employer/*, /api/board/*, /api/applications. Returns false for anything else. */
export async function handleRecruitRoutes(req, res, url, ctx) {
  const path = url.pathname;
  if (!(path.startsWith('/api/employer/') || path.startsWith('/api/board/') || path === '/api/applications')) return false;
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

async function ownPost(user, id) {
  const p = await getPost(id);
  if (!p || p.employer_id !== user.id) throw new HttpError(404, 'Không tìm thấy tin tuyển dụng.');
  return p;
}

async function route(req, res, url, path, ctx) {
  const method = req.method;
  const user = await requireUser(req);

  // ---- Employer: my posts ----
  if (method === 'GET' && path === '/api/employer/posts') {
    const { rows } = await q(`SELECT p.*, (SELECT COUNT(*)::int FROM applications a WHERE a.post_id = p.id) AS applicants,
      (SELECT COUNT(*)::int FROM applications a WHERE a.post_id = p.id AND a.status = 'sent') AS unread
      FROM job_posts p WHERE p.employer_id = $1 ORDER BY p.created_at DESC`, [user.id]);
    return send(res, 200, { posts: rows.map((p) => ({ ...publicPost(p), applicants: p.applicants, unread: p.unread, rejectReason: p.reject_reason, contactEmail: p.contact_email })) });
  }
  if (method === 'POST' && path === '/api/employer/posts') {
    const p = cleanPost(await readJson(req));
    const { rows } = await q(`SELECT COUNT(*)::int AS n FROM job_posts WHERE employer_id = $1 AND status IN ('pending', 'approved')`, [user.id]);
    if (rows[0].n >= MAX_OPEN_POSTS) throw new HttpError(400, `Bạn đang có ${MAX_OPEN_POSTS} tin chờ duyệt hoặc đang mở. Đóng bớt tin cũ để đăng thêm.`);
    const id = randomUUID().replace(/-/g, '').slice(0, 12);
    const t = now();
    await q(`INSERT INTO job_posts (id, employer_id, title, company, company_url, description, skills, kind, budget_text, budget_min_usd, budget_max_usd,
      apply_mode, apply_url, contact_email, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending',$15,$15)`,
    [id, user.id, p.title, p.company, p.company_url, p.description, JSON.stringify(p.skills), p.kind, p.budget_text, p.budget_min_usd, p.budget_max_usd,
      p.apply_mode, p.apply_url, p.contact_email || user.email, t]);
    return send(res, 201, { post: publicPost(await getPost(id)) });
  }
  const mine = path.match(/^\/api\/employer\/posts\/([a-z0-9]{12})(\/close|\/applications)?$/);
  if (mine) {
    const post = await ownPost(user, mine[1]);
    if (method === 'POST' && mine[2] === '/close') {
      await closePost(post.id);
      return send(res, 200, { post: publicPost(await getPost(post.id)) });
    }
    if (method === 'GET' && mine[2] === '/applications') {
      const { rows } = await q(`SELECT a.*, u.name, u.email FROM applications a JOIN users u ON u.id = a.applicant_id WHERE a.post_id = $1 ORDER BY a.created_at DESC`, [post.id]);
      return send(res, 200, { post: publicPost(post), applications: rows.map((a) => ({ id: a.id, name: a.name, email: a.email, message: a.message, profile: a.profile_snapshot, hasCv: a.share_cv, status: a.status, createdAt: a.created_at })) });
    }
    if (method === 'POST' && !mine[2]) {
      // Editing sends the post back for review, unless it is closed.
      if (post.status === 'closed') throw new HttpError(400, 'Tin đã đóng, hãy đăng tin mới.');
      const p = cleanPost(await readJson(req));
      await q(`UPDATE job_posts SET title=$2, company=$3, company_url=$4, description=$5, skills=$6, kind=$7, budget_text=$8, budget_min_usd=$9, budget_max_usd=$10,
        apply_mode=$11, apply_url=$12, contact_email=$13, status='pending', reject_reason=NULL, updated_at=$14 WHERE id=$1`,
      [post.id, p.title, p.company, p.company_url, p.description, JSON.stringify(p.skills), p.kind, p.budget_text, p.budget_min_usd, p.budget_max_usd,
        p.apply_mode, p.apply_url, p.contact_email || user.email, now()]);
      if (post.job_id) await q(`UPDATE jobs SET flag = 'closed' WHERE id = $1`, [post.job_id]); // hidden until approved again
      return send(res, 200, { post: publicPost(await getPost(post.id)) });
    }
  }
  const app = path.match(/^\/api\/employer\/applications\/([a-f0-9-]{36})\/(status|cv)$/);
  if (app) {
    const { rows } = await q(`SELECT a.*, p.employer_id FROM applications a JOIN job_posts p ON p.id = a.post_id WHERE a.id = $1`, [app[1]]);
    const a = rows[0];
    if (!a || a.employer_id !== user.id) throw new HttpError(404, 'Không tìm thấy hồ sơ ứng tuyển.');
    if (method === 'POST' && app[2] === 'status') {
      const { status } = await readJson(req);
      if (!APP_STATUSES.includes(status)) throw new HttpError(400, 'Trạng thái không hợp lệ.');
      await q('UPDATE applications SET status = $2, updated_at = $3 WHERE id = $1', [a.id, status, now()]);
      return send(res, 200, { ok: true });
    }
    if (method === 'GET' && app[2] === 'cv') {
      const cv = a.share_cv ? await getCv(a.applicant_id) : null;
      if (!cv) throw new HttpError(404, 'Ứng viên không gửi CV hoặc đã xoá CV.');
      if (a.status === 'sent') await q(`UPDATE applications SET status = 'viewed', updated_at = $2 WHERE id = $1`, [a.id, now()]);
      res.writeHead(200, { 'Content-Type': cv.cv_mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(cv.cv_name)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(cv.cv_data);
    }
  }

  // ---- Candidates ----
  const board = path.match(/^\/api\/board\/([a-z0-9]{12})(\/apply)?$/);
  if (board) {
    const post = await openPost(board[1]);
    if (!post) throw new HttpError(404, 'Tin tuyển dụng không còn mở.');
    const { rows } = await q('SELECT status, created_at FROM applications WHERE post_id = $1 AND applicant_id = $2', [post.id, user.id]);
    if (method === 'GET' && !board[2]) {
      const profile = await getProfile(user.id);
      return send(res, 200, { post: publicPost(post), myApplication: rows[0] ?? null, own: post.employer_id === user.id, hasCv: Boolean(profile.cv_name) });
    }
    if (method === 'POST' && board[2]) {
      if (post.apply_mode !== 'in_app') throw new HttpError(400, 'Tin này nhận hồ sơ qua link của nhà tuyển dụng.');
      if (post.employer_id === user.id) throw new HttpError(400, 'Bạn không thể ứng tuyển tin của chính mình.');
      if (rows[0]) throw new HttpError(409, 'Bạn đã ứng tuyển tin này.');
      const body = await readJson(req);
      if (body.consent !== true) throw new HttpError(400, 'Bạn cần đồng ý chia sẻ hồ sơ với nhà tuyển dụng.');
      const message = String(body.message ?? '').trim().slice(0, 4000);
      if (message.length < 20) throw new HttpError(400, 'Lời nhắn cần ít nhất 20 ký tự: giới thiệu ngắn vì sao bạn hợp với việc này.');
      if (!applies.hit(user.id)) throw new HttpError(429, 'Bạn đã ứng tuyển 20 lần hôm nay. Thử lại vào ngày mai.');
      const profile = await getProfile(user.id);
      const shareCv = Boolean(body.shareCv && profile.cv_name);
      const t = now();
      await q(`INSERT INTO applications (id, post_id, applicant_id, message, share_cv, profile_snapshot, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7, $7)`, [randomUUID(), post.id, user.id, message, shareCv, profileText(profile, user).slice(0, 8000), t]);
      // The candidate marks it applied in their own feed too.
      await q(`INSERT INTO user_jobs (user_id, job_id, status, updated_at) VALUES ($1, $2, 'applied', $3)
        ON CONFLICT (user_id, job_id) DO UPDATE SET status = 'applied', updated_at = excluded.updated_at`, [user.id, post.job_id, t]);
      const employer = await findUserById(post.employer_id);
      const to = post.contact_email || employer?.email;
      if (to) await sendApplicationEmail(to, post.title, `${ctx.appUrl}/app/employer/${post.id}`, ctx.isLocal).catch((err) => console.error(`[email] ${err.message}`));
      return send(res, 201, { ok: true });
    }
  }

  if (method === 'GET' && path === '/api/applications') {
    const { rows } = await q(`SELECT a.id, a.status, a.created_at, a.share_cv, p.id AS post_id, p.title, p.company, p.status AS post_status
      FROM applications a JOIN job_posts p ON p.id = a.post_id WHERE a.applicant_id = $1 ORDER BY a.created_at DESC`, [user.id]);
    return send(res, 200, { applications: rows });
  }

  throw new HttpError(404, 'not found');
}

export { publicPost };
