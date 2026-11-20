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

const q = (text, params) => pool.query(text, params);

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
    ORDER BY score DESC, COALESCE(posted_at, first_seen) DESC LIMIT $2
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
      region_ok, first_seen, last_seen)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18)
    ON CONFLICT (id) DO UPDATE SET
      title = excluded.title, description = excluded.description, tags = excluded.tags,
      budget_text = excluded.budget_text, budget_min_usd = excluded.budget_min_usd,
      budget_max_usd = excluded.budget_max_usd, bid_count = excluded.bid_count,
      score = excluded.score, matched = excluded.matched, region_ok = excluded.region_ok,
      last_seen = excluded.last_seen
    RETURNING (first_seen = $18) AS is_new
  `, [
    job.id, job.source, job.title, job.company ?? '', job.url, job.description ?? '',
    json(job.tags ?? []), job.kind ?? '', job.location ?? '', job.budgetText ?? '',
    job.budgetMinUsd ?? null, job.budgetMaxUsd ?? null, job.postedAt ?? null, job.bidCount ?? null,
    job.score, json(job.matched), Boolean(job.regionOk), now,
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

export async function pendingNotifications({ minScore, maxAgeHours, sinceIso }) {
  const cutoff = new Date(Date.now() - maxAgeHours * 3.6e6).toISOString();
  const { rows } = await q(`
    SELECT * FROM jobs
    WHERE NOT notified AND status = 'new' AND region_ok AND score >= $1
      AND first_seen >= $2 AND COALESCE(posted_at, first_seen) >= $3
    ORDER BY score DESC
  `, [minScore, sinceIso, cutoff]);
  return rows.map(rowToJob);
}

export async function markNotified(ids) {
  if (ids.length) await q('UPDATE jobs SET notified = TRUE WHERE id = ANY($1)', [ids]);
}

/** Everything first seen before `sinceIso` that never got sent stays silent. */
export async function silenceOlderThan(sinceIso) {
  await q('UPDATE jobs SET notified = TRUE WHERE NOT notified AND first_seen < $1', [sinceIso]);
}

/**
 * Keeps the free database small: deletes jobs no source has listed for `days`
 * days, unless you saved or applied to them (those keep their AI results).
 */
export async function deleteStaleJobs(days) {
  const cutoff = new Date(Date.now() - days * 864e5).toISOString();
  const { rowCount } = await q(`DELETE FROM jobs WHERE status IN ('new', 'hidden') AND last_seen < $1`, [cutoff]);
  return rowCount;
}
