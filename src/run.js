import { pathToFileURL } from 'node:url';
import { loadConfig, loadEnv } from './util.js';
import { SOURCES } from './sources.js';
import { scoreJob } from './score.js';
import { upsertJob, getMeta, setMeta, pendingNotifications, markNotified, silenceOlderThan, aiCandidates, saveAiScore, getJob } from './db.js';
import { telegramConfigured, sendTelegram, formatJob } from './telegram.js';
import { aiConfigured, scoreJobs } from './ai.js';

let running = false;

/** Lets Gemini judge the best keyword matches that it has not seen yet. */
export async function aiScorePending(config, limit = config.ai.maxPerRun) {
  if (!aiConfigured()) return { scored: 0 };
  const jobs = aiCandidates({ minScore: config.ai.minKeywordScore, limit });
  let scored = 0;
  for (let i = 0; i < jobs.length; i += config.ai.batchSize) {
    const batch = jobs.slice(i, i + config.ai.batchSize);
    try {
      for (const r of await scoreJobs(batch)) {
        saveAiScore(r.id, r);
        scored++;
      }
    } catch (err) {
      console.error(`[ai] ${err.message}`);
      setMeta('aiStatus', { at: new Date().toISOString(), ok: false, error: err.message });
      return { scored, error: err.message };
    }
  }
  setMeta('aiStatus', { at: new Date().toISOString(), ok: true, scored });
  if (jobs.length) console.log(`[ai] scored ${scored} of ${jobs.length} jobs`);
  return { scored };
}

export async function aiScoreOne(id) {
  const job = getJob(id);
  if (!job) return null;
  const [r] = await scoreJobs([job]);
  if (r) saveAiScore(id, r);
  return getJob(id);
}

/** Fetches every source that is due, saves and scores jobs, then notifies. */
export async function runOnce({ force = false } = {}) {
  if (running) return { skipped: true };
  running = true;
  try {
    loadEnv();
    const config = loadConfig();
    const startedAt = new Date().toISOString();
    const status = getMeta('sourceStatus') ?? {};
    let newCount = 0;

    for (const [name, fetcher] of Object.entries(SOURCES)) {
      const cfg = config.sources[name];
      if (!cfg?.enabled) continue;
      const last = status[name]?.lastAttempt;
      if (!force && last && Date.now() - Date.parse(last) < cfg.minIntervalMinutes * 60000) continue;
      const t0 = Date.now();
      try {
        const jobs = await fetcher(cfg, config);
        let fresh = 0;
        for (const job of jobs) {
          if (!job.title || !/^https?:\/\//i.test(job.url ?? '')) continue;
          Object.assign(job, scoreJob(job, config));
          if (upsertJob(job, startedAt)) fresh++;
        }
        newCount += fresh;
        status[name] = { lastAttempt: new Date().toISOString(), ok: true, fetched: jobs.length, fresh, ms: Date.now() - t0 };
        console.log(`[${name}] ${jobs.length} jobs, ${fresh} new`);
      } catch (err) {
        status[name] = { ...status[name], lastAttempt: new Date().toISOString(), ok: false, error: err.message };
        console.error(`[${name}] failed: ${err.message}`);
      }
      setMeta('sourceStatus', status);
    }

    const ai = await aiScorePending(config);

    // On the first run everything is new; maxPerRun keeps it to the best few.
    let sent = 0;
    if (telegramConfigured()) {
      let pending = pendingNotifications({ minScore: config.telegram.minScore, maxAgeHours: config.telegram.maxAgeHours, sinceIso: startedAt });
      // With AI on, only jobs Gemini rated well (and not as likely scams) are sent.
      if (aiConfigured() && !ai.error) {
        pending = pending
          .filter((j) => j.ai_score != null && j.ai_score >= config.ai.notifyMinFit && j.ai_scam !== 'high')
          .sort((a, b) => b.ai_score - a.ai_score);
      }
      const batch = pending.slice(0, config.telegram.maxPerRun);
      for (const job of batch) {
        try {
          await sendTelegram(formatJob(job, config.port));
          markNotified([job.id]);
          sent++;
          await new Promise((r) => setTimeout(r, 1100)); // Telegram: ~1 msg/s per chat
        } catch (err) {
          console.error(`[telegram] ${err.message}`);
          break;
        }
      }
      if (pending.length > batch.length) {
        await sendTelegram(`…và còn <b>${pending.length - batch.length}</b> job phù hợp khác. Xem tại http://localhost:${config.port}`).catch(() => {});
      }
      markNotified(pending.slice(batch.length).map((j) => j.id));
    }
    // Jobs the AI filter dropped stay silent; silenceOlderThan only covers older runs.
    if (telegramConfigured()) markNotified(pendingNotifications({ minScore: -999, maxAgeHours: 1e6, sinceIso: startedAt }).map((j) => j.id));
    silenceOlderThan(startedAt);
    setMeta('lastRun', { at: startedAt, newCount, sent });
    console.log(`Done: ${newCount} new jobs, ${sent} sent to Telegram${telegramConfigured() ? '' : ' (Telegram not configured)'}`);
    return { newCount, sent };
  } finally {
    running = false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOnce({ force: process.argv.includes('--force') }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
