// Runs every test file. No network, no real database: Postgres is PGlite in
// memory (pg-shim.mjs), and Gemini, Telegram, Google, Resend and the job
// sources are faked in preload.mjs / server-preload.mjs.
//
// - *.test.mjs files listed in IN_PROCESS import server modules directly.
// - The others talk HTTP to a real server process started fresh for each file,
//   so every file begins with an empty database.
//
// Usage: npm test            (all files)
//        npm test -- feed    (files whose name contains "feed")
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TEST_PORT ?? 4391);
const BASE = `http://127.0.0.1:${PORT}`;
const IN_PROCESS = new Set(['scan.test.mjs', 'quiet-hours.test.mjs', 'db-rules.test.mjs', 'telegram-users.test.mjs']);
const NODE_FLAGS = ['--disable-warning=ExperimentalWarning'];

const filter = process.argv[2] ?? '';
const files = readdirSync(DIR).filter((f) => f.endsWith('.test.mjs') && f.includes(filter)).sort();

function run(args, env, { quiet = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: DIR, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (!quiet) process.stdout.write(d); });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => resolve({ code, out }));
  });
}

async function startServer() {
  const child = spawn(process.execPath, [...NODE_FLAGS, '--import', './server-preload.mjs', '../src/server.js'],
    { cwd: DIR, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', TEST_PUBLIC_URL: BASE }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`test server exited:\n${log}`);
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return { child, log: () => log };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  child.kill();
  throw new Error(`test server did not start within 30s:\n${log}`);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const done = new Promise((r) => child.once('exit', r));
  child.kill('SIGTERM');
  await Promise.race([done, new Promise((r) => setTimeout(r, 3000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

const results = [];
for (const file of files) {
  console.log(`\n━━ ${file} ━━`);
  let server = null;
  let res;
  try {
    if (IN_PROCESS.has(file)) {
      res = await run([...NODE_FLAGS, '--import', './preload.mjs', file], {}, { quiet: true });
      process.stdout.write(res.out.split('\n').filter((l) => /^(PASS|FAIL|\d+\/\d+ checks)/.test(l)).join('\n') + '\n');
    } else {
      server = await startServer();
      res = await run([file], { TEST_BASE: BASE });
    }
  } catch (err) {
    res = { code: 1, out: String(err.message) };
    console.log(err.message);
  } finally {
    if (server) {
      if (res?.code !== 0) console.log(`--- last server log lines ---\n${server.log().split('\n').slice(-40).join('\n')}`);
      await stop(server.child);
    }
  }
  const summary = (res.out.match(/(\d+)\/(\d+) checks passed/) ?? []).slice(1).map(Number);
  results.push({ file, ok: res.code === 0, passed: summary[0] ?? 0, total: summary[1] ?? 0 });
}

console.log('\n━━ Summary ━━');
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.file.padEnd(28)} ${r.passed}/${r.total}`);
const passed = results.reduce((s, r) => s + r.passed, 0);
const total = results.reduce((s, r) => s + r.total, 0);
const failed = results.filter((r) => !r.ok);
console.log(`\n${passed}/${total} checks passed in ${results.length} files${failed.length ? `, ${failed.length} file(s) failed` : ''}`);
process.exit(failed.length || !results.length ? 1 : 0);
