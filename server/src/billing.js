// Plans and payments. Payment is not wired to a real provider yet: with
// BILLING_MODE unset (or "mock"), the checkout page shows a sample transfer and
// a test button that turns on Pro without moving money. Admins can also add
// Pro days by hand. Every activation is recorded in the payments table.
import { randomUUID } from 'node:crypto';
import { q } from './db.js';
import { PRO_PRICE_VND, findUserById } from './accounts.js';

export const PRO_DAYS = 30;
export const billingMode = () => (process.env.BILLING_MODE || 'mock').toLowerCase();

/** Adds days of Pro, starting from today or from the end of the current Pro period. */
export async function addProDays(userId, days, { method, amountVnd = 0, note = '' }) {
  const user = await findUserById(userId);
  if (!user) return null;
  const start = Math.max(Date.now(), Date.parse(user.pro_until ?? '') || 0);
  const until = new Date(start + days * 864e5).toISOString();
  await q('UPDATE users SET pro_until = $2 WHERE id = $1', [userId, until]);
  await q('INSERT INTO payments (id, user_id, amount_vnd, days, method, status, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [randomUUID(), userId, amountVnd, days, method, method === 'mock' ? 'test' : 'paid', note.slice(0, 200), new Date().toISOString()]);
  return findUserById(userId);
}

/** What the checkout page shows: price, and the transfer details (sample ones in mock mode). */
export function checkoutInfo(user) {
  const code = `JR${user.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  return {
    mode: billingMode(),
    priceVnd: PRO_PRICE_VND,
    days: PRO_DAYS,
    transferNote: code,
    bank: billingMode() === 'mock'
      ? { name: 'Ngân hàng mẫu (chế độ thử nghiệm)', account: '0000 0000 0000', holder: 'JOBRADAR TEST' }
      : { name: process.env.BANK_NAME || '', account: process.env.BANK_ACCOUNT || '', holder: process.env.BANK_HOLDER || '' },
  };
}

export async function listPayments(limit = 200) {
  const { rows } = await q(`SELECT p.*, u.email FROM payments p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT $1`, [limit]);
  return rows;
}
