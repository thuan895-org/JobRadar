// Phase 2: employers post, admin approves, candidates apply, employer reviews.
import { readFileSync } from 'node:fs';
const B = process.env.TEST_BASE ?? 'http://localhost:4321';
const checks = [];
const check = (name, ok, detail = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
function agent() {
  const jar = new Map();
  return async (method, path, body, headers = {}) => {
    const json = body !== undefined && !(body instanceof Uint8Array);
    const res = await fetch(B + path, { method, redirect: 'manual', headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...headers }, body: json ? JSON.stringify(body) : body });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); jar.set(k, v); }
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, data: type.includes('json') ? await res.json() : (type.includes('text') || type.includes('xml')) ? await res.text() : new Uint8Array(await res.arrayBuffer()) };
  };
}
const admin = agent(), emp = agent(), cand = agent(), other = agent();
await admin('POST', '/api/auth/signup', { name: 'Admin', email: 'admin@test.vn', password: 'admin password', acceptTerms: true });
await emp('POST', '/api/auth/signup', { name: 'Chị Hoa', email: 'hoa@shop.vn', password: 'employer pass', acceptTerms: true });
await cand('POST', '/api/auth/signup', { name: 'Nguyễn Minh', email: 'minh@test.vn', password: 'candidate pass', acceptTerms: true });
await other('POST', '/api/auth/signup', { name: 'Other', email: 'other@test.vn', password: 'other pass1', acceptTerms: true });
await cand('POST', '/api/profile', { skills: [{ id: 'web', level: 'main' }], summary: 'Mình làm React 3 năm.' });
await cand('POST', '/api/profile/cv', new TextEncoder().encode('%PDF-1.4 cv of minh %%EOF'), { 'Content-Type': 'application/pdf', 'X-File-Name': 'minh.pdf' });

console.log('== Posting ==');
const good = { title: 'Lập trình viên React làm landing page', company: 'Shop Hoa', companyUrl: 'https://shophoa.vn', kind: 'Freelance (trọn gói)', budgetText: '$300–$500', budgetMinUsd: 300, budgetMaxUsd: 500,
  skills: ['React', 'Tailwind'], description: 'Cần làm landing page bán hoa bằng React, responsive, tích hợp form đặt hàng gửi về email. Thời hạn 2 tuần. Có thiết kế Figma sẵn.' };
let r = await emp('POST', '/api/employer/posts', { ...good, title: 'Ngắn' });
check('too-short title refused', r.status === 400, r.data.error);
r = await emp('POST', '/api/employer/posts', { ...good, description: 'ngắn quá' });
check('too-short description refused', r.status === 400);
r = await emp('POST', '/api/employer/posts', { ...good, companyUrl: 'javascript:alert(1)' });
check('a non-http website refused', r.status === 400);
r = await emp('POST', '/api/employer/posts', good);
const id = r.data.post?.id;
check('a post is created, pending review', r.status === 201 && r.data.post.status === 'pending' && /^[a-z0-9]{12}$/.test(id));
check('pending posts are not public', (await cand('GET', `/api/board/${id}`)).status === 404 && (await cand('GET', `/viec-lam/${id}`)).status === 404);
r = await cand('GET', '/api/admin/job-posts');
check('only admins see the review queue', r.status === 403);

console.log('\n== Approval ==');
r = await admin('GET', '/api/admin/job-posts');
check('admin sees it pending with the employer email', r.data.posts.length === 1 && r.data.posts[0].employerEmail === 'hoa@shop.vn');
r = await admin('POST', `/api/admin/job-posts/${id}/approve`, {});
check('admin approves', r.status === 200);
r = await cand('GET', '/api/feed?minScore=-999');
const inFeed = r.data.jobs.find((j) => j.id === `jobradar:${id}`);
check('it appears in feeds as a verified JobRadar job, scored for the user', inFeed && inFeed.source === 'JobRadar' && inFeed.flag === 'verified' && inFeed.matched.includes('Frontend / Web'), JSON.stringify(inFeed && { s: inFeed.score, m: inFeed.matched }));
r = await cand('GET', `/viec-lam/${id}`);
check('public page with JobPosting data for Google', r.status === 200 && r.data.includes('"@type":"JobPosting"') && r.data.includes('"directApply":true') && r.data.includes('"applicantLocationRequirements"'));
check('sitemap includes it', (await cand('GET', '/sitemap.xml')).data.includes(`/viec-lam/${id}`));

console.log('\n== Applying ==');
r = await cand('POST', `/api/board/${id}/apply`, { message: 'Em làm React 3 năm, đã làm 5 landing page.', shareCv: true });
check('consent is required', r.status === 400 && r.data.error.includes('đồng ý'));
r = await cand('POST', `/api/board/${id}/apply`, { message: 'hi', shareCv: true, consent: true });
check('a one-word message is refused', r.status === 400);
r = await emp('POST', `/api/board/${id}/apply`, { message: 'Ứng tuyển tin của chính mình thử xem', consent: true });
check('the employer cannot apply to their own post', r.status === 400);
r = await cand('POST', `/api/board/${id}/apply`, { message: 'Em làm React 3 năm, đã làm 5 landing page bán hàng.', shareCv: true, consent: true });
check('the application is sent', r.status === 201);
const mail = JSON.parse(readFileSync(new URL('./last-email.json', import.meta.url), 'utf8'));
check('the employer gets an email with a link to the applicants', mail.to === 'hoa@shop.vn' && mail.link.endsWith(`/app/employer/${id}`), mail.subject);
r = await cand('POST', `/api/board/${id}/apply`, { message: 'Em làm React 3 năm, gửi lại lần nữa.', consent: true });
check('applying twice is refused', r.status === 409);
r = await cand('GET', '/api/feed?tab=applied');
check('the job moves to the candidate\'s Applied tab', r.data.jobs.some((j) => j.id === `jobradar:${id}`));

console.log('\n== Employer review ==');
r = await emp('GET', `/api/employer/posts/${id}/applications`);
const app = r.data.applications?.[0];
check('the employer sees name, email, message, profile and CV flag', app && app.email === 'minh@test.vn' && app.profile.includes('Mình làm React 3 năm') && app.hasCv && app.status === 'sent');
r = await other('GET', `/api/employer/posts/${id}/applications`);
check('another user cannot see them', r.status === 404);
r = await other('GET', `/api/employer/applications/${app.id}/cv`);
check('…nor download the CV', r.status === 404);
r = await emp('GET', `/api/employer/applications/${app.id}/cv`);
check('the employer downloads the CV, which marks it viewed', r.status === 200 && new TextDecoder().decode(r.data).includes('cv of minh'));
r = await emp('POST', `/api/employer/applications/${app.id}/status`, { status: 'shortlisted' });
r = await cand('GET', '/api/applications');
check('the candidate sees "shortlisted"', r.data.applications[0]?.status === 'shortlisted');
r = await emp('GET', '/api/employer/posts');
check('my posts show the applicant count', r.data.posts[0].applicants === 1 && r.data.posts[0].status === 'approved');

console.log('\n== Limits, edits, closing ==');
for (let i = 0; i < 4; i++) await emp('POST', '/api/employer/posts', { ...good, title: `${good.title} ${i}` });
r = await emp('POST', '/api/employer/posts', { ...good, title: `${good.title} 6` });
check('at most 5 open posts per employer', r.status === 400, r.data.error);
const pending2 = (await admin('GET', '/api/admin/job-posts')).data.posts[0];
r = await admin('POST', `/api/admin/job-posts/${pending2.id}/reject`, {});
check('rejecting needs a reason', r.status === 400);
r = await admin('POST', `/api/admin/job-posts/${pending2.id}/reject`, { reason: 'Thiếu thời hạn cụ thể' });
r = await emp('GET', '/api/employer/posts');
check('the employer sees the reason', r.data.posts.find((p) => p.id === pending2.id)?.rejectReason === 'Thiếu thời hạn cụ thể');
r = await emp('POST', `/api/employer/posts/${id}`, { ...good, title: 'Lập trình viên React làm landing page (sửa)' });
check('editing an approved post sends it back to review', r.data.post.status === 'pending');
r = await other('GET', '/api/feed?minScore=-999');
check('…and hides it from feeds meanwhile', !r.data.jobs.some((j) => j.id === `jobradar:${id}`));
await admin('POST', `/api/admin/job-posts/${id}/approve`, {});
r = await other('GET', '/api/feed?minScore=-999');
check('approved again, it is back with the new title', r.data.jobs.find((j) => j.id === `jobradar:${id}`)?.title.endsWith('(sửa)'));
r = await emp('POST', `/api/employer/posts/${id}/close`, {});
check('the employer closes it', r.data.post.status === 'closed');
check('closed: the public page says so (410)', (await other('GET', `/viec-lam/${id}`)).status === 410);
r = await other('GET', '/api/feed?minScore=-999');
check('closed: gone from New', !r.data.jobs.some((j) => j.id === `jobradar:${id}`));
r = await cand('GET', '/api/feed?tab=applied');
check('closed: the applicant still sees it, marked closed', r.data.jobs.find((j) => j.id === `jobradar:${id}`)?.flag === 'closed');
r = await cand('POST', `/api/board/${id}/apply`, { message: 'Còn nhận không ạ, em muốn ứng tuyển.', consent: true });
check('closed: no more applications', r.status === 404);

console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
