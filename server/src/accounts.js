// User accounts: passwords, sessions and one-time email links.
// Passwords use scrypt (built into Node). Sessions and email links are random
// tokens; the database keeps only their SHA-256, so a leaked table cannot be
// used to log in.
import { randomBytes, randomUUID, scrypt as scryptCb, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { q } from './db.js';

const scrypt = promisify(scryptCb);

/** Bump when the terms or privacy policy change: everyone is asked to accept again. */
export const TERMS_VERSION = '2026-11-26';
export const SESSION_DAYS = 30;
export const MIN_PASSWORD = 8;
export const TRIAL_DAYS = 7;
export const PRO_PRICE_VND = 79000;

/** 'pro' while paid, 'trial' in the first 7 days, otherwise 'free'. Admins always get everything. */
export function planOf(u, at = Date.now()) {
  if (u.pro_until && Date.parse(u.pro_until) > at) return 'pro';
  if (u.trial_ends_at && Date.parse(u.trial_ends_at) > at) return 'trial';
  return 'free';
}

/** Trial and Pro include the AI features and personal Telegram alerts. */
export const hasPro = (u) => planOf(u) !== 'free' || adminEmails().has(u.email);

const now = () => new Date().toISOString();
const hash = (token) => createHash('sha256').update(token).digest('hex');
export const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();
export const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;

// ---- Passwords ----

const N = 16384, R = 8, P = 1, KEYLEN = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function checkPassword(password, stored) {
  if (!stored) return false;
  const [kind, n, r, p, salt, key] = stored.split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(got, expected);
}

// ---- Users ----

/** ADMIN_EMAILS (comma-separated) decides who is an admin, so the owner never needs a database edit. */
function adminEmails() {
  return new Set((process.env.ADMIN_EMAILS ?? '').split(',').map(normalizeEmail).filter(Boolean));
}

/** What the apps may see about a user: never the password hash or the Google id. */
export function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: adminEmails().has(u.email) ? 'admin' : u.role,
    emailVerified: u.email_verified,
    hasPassword: Boolean(u.password_hash),
    googleLinked: Boolean(u.google_sub),
    needsConsent: u.terms_version !== TERMS_VERSION,
    plan: planOf(u),
    proFeatures: hasPro(u),
    trialEndsAt: u.trial_ends_at ?? null,
    proUntil: u.pro_until ?? null,
    telegramLinked: Boolean(u.telegram_chat_id),
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

export async function findUserByEmail(email) {
  const { rows } = await q('SELECT * FROM users WHERE email = $1', [normalizeEmail(email)]);
  return rows[0] ?? null;
}

export async function findUserById(id) {
  const { rows } = await q('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function findUserByGoogle(sub) {
  const { rows } = await q('SELECT * FROM users WHERE google_sub = $1', [sub]);
  return rows[0] ?? null;
}

export async function createUser({ email, name, passwordHash = null, googleSub = null, emailVerified = false, acceptTerms = false }) {
  const t = now();
  const { rows } = await q(`
    INSERT INTO users (id, email, name, password_hash, google_sub, email_verified, terms_version, terms_accepted_at, created_at, last_login_at, trial_ends_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10) RETURNING *
  `, [randomUUID(), normalizeEmail(email), String(name ?? '').trim().slice(0, 100), passwordHash, googleSub, emailVerified,
    acceptTerms ? TERMS_VERSION : null, acceptTerms ? t : null, t, new Date(Date.parse(t) + TRIAL_DAYS * 864e5).toISOString()]);
  return rows[0];
}

export async function updateUser(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return findUserById(id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await q(`UPDATE users SET ${sets} WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => fields[k])]);
  return rows[0] ?? null;
}

export async function acceptTerms(id) {
  return updateUser(id, { terms_version: TERMS_VERSION, terms_accepted_at: now() });
}

export async function deleteUser(id) {
  await q('DELETE FROM users WHERE id = $1', [id]); // sessions and tokens go with it (ON DELETE CASCADE)
}

export async function listUsers(limit = 500) {
  const { rows } = await q('SELECT * FROM users ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows;
}

// ---- Sessions ----

export async function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await q('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [hash(token), userId, now(), expires]);
  await q('UPDATE users SET last_login_at = $1 WHERE id = $2', [now(), userId]);
  return token;
}

export async function userForSession(token) {
  if (!token) return null;
  const { rows } = await q(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > $2
  `, [hash(token), now()]);
  return rows[0] ?? null;
}

export async function endSession(token) {
  if (token) await q('DELETE FROM sessions WHERE token_hash = $1', [hash(token)]);
}

export async function endAllSessions(userId) {
  await q('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

// ---- One-time email links ----

export async function createToken(userId, kind, minutes) {
  const token = randomBytes(32).toString('base64url');
  await q('DELETE FROM user_tokens WHERE user_id = $1 AND kind = $2 AND used_at IS NULL', [userId, kind]); // only the newest link works
  await q('INSERT INTO user_tokens (token_hash, user_id, kind, expires_at) VALUES ($1, $2, $3, $4)',
    [hash(token), userId, kind, new Date(Date.now() + minutes * 60000).toISOString()]);
  return token;
}

/** Marks the link used and returns its user id, or null if it is unknown, used or expired. */
export async function useToken(token, kind) {
  const { rows } = await q(`
    UPDATE user_tokens SET used_at = $3
    WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > $3
    RETURNING user_id
  `, [hash(String(token ?? '')), kind, now()]);
  return rows[0]?.user_id ?? null;
}
