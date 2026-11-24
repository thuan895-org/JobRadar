// Postgres (Neon in production). Every AI result is stored on the job's row,
// keyed by job id, so a job is only ever sent to Gemini once per kind of result.
import pg from 'pg';
import { loadEnv } from './util.js';

loadEnv();
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. Put your Neon connection string in .env (see .env.example).');
  process.exit(1);
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  // Neon suspends its compute when idle and drops connections: do not keep
  // idle ones around, and log (instead of crashing on) a dropped connection.
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 30000,
});
pool.on('error', (err) => console.error(`[db] idle connection error: ${err.message}`));

export const q = (text, params) => pool.query(text, params);

export async function initDb() {
  await q(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT,
      url TEXT NOT NULL,
      description TEXT,
      tags JSONB NOT NULL DEFAULT '[]',
      kind TEXT,
      location TEXT,
      budget_text TEXT,
      budget_min_usd DOUBLE PRECISION,
      budget_max_usd DOUBLE PRECISION,
      posted_at TEXT,
      bid_count INTEGER,
      score INTEGER NOT NULL DEFAULT 0,
      matched JSONB NOT NULL DEFAULT '[]',
      region_ok BOOLEAN NOT NULL DEFAULT TRUE,
      status TEXT NOT NULL DEFAULT 'new',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      notified BOOLEAN NOT NULL DEFAULT FALSE,
      ai_score INTEGER,
      ai_reason TEXT,
      ai_flags JSONB NOT NULL DEFAULT '[]',
      ai_scam TEXT,
      ai_checked_at TEXT,
      apply_kit JSONB,
      ai_highlights JSONB
    );
    CREATE INDEX IF NOT EXISTS jobs_score ON jobs(score);
    CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value JSONB);

    -- Accounts. A user signs up with email + password, with Google, or both.
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT,
      google_sub TEXT UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      terms_version TEXT,
      terms_accepted_at TEXT,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );
    -- Login sessions: the browser keeps a random token, we keep only its hash.
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    -- One-time links sent by email (verify the address, reset the password).
    -- Where a job was written in Vietnamese (Freelancer.com tells us).
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS language TEXT;

    -- What each user told us about themselves: skills (catalogue ids or their
    -- own keyword groups), quiz answers, the text the AI reads, and their CV.
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      skills JSONB NOT NULL DEFAULT '[]',
      exclude_terms JSONB NOT NULL DEFAULT '[]',
      answers JSONB NOT NULL DEFAULT '{}',
      summary TEXT NOT NULL DEFAULT '',
      region_only BOOLEAN NOT NULL DEFAULT TRUE,
      min_budget_usd INTEGER NOT NULL DEFAULT 30,
      cv_name TEXT,
      cv_mime TEXT,
      cv_data BYTEA,
      cv_text TEXT,
      cv_uploaded_at TEXT,
      updated_at TEXT NOT NULL
    );
    -- A user's own state for a job: only created once they act on it or the AI reads it for them.
    CREATE TABLE IF NOT EXISTS user_jobs (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'new',
      ai_score INTEGER,
      ai_reason TEXT,
      ai_flags JSONB NOT NULL DEFAULT '[]',
      ai_scam TEXT,
      ai_checked_at TEXT,
      apply_kit JSONB,
      notified BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, job_id)
    );
    CREATE INDEX IF NOT EXISTS user_jobs_status ON user_jobs(user_id, status);
    -- Plans: a 7-day trial from sign-up, then Free, or Pro until pro_until.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_until TEXT;
    UPDATE users SET trial_ends_at = to_char((created_at::timestamptz + interval '7 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      WHERE trial_ends_at IS NULL;
    -- Personal Telegram alerts (Pro and trial): the linked chat and its settings.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_linked_at TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_settings JSONB NOT NULL DEFAULT '{}';
    CREATE UNIQUE INDEX IF NOT EXISTS users_telegram ON users(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
    -- Payments. While BILLING_MODE is not "live", only test payments exist (no money moves).
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      amount_vnd INTEGER NOT NULL,
      days INTEGER NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
    -- Admin decisions on a job: 'scam' hides it everywhere, 'verified' shows a badge.
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS flag TEXT;
    -- Users report a job (scam, expired, wrong details) or ask for it to be checked.
    CREATE TABLE IF NOT EXISTS job_reports (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      resolution TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS job_reports_status ON job_reports(status, created_at);
    -- One row per Gemini answer: what it was for, which model, how many tokens.
    CREATE TABLE IF NOT EXISTS ai_usage (
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      model TEXT NOT NULL,
      user_id TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS ai_usage_at ON ai_usage(at);
    -- Blog posts (Markdown), written in the admin app.
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      excerpt TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      author_id TEXT REFERENCES users(id) ON DELETE SET NULL
    );
    -- When the user agreed to send their CV to the AI (separate from the terms).
    ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS ai_consent_at TEXT;

    CREATE TABLE IF NOT EXISTS user_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
  `);
}

// Timestamps stay ISO-8601 text, as in the SQLite version, so they compare as strings.
function rowToJob(r) {
  return { ...r, tags: r.tags ?? [], matched: r.matched ?? [], ai_flags: r.ai_flags ?? [] };
}
const json = (v) => (v == null ? null : JSON.stringify(v));

export async function saveHighlights(id, points) {
  await q('UPDATE jobs SET ai_highlights = $1 WHERE id = $2', [json(points), id]);
}

export async function getJob(id) {
  const { rows } = await q('SELECT * FROM jobs WHERE id = $1', [id]);
  return rows[0] ? rowToJob(rows[0]) : null;
}

export async function aiCandidates({ minScore, limit }) {
  const { rows } = await q(`
    SELECT * FROM jobs
    WHERE ai_checked_at IS NULL AND status IN ('new', 'saved') AND region_ok AND score >= $1
    -- Jobs still waiting for a Telegram decision come first, so a new job is
    -- never pushed out by the backlog of older ones nobody has read yet.
    ORDER BY (NOT notified) DESC, score DESC, COALESCE(posted_at, first_seen) DESC LIMIT $2
  `, [minScore, limit]);
  return rows.map(rowToJob);
}

export async function saveAiScore(id, { fit, reason_vi, red_flags_vi, scam_risk }) {
  await q('UPDATE jobs SET ai_score = $1, ai_reason = $2, ai_flags = $3, ai_scam = $4, ai_checked_at = $5 WHERE id = $6',
    [fit, reason_vi, json(red_flags_vi ?? []), scam_risk, new Date().toISOString(), id]);
}

export async function saveApplyKit(id, kit) {
  await q('UPDATE jobs SET apply_kit = $1 WHERE id = $2', [json(kit), id]);
}

/** Saves a scored job; returns true when it was not in the database before. AI columns are never touched here. */
export async function upsertJob(job, now) {
  const { rows } = await q(`
    INSERT INTO jobs (id, source, title, company, url, description, tags, kind, location,
      budget_text, budget_min_usd, budget_max_usd, posted_at, bid_count, score, matched,
      region_ok, first_seen, last_seen, language)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18, $19)
    ON CONFLICT (id) DO UPDATE SET
      title = excluded.title, description = excluded.description, tags = excluded.tags,
      budget_text = excluded.budget_text, budget_min_usd = excluded.budget_min_usd,
      budget_max_usd = excluded.budget_max_usd, bid_count = excluded.bid_count,
      score = excluded.score, matched = excluded.matched, region_ok = excluded.region_ok,
      last_seen = excluded.last_seen, language = excluded.language
    RETURNING (first_seen = $18) AS is_new
  `, [
    job.id, job.source, job.title, job.company ?? '', job.url, job.description ?? '',
    json(job.tags ?? []), job.kind ?? '', job.location ?? '', job.budgetText ?? '',
    job.budgetMinUsd ?? null, job.budgetMaxUsd ?? null, job.postedAt ?? null, job.bidCount ?? null,
    job.score, json(job.matched), Boolean(job.regionOk), now, job.language || null,
  ]);
  return Boolean(rows[0]?.is_new);
}

export async function getMeta(key) {
  const { rows } = await q('SELECT value FROM meta WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function setMeta(key, value) {
  await q('INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, json(value)]);
}

export async function listJobs({ status = 'new', minScore = -999, source = '', q: text = '', regionOnly = false, sort = 'ai', limit = 300 } = {}) {
  const params = [minScore];
  const where = ['score >= $1'];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
  if (status !== 'all') add('status = ?', status);
  if (source) add('source = ?', source);
  if (regionOnly) where.push('region_ok');
  if (text) {
    params.push(`%${text}%`);
    const p = `$${params.length}`;
    where.push(`(title ILIKE ${p} OR description ILIKE ${p} OR company ILIKE ${p})`);
  }
  const order = {
    ai: 'ai_score IS NULL, ai_score DESC, score DESC',
    score: 'score DESC',
    new: 'COALESCE(posted_at, first_seen) DESC',
  }[sort] ?? 'score DESC';
  params.push(limit);
  const { rows } = await q(`
    SELECT * FROM jobs WHERE ${where.join(' AND ')}
    ORDER BY ${order}, COALESCE(posted_at, first_seen) DESC LIMIT $${params.length}
  `, params);
  return rows.map(rowToJob);
}

export async function setStatus(id, status) {
  const { rowCount } = await q('UPDATE jobs SET status = $1 WHERE id = $2', [status, id]);
  return rowCount > 0;
}

export async function counts() {
  const { rows } = await q('SELECT status, COUNT(*)::int AS n FROM jobs GROUP BY status');
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

/** Jobs that may still go to Telegram: not sent or settled yet, open to Vietnam, good enough, recent. */
export async function pendingNotifications({ minScore, maxAgeHours }) {
  const cutoff = new Date(Date.now() - maxAgeHours * 3.6e6).toISOString();
  const { rows } = await q(`
    SELECT * FROM jobs
    WHERE NOT notified AND status = 'new' AND region_ok AND score >= $1 AND flag IS DISTINCT FROM 'scam'
      AND COALESCE(posted_at, first_seen) >= $2
    ORDER BY score DESC
  `, [minScore, cutoff]);
  return rows.map(rowToJob);
}

/** "notified" means settled: sent, or decided not to send. */
export async function markNotified(ids) {
  if (ids.length) await q('UPDATE jobs SET notified = TRUE WHERE id = ANY($1)', [ids]);
}

/** Settles every job that can no longer go to Telegram: too old, low score, not open to Vietnam, or moved out of "new". */
export async function silenceIneligible({ minScore, maxAgeHours }) {
  const cutoff = new Date(Date.now() - maxAgeHours * 3.6e6).toISOString();
  await q(`
    UPDATE jobs SET notified = TRUE
    WHERE NOT notified AND NOT (status = 'new' AND region_ok AND score >= $1 AND COALESCE(posted_at, first_seen) >= $2)
  `, [minScore, cutoff]);
}

/** With Telegram off nothing waits: turning it on later does not send a backlog. */
export async function silenceAll() {
  await q('UPDATE jobs SET notified = TRUE WHERE NOT notified');
}

/**
 * Keeps the free database small: deletes jobs no source has listed for `days`
 * days, unless you saved or applied to them (those keep their AI results).
 */
export async function deleteStaleJobs(days) {
  const cutoff = new Date(Date.now() - days * 864e5).toISOString();
  // A job any user saved or applied to stays, with that user's notes and AI results.
  const { rowCount } = await q(`
    DELETE FROM jobs WHERE status IN ('new', 'hidden') AND last_seen < $1
      AND NOT EXISTS (SELECT 1 FROM user_jobs uj WHERE uj.job_id = jobs.id AND uj.status IN ('saved', 'applied'))
  `, [cutoff]);
  return rowCount;
}
