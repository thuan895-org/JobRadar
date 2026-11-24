// CV upload, AI analysis with consent, download and removal.
const B = process.env.TEST_BASE ?? 'http://localhost:4321';
const checks = [];
const check = (name, ok, detail = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const jar = new Map();
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
async function call(method, path, body, headers = {}) {
  const json = body !== undefined && !(body instanceof Uint8Array);
  const res = await fetch(B + path, { method, headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), Cookie: cookie(), ...headers }, body: json ? JSON.stringify(body) : body });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); jar.set(k, v); }
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer()) };
}
const pdf = (text) => new TextEncoder().encode(`%PDF-1.4\n${text}\n%%EOF`);
const up = (bytes, query = '?analyze=1', extra = {}) => call('POST', `/api/profile/cv${query}`, bytes, { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent('CV Lan – 2026.pdf'), 'X-AI-Consent': 'yes', ...extra });

await call('POST', '/api/auth/signup', { name: 'Lan', email: 'cv.user@test.vn', password: 'designer pass', acceptTerms: true });

let r = await call('POST', '/api/profile/cv', new TextEncoder().encode('hello'), { 'Content-Type': 'text/plain' });
check('a non-PDF content type is refused', r.status === 415, r.data.error);
r = await up(new TextEncoder().encode('just text pretending'));
check('a file that is not really a PDF is refused', r.status === 400, r.data.error);
r = await up(new Uint8Array(2 * 1048576 + 10).fill(37));
check('a file over 2 MB is refused', r.status === 413, r.data.error);
r = await up(pdf('my cv'), '?analyze=1', { 'X-AI-Consent': 'no' });
check('analysis without AI consent is refused (CV kept)', r.status === 400 && r.data.error.includes('đồng ý'));

r = await up(pdf('my cv'));
check('analysis returns a draft', r.status === 200 && r.data.draft, JSON.stringify(r.data.draft));
check('…only catalogue skills survive', JSON.stringify(r.data.draft.skills) === JSON.stringify([{ id: 'graphic', level: 'main' }, { id: 'uiux', level: 'good' }]));
check('…keywords lower-cased, years/english/intro filled', r.data.draft.extraKeywords.join() === 'figma,canva' && r.data.draft.years === '3-5' && r.data.draft.intro.includes('designer'));
check('…CV name kept, CV text stored, AI consent time recorded', r.data.profile.cv_name === 'CV Lan – 2026.pdf' && r.data.profile.cv_text.includes('Figma') && Boolean(r.data.profile.ai_consent_at));
check('…the draft is not saved as the profile until the user saves it', r.data.profile.skills.length === 0);

r = await call('GET', '/api/profile/cv');
check('the CV downloads as the same bytes', r.status === 200 && new TextDecoder().decode(r.data).includes('my cv') && r.headers.get('content-disposition').includes('attachment'));

r = await up(pdf('NOT A CV, a cat photo'));
check('a PDF that is not a CV is reported', r.status === 400 && r.data.error.includes('không phải CV'), r.data.error);

r = await call('POST', '/api/profile', { skills: [{ id: 'graphic', level: 'main' }, { label: 'Từ khoá riêng', level: 'main', terms: ['figma'] }], answers: { years: '3-5', english: 'reading', workTypes: ['project'], hourlyRate: 15 }, summary: 'Mình là designer.', regionOnly: true, minBudgetUsd: 50 });
check('the reviewed profile saves', r.status === 200 && r.data.profile.skills.length === 2 && r.data.profile.answers.hourlyRate === 15 && r.data.profile.min_budget_usd === 50);
check('saving the profile keeps the CV', r.data.profile.cv_name === 'CV Lan – 2026.pdf');

r = await call('POST', '/api/profile/cv/remove', {});
check('removing the CV clears file and text', r.status === 200 && r.data.profile.cv_name === null && r.data.profile.cv_text === null);
check('…and it cannot be downloaded any more', (await call('GET', '/api/profile/cv')).status === 404);
check('…but the profile stays', r.data.profile.skills.length === 2);

let last;
for (let i = 0; i < 4; i++) last = await up(pdf('my cv again'));
check('the 6th analysis in a day is refused', last.status === 429, last.data.error);

console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
