// Telegram for app users: linking a chat to an account, personal alerts for
// trial and Pro users (with their own quiet hours), and a daily digest in a
// public channel for everyone (TELEGRAM_CHANNEL_ID, e.g. @jobradar_vn).
import { q, getMeta, setMeta } from './db.js';
import { createToken, useToken, findUserById, hasPro } from './accounts.js';
import { getProfile, scoringConfig, scoreRow, CATALOG } from './profiles.js';
import { sendTelegram, formatJob, formatDigest, telegramConfigured, getBotUsername } from './telegram.js';
import { inQuietHours, localTime, TELEGRAM_DEFAULTS } from './settings.js';
import { scoreJob } from './score.js';

const LINK_MINUTES = 15;
const MAX_PER_USER = 5; // one message each; the rest goes into a "…and N more" line
const now = () => new Date().toISOString();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const userTelegramSettings = (u) => ({ ...TELEGRAM_DEFAULTS, minScore: 20, ...(u.telegram_settings ?? {}) });

/** A t.me link that opens the bot with a one-time code for this account. */
export async function telegramLink(user) {
  const username = await getBotUsername();
  if (!username) return null;
  const code = await createToken(user.id, 'telegram', LINK_MINUTES);
  return { url: `https://t.me/${username}?start=${code}`, expiresInMinutes: LINK_MINUTES };
}

/** Called by the webhook for "/start <code>". Returns the account email, or null. */
export async function linkChat(code, chatId) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(code)) return null;
  const userId = await useToken(code, 'telegram');
  if (!userId) return null;
  await q('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = $1', [chatId]); // one account per chat
  await q('UPDATE users SET telegram_chat_id = $2, telegram_linked_at = $3 WHERE id = $1', [userId, chatId, now()]);
  return (await findUserById(userId))?.email ?? null;
}

export async function unlinkChat(userId) {
  await q('UPDATE users SET telegram_chat_id = NULL, telegram_linked_at = NULL WHERE id = $1', [userId]);
}

export async function saveUserTelegramSettings(userId, settings) {
  await q('UPDATE users SET telegram_settings = $2 WHERE id = $1', [userId, JSON.stringify(settings)]);
}

async function markUserNotified(userId, jobIds) {
  for (const jobId of jobIds) {
    await q(`INSERT INTO user_jobs (user_id, job_id, notified, updated_at) VALUES ($1, $2, TRUE, $3)
      ON CONFLICT (user_id, job_id) DO UPDATE SET notified = TRUE`, [userId, jobId, now()]);
  }
}

/** Jobs this user has not been told about yet, posted within maxAgeHours and after they linked Telegram, best first. */
async function pendingForUser(user, config) {
  const s = userTelegramSettings(user);
  const since = new Date(Math.max(Date.now() - config.telegram.maxAgeHours * 3.6e6, Date.parse(user.telegram_linked_at) || 0)).toISOString();
  const { rows } = await q(`
    SELECT j.*, uj.status AS my_status FROM jobs j LEFT JOIN user_jobs uj ON uj.job_id = j.id AND uj.user_id = $1
    WHERE j.first_seen >= $2 AND COALESCE(j.posted_at, j.first_seen) >= $3 AND NOT COALESCE(uj.notified, FALSE) AND j.flag IS DISTINCT FROM 'scam'
  `, [user.id, since, new Date(Date.now() - config.telegram.maxAgeHours * 3.6e6).toISOString()]);
  const profile = await getProfile(user.id);
  const scoring = scoringConfig(profile, config);
  if (!scoring.skills.length) return [];
  return rows
    .filter((r) => (r.my_status ?? 'new') === 'new')
    .map((r) => { const s2 = scoreRow(r, scoring); return { ...r, tags: r.tags ?? [], score: s2.score, matched: s2.matched, regionOk: s2.regionOk }; })
    .filter((j) => j.score >= s.minScore && (!profile.region_only || j.regionOk))
    .sort((a, b) => b.score - a.score);
}

/** After a scan: personal alerts for every linked trial/Pro user. Quiet hours hold jobs for a morning list. */
export async function notifyUsers(config, appUrl) {
  if (!telegramConfigured() && !process.env.TELEGRAM_BOT_TOKEN) return { users: 0, sent: 0 };
  const { rows: users } = await q('SELECT * FROM users WHERE telegram_chat_id IS NOT NULL');
  let sent = 0;
  for (const user of users) {
    if (!hasPro(user)) continue;
    try {
      const jobs = await pendingForUser(user, config);
      const s = userTelegramSettings(user);
      if (inQuietHours(s)) {
        if (jobs.length && !s.held) await saveUserTelegramSettings(user.id, { ...s, held: true });
        continue;
      }
      if (s.held) {
        if (jobs.length) {
          await sendTelegram(formatDigest(jobs, `${appUrl}/app/`), user.telegram_chat_id);
          await markUserNotified(user.id, jobs.map((j) => j.id));
          sent += jobs.length;
        }
        await saveUserTelegramSettings(user.id, { ...s, held: false });
        continue;
      }
      for (const job of jobs.slice(0, MAX_PER_USER)) {
        await sendTelegram(formatJob(job, `${appUrl}/app/`), user.telegram_chat_id);
        await markUserNotified(user.id, [job.id]);
        sent++;
        await wait(1100);
      }
      const rest = jobs.slice(MAX_PER_USER);
      if (rest.length) {
        await sendTelegram(`…và còn <b>${rest.length}</b> job phù hợp khác. Xem tại ${appUrl}/app/`, user.telegram_chat_id);
        await markUserNotified(user.id, rest.map((j) => j.id));
      }
    } catch (err) {
      // A blocked bot or a deleted chat must not stop the others; unsent jobs are retried next scan.
      console.error(`[telegram] alerts for one user failed: ${err.message}`);
      if (/blocked by the user|chat not found/i.test(err.description ?? '')) await unlinkChat(user.id);
    }
  }
  return { users: users.length, sent };
}

/** Which catalogue group a job belongs to, for the channel digest headings. */
function categoryOf(job, config) {
  let best = null;
  for (const c of CATALOG) {
    const { score } = scoreJob({ title: job.title, tags: job.tags, description: job.description, location: job.location },
      { ...config, skills: [{ label: c.label, weight: 10, terms: c.terms, ...(c.requireAny ? { requireAny: c.requireAny } : {}) }], excludeTitleTerms: [] });
    if (score > 0 && (!best || score > best.score)) best = { label: c.label, score };
  }
  return best?.label ?? 'Khác';
}

/**
 * Once a day, after CHANNEL_DIGEST_HOUR (Vietnam time), the public channel gets
 * the day's best jobs open to Vietnam, grouped by field, with a link to sign up.
 */
export async function channelDigest(config, appUrl, at = new Date()) {
  const channel = process.env.TELEGRAM_CHANNEL_ID;
  if (!channel || !process.env.TELEGRAM_BOT_TOKEN) return false;
  const tz = 'Asia/Ho_Chi_Minh';
  const hour = Number(process.env.CHANNEL_DIGEST_HOUR ?? 8);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(at);
  if (Number(localTime(at, tz).slice(0, 2)) < hour || (await getMeta('channelDigestDay')) === today) return false;
  const since = new Date(at.getTime() - 24 * 3.6e6).toISOString();
  const { rows } = await q(`SELECT * FROM jobs WHERE region_ok AND first_seen >= $1 AND flag IS DISTINCT FROM 'scam' ORDER BY first_seen DESC LIMIT 400`, [since]);
  const picked = rows
    .map((r) => ({ ...r, tags: r.tags ?? [], category: categoryOf(r, config) }))
    .filter((j) => j.category !== 'Khác')
    .map((j) => ({ ...j, rank: (j.language === 'vi' ? 3 : 0) + (j.budget_text ? 1 : 0) + (j.bid_count != null && j.bid_count < 15 ? 1 : 0) }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 15);
  await setMeta('channelDigestDay', today);
  if (!picked.length) return false;
  const groups = new Map();
  for (const j of picked) groups.set(j.category, [...(groups.get(j.category) ?? []), j]);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = [`📋 <b>Job remote nhận người Việt hôm nay</b> (${picked.length} job)`, ''];
  for (const [cat, jobs] of groups) {
    lines.push(`<b>${esc(cat)}</b>`);
    for (const j of jobs) lines.push(`• <a href="${esc(j.url)}">${esc(j.title)}</a>${j.budget_text ? ` · ${esc(j.budget_text)}` : ''}`);
    lines.push('');
  }
  lines.push(`🔎 Xem job hợp với kỹ năng của bạn, kèm tóm tắt tiếng Việt và AI soạn hồ sơ: ${esc(appUrl)}/app/signup`);
  await sendTelegram(lines.join('\n'), channel);
  return true;
}
