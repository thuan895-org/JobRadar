// One-off: copies data/jobs.sqlite (the old local database) into Postgres,
// including every AI result, so nothing has to be sent to Gemini again.
// Rows already in Postgres are left as they are. Run: npm run migrate
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './util.js';
import { pool, initDb } from './db.js';

const file = join(ROOT, 'data', 'jobs.sqlite');
if (!existsSync(file)) {
  console.log(`Nothing to copy: ${file} does not exist.`);
  process.exit(0);
}

const COLUMNS = [
  'id', 'source', 'title', 'company', 'url', 'description', 'tags', 'kind', 'location',
  'budget_text', 'budget_min_usd', 'budget_max_usd', 'posted_at', 'bid_count', 'score', 'matched',
  'region_ok', 'status', 'first_seen', 'last_seen', 'notified',
  'ai_score', 'ai_reason', 'ai_flags', 'ai_scam', 'ai_checked_at', 'apply_kit', 'ai_highlights',
];
const BOOLEANS = new Set(['region_ok', 'notified']);
const JSON_COLS = { tags: '[]', matched: '[]', ai_flags: '[]', apply_kit: null, ai_highlights: null };

const sqlite = new DatabaseSync(file, { readOnly: true });
const have = new Set(sqlite.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name));
const rows = sqlite.prepare('SELECT * FROM jobs').all();
await initDb();

const insert = `INSERT INTO jobs (${COLUMNS.join(', ')})
  VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`;
let copied = 0;
for (const r of rows) {
  const values = COLUMNS.map((c) => {
    const v = have.has(c) ? r[c] : null;
    if (BOOLEANS.has(c)) return Boolean(v);
    if (c in JSON_COLS) return v ?? JSON_COLS[c]; // already JSON text in SQLite
    return v;
  });
  const { rowCount } = await pool.query(insert, values);
  copied += rowCount;
}
for (const { key, value } of sqlite.prepare('SELECT key, value FROM meta').all()) {
  await pool.query('INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
}
console.log(`Copied ${copied} of ${rows.length} jobs (${rows.length - copied} were already in Postgres).`);
await pool.end();
