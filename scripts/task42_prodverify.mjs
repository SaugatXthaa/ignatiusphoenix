// Task 42: production verification — deploy live + gate drops gated-dead cards on warm pass
const BASE = 'https://ignatiusphoenix.onrender.com';

async function j(url, timeout = 90000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  return r.json();
}

// wait for deploy: /debug/source should respond with the new behavior; poll manifest until 200
let ready = false;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`${BASE}/manifest.json`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) { ready = true; break; }
  } catch {}
  await new Promise(rr => setTimeout(rr, 15000));
}
if (!ready) { console.error('deploy not reachable'); process.exit(1); }
console.log('production reachable, waiting 300s for deploy rollout + boot warm-up...');
await new Promise(rr => setTimeout(rr, 300000));

const CHECKS = [
  ['movie', 'tt1375666', 'Inception', ['hdhub4u', 'streamxtv', 'cineby', 'moviesdrivev2', 'stellar', 'movieshuntv2']],
  ['series', 'tt0903747:1:1', 'BreakingBad S1E1', ['hdhub4u', 'streamxtv', 'cineby', 'moviesdrivev2']],
  ['series', 'tmdb:209867:1:1', 'Frieren S1E1', ['streamxtv', 'cineby', 'animekai', 'anibd', 'hianime']],
];

const BAD_HOSTS = ['nexabloom', 'nhdapi.com', 'vimeos.zip', 'vimeos.net', 'player.zxcstream.xyz']; // last = sanctioned exception (excluded from drop rule)
const ZIP_RE = /\.(zip|rar|7z)(?:[?#]|$)/i;

for (const [type, id, label, sources] of CHECKS) {
  // two passes: pass 1 warms verdicts/circuits, pass 2 must show drops
  const counts = [];
  let badHosts = {}, zipCards = 0, perSource = {};
  for (let pass = 0; pass < 2; pass++) {
    const data = await j(`${BASE}/stream/${type}/${id}.json`, 120000);
    const all = data.streams || [];
    counts.push(all.length);
    if (pass === 1) {
      for (const s of all) {
        const u = s.url || '';
        // toroplay/nested third-party proxies legitimately embed gated hosts
        // as params (their servers do the upstream fetching, not ours)
        const nested = u.includes('toroplay') || /url=https?(:|%3A|%2F%2F).*nexabloom/.test(u);
        const hit = BAD_HOSTS.find(h => u.includes(h));
        if (hit && hit !== 'player.zxcstream.xyz' && !nested) badHosts[hit] = (badHosts[hit] || 0) + 1;
        const m = /phoenix-([a-z0-9_]+)-/.exec(s.behaviorHints?.bingeGroup || '');
        const sid = m ? m[1] : '?';
        if (sources.includes(sid)) perSource[sid] = (perSource[sid] || 0) + 1;
        if (ZIP_RE.test(u)) zipCards++;
      }
    }
    if (pass === 0) await new Promise(rr => setTimeout(rr, 90000));
  }
  console.log(`\n=== ${label} ===  pass1=${counts[0]} cards, warm pass2=${counts[1]} cards`);
  console.log('  gated-host cards on warm pass:', JSON.stringify(badHosts), '| zip cards:', zipCards);
  console.log('  per-source:', JSON.stringify(perSource));
}
console.log('\nDONE');
