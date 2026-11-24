// Reports, admin decisions, sources and AI usage over HTTP.
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
const admin = agent(), u1 = agent(), u2 = agent();
await admin('POST', '/api/auth/signup', { name: 'Admin', email: 'admin@test.vn', password: 'admin password', acceptTerms: true });
for (const [a, e] of [[u1, 'u1@test.vn'], [u2, 'u2@test.vn']]) {
  await a('POST', '/api/auth/signup', { name: e, email: e, password: 'user password', acceptTerms: true });
  await a('POST', '/api/profile', { skills: [{ id: 'web', level: 'main' }, { id: 'mobile', level: 'main' }] });
}

let r = await u1('POST', '/api/feed/t2/report', { kind: 'scam', note: 'Đòi chuyển phí trước' });
check('a user reports a job as a scam', r.status === 200);
r = await u1('POST', '/api/feed/t2/report', { kind: 'scam', note: 'Đòi chuyển phí trước 500k' });
r = await u2('POST', '/api/feed/t2/report', { kind: 'scam' });
r = await u2('POST', '/api/feed/bulk-1/report', { kind: 'verify', note: 'Công ty này có thật không?' });
r = await u2('POST', '/api/feed/bulk-2/report', { kind: 'nonsense' });
check('an unknown report kind is refused', r.status === 400);
r = await u1('GET', '/api/admin/reports');
check('reports are admin-only', r.status === 403);
r = await admin('GET', '/api/admin/reports');
const t2reports = r.data.reports.filter((x) => x.job_id === 't2');
check('admin sees 3 open reports; reporting twice updates instead of duplicating', r.data.reports.length === 3 && t2reports.length === 2, r.data.reports.map((x) => `${x.job_id}:${x.kind}`).join(', '));
check('…with the updated note, reporter and a count per job', t2reports.some((x) => x.note === 'Đòi chuyển phí trước 500k' && x.reporter === 'u1@test.vn') && t2reports[0].open_on_job === 2);

await u2('POST', '/api/feed/t2/status', { status: 'saved' });
r = await admin('POST', `/api/admin/reports/${t2reports[0].id}/resolve`, { action: 'scam' });
check('admin marks it a scam', r.status === 200);
r = await admin('GET', '/api/admin/reports');
check('that closes every open report on the job', !r.data.reports.some((x) => x.job_id === 't2'));
r = await u1('GET', '/api/feed?minScore=-999&regionOnly=0');
check('the scam job is gone from New for everyone', !ids(r).includes('t2'));
r = await u2('GET', '/api/feed?tab=saved');
check('…but stays in Saved for the user who saved it, flagged', r.data.jobs.find((j) => j.id === 't2')?.flag === 'scam');
const verify = (await admin('GET', '/api/admin/reports')).data.reports.find((x) => x.job_id === 'bulk-1');
await admin('POST', `/api/admin/reports/${verify.id}/resolve`, { action: 'verified' });
r = await u1('GET', '/api/feed?minScore=-999');
check('a verified job shows its badge', r.data.jobs.find((j) => j.id === 'bulk-1')?.flag === 'verified');
r = await admin('GET', '/api/admin/reports?status=resolved');
check('resolved reports keep who decided', r.data.reports.length === 3 && r.data.reports.every((x) => x.resolution?.includes('admin@test.vn')));

r = await admin('GET', '/api/admin/sources');
check('sources list every configured source with counts', r.data.sources.length >= 6 && r.data.sources.some((s) => s.name === 'Freelancer.com' && s.jobsTotal > 0) && r.data.sources.some((s) => s.ok === false), r.data.sources.map((s) => `${s.key}:${s.jobsTotal}`).join(' '));

await u1('POST', '/api/feed/bulk-3/ai-score');
await u1('POST', '/api/feed/bulk-3/apply-kit', {});
await u1('POST', '/api/feed/highlights', { ids: ['bulk-4', 'bulk-5'] });
r = await admin('GET', '/api/admin/ai-usage');
const kinds = r.data.periods.day.byKind;
check('AI usage is logged by kind with tokens', kinds.score?.calls >= 1 && kinds.kit?.calls === 1 && kinds.highlights?.calls >= 1 && kinds.kit.input === 1000, JSON.stringify(kinds));
check('…and by user', r.data.topUsers.some((u) => u.email === 'u1@test.vn' && u.calls >= 3));
check('…no cost without prices set', r.data.pricingSet === false && r.data.byModel[0].costUsd === null);

console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
