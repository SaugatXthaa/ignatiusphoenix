// Task 61: local A/B for suspect sources — boots the addon locally and runs
// the same /debug/source probes as production. Local OK + prod ZERO = upstream
// gating of datacenter IP (or prod-instance cache). Local ZERO too = upstream
// site change / our regression.
import { spawn } from 'child_process';
import fs from 'fs';

const REPO = '/home/z/my-project/phoenix-analysis';
const PORT = 4699;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = `${REPO}/scripts/task61`;

const PROBES = [
  ['kmmovies', 'movie', 'tt1375666', 'Inception'],
  ['anineko', 'series', 'tmdb:209867:2:1', 'FrierenS2E1'],
  ['animekai', 'series', 'tmdb:209867:2:1', 'FrierenS2E1'],
  ['animezey', 'series', 'tmdb:209867:2:1', 'FrierenS2E1'],
  ['animesdigital', 'series', 'tmdb:209867:2:1', 'FrierenS2E1'],
  ['animeworldindia', 'series', 'tmdb:209867:2:1', 'FrierenS2E1'],
  ['2dhive', 'series', 'tmdb:209867:2:1', 'FrierenS2E1'],
  ['cinejoyaio', 'movie', 'tt1375666', 'Inception'],
];

const wait = (ms) => new Promise(r => setTimeout(r, ms));

const child = spawn('node', ['src/index.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(PORT), STREAM_CLIENT_BUDGET_MS: '40000', NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const bootLog = [];
child.stdout.on('data', d => bootLog.push(d.toString()));
child.stderr.on('data', d => bootLog.push(d.toString()));

const up = await new Promise((resolve) => {
  let n = 0;
  const iv = setInterval(async () => {
    n++;
    try {
      const r = await fetch(`${BASE}/manifest.json`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) { clearInterval(iv); resolve(true); }
    } catch {}
    if (n > 40) { clearInterval(iv); resolve(false); }
  }, 1000);
});
if (!up) { console.log('BOOT FAILED'); console.log(bootLog.join('').slice(-2000)); child.kill(); process.exit(1); }
console.log('local addon up');
await wait(1500);

const results = [];
for (const [id, type, iid, label] of PROBES) {
  const t0 = Date.now();
  try {
    const raw = await (await fetch(`${BASE}/debug/source/${id}?type=${type}&id=${encodeURIComponent(iid)}`, { signal: AbortSignal.timeout(60000) })).json();
    const rec = { id, title: label, count: raw.count ?? null, timedOut: !!raw.timedOut, error: raw.error || null, ms: raw.durationMs || (Date.now() - t0) };
    if (raw.logs?.length) rec.logTail = raw.logs.slice(-4);
    results.push(rec);
    console.log(`${rec.count > 0 ? 'OK  ' : rec.timedOut ? 'TMO ' : 'ZERO'} ${id.padEnd(16)} count=${String(rec.count).padStart(3)} ${String(rec.ms).padStart(6)}ms ${rec.error || ''}`);
    (rec.logTail || []).forEach(l => console.log('   |', String(l).slice(0, 150)));
  } catch (e) {
    results.push({ id, error: String(e).slice(0, 100) });
    console.log(`ERR  ${id}: ${String(e).slice(0, 80)}`);
  }
  await wait(1500);
}
fs.writeFileSync(`${OUT}/local_ab.json`, JSON.stringify(results, null, 1));
child.kill('SIGKILL');
console.log('done');
process.exit(0);
