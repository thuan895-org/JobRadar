const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export async function sendTelegram(html) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    // Never echo the URL: it contains the bot token.
    const body = await res.json().catch(() => ({}));
    throw new Error(`Telegram refused the message (HTTP ${res.status}: ${body.description ?? 'unknown error'})`);
  }
}

export function formatJob(job, port) {
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
  lines.push(`<a href="${esc(job.url)}">Mở job</a> · <a href="http://localhost:${port}">JobRadar</a>`);
  return lines.join('\n');
}
