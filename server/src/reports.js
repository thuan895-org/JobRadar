// Job reports from users, admin decisions on jobs, and the numbers the admin
// pages show (sources, AI usage).
import { randomUUID } from 'node:crypto';
import { q, getMeta } from './db.js';
import { loadConfig } from './util.js';

export const REPORT_KINDS = ['scam', 'expired', 'wrong', 'verify'];
const now = () => new Date().toISOString();

/** One open report per user and job; a second one updates the note. */
export async function addReport(userId, jobId, kind, note) {
  const { rows } = await q(`SELECT id FROM job_reports WHERE user_id = $1 AND job_id = $2 AND status = 'open'`, [userId, jobId]);
  if (rows[0]) {
    await q('UPDATE job_reports SET kind = $2, note = $3 WHERE id = $1', [rows[0].id, kind, note]);
    return rows[0].id;
  }
  const id = randomUUID();
  await q('INSERT INTO job_reports (id, job_id, user_id, kind, note, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [id, jobId, userId, kind, note, now()]);
  return id;
}

export async function listReports(status = 'open') {
  const { rows } = await q(`
    SELECT r.*, j.title, j.url, j.source, j.company, j.flag, u.email AS reporter,
      (SELECT COUNT(*)::int FROM job_reports r2 WHERE r2.job_id = r.job_id AND r2.status = 'open') AS open_on_job
    FROM job_reports r JOIN jobs j ON j.id = r.job_id LEFT JOIN users u ON u.id = r.user_id
    WHERE ($1 = 'all' OR r.status = $1) ORDER BY r.created_at DESC LIMIT 300
  `, [status]);
  return rows;
}

/**
 * Admin decision on a report: 'scam' hides the job from every feed and alert,
 * 'verified' gives it a badge, 'dismiss' closes the report. A decision on a
 * job closes all its open reports.
 */
export async function resolveReport(reportId, action, adminEmail) {
  const { rows } = await q('SELECT job_id FROM job_reports WHERE id = $1', [reportId]);
  if (!rows[0]) return false;
  const jobId = rows[0].job_id;
  if (action === 'scam' || action === 'verified') await q('UPDATE jobs SET flag = $2 WHERE id = $1', [jobId, action]);
  if (action === 'unflag') await q('UPDATE jobs SET flag = NULL WHERE id = $1', [jobId]);
  const status = action === 'dismiss' ? 'dismissed' : 'resolved';
  await q(`UPDATE job_reports SET status = $2, resolution = $3, resolved_at = $4 WHERE job_id = $1 AND status = 'open'`,
    [jobId, status, `${action} by ${adminEmail}`, now()]);
  return true;
}

/** Each source: last fetch result (from the scanner) and how many jobs it gave. */
export async function sourceStats() {
  const status = (await getMeta('sourceStatus')) ?? {};
  const config = loadConfig();
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  const { rows } = await q(`SELECT source, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE first_seen >= $1)::int AS last_day FROM jobs GROUP BY source`, [dayAgo]);
  const counts = new Map(rows.map((r) => [r.source, r]));
  const names = { freelancer: 'Freelancer.com', remotive: 'Remotive', remoteok: 'Remote OK', himalayas: 'Himalayas', himalayasVietnam: 'Himalayas', jobicy: 'Jobicy', weworkremotely: 'We Work Remotely' };
  return Object.keys(config.sources).map((key) => {
    const s = status[key] ?? {};
    const c = counts.get(names[key] ?? key) ?? {};
    return { key, name: names[key] ?? key, enabled: config.sources[key].enabled, minIntervalMinutes: config.sources[key].minIntervalMinutes,
      lastAttempt: s.lastAttempt ?? null, ok: s.ok ?? null, error: s.error ?? null, fetched: s.fetched ?? null, fresh: s.fresh ?? null, ms: s.ms ?? null,
      jobsTotal: c.total ?? 0, jobsLastDay: c.last_day ?? 0 };
  });
}

/**
 * Token use over the last 1, 7 and 30 days, by kind, by model and top users.
 * Cost is shown only when config.ai.pricing has USD per million tokens for the model.
 */
export async function aiUsageStats() {
  const pricing = loadConfig().ai.pricing ?? {};
  const since = (d) => new Date(Date.now() - d * 864e5).toISOString();
  const cost = (model, inT, outT) => {
    const p = pricing[model];
    return p ? (inT * p.input + outT * p.output) / 1e6 : null;
  };
  const periods = {};
  for (const [label, d] of [['day', 1], ['week', 7], ['month', 30]]) {
    const { rows } = await q(`SELECT model, kind, COUNT(*)::int AS calls, SUM(input_tokens)::int AS input, SUM(output_tokens)::int AS output
      FROM ai_usage WHERE at >= $1 GROUP BY model, kind`, [since(d)]);
    const byKind = {};
    let total = { calls: 0, input: 0, output: 0, costUsd: 0, costKnown: true };
    for (const r of rows) {
      const k = (byKind[r.kind] ??= { calls: 0, input: 0, output: 0 });
      k.calls += r.calls; k.input += r.input; k.output += r.output;
      total.calls += r.calls; total.input += r.input; total.output += r.output;
      const c = cost(r.model, r.input, r.output);
      if (c == null) total.costKnown = false; else total.costUsd += c;
    }
    periods[label] = { total, byKind };
  }
  const { rows: byModel } = await q(`SELECT model, COUNT(*)::int AS calls, SUM(input_tokens)::int AS input, SUM(output_tokens)::int AS output
    FROM ai_usage WHERE at >= $1 GROUP BY model ORDER BY calls DESC`, [since(30)]);
  const { rows: topUsers } = await q(`SELECT u.email, COUNT(*)::int AS calls, SUM(a.input_tokens + a.output_tokens)::int AS tokens
    FROM ai_usage a JOIN users u ON u.id = a.user_id WHERE a.at >= $1 GROUP BY u.email ORDER BY tokens DESC LIMIT 10`, [since(30)]);
  return { periods, byModel: byModel.map((m) => ({ ...m, costUsd: cost(m.model, m.input, m.output) })), topUsers, pricingSet: Object.keys(pricing).length > 0 };
}
