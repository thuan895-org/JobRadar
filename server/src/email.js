// Sends account emails (verify address, reset password) through Resend's API.
// Without RESEND_API_KEY nothing is sent; on a local run the link is printed
// so the flow can still be tried.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function layout(title, body, button, link) {
  return `<!doctype html><html lang="vi"><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2330">
<div style="max-width:480px;margin:32px auto;background:#fff;border:1px solid #e3e6ec;border-radius:12px;padding:28px">
<div style="font-weight:700;font-size:18px;margin-bottom:16px">📡 JobRadar</div>
<h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
<p style="line-height:1.6;color:#444">${body}</p>
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#2f6fed;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">${esc(button)}</a></p>
<p style="font-size:13px;color:#677085;line-height:1.5">Nếu nút không bấm được, mở liên kết này:<br><span style="word-break:break-all">${esc(link)}</span></p>
<p style="font-size:13px;color:#677085">Nếu bạn không yêu cầu việc này, hãy bỏ qua email.</p>
</div></body></html>`;
}

async function sendEmail({ to, subject, html, link, isLocal }) {
  if (!emailConfigured()) {
    if (isLocal) console.log(`[email] not configured; link for ${to}: ${link}`);
    else console.log(`[email] not configured (RESEND_API_KEY / EMAIL_FROM): "${subject}" not sent`);
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error(`[email] Resend refused "${subject}" (HTTP ${res.status}: ${body.message ?? 'unknown error'})`);
    return false;
  }
  return true;
}

export function sendVerifyEmail(to, link, isLocal) {
  return sendEmail({
    to, link, isLocal,
    subject: 'Xác minh email cho tài khoản JobRadar',
    html: layout('Xác minh địa chỉ email', 'Bấm nút bên dưới để xác minh email của bạn. Liên kết có hiệu lực trong 48 giờ.', 'Xác minh email', link),
  });
}

export function sendResetEmail(to, link, isLocal) {
  return sendEmail({
    to, link, isLocal,
    subject: 'Đặt lại mật khẩu JobRadar',
    html: layout('Đặt lại mật khẩu', 'Bấm nút bên dưới để đặt mật khẩu mới. Liên kết có hiệu lực trong 1 giờ và chỉ dùng được một lần.', 'Đặt mật khẩu mới', link),
  });
}
