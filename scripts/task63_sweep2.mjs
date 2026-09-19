// Task 63 v2: fixed field names (count/results). Full matrix + reported sources.
const BASE = 'https://ignatiusphoenix.onrender.com';

async function j(url, ms = 50000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { accept: 'application/json' } });
    const txt = await r.text();
    try { return JSON.parse(txt); } catch { return { _raw: txt.slice(0, 200) }; }
  } catch (e) { return { _err: String(e).slice(0, 120) }; }
  finally { clearTimeout(t); }
}

const REPORTED = ['stellarrip', 'stellar', 'atlantic', 'raflix'];
const PROBE = { movie: 'tmdb:27205', series: 'tmdb:1399:1:1' };

console.log('=== REPORTED SOURCES (fixed parsing) ===');
for (const sid of REPORTED) {
  for (const [type, id] of [['movie', PROBE.movie], ['series', PROBE.series]]) {
    const r = await j(`${BASE}/debug/source/${sid}?type=${type}&id=${id}`);
    console.log(`${sid} ${type}: count=${r.count} ${r.timedOut ? 'TIMEOUT' : ''} dt=${r.durationMs}ms ${r.error ? 'ERR=' + r.error : ''}`);
    for (const s of (r.results || []).slice(0, 2)) {
      console.log(`   card: ${s.format} ${String(s.url).slice(0, 110)}`);
    }
  }
}

console.log('\n=== FULL MATRIX (all 71 sources, movie probe) ===');
const avail = await j(`${BASE}/debug/source/__bogus__?type=movie&id=tmdb:1`, 20000);
const ids = String(avail.error || '').replace("Source '__bogus__' not found. Available: ", '').split(', ').filter(Boolean);
console.log(`registered sources: ${ids.length}`);
const ZERO = [];
for (const sid of ids) {
  const rm = await j(`${BASE}/debug/source/${sid}?type=movie&id=${PROBE.movie}`);
  const m = rm.count ?? 0;
  let s = '-';
  if (m === 0) {
    const rs = await j(`${BASE}/debug/source/${sid}?type=series&id=${PROBE.series}`);
    s = rs.count ?? 0;
    if (s === 0) ZERO.push({ sid, mLogs: (rm.logs || []).slice(0, 3), mErr: rm.error, sErr: rs.error, mTO: rm.timedOut, sTO: rs.timedOut });
  }
  console.log(`${sid}: movie=${m} series=${s}${rm.timedOut ? ' [mTO]' : ''}`);
}
console.log(`\nTRUE ZERO (${ZERO.length}): ${ZERO.map(z => z.sid).join(', ')}`);
console.log(JSON.stringify(ZERO, null, 1).slice(0, 4000));
