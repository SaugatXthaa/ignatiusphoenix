// Task 51: reproduce the "Mutiny" wrong-title card for Homecoming (tmdb:315635)
const { spawn } = require('child_process');
const child = spawn('node', ['src/index.js'], { env: { ...process.env, PORT: '4674', STREAM_CLIENT_BUDGET_MS: '40000' }, stdio: ['ignore', 'ignore', 'pipe'] });
child.stderr.on('data', d => process.stderr.write(d));
(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch('http://127.0.0.1:4674/health', { signal: AbortSignal.timeout(1000) }); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
  const d = await (await fetch('http://127.0.0.1:4674/debug/source/cinewave?type=movie&id=tmdb:315635')).json();
  console.log('cinewave count=' + d.count + ' @' + (d.durationMs / 1000) + 's');
  for (const r of (d.results || [])) {
    const t = r.meta?.title || '';
    if (!/spider|homecoming/i.test(t)) console.log('  SUSPECT:', t.slice(0, 90), '|', (r.url || '').slice(0, 70));
  }
  child.kill('SIGTERM'); process.exit(0);
})();
