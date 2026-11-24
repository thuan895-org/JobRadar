// Drives the account API of the running test server like a browser would.
import { readFileSync } from 'node:fs';
const B = process.env.TEST_BASE ?? 'http://localhost:4321';
const checks = [];
const check = (name, ok, detail = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const lastEmail = () => JSON.parse(readFileSync(new URL('./last-email.json', import.meta.url), 'utf8'));
function agent() {
  const jar = new Map();
  const call = async (method, path, body, extra = {}) => {
    const res = await fetch(B + path, {
      method, redirect: 'manual',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...extra },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) { const [kv, ...attrs] = c.split(';'); const [k, v] = kv.split('='); if (/Max-Age=0/.test(attrs.join(';'))) jar.delete(k); else jar.set(k, v); }
    const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  };
  return { call, jar };
}

console.log('== Public config ==');
let r = await agent().call('GET', '/api/public/config');
check('reports Google and email on, terms version, operator', r.data.googleEnabled && r.data.emailEnabled && r.data.termsVersion === '2026-11-26' && r.data.operatorName === 'Nguyễn Văn Test');

console.log('\n== Sign up with email ==');
const a = agent();
r = await a.call('POST', '/api/auth/signup', { name: 'Thuận', email: 'PW.User@Test.vn ', password: 'short', acceptTerms: true });
check('rejects a short password', r.status === 400, r.data.error);
r = await a.call('POST', '/api/auth/signup', { name: 'Thuận', email: 'pw.user@test.vn', password: 'mật khẩu dài 123', acceptTerms: false });
check('rejects without consent', r.status === 400, r.data.error);
r = await a.call('POST', '/api/auth/signup', { name: 'Thuận', email: 'not-an-email', password: 'mật khẩu dài 123', acceptTerms: true });
check('rejects a bad email', r.status === 400, r.data.error);
r = await a.call('POST', '/api/auth/signup', { name: 'Thuận', email: ' PW.User@Test.vn', password: 'mật khẩu dài 123', acceptTerms: true });
check('creates the account (email lower-cased), logged in, consent recorded', r.status === 201 && r.data.user.email === 'pw.user@test.vn' && !r.data.user.needsConsent && a.jar.has('jr_user'), JSON.stringify(r.data.user));
check('never returns the password hash or Google id', !JSON.stringify(r.data).includes('scrypt') && !('google_sub' in r.data.user));
check('sends a verification email', lastEmail().to === 'pw.user@test.vn' && lastEmail().link.includes('/app/verify?token='));
r = await agent().call('POST', '/api/auth/signup', { name: 'X', email: 'pw.user@test.vn', password: 'mật khẩu dài 123', acceptTerms: true });
check('second signup with same email is refused', r.status === 409, r.data.error);
r = await a.call('GET', '/api/auth/me');
check('/me shows the user, not verified yet', r.status === 200 && r.data.user.emailVerified === false);

console.log('\n== Verify email ==');
const verifyToken = new URL(lastEmail().link).searchParams.get('token');
r = await agent().call('POST', '/api/auth/verify', { token: verifyToken });
check('link verifies the address', r.status === 200 && r.data.user.emailVerified === true);
r = await agent().call('POST', '/api/auth/verify', { token: verifyToken });
check('the same link cannot be used twice', r.status === 400, r.data.error);

console.log('\n== Log out / log in ==');
r = await a.call('POST', '/api/auth/logout', {});
check('logout clears the session', r.status === 200 && !a.jar.has('jr_user') && (await a.call('GET', '/api/auth/me')).status === 401);
r = await a.call('POST', '/api/auth/login', { email: 'pw.user@test.vn', password: 'sai mật khẩu' });
check('wrong password refused', r.status === 401, r.data.error);
r = await a.call('POST', '/api/auth/login', { email: 'PW.USER@test.vn', password: 'mật khẩu dài 123' });
check('right password logs in', r.status === 200 && a.jar.has('jr_user'));
r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=pw.user@test.vn&password=x' });
check('a form post (cross-site style) is refused', r.status === 415);

console.log('\n== Forgot / reset password ==');
r = await agent().call('POST', '/api/auth/forgot', { email: 'nobody@test.vn' });
check('unknown email gets the same answer', r.status === 200 && r.data.ok);
r = await agent().call('POST', '/api/auth/forgot', { email: 'pw.user@test.vn' });
const resetToken = new URL(lastEmail().link).searchParams.get('token');
check('reset email sent with a /app/reset link', lastEmail().link.includes('/app/reset?token='));
const b = agent();
r = await b.call('POST', '/api/auth/reset', { token: resetToken, password: 'mật khẩu mới 456' });
check('reset sets the new password and logs in', r.status === 200 && b.jar.has('jr_user'));
check('other devices were logged out', (await a.call('GET', '/api/auth/me')).status === 401);
check('old password no longer works', (await agent().call('POST', '/api/auth/login', { email: 'pw.user@test.vn', password: 'mật khẩu dài 123' })).status === 401);

console.log('\n== Google sign-in ==');
const g = agent();
r = await g.call('GET', '/api/auth/google/start');
const loc = new URL(r.headers.get('location'));
check('redirects to Google with PKCE and state', r.status === 303 && loc.host === 'accounts.google.com' && loc.searchParams.get('code_challenge_method') === 'S256' && loc.searchParams.get('redirect_uri') === `${B}/api/auth/google/callback`);
const state = loc.searchParams.get('state');
r = await g.call('GET', `/api/auth/google/callback?code=code-new&state=wrong`);
check('a wrong state is refused', r.headers.get('location') === '/app/login?error=google' && !g.jar.has('jr_user'));
r = await g.call('GET', '/api/auth/google/start');
const state2 = new URL(r.headers.get('location')).searchParams.get('state');
r = await g.call('GET', `/api/auth/google/callback?code=code-new&state=${state2}`);
check('new Google user is created and logged in', r.headers.get('location') === '/app/' && g.jar.has('jr_user'));
r = await g.call('GET', '/api/auth/me');
check('…verified, but must accept the terms first', r.data.user.emailVerified && r.data.user.needsConsent && r.data.user.googleLinked && !r.data.user.hasPassword);
r = await g.call('POST', '/api/me/profile', { name: 'Tên mới' });
check('account pages are blocked until consent', r.status === 403 && r.data.error === 'consent_required');
r = await g.call('POST', '/api/auth/consent', { accept: true });
check('consent recorded', r.status === 200 && !r.data.user.needsConsent);
r = await g.call('POST', '/api/me/profile', { name: 'Tên mới' });
check('then the account works', r.status === 200 && r.data.user.name === 'Tên mới');
r = await agent().call('POST', '/api/auth/login', { email: 'google.user@gmail.com', password: 'whatever1' });
check('password login on a Google-only account explains why', r.status === 400 && r.data.error.includes('Google'));
const l = agent();
r = await l.call('GET', '/api/auth/google/start');
const state3 = new URL(r.headers.get('location')).searchParams.get('state');
r = await l.call('GET', `/api/auth/google/callback?code=code-link&state=${state3}`);
r = await l.call('GET', '/api/auth/me');
check('Google sign-in with an existing email links to that account', r.data.user.email === 'pw.user@test.vn' && r.data.user.googleLinked && r.data.user.hasPassword);

console.log('\n== Admin ==');
r = await l.call('GET', '/api/admin/users');
check('a normal user cannot list users', r.status === 403);
const ad = agent();
await ad.call('POST', '/api/auth/signup', { name: 'Admin', email: 'admin@test.vn', password: 'admin password', acceptTerms: true });
r = await ad.call('GET', '/api/admin/users');
check('ADMIN_EMAILS user sees all users', r.status === 200 && r.data.users.filter((u) => u.email !== 'free@test.vn').length === 3, r.data.users?.map((u) => `${u.email}:${u.role}`).join(', '));

console.log('\n== Export and delete ==');
r = await g.call('GET', '/api/me/export');
check('export downloads my data as a file', r.status === 200 && r.headers.get('content-disposition').includes('attachment') && r.data.account.email === 'google.user@gmail.com');
r = await g.call('POST', '/api/me/delete', { confirmEmail: 'wrong@x.vn' });
check('delete needs the right email', r.status === 400);
r = await g.call('POST', '/api/me/delete', { confirmEmail: 'Google.User@gmail.com' });
check('account deleted and logged out', r.status === 200 && (await g.call('GET', '/api/auth/me')).status === 401);
r = await ad.call('GET', '/api/admin/users');
check('the deleted user is gone', r.data.users.filter((u) => u.email !== 'free@test.vn').length === 2);

console.log('\n== Old page untouched ==');
r = await agent().call('GET', '/api/jobs');
check('legacy /api/jobs still answers (no password set locally)', r.status === 200 && Array.isArray(r.data.jobs));

console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
