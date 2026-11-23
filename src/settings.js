// Settings changed from the page. They live in the database (meta table), not
// in config.json, because the online server keeps no files between deploys.
import { getMeta, setMeta } from './db.js';

// Quiet hours: no Telegram messages between quietStart and quietEnd (local
// time in `timezone`). Jobs found then are held and sent as one list on the
// first scan after quietEnd.
export const TELEGRAM_DEFAULTS = { quietEnabled: true, quietStart: '00:00', quietEnd: '06:00', timezone: 'Asia/Ho_Chi_Minh' };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function getTelegramSettings() {
  return { ...TELEGRAM_DEFAULTS, ...((await getMeta('telegramSettings')) ?? {}) };
}

/** Checks and saves what the page sent. Throws a Vietnamese message the page can show. */
export async function saveTelegramSettings(input) {
  const s = {
    quietEnabled: Boolean(input.quietEnabled),
    quietStart: String(input.quietStart ?? ''),
    quietEnd: String(input.quietEnd ?? ''),
    timezone: String(input.timezone ?? TELEGRAM_DEFAULTS.timezone),
  };
  if (!TIME.test(s.quietStart) || !TIME.test(s.quietEnd)) throw new Error('Giờ phải có dạng HH:MM, ví dụ 00:00.');
  if (s.quietEnabled && s.quietStart === s.quietEnd) throw new Error('Giờ bắt đầu và giờ kết thúc phải khác nhau.');
  if (!validTimezone(s.timezone)) throw new Error(`Múi giờ không hợp lệ: ${s.timezone}`);
  await setMeta('telegramSettings', s);
  return s;
}

/** "HH:MM" of `date` in `timezone`. */
export function localTime(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('hour')}:${get('minute')}`;
}

/** True while `date` falls in the quiet window. A window like 22:00–06:00 runs past midnight. */
export function inQuietHours(settings, date = new Date()) {
  const { quietEnabled, quietStart, quietEnd, timezone } = settings;
  if (!quietEnabled || quietStart === quietEnd) return false;
  const now = localTime(date, timezone);
  return quietStart < quietEnd
    ? now >= quietStart && now < quietEnd
    : now >= quietStart || now < quietEnd;
}
