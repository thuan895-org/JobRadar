import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './util.js';

mkdirSync(join(ROOT, 'data'), { recursive: true });
export const db = new DatabaseSync(join(ROOT, 'data', 'jobs.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT,
    url TEXT NOT NULL,
    description TEXT,
    tags TEXT,
    kind TEXT,
    location TEXT,
    budget_text TEXT,
    budget_min_usd REAL,
    budget_max_usd REAL,
    posted_at TEXT,
    bid_count INTEGER,
    score INTEGER NOT NULL DEFAULT 0,
    matched TEXT,
    region_ok INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'new',
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    notified INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS jobs_score ON jobs(score);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`);

// AI columns, added to databases created before the AI feature.
const existing = new Set(db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name));
for (const [name, type] of [
  ['ai_score', 'INTEGER'], ['ai_reason', 'TEXT'], ['ai_flags', 'TEXT'], ['ai_scam', 'TEXT'],
  ['ai_checked_at', 'TEXT'], ['apply_kit', 'TEXT'], ['ai_highlights', 'TEXT'],
]) {
  if (!existing.has(name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
}

function rowToJob(r) {
  return {
    ...r,
    tags: JSON.parse(r.tags || '[]'),
    matched: JSON.parse(r.matched || '[]'),
    ai_flags: JSON.parse(r.ai_flags || '[]'),
    apply_kit: r.apply_kit ? JSON.parse(r.apply_kit) : null,
    ai_highlights: r.ai_highlights ? JSON.parse(r.ai_highlights) : null,
  };
}

export function saveHighlights(id, points) {
  db.prepare('UPDATE jobs SET ai_highlights = ? WHERE id = ?').run(JSON.stringify(points), id);
}

export function getJob(id) {
  const r = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return r ? rowToJob(r) : null;
}

export function aiCandidates({ minScore, limit }) {
  return db.prepare(`
    SELECT * FROM jobs
    WHERE ai_checked_at IS NULL AND status IN ('new', 'saved') AND region_ok = 1 AND score >= ?
    ORDER BY score DESC, COALESCE(posted_at, first_seen) DESC LIMIT ?
  `).all(minScore, limit).map(rowToJob);
}

export function saveAiScore(id, { fit, reason_vi, red_flags_vi, scam_risk }) {
  db.prepare('UPDATE jobs SET ai_score = ?, ai_reason = ?, ai_flags = ?, ai_scam = ?, ai_checked_at = ? WHERE id = ?')
    .run(fit, reason_vi, JSON.stringify(red_flags_vi ?? []), scam_risk, new Date().toISOString(), id);
}

export function saveApplyKit(id, kit) {
  db.prepare('UPDATE jobs SET apply_kit = ? WHERE id = ?').run(JSON.stringify(kit), id);
}

const insert = db.prepare(`
  INSERT INTO jobs (id, source, title, company, url, description, tags, kind, location,
    budget_text, budget_min_usd, budget_max_usd, posted_at, bid_count, score, matched,
    region_ok, first_seen, last_seen)
  VALUES (:id, :source, :title, :company, :url, :description, :tags, :kind, :location,
    :budgetText, :budgetMinUsd, :budgetMaxUsd, :postedAt, :bidCount, :score, :matched,
    :regionOk, :now, :now)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title, description = excluded.description, tags = excluded.tags,
    budget_text = excluded.budget_text, budget_min_usd = excluded.budget_min_usd,
    budget_max_usd = excluded.budget_max_usd, bid_count = excluded.bid_count,
    score = excluded.score, matched = excluded.matched, region_ok = excluded.region_ok,
    last_seen = excluded.last_seen
  RETURNING (first_seen = :now) AS is_new
`);

/** Saves a scored job; returns true when it was not in the database before. */
export function upsertJob(job, now) {
  const row = insert.get({
    id: job.id, source: job.source, title: job.title, company: job.company ?? '',
    url: job.url, description: job.description ?? '', tags: JSON.stringify(job.tags ?? []),
    kind: job.kind ?? '', location: job.location ?? '', budgetText: job.budgetText ?? '',
    budgetMinUsd: job.budgetMinUsd ?? null, budgetMaxUsd: job.budgetMaxUsd ?? null,
    postedAt: job.postedAt ?? null, bidCount: job.bidCount ?? null, score: job.score,
    matched: JSON.stringify(job.matched), regionOk: job.regionOk ? 1 : 0, now,
  });
  return Boolean(row?.is_new);
}

export function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

export function setMeta(key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export function listJobs({ status = 'new', minScore = -999, source = '', q = '', regionOnly = false, sort = 'ai', limit = 300 } = {}) {
  const where = ['score >= :minScore'];
  const params = { minScore, limit };
  if (status !== 'all') { where.push('status = :status'); params.status = status; }
  if (source) { where.push('source = :source'); params.source = source; }
  if (regionOnly) where.push('region_ok = 1');
  if (q) { where.push('(title LIKE :q OR description LIKE :q OR company LIKE :q)'); params.q = `%${q}%`; }
  const order = {
    ai: 'ai_score IS NULL, ai_score DESC, score DESC',
    score: 'score DESC',
    new: 'COALESCE(posted_at, first_seen) DESC',
  }[sort] ?? 'score DESC';
  return db.prepare(`
    SELECT * FROM jobs WHERE ${where.join(' AND ')}
    ORDER BY ${order}, COALESCE(posted_at, first_seen) DESC LIMIT :limit
  `).all(params).map(rowToJob);
}

export function setStatus(id, status) {
  return db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, id).changes > 0;
}

export function counts() {
  return Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all().map((r) => [r.status, r.n]));
}

export function pendingNotifications({ minScore, maxAgeHours, sinceIso }) {
  const cutoff = new Date(Date.now() - maxAgeHours * 3.6e6).toISOString();
  return db.prepare(`
    SELECT * FROM jobs
    WHERE notified = 0 AND status = 'new' AND region_ok = 1 AND score >= ?
      AND first_seen >= ? AND COALESCE(posted_at, first_seen) >= ?
    ORDER BY score DESC
  `).all(minScore, sinceIso, cutoff).map(rowToJob);
}

export function markNotified(ids) {
  const stmt = db.prepare('UPDATE jobs SET notified = 1 WHERE id = ?');
  for (const id of ids) stmt.run(id);
}

/** Everything first seen before `sinceIso` that never got sent stays silent. */
export function silenceOlderThan(sinceIso) {
  db.prepare('UPDATE jobs SET notified = 1 WHERE notified = 0 AND first_seen < ?').run(sinceIso);
}
