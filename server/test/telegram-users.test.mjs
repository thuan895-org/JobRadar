const R = new URL('../src/', import.meta.url).href;
process.env.TELEGRAM_CHANNEL_ID = '@jobradar_test';
process.env.CHANNEL_DIGEST_HOUR = '0';
const { initDb, pool } = await import(R + 'db.js');
const { createUser } = await import(R + 'accounts.js');
const { saveProfile } = await import(R + 'profiles.js');
const { notifyUsers, channelDigest, saveUserTelegramSettings } = await import(R + 'telegram-users.js');
const { loadConfig } = await import(R + 'util.js');
const { localTime } = await import(R + 'settings.js');
await initDb();
const config = loadConfig();
const checks = [];
const check = (name, ok, detail = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const reset = () => { tg.sent = []; tg.full = []; tg.chats = []; tg.calls = 0; tg.failAt = null; };
const hourAgo = new Date(Date.now() - 3.6e6).toISOString();
async function job(id, title, desc = 'react typescript frontend') {
  const t = new Date().toISOString();
  await pool.query(`INSERT INTO jobs (id, source, title, url, description, location, first_seen, last_seen, posted_at, region_ok) VALUES ($1,'x',$2,'https://x/'||$1,$3,'Anywhere',$4,$4,$4,TRUE)`, [id, title, desc, t]);
}
async function linkedUser(email, { pro = true, skills = [{ id: 'web', level: 'main' }], chat }) {
  const u = await createUser({ email, name: email, acceptTerms: true });
  if (!pro) await pool.query(`UPDATE users SET trial_ends_at = '2020-01-01T00:00:00.000Z' WHERE id = $1`, [u.id]);
  await pool.query(`UPDATE users SET telegram_chat_id = $2, telegram_linked_at = $3 WHERE id = $1`, [u.id, chat, hourAgo]);
  await saveProfile(u.id, { skills });
  // Quiet hours default to 00:00–06:00 Vietnam time; start with them off so the result does not depend on the clock.
  await saveUserTelegramSettings(u.id, { quietEnabled: false, quietStart: '00:00', quietEnd: '06:00', timezone: VN, minScore: 20 });
  return u;
}
const VN = 'Asia/Ho_Chi_Minh';
const hm = (h) => localTime(new Date(Date.now() + h * 3.6e6), VN);

const pro = await linkedUser('pro@test.vn', { chat: '111' });
await linkedUser('free@test.vn', { pro: false, chat: '222' });
await linkedUser('designer@test.vn', { chat: '333', skills: [{ id: 'graphic', level: 'main' }] });
await job('j1', 'Senior React developer');
await job('j2', 'Logo designer', 'photoshop illustrator logo design');

reset();
let r = await notifyUsers(config, 'http://test');
check('each Pro user gets the job matching their own profile', tg.chats.filter((c) => c === '111').length === 1 && tg.chats.filter((c) => c === '333').length === 1, JSON.stringify(tg.chats));
check('…React job to the web developer, logo job to the designer', tg.full[tg.chats.indexOf('111')].includes('React') && tg.full[tg.chats.indexOf('333')].includes('Logo'));
check('the Free user gets no personal alert', !tg.chats.includes('222'));
reset();
await notifyUsers(config, 'http://test');
check('nothing is sent twice', tg.chats.length === 0);

await saveUserTelegramSettings(pro.id, { quietEnabled: true, quietStart: hm(-1), quietEnd: hm(1), timezone: VN, minScore: 20 });
await job('j3', 'React native and react web app');
await job('j4', 'Frontend React engineer');
reset();
await notifyUsers(config, 'http://test');
check('quiet hours: nothing sent to that user', !tg.chats.includes('111'));
await saveUserTelegramSettings(pro.id, { quietEnabled: true, quietStart: hm(2), quietEnd: hm(3), timezone: VN, minScore: 20, held: true });
reset();
await notifyUsers(config, 'http://test');
const toPro = tg.full.filter((_, i) => tg.chats[i] === '111');
check('after quiet hours: one list with both held jobs', toPro.length === 1 && toPro[0].includes('Bản tin đầu ngày') && toPro[0].includes('React native') && toPro[0].includes('Frontend React'));

reset();
r = await channelDigest(config, 'http://test');
check('the channel gets a daily digest grouped by field', r && tg.chats[0] === '@jobradar_test' && tg.full[0].includes('<b>Frontend / Web</b>') && tg.full[0].includes('/app/signup'), tg.full[0]?.slice(0, 120));
reset();
r = await channelDigest(config, 'http://test');
check('…only once a day', r === false && tg.chats.length === 0);

console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
