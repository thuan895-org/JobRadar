import { createHash } from 'node:crypto';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export async function sendTelegram(html, chatId = process.env.TELEGRAM_CHAT_ID) {
  return callTelegram('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true });
}

async function callTelegram(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    // Never echo the URL: it contains the bot token.
    const err = new Error(`Telegram refused ${method} (HTTP ${res.status}: ${body.description ?? 'unknown error'})`);
    err.status = res.status;
    err.description = body.description ?? '';
    throw err;
  }
  return body.result;
}

/** Turns a Telegram error into what to fix, in Vietnamese, for the page. */
export function explainTelegramError(err) {
  const d = err.description ?? '';
  if (err.status === 401 || err.status === 404) return 'Token bot sai (TELEGRAM_BOT_TOKEN). Lấy lại token ở @BotFather.';
  if (/chat not found/i.test(d)) return 'Không tìm thấy chat: TELEGRAM_CHAT_ID sai. Nhắn /start cho bot, bot sẽ trả lời chat id đúng.';
  if (/blocked by the user/i.test(d)) return 'Bạn đã chặn bot. Mở bot trong Telegram, bấm Restart (hoặc Start) rồi thử lại.';
  if (/can't initiate/i.test(d)) return 'Bot chưa được phép nhắn cho bạn. Mở bot trong Telegram và nhắn /start trước.';
  if (err.status === 429) return 'Telegram đang giới hạn tốc độ gửi. Thử lại sau ít phút.';
  return err.message;
}

/**
 * The list sent after quiet hours: every held job on one line or two, best
 * first. Stays well under Telegram's 4096-character limit; the rest is counted.
 */
export function formatDigest(jobs, appUrl, max = 20) {
  const lines = [`☀️ <b>Bản tin đầu ngày: ${jobs.length} job phù hợp</b> tìm được trong giờ nghỉ`, ''];
  let shown = 0;
  for (const job of jobs.slice(0, max)) {
    const facts = [esc(job.source), job.budget_text && `💰 ${esc(job.budget_text)}`, job.ai_score != null ? `🤖 ${job.ai_score}` : `⭐ ${job.score}`].filter(Boolean).join(' · ');
    const reason = job.ai_reason ? `\n💡 ${esc(job.ai_reason.length > 100 ? `${job.ai_reason.slice(0, 99)}…` : job.ai_reason)}` : '';
    const entry = `${shown + 1}. <a href="${esc(job.url)}">${esc(job.title)}</a>\n${facts}${reason}\n`;
    if (lines.join('\n').length + entry.length > 3500) break;
    lines.push(entry);
    shown++;
  }
  if (jobs.length > shown) lines.push(`…và còn <b>${jobs.length - shown}</b> job khác.`);
  lines.push(`Xem tất cả: ${esc(appUrl)}`);
  return lines.join('\n');
}

// ---- Replies to /start (Telegram calls our webhook) ----

/** Telegram sends this back in a header on every webhook call; derived from the token, so no extra setting. */
export function webhookSecret() {
  return createHash('sha256').update(`jobradar-telegram-webhook:${process.env.TELEGRAM_BOT_TOKEN ?? ''}`).digest('hex');
}

/** Points the bot at /api/telegram/webhook. Telegram only accepts https, so local runs skip it. */
export async function setupWebhook(appUrl) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return 'off (no TELEGRAM_BOT_TOKEN)';
  if (!/^https:\/\//.test(appUrl)) return 'off (needs PUBLIC_URL starting with https://)';
  try {
    await callTelegram('setWebhook', { url: `${appUrl}/api/telegram/webhook`, secret_token: webhookSecret(), allowed_updates: ['message'] });
    return 'on (webhook)';
  } catch (err) {
    return `failed: ${err.message}`;
  }
}

/** Answers a message sent to the bot. The bot only sends job alerts, so this just confirms the connection. */
/** The bot's @username, for t.me links. Asked once, then cached. */
let botUsername = null;
export async function getBotUsername() {
  if (botUsername || !process.env.TELEGRAM_BOT_TOKEN) return botUsername;
  try {
    botUsername = (await callTelegram('getMe', {})).username ?? null;
  } catch (err) {
    console.error(`[telegram] getMe failed: ${err.message}`);
  }
  return botUsername;
}

/**
 * Answers a message sent to the bot. "/start <code>" comes from the link on
 * the app's Telegram page and connects this chat to that account.
 * `linkAccount(code, chatId)` returns the account's email, or null.
 */
export async function handleUpdate(update, appUrl, linkAccount = async () => null) {
  const msg = update?.message;
  if (!msg?.chat || typeof msg.text !== 'string') return;
  const chatId = String(msg.chat.id);
  const [first, payload] = msg.text.trim().split(/\s+/);
  const command = first.split('@')[0].toLowerCase();
  if (command === '/start' && payload) {
    const email = msg.chat.type === 'private' ? await linkAccount(payload, chatId) : null;
    await sendTelegram(email
      ? `✅ <b>Đã liên kết với tài khoản ${esc(email)}.</b>\n\nTừ giờ JobRadar sẽ gửi vào đây những job mới hợp với hồ sơ của bạn. Đổi giờ nghỉ hoặc huỷ liên kết trong mục Telegram của ứng dụng: ${esc(appUrl)}/app/telegram`
      : '⚠️ Liên kết không hợp lệ hoặc đã hết hạn (hiệu lực 15 phút). Mở lại mục Telegram trong ứng dụng JobRadar và bấm "Liên kết Telegram".', chatId);
    return;
  }
  const isOwner = chatId === String(process.env.TELEGRAM_CHAT_ID ?? '');
  if (['/start', '/id', '/help'].includes(command)) {
    const text = isOwner
      ? ['👋 <b>JobRadar đã kết nối với chat này.</b>',
          'Sau mỗi lượt quét, bot sẽ gửi vào đây những job mới phù hợp với bạn. Không có job mới phù hợp thì bot im lặng.',
          `Xem tất cả job: ${esc(appUrl)}`].join('\n\n')
      : ['👋 Chào bạn!',
          `Chat id của bạn là: <code>${esc(chatId)}</code>`,
          `Để nhận job ở chat này, đặt <code>TELEGRAM_CHAT_ID=${esc(chatId)}</code> trong file .env (hoặc phần Environment trên Render) rồi khởi động lại JobRadar.`].join('\n\n');
    await sendTelegram(text, chatId);
  } else if (isOwner) {
    await sendTelegram('Bot này chỉ gửi thông báo job. Gõ /start để kiểm tra kết nối.', chatId);
  }
  // Anyone else who writes to the bot gets no answer except to /start.
}

export function formatJob(job, appUrl) {
  const lines = [
    `<b>${esc(job.title)}</b>`,
    [job.source, job.company].filter(Boolean).map(esc).join(' · '),
  ];
  const facts = [
    job.budget_text && `💰 ${esc(job.budget_text)}`,
    job.bid_count != null && `👥 ${job.bid_count} bid`,
    job.ai_score != null ? `🤖 ${job.ai_score}/100` : `⭐ ${job.score}`,
  ].filter(Boolean);
  lines.push(facts.join('   '));
  if (job.matched.length) lines.push(`🏷 ${esc(job.matched.join(', '))}`);
  if (job.ai_reason) lines.push(`💡 ${esc(job.ai_reason)}`);
  if (job.ai_flags?.length) lines.push(`⚠️ ${esc(job.ai_flags.join('; '))}`);
  const snippet = (job.description || '').replace(/\s+/g, ' ').slice(0, 220);
  if (snippet) lines.push(`<i>${esc(snippet)}…</i>`);
  lines.push(`<a href="${esc(job.url)}">Mở job</a> · <a href="${esc(appUrl)}">JobRadar</a>`);
  return lines.join('\n');
}
