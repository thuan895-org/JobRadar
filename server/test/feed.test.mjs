// Two users, one set of jobs: each sees their own scores and states.
const B = process.env.TEST_BASE ?? 'http://localhost:4321';
const checks = [];
const check = (name, ok, detail = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
function agent() {
  const jar = new Map();
  return async (method, path, body) => {
    const res = await fetch(B + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); jar.set(k, v); }
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}
const ids = (r) => r.data.jobs.map((j) => j.id);

console.log('== Owner (admin) gets the single-user data ==');
const owner = agent();
await owner('POST', '/api/auth/signup', { name: 'Chủ', email: 'admin@test.vn', password: 'admin password', acceptTerms: true });
let r = await owner('GET', '/api/feed?tab=saved');
check('the job saved before accounts existed is in Saved', ids(r).includes('t1') && r.data.counts.saved === 1, JSON.stringify(r.data.counts));
check('…with its old AI score', r.data.jobs.find((j) => j.id === 't1')?.ai?.score === 92);
r = await owner('GET', '/api/feed?tab=hidden');
check('the hidden job stays hidden', ids(r).includes('t4'));
r = await owner('GET', '/api/profile');
check('config.json skills became the owner\'s profile', r.data.profile.skills.length >= 5 && r.data.profile.skills.some((s) => s.label === 'Backend'), r.data.profile.skills.map((s) => s.label).join(', '));
check('personal exclusions include "sales"', r.data.profile.exclude_terms.includes('sales'));
r = await owner('GET', '/api/feed');
check('the owner\'s new tab: mobile job in, sales director out, 40-day-old job out', ids(r).includes('t2') && !ids(r).includes('t5') && !ids(r).includes('t6'), ids(r).join(','));
check('US-only job hidden when "only jobs open to Vietnam"', !ids(r).includes('t7') && r.data.regionOnly);
r = await owner('GET', '/api/feed?regionOnly=0&minScore=-999');
check('…and shown when that filter is off', ids(r).includes('t7'));

console.log('\n== A designer, new account ==');
const des = agent();
await des('POST', '/api/auth/signup', { name: 'Lan', email: 'lan@test.vn', password: 'designer pass', acceptTerms: true });
r = await des('GET', '/api/feed');
check('no profile yet: told so, and the owner\'s data is not shared', r.data.hasProfile === false && r.data.counts.saved === 0 && r.data.counts.hidden === 0);
r = await des('POST', '/api/profile', { skills: [{ id: 'graphic', level: 'main' }, { id: 'nope', level: 'main' }], regionOnly: true });
check('profile saved; unknown catalogue ids dropped', r.status === 200 && r.data.profile.skills.length === 1);
r = await des('GET', '/api/feed');
check('the design job is first for her', r.data.jobs[0]?.id === 't3' && r.data.jobs[0].matched.includes('Thiết kế đồ hoạ'), ids(r).join(','));
check('backend jobs do not show for her', !ids(r).includes('t1'));
r = await des('POST', '/api/profile', { skills: [{ id: 'graphic', level: 'main' }, { id: 'translation', level: 'good' }] });
r = await des('GET', '/api/feed');
check('adding translation brings in the Vietnamese job (hidden only for the owner)', ids(r).includes('t4'));
r = await des('POST', '/api/profile', { skills: [{ id: 'graphic', level: 'main' }], excludeTerms: ['Logo'] });
r = await des('GET', '/api/feed');
check('her own exclusion "logo" removes the logo job', !ids(r).includes('t3'));
await des('POST', '/api/profile', { skills: [{ id: 'graphic', level: 'main' }], excludeTerms: [] });
r = await des('POST', '/api/profile', { skills: 'not a list' });
check('bad profile input refused with a message', r.status === 400 && r.data.error);

console.log('\n== Per-user state ==');
r = await des('POST', '/api/feed/t3/status', { status: 'saved' });
check('she saves the design job', r.status === 200);
r = await des('GET', '/api/feed?tab=saved');
check('it is in her Saved tab', ids(r).includes('t3'));
r = await owner('GET', '/api/feed?tab=all&regionOnly=0&minScore=-999');
check('for the owner it is still new', r.data.jobs.find((j) => j.id === 't3')?.status === 'new');
r = await des('POST', '/api/feed/t3/status', { status: 'bogus' });
check('a made-up status is refused', r.status === 400);
r = await des('POST', '/api/feed/nope/status', { status: 'saved' });
check('an unknown job is 404', r.status === 404);

console.log('\n== AI per user ==');
r = await des('POST', '/api/feed/t3/ai-score');
check('AI score uses HER profile (designer prompt → 81)', r.data.ai?.score === 81, JSON.stringify(r.data));
r = await owner('POST', '/api/feed/t3/ai-score');
check('the owner gets their own score (55)', r.data.ai?.score === 55);
r = await des('POST', '/api/feed/t3/apply-kit', {});
check('her apply kit is written from her profile', r.data.kit?.proposal === 'designer proposal');
r = await des('POST', '/api/feed/t3/apply-kit', {});
check('asking again returns the saved kit', r.data.kit?.proposal === 'designer proposal');
r = await des('GET', '/api/feed?tab=saved');
check('feed shows hasKit and her AI score', r.data.jobs[0].hasKit && r.data.jobs[0].ai.score === 81);
r = await des('POST', '/api/feed/highlights', { ids: ['t3', 't2'] });
check('10-point summaries work for users', r.data.highlights?.t3?.length === 2);

console.log('\n== Access ==');
r = await agent()('GET', '/api/feed');
check('feed needs a login', r.status === 401);
r = await agent()('GET', '/api/profile');
check('profile needs a login', r.status === 401);

console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
