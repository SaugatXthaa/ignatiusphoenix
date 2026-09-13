// Task 22 round 2: cross-check first-pass EMPTY sources with alternate titles
const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:4591';

const RETRY = {
  anineko:      [['series','tmdb:31910:1:1','Naruto'], ['series','tmdb:85937:1:1','DemonSlayer'], ['series','tmdb:37854:1:1','OnePiece']],
  pantyflix:    [['series','tmdb:31910:1:1','Naruto'], ['series','tmdb:85937:1:1','DemonSlayer'], ['movie','tmdb:372058','YourName2']],
  stellar:      [['series','tmdb:31910:1:1','Naruto'], ['series','tmdb:85937:1:1','DemonSlayer'], ['movie','tmdb:372058','YourName2']],
  animesdigital:[['series','tmdb:1429:1:1','AoT'], ['series','tmdb:209867:2:1','Frieren'], ['series','tmdb:31910:1:1','Naruto']],
  reanime:      [['series','tmdb:31910:1:1','Naruto'], ['movie','tmdb:1061474','Superman'], ['series','tmdb:85937:1:1','DemonSlayer']],
  nikastream:   [['movie','tmdb:1061474','Superman'], ['movie','tmdb:693134','Dune2'], ['series','tmdb:95396:2:1','Severance']],
  moviesdrivev2:[['movie','tmdb:1061474','Superman'], ['movie','tmdb:693134','Dune2'], ['movie','tmdb:299534','Endgame2']],
  hdhub4uv2:    [['movie','tmdb:1061474','Superman'], ['movie','tmdb:693134','Dune2'], ['movie','tmdb:299534','Endgame2']],
  hindmoviez:   [['movie','tmdb:1061474','Superman'], ['movie','tmdb:693134','Dune2'], ['movie','tmdb:299534','Endgame2']],
};

async function probe(sourceId, type, rawId, timeoutMs = 75000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/debug/source/${sourceId}?type=${type}&id=${rawId}`, { signal: ctl.signal });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const d = await res.json();
    if (d.timedOut) return { timeout: true, ms: d.durationMs };
    if (d.error) return { error: d.error, ms: d.durationMs };
    return { count: d.count, ms: d.durationMs };
  } catch (e) {
    return { error: e?.name === 'AbortError' ? 'client-timeout' : String(e?.message || e).slice(0, 80) };
  } finally { clearTimeout(timer); }
}

for (const [id, trials] of Object.entries(RETRY)) {
  const out = [];
  for (const [type, raw, label] of trials) {
    const r = await probe(id, type, raw);
    out.push(`${label}=${r.count ?? (r.timeout ? 'TO' : r.error)}`);
    if (typeof r.count === 'number' && r.count > 0) break;
    await new Promise(res => setTimeout(res, 300));
  }
  console.log(`${id}: ${out.join(' ')} => ${out.some(o => /=\d+/.test(o) && !/=0/.test(o)) ? 'PASS(round2)' : 'STILL-EMPTY'}`);
}
