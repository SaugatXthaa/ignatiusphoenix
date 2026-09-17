// Task 51: combined local verification of all fixes
const { spawn } = require('child_process');
const child = spawn('node', ['src/index.js'], { env: { ...process.env, PORT: '4675', STREAM_CLIENT_BUDGET_MS: '40000' }, stdio: ['ignore', 'ignore', 'pipe'] });
child.stderr.on('data', d => process.stderr.write(d));
const BASE = 'http://127.0.0.1:4675';
(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) }); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
  const jget = async (u, t = 70000) => (await fetch(u, { signal: AbortSignal.timeout(t) })).json();

  // 1. hdhub4uv2 Spider-Verse (hblinks.lol funnel fix)
  const h4 = await jget(`${BASE}/debug/source/hdhub4uv2?type=movie&id=tmdb:324857`);
  console.log(`[1] hdhub4uv2 Spider-Verse: count=${h4.count} (expect >=3)`);

  // 2. vixsrc (revival — direct playlist + proxyHeaders)
  const vx = await jget(`${BASE}/debug/source/vixsrc?type=movie&id=tmdb:315635`);
  console.log(`[2] vixsrc Homecoming: count=${vx.count} (expect 1)`);
  if (vx.results?.[0]) {
    console.log(`    url: ${vx.results[0].url?.slice(0, 80)}`);
    // full merged stream — check proxyHeaders on the vixsrc card
    const st = await jget(`${BASE}/stream/movie/tmdb:315635.json`);
    const vxc = (st.streams || []).filter(s => /VixSrc/i.test(s.name || ''));
    const ph = vxc[0]?.behaviorHints?.proxyHeaders;
    console.log(`    merged vixsrc cards: ${vxc.length}, proxyHeaders: ${ph ? JSON.stringify(ph).slice(0, 90) : 'MISSING'}`);
  }

  // 3. pantyflix (Fetcher transport)
  const pf = await jget(`${BASE}/debug/source/pantyflix?type=movie&id=tmdb:27205`);
  console.log(`[3] pantyflix Inception: count=${pf.count} (expect >=2)`);

  // 4. kmmovies (got-scraping fallback — sandbox has curl so unchanged, but sanity)
  const km = await jget(`${BASE}/debug/source/kmmovies?type=movie&id=tmdb:27205`);
  console.log(`[4] kmmovies Inception: count=${km.count} (expect >=3)`);

  // 5. raflix (GOAWAY retry)
  const rf = await jget(`${BASE}/debug/source/raflix?type=movie&id=tmdb:27205`);
  console.log(`[5] raflix Inception: count=${rf.count} (expect >=3)`);

  // 6. bollyflix (resolveFastdl GOAWAY retry)
  const bf = await jget(`${BASE}/debug/source/bollyflix?type=movie&id=tmdb:27205`);
  console.log(`[6] bollyflix Inception: count=${bf.count} (expect >=2)`);

  child.kill('SIGTERM'); process.exit(0);
})();
