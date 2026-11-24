import { pathToFileURL } from 'node:url';
import { loadConfig, loadEnv } from './util.js';
import { SOURCES } from './sources.js';
import { scoreJob } from './score.js';
import { initDb, pool, upsertJob, getMeta, setMeta, pendingNotifications, markNotified, silenceIneligible, silenceAll, aiCandidates, saveAiScore, getJob, deleteStaleJobs } from './db.js';
import { telegramConfigured, sendTelegram, formatJob, formatDigest } from './telegram.js';
import { getTelegramSettings, inQuietHours } from './settings.js';
import { notifyUsers, channelDigest } from './telegram-users.js';
import { aiConfigured, scoreJobs } from './ai.js';

// The scan in progress, if any: a second request waits for it instead of starting another.
let current = null;

/** Public link to the JobRadar page, used in Telegram messages. */
export function appUrl(config) {
  return (process.env.PUBLIC_URL || `http://localhost:${config.port}`).replace(/\/+$/, '');
}

/** Lets Gemini judge the best keyword matches that it has not seen yet. */
export async function aiScorePending(config, limit = config.ai.maxPerRun) {
  if (!aiConfigured()) return { scored: 0 };
  const jobs = await aiCandidates({ minScore: config.ai.minKeywordScore, limit });
  let scored = 0;
  for (let i = 0; i < jobs.length; i += config.ai.batchSize) {
    const batch = jobs.slice(i, i + config.ai.batchSize);
    try {
      for (const r of await scoreJobs(batch)) {
        await saveAiScore(r.id, r);
        scored++;
      }
    } catch (err) {
      console.error(`[ai] ${err.message}`);
      await setMeta('aiStatus', { at: new Date().toISOString(), ok: false, error: err.message });
      return { scored, error: err.message };
    }
  }
  await setMeta('aiStatus', { at: new Date().toISOString(), ok: true, scored });
  if (jobs.length) console.log(`[ai] scored ${scored} of ${jobs.length} jobs`);
  return { scored };
}

/** Scores one job on request. A job that already has an AI score keeps it: no new Gemini call. */
export async function aiScoreOne(id) {
  const job = await getJob(id);
  if (!job || job.ai_checked_at) return job;
  const [r] = await scoreJobs([job]);
  if (r) await saveAiScore(id, r);
  return getJob(id);
}

/**
 * Jobs ready to go to Telegram. With AI on, Gemini has the final say: a job it
 * rated low (or as a likely scam) is `rejected`; one it has not read yet is in
 * neither list and waits for a later scan. With AI off (or failing this time),
 * the keyword score decides.
 */
export async function telegramQueue(config, { aiOk = aiConfigured() } = {}) {
  const tg = config.telegram;
  const pending = await pendingNotifications({ minScore: tg.minScore, maxAgeHours: tg.maxAgeHours });
  if (!aiOk) return { sendable: pending, rejected: [] };
  const rejected = pending.filter((j) => j.ai_score != null && (j.ai_score < config.ai.notifyMinFit || j.ai_scam === 'high'));
  const sendable = pending
    .filter((j) => j.ai_score != null && !rejected.includes(j))
    .sort((a, b) => b.ai_score - a.ai_score);
  return { sendable, rejected };
}

/** Fetches every source that is due, saves and scores jobs, then notifies. */
export function runOnce({ force = false } = {}) {
  current ??= scan({ force }).finally(() => { current = null; });
  return current;
}

export function scanRunning() {
  return Boolean(current);
}

async function scan({ force }) {
  {
    loadEnv();
    const config = loadConfig();
    const startedAt = new Date().toISOString();
    const status = (await getMeta('sourceStatus')) ?? {};
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
          if (await upsertJob(job, startedAt)) fresh++;
        }
        newCount += fresh;
        status[name] = { lastAttempt: new Date().toISOString(), ok: true, fetched: jobs.length, fresh, ms: Date.now() - t0 };
        console.log(`[${name}] ${jobs.length} jobs, ${fresh} new`);
      } catch (err) {
        status[name] = { ...status[name], lastAttempt: new Date().toISOString(), ok: false, error: err.message };
        console.error(`[${name}] failed: ${err.message}`);
      }
      await setMeta('sourceStatus', status);
    }

    // A job gets a Telegram decision once: sent, or settled as not worth sending.
    // Until then it stays pending and is looked at again on every scan, for as
    // long as it is recent enough (telegram.maxAgeHours).
    const tg = config.telegram;
    if (telegramConfigured()) await silenceIneligible({ minScore: tg.minScore, maxAgeHours: tg.maxAgeHours });

    // Pending jobs are first in line for Gemini (see aiCandidates).
    const ai = await aiScorePending(config);

    let sent = 0;
    if (telegramConfigured()) {
      const { sendable, rejected } = await telegramQueue(config, { aiOk: aiConfigured() && !ai.error });
      await markNotified(rejected.map((j) => j.id));
      const settings = await getTelegramSettings();
      if (inQuietHours(settings)) {
        // Quiet hours: send nothing, keep the jobs pending for the morning list.
        if (sendable.length) {
          await setMeta('telegramHeld', true);
          console.log(`[telegram] quiet hours (${settings.quietStart}–${settings.quietEnd}): holding ${sendable.length} jobs for the morning list`);
        }
      } else if (await getMeta('telegramHeld')) {
        // First scan after quiet hours: everything held (and anything new) goes out as one list.
        if (sendable.length) {
          try {
            await sendTelegram(formatDigest(sendable, appUrl(config)));
            await markNotified(sendable.map((j) => j.id));
            sent = sendable.length;
            await setMeta('telegramHeld', false);
          } catch (err) {
            console.error(`[telegram] morning list not sent, will retry next scan: ${err.message}`);
          }
        } else {
          await setMeta('telegramHeld', false); // what was held got hidden, or is too old now
        }
      } else {
        sent = await sendOneByOne(sendable, config);
      }
    } else {
      await silenceAll();
    }
    // App users: personal alerts (trial/Pro) and the public channel's daily digest.
    try {
      const u = await notifyUsers(config, appUrl(config));
      if (u.sent) console.log(`[telegram] ${u.sent} personal alerts to app users`);
      if (await channelDigest(config, appUrl(config))) console.log('[telegram] daily digest posted to the channel');
    } catch (err) {
      console.error(`[telegram] app-user alerts failed: ${err.message}`);
    }
    const deleted = await deleteStaleJobs(config.retentionDays ?? 60);
    if (deleted) console.log(`Deleted ${deleted} jobs no source has listed for ${config.retentionDays ?? 60} days`);
    await setMeta('lastRun', { at: startedAt, newCount, sent });
    console.log(`Done: ${newCount} new jobs, ${sent} sent to Telegram${telegramConfigured() ? '' : ' (Telegram not configured)'}`);
    return { newCount, sent };
  }
}

/** One message per job, at most telegram.maxPerRun, then a line saying how many more there are. */
async function sendOneByOne(jobs, config) {
  const batch = jobs.slice(0, config.telegram.maxPerRun);
  let sent = 0;
  for (const job of batch) {
    try {
      await sendTelegram(formatJob(job, appUrl(config)));
      await markNotified([job.id]);
      sent++;
      await new Promise((r) => setTimeout(r, 1100)); // Telegram: ~1 msg/s per chat
    } catch (err) {
      // Only what was actually sent is marked: the rest is tried again next scan.
      console.error(`[telegram] ${err.message}`);
      return sent;
    }
  }
  const rest = jobs.slice(batch.length);
  if (rest.length) {
    try {
      await sendTelegram(`…và còn <b>${rest.length}</b> job phù hợp khác. Xem tại ${appUrl(config)}`);
      await markNotified(rest.map((j) => j.id));
    } catch (err) {
      console.error(`[telegram] ${err.message}`);
    }
  }
  return sent;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  initDb()
    .then(() => runOnce({ force: process.argv.includes('--force') }))
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
