const R = new URL('../src/', import.meta.url).href;
const { initDb, pool } = await import(R + 'db.js');
const { runOnce } = await import(R + 'run.js');
await initDb();
// Quiet hours default to 00:00–06:00 Vietnam time; this test must not depend on when it runs.
await (await import(R + 'settings.js')).saveTelegramSettings({ quietEnabled: false, quietStart: '00:00', quietEnd: '06:00' });
const ago = (h) => new Date(Date.now() - h * 3.6e6).toISOString();
async function seed(id, { score = 30, notified = false, postedHoursAgo = 1, status = 'new' } = {}) {
  await pool.query(`INSERT INTO jobs (id, source, title, url, score, notified, status, posted_at, first_seen, last_seen, region_ok)
    VALUES ($1,'test',$1,'https://example.com/'||$1,$2,$3,$4,$5,$6,$6,TRUE)`, [id, score, notified, status, ago(postedHoursAgo), ago(0.1)]);
}
const notified = async (id) => (await pool.query('SELECT notified FROM jobs WHERE id=$1', [id])).rows[0].notified;
const checks = [];
const check = (name, ok, detail = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

console.log('\n== Bug 1: a new job must not lose its AI turn to the backlog ==');
for (let i = 0; i < 40; i++) await seed(`old-${i}`, { score: 80, notified: true, postedHoursAgo: 240 });
for (const id of ['new-a', 'new-b', 'new-c', 'new-bad']) await seed(id, { score: 30 });
await seed('new-but-old-post', { score: 50, postedHoursAgo: 120 });
let r = await runOnce({ force: true });
const firstAi = gemini.scored.slice(0, 10);
check('AI read the 4 pending jobs first', ['new-a', 'new-b', 'new-c', 'new-bad'].every((id) => firstAi.includes(id)), `first batch: ${firstAi.join(', ')}`);
check('the 3 good new jobs were sent', ['new-a', 'new-b', 'new-c'].every((id) => tg.sent.includes(id)) && r.sent === 3, `sent: ${tg.sent.join(', ')}`);
check('the job AI rated 30 was not sent but is settled', !tg.sent.includes('new-bad') && await notified('new-bad'));
check('a job posted 5 days ago is settled without AI or Telegram', !tg.sent.includes('new-but-old-post') && await notified('new-but-old-post') && !firstAi.includes('new-but-old-post'));

console.log('\n== Bug 2: a Telegram error must not lose the unsent jobs ==');
tg.sent = []; tg.calls = 0; tg.failAt = 3;
for (const id of ['f1', 'f2', 'f3', 'f4', 'f5']) await seed(id, { score: 40 });
r = await runOnce({ force: true });
const left = [];
for (const id of ['f1', 'f2', 'f3', 'f4', 'f5']) if (!(await notified(id))) left.push(id);
check('2 sent before the error', r.sent === 2, `sent: ${tg.sent.join(', ')}`);
check('the 3 unsent jobs are still pending', left.length === 3, `pending: ${left.join(', ')}`);
tg.sent = []; tg.calls = 0; tg.failAt = null;
const scoredBefore = gemini.scored.length;
r = await runOnce({ force: true });
check('next scan sends exactly those 3', r.sent === 3 && left.every((id) => tg.sent.includes(id)), `sent: ${tg.sent.join(', ')}`);
check('no job was sent twice and Gemini did not re-read them', tg.sent.every((id) => left.includes(id)) && !gemini.scored.slice(scoredBefore).some((id) => left.includes(id)));

console.log('\n== Telegram off: nothing queues up ==');
process.env.TELEGRAM_CHAT_ID = ''; tg.sent = [];
await seed('while-off', { score: 40 });
r = await runOnce({ force: true });
check('job seen while Telegram is off is settled, nothing sent', await notified('while-off') && tg.sent.length === 0);

console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
