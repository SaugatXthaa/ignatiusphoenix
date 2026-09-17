// Task 51: boot local addon once, probe the zero-yield sources with logs.
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');
const PORT = 4672;
const BASE = `http://127.0.0.1:${PORT}`;

const child = spawn('node', ['src/index.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(PORT), STREAM_CLIENT_BUDGET_MS: '40000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.on('data', d => process.stderr.write(d));

async function jget(url, timeoutMs = 70000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  return res.json();
}
for (let i = 0; i < 40; i++) {
  try { await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) }); break; }
  catch { await new Promise(r => setTimeout(r, 500)); }
}

const id = process.argv[2] || 'tmdb:27205';
const list = (process.argv[3] || 'acermovies,pantyflix,cinehdplus,kmmovies,vixsrc,stellarrip,nowhdtime').split(',');
for (const s of list) {
  const t0 = Date.now();
  try {
    const d = await jget(`${BASE}/debug/source/${s}?type=movie&id=${id}`);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n=== ${s}: count=${d.count} @${dt}s ${d.error ? 'ERROR ' + d.error : ''} ===`);
    for (const l of (d.logs || []).slice(0, 6)) console.log('  ', l.slice(0, 160));
  } catch (e) {
    console.log(`\n=== ${s}: PROBE FAIL ${e.message} ===`);
  }
}
child.kill('SIGTERM');
process.exit(0);
