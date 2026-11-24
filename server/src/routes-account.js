// Routes for accounts: sign up, log in (password or Google), email links,
// consent, and the user's own data (export, delete). Messages are Vietnamese
// because the apps show them as they are.
import { randomBytes, createHash } from 'node:crypto';
import {
  TERMS_VERSION, SESSION_DAYS, MIN_PASSWORD, normalizeEmail, validEmail, hashPassword, checkPassword,
  publicUser, findUserByEmail, findUserById, findUserByGoogle, createUser, updateUser, acceptTerms,
  deleteUser, listUsers, createSession, hasPro, userForSession, endSession, endAllSessions, createToken, useToken,
} from './accounts.js';
import { emailConfigured, sendVerifyEmail, sendResetEmail } from './email.js';
import { send, redirect, readJson, getCookie, cookie, clientIp, limiter } from './http.js';
import { addProDays, checkoutInfo, billingMode, listPayments, PRO_DAYS } from './billing.js';
import { telegramLink, unlinkChat, userTelegramSettings, saveUserTelegramSettings } from './telegram-users.js';
import { saveTelegramSettings as checkSettings } from './settings.js';
import { PRO_PRICE_VND } from './accounts.js';

const SESSION_COOKIE = 'jr_user';
const OAUTH_COOKIE = 'jr_oauth';
const perIp = limiter(30, 15 * 60000); // sign up, log in, forgot password
const perEmail = limiter(10, 15 * 60000); // wrong passwords for one account

const googleEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** The logged-in user (database row) or null. */
export async function currentUser(req) {
  return userForSession(getCookie(req, SESSION_COOKIE));
}

export async function requireUser(req, { consent = true } = {}) {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, 'Bạn cần đăng nhập.');
  if (consent && publicUser(user).needsConsent) throw new HttpError(403, 'consent_required');
  return user;
}

async function startSession(req, user) {
  const token = await createSession(user.id);
  return cookie(req, SESSION_COOKIE, token, SESSION_DAYS * 86400);
}

function checkNewPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new HttpError(400, `Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự.`);
  if (password.length > 200) throw new HttpError(400, 'Mật khẩu quá dài.');
}

function rateLimit(req) {
  if (!perIp.hit(clientIp(req))) throw new HttpError(429, 'Thử quá nhiều lần. Vui lòng đợi 15 phút.');
}

async function sendVerification(user, ctx) {
  const token = await createToken(user.id, 'verify', 48 * 60);
  return sendVerifyEmail(user.email, `${ctx.appUrl}/app/verify?token=${token}`, ctx.isLocal);
}

// ---- Google sign-in (OAuth 2.0 authorization code flow with PKCE) ----

const b64url = (buf) => buf.toString('base64url');

function googleStart(req, res, ctx) {
  if (!googleEnabled()) return redirect(res, '/app/login?error=google_off');
  const state = b64url(randomBytes(16));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${ctx.appUrl}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params}`, { 'Set-Cookie': cookie(req, OAUTH_COOKIE, `${state}.${verifier}`, 600) });
}

async function googleCallback(req, res, url, ctx) {
  const clear = cookie(req, OAUTH_COOKIE, '', 0);
  const fail = (why) => {
    console.error(`[google] sign-in failed: ${why}`);
    redirect(res, '/app/login?error=google', { 'Set-Cookie': clear });
  };
  const [state, verifier] = (getCookie(req, OAUTH_COOKIE) ?? '').split('.');
  if (!state || !verifier || url.searchParams.get('state') !== state) return fail('state mismatch');
  if (!url.searchParams.get('code')) return fail(url.searchParams.get('error') ?? 'no code');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code'),
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${ctx.appUrl}/api/auth/google/callback`,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const tokens = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokens.id_token) return fail(`token endpoint HTTP ${tokenRes.status}: ${tokens.error ?? ''}`);
  // The ID token came straight from Google over TLS, in exchange for our secret,
  // so its claims can be read without checking the signature (Google's guidance).
  let claims;
  try {
    claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return fail('unreadable id_token');
  }
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) return fail('wrong audience or issuer');
  if (!claims.sub || !claims.email || claims.email_verified !== true) return fail('email not verified by Google');

  let user = await findUserByGoogle(claims.sub);
  if (!user) {
    const existing = await findUserByEmail(claims.email);
    user = existing
      ? await updateUser(existing.id, { google_sub: claims.sub, email_verified: true })
      : await createUser({ email: claims.email, name: claims.name ?? '', googleSub: claims.sub, emailVerified: true });
  }
  redirect(res, '/app/', { 'Set-Cookie': [clear, await startSession(req, user)] });
}

// ---- Router ----

/** Handles /api/public/config, /api/auth/*, /api/me/* and /api/admin/*. Returns false for anything else. */
export async function handleAccountRoutes(req, res, url, ctx) {
  const path = url.pathname;
  if (!(path === '/api/public/config' || path.startsWith('/api/auth/') || path.startsWith('/api/me/') || path === '/api/me' || path.startsWith('/api/admin/') || path.startsWith('/api/billing/'))) return false;
  try {
    await route(req, res, url, path, ctx);
  } catch (err) {
    if (err.status) send(res, err.status, { error: err.message });
    else {
      console.error(err);
      send(res, 500, { error: 'Có lỗi ở server. Vui lòng thử lại.' });
    }
  }
  return true;
}

async function route(req, res, url, path, ctx) {
  const method = req.method;

  if (method === 'GET' && path === '/api/public/config') {
    return send(res, 200, {
      googleEnabled: googleEnabled(),
      emailEnabled: emailConfigured(),
      termsVersion: TERMS_VERSION,
      operatorName: process.env.LEGAL_OPERATOR || '',
      contactEmail: process.env.CONTACT_EMAIL || '',
      priceVnd: PRO_PRICE_VND,
      billingMode: billingMode(),
      telegramChannel: process.env.TELEGRAM_CHANNEL_URL || '',
    });
  }

  if (method === 'GET' && path === '/api/auth/google/start') return googleStart(req, res, ctx);
  if (method === 'GET' && path === '/api/auth/google/callback') return googleCallback(req, res, url, ctx);

  if (method === 'POST' && path === '/api/auth/signup') {
    rateLimit(req);
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    if (!validEmail(email)) throw new HttpError(400, 'Email không hợp lệ.');
    checkNewPassword(body.password);
    if (body.acceptTerms !== true) throw new HttpError(400, 'Bạn cần đồng ý Điều khoản sử dụng và Chính sách quyền riêng tư.');
    const existing = await findUserByEmail(email);
    if (existing) {
      throw new HttpError(409, existing.password_hash ? 'Email này đã có tài khoản. Hãy đăng nhập.' : 'Email này đã đăng ký bằng Google. Hãy đăng nhập bằng Google.');
    }
    const user = await createUser({ email, name: body.name, passwordHash: await hashPassword(body.password), acceptTerms: true });
    await sendVerification(user, ctx);
    return send(res, 201, { user: publicUser(user) }, undefined, { 'Set-Cookie': await startSession(req, user) });
  }

  if (method === 'POST' && path === '/api/auth/login') {
    rateLimit(req);
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    if (!perEmail.hit(email)) throw new HttpError(429, 'Sai mật khẩu quá nhiều lần. Vui lòng đợi 15 phút hoặc đặt lại mật khẩu.');
    const user = await findUserByEmail(email);
    if (user && !user.password_hash) throw new HttpError(400, 'Tài khoản này đăng nhập bằng Google. Bấm "Tiếp tục với Google".');
    if (!user || !(await checkPassword(String(body.password ?? ''), user.password_hash))) throw new HttpError(401, 'Email hoặc mật khẩu không đúng.');
    perEmail.reset(email);
    return send(res, 200, { user: publicUser(user) }, undefined, { 'Set-Cookie': await startSession(req, user) });
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    await endSession(getCookie(req, SESSION_COOKIE));
    return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': cookie(req, SESSION_COOKIE, '', 0) });
  }

  if (method === 'GET' && path === '/api/auth/me') {
    const user = await currentUser(req);
    return user ? send(res, 200, { user: publicUser(user) }) : send(res, 401, { error: 'Bạn chưa đăng nhập.' });
  }

  if (method === 'POST' && path === '/api/auth/consent') {
    const user = await requireUser(req, { consent: false });
    const body = await readJson(req);
    if (body.accept !== true) throw new HttpError(400, 'Bạn cần đồng ý để tiếp tục.');
    return send(res, 200, { user: publicUser(await acceptTerms(user.id)) });
  }

  if (method === 'POST' && path === '/api/auth/verify') {
    const body = await readJson(req);
    const userId = await useToken(body.token, 'verify');
    if (!userId) throw new HttpError(400, 'Liên kết xác minh không hợp lệ hoặc đã hết hạn.');
    const user = await updateUser(userId, { email_verified: true });
    return send(res, 200, { user: publicUser(user) });
  }

  if (method === 'POST' && path === '/api/auth/resend-verification') {
    rateLimit(req);
    const user = await requireUser(req, { consent: false });
    if (user.email_verified) return send(res, 200, { sent: false, alreadyVerified: true });
    return send(res, 200, { sent: await sendVerification(user, ctx) });
  }

  if (method === 'POST' && path === '/api/auth/forgot') {
    rateLimit(req);
    const body = await readJson(req);
    const user = await findUserByEmail(body.email);
    // Same answer whether or not the account exists, so this cannot be used to probe emails.
    if (user) {
      const token = await createToken(user.id, 'reset', 60);
      await sendResetEmail(user.email, `${ctx.appUrl}/app/reset?token=${token}`, ctx.isLocal);
    }
    return send(res, 200, { ok: true, emailEnabled: emailConfigured() });
  }

  if (method === 'POST' && path === '/api/auth/reset') {
    rateLimit(req);
    const body = await readJson(req);
    checkNewPassword(body.password);
    const userId = await useToken(body.token, 'reset');
    if (!userId) throw new HttpError(400, 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
    // The link arrived by email, so the address is proven too. Every other device is logged out.
    const user = await updateUser(userId, { password_hash: await hashPassword(body.password), email_verified: true });
    await endAllSessions(userId);
    return send(res, 200, { user: publicUser(user) }, undefined, { 'Set-Cookie': await startSession(req, user) });
  }

  // ---- The user's own account ----

  if (method === 'POST' && path === '/api/me/profile') {
    const user = await requireUser(req);
    const body = await readJson(req);
    const name = String(body.name ?? '').trim();
    if (!name || name.length > 100) throw new HttpError(400, 'Tên cần từ 1 đến 100 ký tự.');
    return send(res, 200, { user: publicUser(await updateUser(user.id, { name })) });
  }

  if (method === 'POST' && path === '/api/me/password') {
    const user = await requireUser(req);
    const body = await readJson(req);
    if (user.password_hash && !(await checkPassword(String(body.currentPassword ?? ''), user.password_hash))) {
      throw new HttpError(400, 'Mật khẩu hiện tại không đúng.');
    }
    checkNewPassword(body.newPassword);
    await updateUser(user.id, { password_hash: await hashPassword(body.newPassword) });
    await endAllSessions(user.id);
    const fresh = await findUserById(user.id);
    return send(res, 200, { user: publicUser(fresh) }, undefined, { 'Set-Cookie': await startSession(req, fresh) });
  }

  if (method === 'GET' && path === '/api/me/export') {
    const user = await requireUser(req, { consent: false });
    const data = { exportedAt: new Date().toISOString(), account: publicUser(user), termsAcceptedAt: user.terms_accepted_at, termsVersion: user.terms_version };
    return send(res, 200, data, 'application/json; charset=utf-8', { 'Content-Disposition': 'attachment; filename="jobradar-du-lieu-cua-toi.json"' });
  }

  if (method === 'POST' && path === '/api/me/delete') {
    const user = await requireUser(req, { consent: false });
    const body = await readJson(req);
    if (normalizeEmail(body.confirmEmail) !== user.email) throw new HttpError(400, 'Email xác nhận không khớp với tài khoản.');
    await deleteUser(user.id);
    console.log(`[accounts] account deleted at the user's request`);
    return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': cookie(req, SESSION_COOKIE, '', 0) });
  }

  // ---- Plan and payment ----

  if (method === 'GET' && path === '/api/billing/checkout') {
    const user = await requireUser(req);
    return send(res, 200, checkoutInfo(user));
  }

  if (method === 'POST' && path === '/api/billing/mock-pay') {
    const user = await requireUser(req);
    if (billingMode() !== 'mock') throw new HttpError(400, 'Thanh toán thử nghiệm đã tắt.');
    const fresh = await addProDays(user.id, PRO_DAYS, { method: 'mock', amountVnd: 0, note: 'test checkout' });
    return send(res, 200, { user: publicUser(fresh) });
  }

  // ---- Telegram for this account ----

  if (method === 'GET' && path === '/api/me/telegram') {
    const user = await requireUser(req);
    return send(res, 200, { linked: Boolean(user.telegram_chat_id), linkedAt: user.telegram_linked_at, settings: userTelegramSettings(user), botReady: Boolean(process.env.TELEGRAM_BOT_TOKEN) });
  }

  if (method === 'POST' && path === '/api/me/telegram/link') {
    const user = await requireUser(req);
    if (!hasPro(user)) throw new HttpError(403, 'Thông báo Telegram riêng có trong gói Pro.');
    const link = await telegramLink(user);
    if (!link) throw new HttpError(400, 'Bot Telegram chưa được cấu hình trên server.');
    return send(res, 200, link);
  }

  if (method === 'POST' && path === '/api/me/telegram/unlink') {
    const user = await requireUser(req);
    await unlinkChat(user.id);
    return send(res, 200, { ok: true });
  }

  if (method === 'POST' && path === '/api/me/telegram/settings') {
    const user = await requireUser(req);
    const body = await readJson(req);
    // Reuses the owner's validation (HH:MM, different times, real timezone) without saving there.
    let s;
    try {
      s = await checkSettings(body, { dryRun: true });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    const minScore = Math.max(-50, Math.min(100, Math.round(Number(body.minScore ?? 20)) || 0));
    const settings = { ...userTelegramSettings(user), ...s, minScore };
    await saveUserTelegramSettings(user.id, settings);
    return send(res, 200, { settings });
  }

  // ---- Admin ----

  if (path.startsWith('/api/admin/')) {
    const user = await requireUser(req);
    if (publicUser(user).role !== 'admin') throw new HttpError(403, 'Chỉ admin mới xem được trang này.');
    if (method === 'GET' && path === '/api/admin/users') {
      return send(res, 200, { users: (await listUsers()).map(publicUser) });
    }
    if (method === 'GET' && path === '/api/admin/payments') {
      return send(res, 200, { payments: await listPayments() });
    }
    const grant = path.match(/^\/api\/admin\/users\/([^/]+)\/pro$/);
    if (method === 'POST' && grant) {
      const body = await readJson(req);
      const days = Math.round(Number(body.days));
      if (!(days >= 1 && days <= 366)) throw new HttpError(400, 'Số ngày từ 1 đến 366.');
      const updated = await addProDays(decodeURIComponent(grant[1]), days, { method: 'admin', amountVnd: Math.max(0, Math.round(Number(body.amountVnd) || 0)), note: String(body.note ?? `by ${user.email}`) });
      if (!updated) throw new HttpError(404, 'Không tìm thấy người dùng.');
      return send(res, 200, { user: publicUser(updated) });
    }
  }

  throw new HttpError(404, 'not found');
}
