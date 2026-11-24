// Plans over HTTP: trial, Free limits, mock payment, admin grants, Telegram linking.
import { createHash } from 'node:crypto';
const B = process.env.TEST_BASE ?? 'http://localhost:4321';
const checks = [];
const check = (name, ok, detail = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
function agent() {
  const jar = new Map();
  return async (method, path, body, headers = {}) => {
    const res = await fetch(B + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); jar.set(k, v); }
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}
const days = (iso) => Math.round((Date.parse(iso) - Date.now()) / 864e5);

console.log('== Trial ==');
const t = agent();
let r = await t('POST', '/api/auth/signup', { name: 'Trial', email: 'trial@test.vn', password: 'trial password', acceptTerms: true });
check('a new account is on a 7-day trial with Pro features', r.data.user.plan === 'trial' && days(r.data.user.trialEndsAt) === 7 && r.data.user.proFeatures);
await t('POST', '/api/profile', { skills: [{ id: 'web', level: 'main' }] });
r = await t('POST', '/api/feed/bulk-1/ai-score');
check('trial users can use AI scoring', r.status === 200 && r.data.ai);

console.log('\n== Free (trial over) ==');
const f = agent();
r = await f('POST', '/api/auth/login', { email: 'free@test.vn', password: 'free password' });
check('the expired-trial user is on Free', r.data.user.plan === 'free' && !r.data.user.proFeatures);
await f('POST', '/api/profile', { skills: [{ id: 'web', level: 'main' }] });
r = await f('POST', '/api/feed/bulk-2/ai-score');
check('Free: AI scoring needs Pro', r.status === 402 && r.data.error === 'pro_required');
r = await f('POST', '/api/feed/bulk-2/apply-kit', {});
check('Free: apply kit needs Pro', r.status === 402);
const ids = Array.from({ length: 25 }, (_, i) => `bulk-${i + 1}`);
// bulk-1 was already summarised? No: only scored. Ask in batches of 10 like the page does.
const got = [];
let limited = false;
for (let i = 0; i < 25; i += 10) {
  r = await f('POST', '/api/feed/highlights', { ids: ids.slice(i, i + 10) });
  got.push(...Object.keys(r.data.highlights ?? {}));
  limited ||= r.data.limited === true;
}
check('Free: 20 new summaries a day, then told it is the limit', got.length === 20 && limited, `${got.length} summaries`);
r = await f('POST', '/api/feed/highlights', { ids: ['bulk-1', 'bulk-2'] });
check('Free: summaries that already exist still show', Object.keys(r.data.highlights).length === 2);
r = await f('POST', '/api/me/telegram/link', {});
check('Free: personal Telegram needs Pro', r.status === 403);

console.log('\n== Mock payment ==');
r = await f('GET', '/api/billing/checkout');
check('checkout is in test mode with price and transfer code', r.data.mode === 'mock' && r.data.priceVnd === 79000 && /^JR[0-9A-F]{8}$/.test(r.data.transferNote), JSON.stringify(r.data));
r = await f('POST', '/api/billing/mock-pay', {});
check('test payment turns on Pro for 30 days', r.data.user.plan === 'pro' && days(r.data.user.proUntil) === 30);
r = await f('POST', '/api/feed/bulk-2/ai-score');
check('…and AI scoring works now', r.status === 200);
r = await f('POST', '/api/billing/mock-pay', {});
check('paying again adds 30 more days', days(r.data.user.proUntil) === 60);

console.log('\n== Admin ==');
const a = agent();
await a('POST', '/api/auth/signup', { name: 'Admin', email: 'admin@test.vn', password: 'admin password', acceptTerms: true });
const users = (await a('GET', '/api/admin/users')).data.users;
const trialUser = users.find((u) => u.email === 'trial@test.vn');
r = await a('POST', `/api/admin/users/${trialUser.id}/pro`, { days: 30 });
check('admin grants 30 days of Pro', r.data.user.plan === 'pro' && days(r.data.user.proUntil) === 30);
r = await a('POST', `/api/admin/users/${trialUser.id}/pro`, { days: 9999 });
check('…an absurd number of days is refused', r.status === 400);
r = await f('POST', `/api/admin/users/${trialUser.id}/pro`, { days: 30 });
check('a normal user cannot grant Pro', r.status === 403);
r = await a('GET', '/api/admin/payments');
check('payments list: 2 test payments and 1 admin grant', r.data.payments.filter((p) => p.method === 'mock' && p.status === 'test').length === 2 && r.data.payments.filter((p) => p.method === 'admin').length === 1);

console.log('\n== Telegram linking ==');
r = await f('POST', '/api/me/telegram/link', {});
check('a Pro user gets a t.me link with a one-time code', r.status === 200 && r.data.url.startsWith('https://t.me/JobRadarTestBot?start='), r.data.url);
const code = new URL(r.data.url).searchParams.get('start');
const secret = createHash('sha256').update('jobradar-telegram-webhook:mock-token').digest('hex');
const hook = (chatId, text, type = 'private') => fetch(B + '/api/telegram/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify({ update_id: 1, message: { chat: { id: chatId, type }, text } }) });
await hook(777, `/start ${code}`, 'group');
r = await f('GET', '/api/me/telegram');
check('a code sent from a group chat does not link', r.data.linked === false);
r = await f('POST', '/api/me/telegram/link', {});
const code2 = new URL(r.data.url).searchParams.get('start');
await hook(777, `/start ${code2}`);
r = await f('GET', '/api/me/telegram');
check('/start <code> in a private chat links the account', r.data.linked === true);
await hook(888, `/start ${code2}`);
check('the same code cannot be used twice', (await f('GET', '/api/me/telegram')).data.linked === true);
r = await f('POST', '/api/me/telegram/settings', { quietEnabled: true, quietStart: '25:00', quietEnd: '06:00' });
check('bad quiet hours refused', r.status === 400);
r = await f('POST', '/api/me/telegram/settings', { quietEnabled: true, quietStart: '23:00', quietEnd: '07:00', timezone: 'Asia/Ho_Chi_Minh', minScore: 35 });
check('quiet hours and threshold saved', r.status === 200 && r.data.settings.quietStart === '23:00' && r.data.settings.minScore === 35);
r = await f('POST', '/api/me/telegram/unlink', {});
check('unlink works', (await f('GET', '/api/me/telegram')).data.linked === false);

console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
