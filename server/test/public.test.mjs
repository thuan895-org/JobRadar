// Landing page, blog (admin editor API + public pages), sitemap, robots, ads.
const B = process.env.TEST_BASE ?? 'http://localhost:4321';
const checks = [];
const check = (name, ok, detail = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
function agent() {
  const jar = new Map();
  return async (method, path, body) => {
    const res = await fetch(B + path, { method, redirect: 'manual', headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); jar.set(k, v); }
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, type, data: type.includes('json') ? await res.json() : await res.text() };
  };
}
const guest = agent(), admin = agent(), user = agent();

console.log('== Landing ==');
let r = await guest('GET', '/');
check('/ is the public landing page', r.status === 200 && r.type.startsWith('text/html') && r.data.includes('Việc remote cho người Việt') && r.data.includes('rel="canonical"'));
check('…with the job count and the pricing section', /\d+ job nhận người Việt trong 7 ngày qua/.test(r.data) && r.data.includes('id="gia"'));
check('ads: a slot and the consent banner, but no Google script tag before consent', r.data.includes('class="ad"') && r.data.includes('id="consent"') && !/<script[^>]+googlesyndication/.test(r.data));
r = await guest('GET', '/classic');
check('the old page moved to /classic', r.status === 200 && r.data.includes('JobRadar'));

console.log('\n== Blog editor (admin) ==');
await admin('POST', '/api/auth/signup', { name: 'Admin', email: 'admin@test.vn', password: 'admin password', acceptTerms: true });
await user('POST', '/api/auth/signup', { name: 'U', email: 'u@test.vn', password: 'user password', acceptTerms: true });
await user('POST', '/api/billing/mock-pay', {});
r = await user('POST', '/api/admin/posts', { title: 'x' });
check('a normal user cannot write posts', r.status === 403);
const body = '## Bước 1\n\nMở tài khoản **Payoneer** rồi [đăng ký](https://www.payoneer.com).\n\n- Ý một\n- Ý hai\n\n> Lưu ý: kiểm tra phí.\n\n<script>alert(1)</script> [bad](javascript:alert(1)) ![x](javascript:1)\n\nĐoạn cuối.';
r = await admin('POST', '/api/admin/posts', { title: 'Cách nhận tiền từ Upwork về Việt Nam', body });
const id = r.data.post?.id;
check('a draft is created with a Vietnamese-free slug', r.status === 201 && r.data.post.slug === 'cach-nhan-tien-tu-upwork-ve-viet-nam' && r.data.post.status === 'draft', r.data.post?.slug);
check('…and an excerpt taken from the text', r.data.post.excerpt.startsWith('Bước 1 Mở tài khoản Payoneer'), r.data.post.excerpt);
r = await guest('GET', '/blog/cach-nhan-tien-tu-upwork-ve-viet-nam');
check('a draft is not public', r.status === 404);
r = await admin('POST', '/api/admin/posts', { title: 'Cách nhận tiền từ Upwork về Việt Nam' });
check('a second post with the same slug is refused', r.status === 409, r.data.error);
r = await admin('POST', '/api/admin/blog/preview', { body: '**hi** <b>x</b>' });
check('preview renders Markdown and escapes HTML', r.data.html === '<p><strong>hi</strong> &lt;b&gt;x&lt;/b&gt;</p>', r.data.html);
r = await admin('POST', `/api/admin/posts/${id}`, { title: 'Cách nhận tiền từ Upwork về Việt Nam', body, status: 'published' });
check('publishing sets the date', r.data.post.status === 'published' && r.data.post.published_at);

console.log('\n== Public blog ==');
r = await guest('GET', '/blog');
check('the post is listed on /blog', r.data.includes('/blog/cach-nhan-tien-tu-upwork-ve-viet-nam'));
r = await guest('GET', '/blog/cach-nhan-tien-tu-upwork-ve-viet-nam');
const html = r.data;
check('the post renders headings, bold, lists, quotes and safe links', html.includes('<h2>Bước 1</h2>') && html.includes('<strong>Payoneer</strong>') && html.includes('<li>Ý một</li>') && html.includes('<blockquote>') && html.includes('href="https://www.payoneer.com" target="_blank" rel="noopener noreferrer"'));
check('raw HTML and javascript: links never get through', !html.includes('<script>alert') && !html.includes('href="javascript') && !html.includes('src="javascript') && html.includes('&lt;script&gt;'));
check('article schema and meta description present', html.includes('"@type":"BlogPosting"') && html.includes('<meta name="description" content="Bước 1'));
check('an ad slot inside the article for guests', html.includes('data-ad-slot="111"'));
r = await user('GET', '/blog/cach-nhan-tien-tu-upwork-ve-viet-nam');
check('Pro users see no ads', !r.data.includes('class="ad"') && !r.data.includes('id="consent"'));
r = await guest('GET', '/blog/khong-co-bai-nay');
check('an unknown post is a 404 page, not indexed', r.status === 404 && r.data.includes('noindex'));

console.log('\n== Search engines and ads.txt ==');
r = await guest('GET', '/sitemap.xml');
check('sitemap lists home, blog and the post', r.type.includes('xml') && r.data.includes(`<loc>${B}/</loc>`) && r.data.includes('/blog/cach-nhan-tien-tu-upwork-ve-viet-nam</loc>'));
r = await guest('GET', '/robots.txt');
check('robots.txt blocks app and admin, points to the sitemap', r.data.includes('Disallow: /app/') && r.data.includes('Disallow: /admin/') && r.data.includes(`Sitemap: ${B}/sitemap.xml`));
r = await guest('GET', '/ads.txt');
check('ads.txt names the AdSense publisher', r.data.trim() === 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0');
r = await guest('GET', '/api/public/config');
check('the app gets the feed ad slot settings', r.data.adsenseClient === 'ca-pub-1234567890123456' && r.data.adsenseFeedSlot === '222');

console.log('\n== Security headers ==');
let h = await fetch(B + '/');
check('every page refuses to be framed and does not leak referrers', h.headers.get('x-frame-options') === 'DENY' && h.headers.get('x-content-type-options') === 'nosniff' && h.headers.get('referrer-policy') === 'strict-origin-when-cross-origin');
check('no HSTS over plain http', !h.headers.get('strict-transport-security'));
h = await fetch(B + '/app/login');
check('the app gets a strict Content-Security-Policy', /default-src 'self'/.test(h.headers.get('content-security-policy') ?? '') && /frame-ancestors 'none'/.test(h.headers.get('content-security-policy')));
h = await fetch(B + '/', { headers: { 'X-Forwarded-Proto': 'https' } });
check('HSTS behind https (Render)', (h.headers.get('strict-transport-security') ?? '').includes('max-age=31536000'));

console.log('\n== Remove ==');
r = await admin('POST', `/api/admin/posts/${id}/remove`, {});
check('removing a post takes it offline', r.status === 200 && (await guest('GET', '/blog/cach-nhan-tien-tu-upwork-ve-viet-nam')).status === 404);

console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
