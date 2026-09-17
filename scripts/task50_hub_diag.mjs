// task50_hub_diag.mjs — Task 50: diagnose 4khdhub family count=0 flakiness.
// Boots the addon as a child (same pattern as task23_baseline Part C), then
// probes 4khdhub + fourkhdhubone repeatedly (with gaps) to observe the
// "returns 0 until several refreshes" behavior and dump per-probe logs.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');
const PORT = 4598;

const child = spawn('node', ['src/index.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const logFile = `/tmp/task50_diag_${PORT}.log`;
const logStream = fs.createWriteStream(logFile);
child.stdout.pipe(logStream);
child.stderr.pipe(logStream);
let bootLines = '';
child.stdout.on('data', d => { bootLines += d; });
child.stderr.on('data', d => { bootLines += d; });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitHealthy(budgetMs = 40000) {
  const end = Date.now() + budgetMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

async function getJson(url, timeoutMs = 90000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return await res.json();
  } catch (e) { return { error: e.message.slice(0, 80) }; }
}

const PROBES = [
  ['4khdhub', 'tmdb:27205'],
  ['fourkhdhubone', 'tmdb:27205'],
];

const ROUNDS = 5;
const GAP_MS = 12000;

(async () => {
  if (!(await waitHealthy())) {
    console.log('FATAL: addon never became healthy');
    child.kill('SIGTERM');
    process.exit(1);
  }
  console.log('addon healthy — starting probe rounds');
  for (let r = 1; r <= ROUNDS; r++) {
    console.log(`\n===== ROUND ${r} =====`);
    for (const [id, tmdb] of PROBES) {
      const d = await getJson(`http://127.0.0.1:${PORT}/debug/source/${id}?type=movie&id=${tmdb}`);
      const count = d?.count ?? 'ERR';
      const dur = d?.durationMs ?? '?';
      console.log(`[${id}] round ${r}: count=${count} in ${dur}ms`);
      const logs = d?.logs || [];
      for (const l of logs.slice(-12)) console.log(`    | ${String(l).slice(0, 160)}`);
      if (d?.error) console.log(`    | fetch-error: ${d.error}`);
    }
    if (r < ROUNDS) await sleep(GAP_MS);
  }
  console.log('\ndone — killing addon');
  child.kill('SIGTERM');
  await sleep(500);
  process.exit(0);
})().catch(e => { console.error('diag error:', e); child.kill('SIGTERM'); process.exit(1); });
