// Public pages rendered on the server so search engines can read them:
// the landing page (/), the blog (/blog, /blog/<slug>), sitemap, robots.txt.
// Ad slots: Pro users see none. Others see a house ad (Pro, the channel), or
// Google AdSense when ADSENSE_CLIENT is set AND the visitor accepted ads on
// the consent banner; until then no ad script is loaded at all.
import { q } from './db.js';
import { send } from './http.js';
import { listPosts, getPost } from './blog.js';
import { renderMarkdown, plainText } from './markdown.js';
import { currentUser } from './routes-account.js';
import { hasPro, PRO_PRICE_VND } from './accounts.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dateVi = (iso) => (iso ? new Date(iso).toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const adsenseClient = () => (/^ca-pub-\d{10,20}$/.test(process.env.ADSENSE_CLIENT ?? '') ? process.env.ADSENSE_CLIENT : '');

const CSS = `
:root{--bg:#f6f7f9;--surface:#fff;--text:#1d2330;--muted:#677085;--line:#e3e6ec;--brand:#2f6fed;--brand-soft:#e8efff;--on-brand:#fff;--good:#1a8a52;--good-soft:#e3f5ea;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#12151b;--surface:#1a1e26;--text:#e6e9ef;--muted:#98a1b3;--line:#2a303b;--brand:#6d9bff;--brand-soft:#1e2a44;--on-brand:#0b1020;--good:#4cc98a;--good-soft:#17301f;color-scheme:dark}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--brand)}img{max-width:100%;height:auto;border-radius:12px}
.wrap{max-width:1080px;margin:0 auto;padding:0 16px}.narrow{max-width:740px}
header.site{border-bottom:1px solid var(--line);background:var(--surface)}header.site .wrap{display:flex;align-items:center;gap:20px;height:64px}
.logo{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:18px;color:var(--text);text-decoration:none}.logo i{display:grid;place-items:center;width:32px;height:32px;border-radius:8px;background:var(--brand);font-style:normal}
nav.site{display:flex;gap:18px;margin-left:auto;align-items:center;font-size:15px}nav.site a{color:var(--muted);text-decoration:none}nav.site a:hover{color:var(--text)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:10px;padding:11px 18px;font-weight:600;font-size:15px;text-decoration:none;border:1px solid var(--line);background:var(--surface);color:var(--text)}
.btn.primary{background:var(--brand);border-color:var(--brand);color:var(--on-brand)}nav.site .btn{padding:8px 14px;color:var(--on-brand)}
.hero{padding:72px 0 56px;text-align:center}.hero h1{font-size:clamp(32px,6vw,54px);line-height:1.1;letter-spacing:-.02em;margin:0 auto;max-width:820px}
.hero p{font-size:19px;color:var(--muted);max-width:640px;margin:20px auto 0}.hero .cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:32px}.hero small{display:block;margin-top:14px;color:var(--muted)}
section{padding:48px 0}h2.sec{font-size:30px;letter-spacing:-.01em;text-align:center;margin:0 0 32px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:22px}.card h3{margin:10px 0 6px;font-size:18px}.card p{margin:0;color:var(--muted);font-size:15px}.ico{font-size:28px}
.steps{counter-reset:s}.steps .card h3::before{counter-increment:s;content:counter(s);display:inline-grid;place-items:center;width:28px;height:28px;margin-right:10px;border-radius:50%;background:var(--brand-soft);color:var(--brand);font-size:14px}
.price{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));max-width:760px;margin:0 auto}.price .big{font-size:34px;font-weight:700}.price ul{padding-left:20px;color:var(--muted);font-size:15px}.price .pro{border:2px solid var(--brand)}
.posts{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}.post-card{display:block;text-decoration:none;color:var(--text)}.post-card:hover h3{color:var(--brand)}.meta{color:var(--muted);font-size:14px}
article.post h1{font-size:clamp(28px,5vw,40px);line-height:1.2;letter-spacing:-.02em;margin:40px 0 8px}article.post .body{font-size:17px;line-height:1.75}article.post .body h2{margin-top:36px}
article.post blockquote{margin:20px 0;padding:8px 18px;border-left:3px solid var(--brand);color:var(--muted)}article.post pre{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px;overflow-x:auto}article.post code{font-size:.92em}
.ad{margin:32px 0;border:1px dashed var(--line);border-radius:14px;padding:16px;min-height:120px;position:relative;background:var(--surface)}.ad-label{position:absolute;top:6px;right:12px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.house{display:flex;gap:16px;align-items:center;flex-wrap:wrap;justify-content:space-between}.house b{display:block;font-size:17px}.house span{color:var(--muted);font-size:15px}
footer.site{border-top:1px solid var(--line);margin-top:48px;padding:28px 0;color:var(--muted);font-size:14px}footer.site .wrap{display:flex;gap:18px;flex-wrap:wrap;justify-content:space-between}footer.site a{color:var(--muted)}
#consent{position:fixed;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;box-shadow:0 8px 30px #0003;font-size:14px;z-index:9}#consent div{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
@media (max-width:640px){nav.site a:not(.btn){display:none}.hero{padding:48px 0 32px}}
`;

function page({ title, description, path, appUrl, body, ads, noindex = false, jsonLd }) {
  const client = ads ? adsenseClient() : '';
  const url = `${appUrl}${path}`;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
<style>${CSS}</style></head><body>
<header class="site"><div class="wrap"><a class="logo" href="/"><i>📡</i>JobRadar</a>
<nav class="site"><a href="/blog">Blog</a><a href="/#gia">Bảng giá</a><a href="/app/login">Đăng nhập</a><a class="btn primary" href="/app/signup">Dùng thử miễn phí</a></nav></div></header>
${body}
<footer class="site"><div class="wrap"><span>© ${new Date().getFullYear()} JobRadar · Việc remote cho người Việt</span>
<span><a href="/blog">Blog</a> · <a href="/app/terms">Điều khoản</a> · <a href="/app/privacy">Quyền riêng tư</a>${process.env.TELEGRAM_CHANNEL_URL ? ` · <a href="${esc(process.env.TELEGRAM_CHANNEL_URL)}" rel="noopener">Channel Telegram</a>` : ''}</span></div></footer>
${client ? consentScript(client) : ''}
</body></html>`;
}

/** Ads load only after the visitor says yes; the choice is kept in this browser. */
function consentScript(client) {
  return `<div id="consent" hidden><b>Quảng cáo trên JobRadar</b><br>Chúng tôi muốn hiển thị quảng cáo của Google để giữ gói Free miễn phí. Google có thể dùng cookie để chọn quảng cáo. Bạn đồng ý chứ? <a href="/app/privacy">Chi tiết</a>
<div><button class="btn" id="ads-no">Không</button><button class="btn primary" id="ads-yes">Đồng ý</button></div></div>
<script>(function(){var k='jr_ads_consent',c=null;try{c=localStorage.getItem(k)}catch(e){}
function load(){var s=document.createElement('script');s.async=true;s.crossOrigin='anonymous';s.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}';document.head.appendChild(s);
document.querySelectorAll('.ad').forEach(function(a){var h=a.querySelector('.house'),i=a.querySelector('ins');if(i){i.hidden=false;if(h)h.hidden=true;(window.adsbygoogle=window.adsbygoogle||[]).push({})}})}
function set(v){try{localStorage.setItem(k,v)}catch(e){}document.getElementById('consent').hidden=true;if(v==='yes')load()}
if(c==='yes')load();else if(c!=='no'){document.getElementById('consent').hidden=false}
document.getElementById('ads-yes').onclick=function(){set('yes')};document.getElementById('ads-no').onclick=function(){set('no')}})();</script>`;
}

/** One ad slot: a house ad, plus an AdSense unit that the consent script swaps in. */
function adSlot(name, show) {
  if (!show) return '';
  const client = adsenseClient();
  const slot = process.env[`ADSENSE_SLOT_${name.toUpperCase()}`] ?? '';
  const channel = process.env.TELEGRAM_CHANNEL_URL;
  const house = name === 'landing' || !channel
    ? `<div class="house"><span><b>Nâng cấp JobRadar Pro</b>AI soạn proposal, báo job qua Telegram riêng, không quảng cáo. ${(PRO_PRICE_VND / 1000).toFixed(0)}k/tháng.</span><a class="btn primary" href="/app/pricing">Xem gói Pro</a></div>`
    : `<div class="house"><span><b>Nhận job remote mỗi sáng</b>Tham gia channel Telegram của JobRadar, miễn phí.</span><a class="btn primary" href="${esc(channel)}" rel="noopener">Tham gia channel</a></div>`;
  const ins = client && slot ? `<ins class="adsbygoogle" hidden style="display:block" data-ad-client="${client}" data-ad-slot="${esc(slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins>` : '';
  return `<aside class="ad" aria-label="Quảng cáo"><span class="ad-label">${ins ? 'Quảng cáo' : 'JobRadar'}</span>${house}${ins}</aside>`;
}

async function showAds(req) {
  const user = await currentUser(req).catch(() => null);
  return !(user && hasPro(user));
}

async function landing(req, res, appUrl) {
  const posts = await listPosts({ limit: 3 });
  const { rows } = await q("SELECT COUNT(*)::int AS n FROM jobs WHERE region_ok AND first_seen >= $1", [new Date(Date.now() - 7 * 864e5).toISOString()]);
  const weekly = rows[0]?.n ?? 0;
  const ads = await showAds(req);
  const body = `<main>
<section class="hero"><div class="wrap"><h1>Việc remote cho người Việt, tóm tắt bằng tiếng Việt</h1>
<p>JobRadar gom job remote và freelance nhận người ở Việt Nam từ nhiều trang, xếp theo kỹ năng của bạn, tóm tắt 10 ý chính và giúp bạn soạn hồ sơ ứng tuyển.</p>
<div class="cta"><a class="btn primary" href="/app/signup">Dùng thử miễn phí 7 ngày</a><a class="btn" href="/blog">Đọc blog</a></div>
<small>${weekly > 0 ? `${weekly.toLocaleString('vi-VN')} job nhận người Việt trong 7 ngày qua · ` : ''}Không cần thẻ thanh toán</small></div></section>
<section><div class="wrap"><h2 class="sec">Tại sao dùng JobRadar</h2><div class="grid">
<div class="card"><div class="ico">🇻🇳</div><h3>Chỉ job nhận người Việt</h3><p>Lọc sẵn job giới hạn quốc gia khác. Ưu tiên khách hàng người Việt.</p></div>
<div class="card"><div class="ico">📝</div><h3>10 ý chính bằng tiếng Việt</h3><p>Lướt nhanh ngân sách, yêu cầu, thời hạn mà không cần đọc mô tả dài.</p></div>
<div class="card"><div class="ico">🎯</div><h3>Xếp theo kỹ năng của bạn</h3><p>Trả lời vài câu hỏi hoặc tải CV lên, danh sách tự xếp job hợp nhất lên đầu.</p></div>
<div class="card"><div class="ico">🤝</div><h3>AI soạn, bạn bấm gửi</h3><p>Proposal, giá đề xuất, câu trả lời form. Bạn đọc lại rồi tự nộp trên trang gốc.</p></div>
</div></div></section>
<section><div class="wrap"><h2 class="sec">Bắt đầu trong 2 phút</h2><div class="grid steps">
<div class="card"><h3>Tạo tài khoản</h3><p>Bằng email hoặc Google. Dùng thử mọi tính năng 7 ngày.</p></div>
<div class="card"><h3>Tạo hồ sơ</h3><p>Chọn kỹ năng và mức độ, hoặc để AI đọc CV của bạn.</p></div>
<div class="card"><h3>Nhận job hợp với bạn</h3><p>Trên web và qua Telegram, kèm cảnh báo job đáng ngờ.</p></div>
</div></div></section>
<div class="wrap narrow">${adSlot('landing', ads)}</div>
<section id="gia"><div class="wrap"><h2 class="sec">Bảng giá</h2><div class="price">
<div class="card"><h3>Free</h3><div class="big">0đ</div><ul><li>Danh sách job xếp theo hồ sơ</li><li>20 tóm tắt mỗi ngày</li><li>Bản tin channel Telegram hằng ngày</li></ul><a class="btn" href="/app/signup">Bắt đầu</a></div>
<div class="card pro"><h3>Pro</h3><div class="big">${PRO_PRICE_VND.toLocaleString('vi-VN')}đ<span class="meta"> / tháng</span></div><ul><li>Tóm tắt không giới hạn</li><li>AI chấm mức phù hợp, cảnh báo lừa đảo</li><li>AI soạn bộ apply</li><li>Telegram riêng, không quảng cáo</li></ul><a class="btn primary" href="/app/signup">Dùng thử 7 ngày</a></div>
</div></div></section>
${posts.length ? `<section><div class="wrap"><h2 class="sec">Từ blog</h2><div class="posts">${posts.map(postCard).join('')}</div></div></section>` : ''}
</main>`;
  send(res, 200, page({
    title: 'JobRadar — Việc remote cho người Việt', description: 'Job remote và freelance nhận người ở Việt Nam, tóm tắt bằng tiếng Việt, xếp theo kỹ năng của bạn, AI giúp soạn hồ sơ ứng tuyển.',
    path: '/', appUrl, body, ads,
    jsonLd: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'JobRadar', url: appUrl, inLanguage: 'vi' },
  }), 'text/html; charset=utf-8');
}

const postCard = (p) => `<a class="card post-card" href="/blog/${esc(p.slug)}"><div class="meta">${dateVi(p.published_at)}</div><h3>${esc(p.title)}</h3><p>${esc(p.excerpt)}</p></a>`;

async function blogIndex(req, res, appUrl) {
  const posts = await listPosts();
  const ads = await showAds(req);
  const body = `<main class="wrap"><section><h2 class="sec">Blog JobRadar</h2><p class="meta" style="text-align:center;margin-top:-20px">Kinh nghiệm làm remote, freelance và nhận tiền từ nước ngoài cho người Việt.</p>
${posts.length ? `<div class="posts">${posts.map(postCard).join('')}</div>` : '<p class="meta" style="text-align:center">Chưa có bài viết nào.</p>'}
<div class="narrow" style="margin:0 auto">${adSlot('blog', ads)}</div></section></main>`;
  send(res, 200, page({ title: 'Blog — JobRadar', description: 'Kinh nghiệm tìm việc remote, làm freelance và nhận tiền từ nước ngoài cho người Việt.', path: '/blog', appUrl, body, ads }), 'text/html; charset=utf-8');
}

async function blogPost(req, res, appUrl, slug) {
  const post = await getPost({ slug });
  if (!post) return notFound(res, appUrl);
  const ads = await showAds(req);
  const html = renderMarkdown(post.body);
  // The ad goes after the second paragraph-level block, then the article continues.
  const blocks = html.split('\n');
  const cut = Math.min(blocks.length, 3);
  const minutes = Math.max(1, Math.round(plainText(post.body).split(' ').length / 220));
  const body = `<main class="wrap narrow"><article class="post">
<div class="meta" style="margin-top:32px"><a href="/blog">← Blog</a></div>
<h1>${esc(post.title)}</h1><div class="meta">${dateVi(post.published_at)} · ${minutes} phút đọc</div>
<div class="body">${blocks.slice(0, cut).join('\n')}${blocks.length > cut ? adSlot('post', ads) : ''}${blocks.slice(cut).join('\n')}</div></article>
<div class="card" style="margin-top:40px;text-align:center"><h3 style="margin-top:0">Tìm job remote nhận người Việt?</h3><p>JobRadar lọc job theo kỹ năng của bạn và tóm tắt bằng tiếng Việt.</p><p style="margin-top:16px"><a class="btn primary" href="/app/signup">Dùng thử miễn phí 7 ngày</a></p></div>
${blocks.length <= cut ? adSlot('post', ads) : ''}</main>`;
  send(res, 200, page({
    title: `${post.title} — JobRadar`, description: post.excerpt, path: `/blog/${post.slug}`, appUrl, body, ads,
    jsonLd: { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title, datePublished: post.published_at, dateModified: post.updated_at, inLanguage: 'vi', description: post.excerpt },
  }), 'text/html; charset=utf-8');
}

function notFound(res, appUrl) {
  send(res, 404, page({ title: 'Không tìm thấy — JobRadar', description: '', path: '/404', appUrl, noindex: true, ads: false,
    body: '<main class="wrap narrow" style="padding:80px 16px;text-align:center"><h1>Không tìm thấy trang</h1><p class="meta">Trang này không tồn tại hoặc đã bị gỡ.</p><p><a class="btn primary" href="/">Về trang chủ</a></p></main>' }), 'text/html; charset=utf-8');
}

/** Handles /, /blog, /blog/<slug>, /sitemap.xml, /robots.txt, /ads.txt. Returns false for anything else. */
export async function handlePublicPages(req, res, url, appUrl) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return landing(req, res, appUrl), true;
  if (path === '/blog') return blogIndex(req, res, appUrl), true;
  const m = path.match(/^\/blog\/([a-z0-9-]{1,80})$/);
  if (m) return blogPost(req, res, appUrl, m[1]), true;
  if (path === '/robots.txt') {
    send(res, 200, `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app/\nAllow: /app/terms\nAllow: /app/privacy\nDisallow: /admin/\nDisallow: /classic\nSitemap: ${appUrl}/sitemap.xml\n`, 'text/plain; charset=utf-8');
    return true;
  }
  if (path === '/ads.txt') {
    const client = adsenseClient();
    send(res, client ? 200 : 404, client ? `google.com, ${client.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n` : 'not configured\n', 'text/plain; charset=utf-8');
    return true;
  }
  if (path === '/sitemap.xml') {
    const posts = await listPosts({ limit: 1000 });
    const urls = [['/', null], ['/blog', posts[0]?.updated_at], ['/app/terms', null], ['/app/privacy', null], ...posts.map((p) => [`/blog/${p.slug}`, p.updated_at])];
    send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, d]) => `  <url><loc>${esc(appUrl + u)}</loc>${d ? `<lastmod>${d.slice(0, 10)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`, 'application/xml; charset=utf-8');
    return true;
  }
  return false;
}
