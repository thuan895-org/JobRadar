// Runs the real JobRadar server on in-memory Postgres, with Telegram, Gemini and job sources faked.
import { register } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
register('./hooks.mjs', import.meta.url);
const FAIL_FLAG = new URL('./tg-fail', import.meta.url);
Object.assign(process.env, { DATABASE_URL: 'pglite://memory', APP_PASSWORD: '', HOST: '127.0.0.1', GEMINI_API_KEY: 'mock-key', TELEGRAM_BOT_TOKEN: 'mock-token', TELEGRAM_CHAT_ID: '555', PUBLIC_URL: process.env.TEST_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4321}`, ADMIN_EMAILS: 'Admin@Test.vn', GOOGLE_CLIENT_ID: 'gid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'gsecret', RESEND_API_KEY: 'mock-resend', EMAIL_FROM: 'JobRadar <noreply@test.vn>', LEGAL_OPERATOR: 'Nguyễn Văn Test', CONTACT_EMAIL: 'lienhe@test.vn', ADSENSE_CLIENT: 'ca-pub-1234567890123456', ADSENSE_SLOT_POST: '111', ADSENSE_SLOT_FEED: '222', TELEGRAM_CHANNEL_URL: 'https://t.me/jobradar_test' });
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes('api.telegram.org')) {
    const method = url.split('/').pop();
    const body = JSON.parse(init.body);
    if (method === 'sendMessage' && existsSync(FAIL_FLAG)) {
      console.error(`[mock-tg] sendMessage chat=${body.chat_id} -> 400 chat not found`);
      return new Response('{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}', { status: 400 });
    }
    if (method === 'getMe') return new Response('{"ok":true,"result":{"username":"JobRadarTestBot"}}', { status: 200 });
    console.error(`[mock-tg] ${method} ${method === 'setWebhook' ? `url=${body.url} secret=${body.secret_token.length}chars updates=${body.allowed_updates}` : `chat=${body.chat_id} text=${JSON.stringify(body.text.slice(0, 90))}`}`);
    return new Response('{"ok":true,"result":true}', { status: 200 });
  }
  if (url === 'https://api.resend.com/emails') {
    const body = JSON.parse(init.body);
    const link = body.html.match(/href="([^"]+)"/)[1].replace(/&amp;/g, '&');
    writeFileSync(new URL('./last-email.json', import.meta.url), JSON.stringify({ to: body.to[0], subject: body.subject, link }));
    console.error(`[mock-email] to=${body.to[0]} subject=${body.subject} link=${link}`);
    return new Response('{"id":"mock"}', { status: 200 });
  }
  if (url === 'https://oauth2.googleapis.com/token') {
    const form = new URLSearchParams(init.body);
    const who = { 'code-new': { sub: 'g-new', email: 'google.user@gmail.com', name: 'Google User' }, 'code-link': { sub: 'g-link', email: 'pw.user@test.vn', name: 'PW' } }[form.get('code')];
    if (!who || !form.get('code_verifier') || form.get('client_secret') !== 'gsecret') return new Response('{"error":"invalid_grant"}', { status: 400 });
    const claims = { iss: 'https://accounts.google.com', aud: 'gid.apps.googleusercontent.com', email_verified: true, ...who };
    const idt = ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
    return new Response(JSON.stringify({ id_token: idt, access_token: 'x' }), { status: 200 });
  }
  if (url.includes('generativelanguage.googleapis.com')) {
    const body = JSON.parse(init.body);
    const prompt = body.contents[0].parts.find((part) => part.text).text;
    const schema = body.generationConfig.responseSchema;
    const ids = [...prompt.matchAll(/^ID: (.+)$/gm)].map((m) => m[1]);
    let out;
    if (schema.properties?.is_cv) {
      const file = body.contents[0].parts[0].inlineData;
      const pdf = file && file.mimeType === 'application/pdf' ? Buffer.from(file.data, 'base64').toString('latin1') : '';
      console.error(`[mock-gemini] CV call, pdf part: ${pdf.slice(0, 8)}`);
      out = pdf.includes('NOT A CV') ? { is_cv: false, skills: [], extra_keywords: [], years: '0-1', english: 'basic', intro_vi: '', cv_text: '' }
        : { is_cv: true, name: 'Lan', headline: 'Graphic designer, 4 years', skills: [{ id: 'graphic', level: 'main' }, { id: 'uiux', level: 'good' }, { id: 'made-up', level: 'main' }],
          extra_keywords: ['Figma', 'Canva'], years: '3-5', english: 'reading', intro_vi: 'Mình là designer 4 năm.', cv_text: 'Graphic designer. 4 years. Figma, Canva.' };
    } else if (schema.items?.properties?.points) out = ids.map((id) => ({ id, points: ['🛠 Điểm 1', '💰 Điểm 2'] }));
    else if (schema.type === 'ARRAY') out = ids.map((id) => ({ id, fit: prompt.includes('Thiết kế đồ hoạ') ? 81 : 55, reason_vi: 'mock', red_flags_vi: [], scam_risk: 'low' }));
    else out = { language: 'en', job_summary_vi: 'mock', subject_line: 'Hi', proposal: prompt.includes('Thiết kế đồ hoạ') ? 'designer proposal' : 'other proposal', bid: { amount: 100, currency: 'USD', unit: 'fixed', delivery_days: 3, rationale_vi: 'x' }, milestones: [], screening_answers: [], questions_for_client: [], profile_highlights: [], missing_info_vi: [], tips_vi: [] };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 } }), { status: 200 });
  }
  throw new Error('offline in test');
};
const db = await import(new URL('../src/db.js', import.meta.url).href);
await db.initDb();
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();
const seedJobs = [
  // id, title, description, location, posted days ago, legacy status, legacy ai score, matched
  ['t1', 'Senior Node.js Backend Engineer', 'We need node.js and postgresql microservices.', 'Anywhere', 0.5, 'saved', 92, ['Backend']],
  ['t2', 'React Native app', 'Build a react native mobile app for ios and android.', 'Worldwide', 1, 'new', null, ['Mobile']],
  ['t3', 'Graphic designer for logo', 'Photoshop and illustrator logo design and branding.', 'Anywhere', 1, 'new', null, []],
  ['t4', 'Vietnamese translator needed', 'Translate English to Vietnamese subtitles.', 'Anywhere', 2, 'hidden', null, ['Dịch tiếng Việt']],
  ['t5', 'Sales Director', 'Lead the sales team.', 'Anywhere', 1, 'new', null, []],
  ['t6', 'Old Node.js backend job', 'node.js backend api postgresql', 'Anywhere', 40, 'new', null, ['Backend']],
  ['t7', 'US-only backend engineer', 'node.js backend api', 'USA only', 1, 'new', null, ['Backend']],
];
for (const [id, title, desc, loc, age, status, ai, matched] of seedJobs) {
  const t = daysAgo(age);
  await db.pool.query(`INSERT INTO jobs (id, source, title, url, description, location, score, status, ai_score, ai_reason, ai_checked_at, notified, posted_at, first_seen, last_seen, budget_text, matched, region_ok)
    VALUES ($1,'Freelancer.com',$2,'https://example.com/'||$1,$3,$4,40,$5,$6::int,CASE WHEN $6::int IS NULL THEN NULL ELSE 'legacy reason' END,CASE WHEN $6::int IS NULL THEN NULL ELSE $7 END,TRUE,$7,$7,$7,'$500–$1000',$8,$9)`,
    [id, title, desc, loc, status, ai, t, JSON.stringify(matched), loc !== 'USA only']);
}

// A user whose trial ended (Free plan), and 25 more fresh jobs for the summary limit.
const acc = await import(new URL('../src/accounts.js', import.meta.url).href);
const freeUser = await acc.createUser({ email: 'free@test.vn', name: 'Free', passwordHash: await acc.hashPassword('free password'), acceptTerms: true });
await db.pool.query(`UPDATE users SET trial_ends_at = '2020-01-01T00:00:00.000Z' WHERE id = $1`, [freeUser.id]);
for (let i = 1; i <= 25; i++) {
  const t = new Date().toISOString();
  await db.pool.query(`INSERT INTO jobs (id, source, title, url, description, location, score, notified, posted_at, first_seen, last_seen, matched, region_ok)
    VALUES ($1,'Remote OK',$2,'https://example.com/'||$1,'react typescript frontend web app','Anywhere',30,TRUE,$3,$3,$3,'[]',TRUE)`, [`bulk-${i}`, `React frontend job ${i}`, t]);
}
