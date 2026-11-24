const R = new URL('../src/', import.meta.url).href;
const { initDb, pool, deleteStaleJobs } = await import(R + 'db.js');
const { createUser, deleteUser } = await import(R + 'accounts.js');
const { saveProfile } = await import(R + 'profiles.js');
await initDb();
const checks = [];
const check = (name, ok) => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const old = new Date(Date.now() - 90 * 864e5).toISOString();
for (const id of ['old-saved', 'old-plain']) {
  await pool.query(`INSERT INTO jobs (id, source, title, url, first_seen, last_seen) VALUES ($1,'x',$1,'https://x/'||$1,$2,$2)`, [id, old]);
}
const u = await createUser({ email: 'u@test.vn', name: 'U', acceptTerms: true });
await pool.query(`INSERT INTO user_jobs (user_id, job_id, status, updated_at) VALUES ($1,'old-saved','saved',$2)`, [u.id, old]);
await saveProfile(u.id, { skills: [{ id: 'web', level: 'main' }] });
const deleted = await deleteStaleJobs(60);
const left = (await pool.query(`SELECT id FROM jobs ORDER BY id`)).rows.map((r) => r.id);
check('cleanup deletes the old unsaved job only', deleted === 1 && left.includes('old-saved') && !left.includes('old-plain'));
await deleteUser(u.id);
const rows = async (t) => Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE user_id = $1`, [u.id])).rows[0].n);
check('deleting the account removes their job states and profile', (await rows('user_jobs')) === 0 && (await rows('user_profiles')) === 0);
console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
