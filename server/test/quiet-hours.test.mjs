const R = new URL('../src/', import.meta.url).href;
const { initDb, pool, getMeta } = await import(R + 'db.js');
const { runOnce } = await import(R + 'run.js');
const { inQuietHours, saveTelegramSettings, getTelegramSettings, localTime } = await import(R + 'settings.js');
await initDb();
const checks = [];
const check = (name, ok, detail = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const VN = 'Asia/Ho_Chi_Minh';

console.log('== Quiet-hour clock (Vietnam time = UTC+7) ==');
const night = { quietEnabled: true, quietStart: '00:00', quietEnd: '06:00', timezone: VN };
check('01:30 VN is quiet', inQuietHours(night, new Date('2026-11-23T18:30:00Z')));
check('05:59 VN is quiet', inQuietHours(night, new Date('2026-11-23T22:59:00Z')));
check('06:00 VN is not quiet', !inQuietHours(night, new Date('2026-11-23T23:00:00Z')));
check('23:59 VN is not quiet', !inQuietHours(night, new Date('2026-11-23T16:59:00Z')));
const late = { ...night, quietStart: '22:00', quietEnd: '06:00' };
check('22:30 VN is quiet in 22:00–06:00', inQuietHours(late, new Date('2026-11-23T15:30:00Z')));
check('03:00 VN is quiet in 22:00–06:00', inQuietHours(late, new Date('2026-11-23T20:00:00Z')));
check('19:00 VN is not quiet in 22:00–06:00', !inQuietHours(late, new Date('2026-11-23T12:00:00Z')));
check('switched off is never quiet', !inQuietHours({ ...night, quietEnabled: false }, new Date('2026-11-23T18:30:00Z')));
check('default is 00:00–06:00 Vietnam, on', JSON.stringify(await getTelegramSettings()) === JSON.stringify(night));
for (const [bad, why] of [[{ quietEnabled: true, quietStart: '25:00', quietEnd: '06:00' }, 'hour 25'], [{ quietEnabled: true, quietStart: '06:00', quietEnd: '06:00' }, 'same start and end'], [{ quietEnabled: true, quietStart: '00:00', quietEnd: '06:00', timezone: 'Mars/Base' }, 'bad timezone']]) {
  let msg = null; try { await saveTelegramSettings(bad); } catch (e) { msg = e.message; }
  check(`rejects ${why}`, Boolean(msg), msg);
}

const ago = (h) => new Date(Date.now() - h * 3.6e6).toISOString();
async function seed(id, score = 40) {
  await pool.query(`INSERT INTO jobs (id, source, title, url, score, notified, status, posted_at, first_seen, last_seen, region_ok, budget_text)
    VALUES ($1,'freelancer',$1,'https://example.com/'||$1,$2,FALSE,'new',$3,$3,$3,TRUE,'$300–$600')`, [id, score, ago(0.5)]);
}
const notified = async (id) => (await pool.query('SELECT notified FROM jobs WHERE id=$1', [id])).rows[0].notified;
const hm = (h) => localTime(new Date(Date.now() + h * 3.6e6), VN);
const quietNow = () => saveTelegramSettings({ quietEnabled: true, quietStart: hm(-1), quietEnd: hm(1), timezone: VN });
const awakeNow = () => saveTelegramSettings({ quietEnabled: true, quietStart: hm(2), quietEnd: hm(3), timezone: VN });
const reset = () => { tg.sent = []; tg.full = []; tg.calls = 0; tg.failAt = null; };

console.log('\n== During quiet hours: nothing is sent, jobs are held ==');
await quietNow(); reset();
for (const id of ['night-1', 'night-2', 'night-3', 'night-bad']) await seed(id);
let r = await runOnce({ force: true });
check('no message sent', tg.sent.length === 0 && r.sent === 0);
check('the 3 good jobs are still pending', !(await notified('night-1')) && !(await notified('night-2')) && !(await notified('night-3')));
check('the job AI rated 30 is settled anyway', await notified('night-bad'));
check('the "held" flag is set', (await getMeta('telegramHeld')) === true);
r = await runOnce({ force: true });
check('a second quiet scan still sends nothing', tg.sent.length === 0);

console.log('\n== First scan after quiet hours: one list ==');
await awakeNow(); reset();
r = await runOnce({ force: true });
check('exactly one message', tg.full.length === 1, `${tg.full.length} messages`);
check('it lists all 3 held jobs', ['night-1', 'night-2', 'night-3'].every((t) => tg.full[0]?.includes(`>${t}</a>`)));
check('it does not list the rejected job', !tg.full[0]?.includes('night-bad'));
check('all 3 are now settled, flag cleared', (await notified('night-1')) && (await notified('night-3')) && (await getMeta('telegramHeld')) === false);
console.log('---- the list as sent ----\n' + tg.full[0] + '\n--------------------------');

console.log('\n== Daytime: back to one message per job ==');
reset(); await seed('day-1');
r = await runOnce({ force: true });
check('the new job goes out on its own', tg.sent.length === 1 && tg.sent[0] === 'day-1');

console.log('\n== A long night: 30 held jobs ==');
await quietNow(); reset();
for (let i = 1; i <= 30; i++) await seed(`long-night-job-number-${String(i).padStart(2, '0')}`);
await runOnce({ force: true });
await awakeNow(); reset();
r = await runOnce({ force: true });
check('still one message, under Telegram\'s 4096 limit', tg.full.length === 1 && tg.full[0].length < 4096, `${tg.full[0]?.length} characters`);
check('shows 20 and counts the other 10', (tg.full[0].match(/^\d+\. /gm) ?? []).length === 20 && tg.full[0].includes('còn <b>10</b> job khác'));
check('all 30 settled', r.sent === 30);

console.log('\n== The morning list fails to send ==');
await quietNow(); reset();
await seed('retry-1'); await seed('retry-2');
await runOnce({ force: true });
await awakeNow(); reset(); tg.failAt = 1;
r = await runOnce({ force: true });
check('nothing marked after the error, flag kept', !(await notified('retry-1')) && (await getMeta('telegramHeld')) === true && r.sent === 0);
reset();
r = await runOnce({ force: true });
check('next scan sends the list', tg.full.length === 1 && tg.full[0].includes('retry-1') && tg.full[0].includes('retry-2') && (await notified('retry-2')));

console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
