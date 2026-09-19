// Task 63: full production sweep — subs via REAL Stremio path (tt ids) + all-source matrix
const BASE = 'https://ignatiusphoenix.onrender.com';

async function j(url, ms = 60000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { accept: 'application/json' } });
    const txt = await r.text();
    try { return JSON.parse(txt); } catch { return { _raw: txt.slice(0, 200) }; }
  } catch (e) { return { _err: String(e).slice(0, 120) }; }
  finally { clearTimeout(t); }
}

const TITLES = [
  { name: 'Inception', type: 'movie', id: 'tt1375666', tmdb: 'tmdb:27205' },
  { name: 'GoT S1E1', type: 'series', id: 'tt0944947', tmdb: 'tmdb:1399:1:1' },
];

// ---- 1) SUBTITLE CHECK via the REAL Stremio path (tt id, as the user plays) ----
console.log('=== SUBTITLE CHECK (real /stream path, tt ids) ===');
for (const t of TITLES) {
  const r = await j(`${BASE}/stream/${t.type}/${t.id}.json`);
  const streams = Array.isArray(r?.streams) ? r.streams : [];
  const withSubs = streams.filter(s => s.subtitles?.length);
  const urlCards = streams.filter(s => /^(https?:)?\/\//.test(s.url || ''));
  console.log(`${t.name}: cards=${streams.length} subbed=${withSubs.length} (${streams.length ? Math.round(100 * withSubs.length / streams.length) : 0}%) htmlUrl=${urlCards.length}`);
  if (streams.length) {
    const sample = withSubs[0]?.subtitles?.[0];
    console.log(`  sample sub: ${sample ? sample.lang + ' ' + String(sample.url).slice(0, 100) : 'NONE'}`);
    // fetch one sub URL and validate VTT
    if (sample) {
      const c = new AbortController(); const tm = setTimeout(() => c.abort(), 20000);
      try {
        const r2 = await fetch(sample.url.startsWith('//') ? 'https:' + sample.url : sample.url, { signal: c.signal });
        const body = await r2.text();
        console.log(`  sub fetch: ${r2.status} ct=${r2.headers.get('content-type')} head=${body.slice(0, 60).replace(/\n/g, '\\n')}`);
      } catch (e) { console.log(`  sub fetch ERR: ${String(e).slice(0, 80)}`); }
      finally { clearTimeout(tm); }
    }
  }
}

// ---- 2) debug/subs with tt vs numeric (repro the user's "no subtitles" claim) ----
console.log('\n=== DEBUG SUBS (tt vs numeric) ===');
for (const [label, q] of [
  ['GoT tt', '/debug/subs?type=series&id=tt0944947:1:1'],
  ['GoT num', '/debug/subs?type=series&id=tmdb:1399:1:1'],
  ['Inception tt', '/debug/subs?type=movie&id=tt1375666'],
]) {
  const r = await j(`${BASE}${q}`);
  console.log(`${label}: count=${r.count} granite=${r.byProvider?.granite} natsuki=${r.byProvider?.natsuki} ${r.timedOut ? 'TIMEOUT' : ''} ${r.error ? 'ERR=' + r.error : ''}`);
}

// ---- 3) ISOLATED SOURCE PROBES for the reported 4 + quick health of everything ----
console.log('\n=== ISOLATED PROBES (reported sources) ===');
const REPORTED = ['stellarrip', 'stellar', 'atlantic', 'raflix'];
const PROBE = { movie: 'tmdb:27205', series: 'tmdb:1399:1:1' }; // Inception / GoT S1E1
for (const sid of REPORTED) {
  for (const [type, id] of [['movie', PROBE.movie], ['series', PROBE.series]]) {
    const r = await j(`${BASE}/debug/source/${sid}?type=${type}&id=${id}`, 50000);
    const cards = Array.isArray(r?.streams) ? r.streams.length : 0;
    const logs = (r?.logs || []).slice(0, 4).join(' | ');
    console.log(`${sid} ${type}: cards=${cards} ${r.timedOut ? 'TIMEOUT' : ''} dt=${r.durationMs}ms ${logs ? 'logs: ' + logs.slice(0, 200) : ''}`);
  }
}

// ---- 4) FULL MATRIX: every source, isolated, both types ----
console.log('\n=== FULL MATRIX (all sources isolated) ===');
const man = await j(`${BASE}/manifest.json`);
// get source ids from the addon internals via a probe of a bogus id (returns Available list)
const avail = await j(`${BASE}/debug/source/__bogus__?type=movie&id=tmdb:1`, 20000);
const ids = String(avail.error || '').replace("Source '__bogus__' not found. Available: ", '').split(', ').filter(Boolean);
console.log(`registered sources: ${ids.length}`);
const ZERO = [];
for (const sid of ids) {
  const rm = await j(`${BASE}/debug/source/${sid}?type=movie&id=${PROBE.movie}`, 50000);
  const rmCards = Array.isArray(rm?.streams) ? rm.streams.length : 0;
  let rsCards = 'skip';
  // series probe only if movie zero (save time) or randomly sample
  const rs = rmCards === 0 ? await j(`${BASE}/debug/source/${sid}?type=series&id=${PROBE.series}`, 50000) : null;
  rsCards = rs ? (Array.isArray(rs?.streams) ? rs.streams.length : 0) : '-';
  const zero = rmCards === 0 && rsCards === 0;
  if (zero) ZERO.push(sid);
  console.log(`${sid}: movie=${rmCards} series=${rsCards}${rm.timedOut ? ' [mTO]' : ''}${rs?.timedOut ? ' [sTO]' : ''}${zero ? '  << ZERO' : ''}`);
}
console.log(`\nZERO-SOURCES (${ZERO.length}): ${ZERO.join(', ')}`);
