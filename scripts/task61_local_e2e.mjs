// Task 61: local E2E — persianstremio wave-2 landing + budget echo fix.
import { spawn } from 'child_process';

const REPO = '/home/z/my-project/phoenix-analysis';
const PORT = 4701;
const BASE = `http://127.0.0.1:${PORT}`;

const child = spawn('node', ['src/index.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const wait = (ms) => new Promise(r => setTimeout(r, ms));
let up = false;
for (let i = 0; i < 40 && !up; i++) {
  try { const r = await fetch(`${BASE}/manifest.json`, { signal: AbortSignal.timeout(2000) }); up = r.ok; } catch {}
  if (!up) await wait(1000);
}
if (!up) { console.log('BOOT FAILED'); child.kill(); process.exit(1); }
console.log('local addon up');

// merged resolve (cold) — persianstremio must land IN-request (wave-2)
const t0 = Date.now();
const d = await (await fetch(`${BASE}/stream/movie/tt1375666.json`, { signal: AbortSignal.timeout(120000) })).json();
const dt = Date.now() - t0;
const ss = d.streams || [];
const ps = ss.filter(s => /persianstremio/i.test(JSON.stringify(s.behaviorHints || {}) + s.name + s.title));
console.log(`merged Inception: ${ss.length} cards in ${dt}ms | persianstremio cards: ${ps.length}`);
if (ps.length) console.log('  sample:', ps[0].name, '|', String(ps[0].url).slice(0, 90));

// budget echo
const dbg = await (await fetch(`${BASE}/debug/stream?type=movie&id=tt1375666`, { signal: AbortSignal.timeout(120000) })).json();
console.log(`debug echo: clientBudgetMs=${dbg.clientBudgetMs} (expect 40000) partial=${dbg.partial} totalMs=${dbg.totalMs} streams=${dbg.totalStreams}`);

const ok = ps.length > 0 && dbg.clientBudgetMs === 40000;
console.log(ok ? 'E2E PASS' : 'E2E FAIL');
child.kill('SIGKILL');
process.exit(ok ? 0 : 1);
