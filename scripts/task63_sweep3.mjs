// Task 63 v3: series-tt real path recheck + anime-source probes with anime ids
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

// 1) series real path: tt vs tmdb (Stremio sends tt)
console.log('=== SERIES REAL PATH (tt vs numeric) ===');
for (const [label, path] of [
  ['GoT tt r1', '/stream/series/tt0944947:1:1.json'],
  ['GoT tmdb r1', '/stream/series/tmdb:1399:1:1.json'],
  ['GoT tt r2', '/stream/series/tt0944947:1:1.json'],
]) {
  const r = await j(`${BASE}${path}`, 60000);
  const streams = Array.isArray(r?.streams) ? r.streams : [];
  const subbed = streams.filter(s => s.subtitles?.length).length;
  console.log(`${label}: cards=${streams.length} subbed=${subbed} ${r.behaviorHints ? '' : ''}`);
}

// 2) anime sources with real anime ids (JJK S1E1 = tmdb:95479:1:1; Frieren S1E1 = tmdb:209867:1:1)
console.log('\n=== ANIME SOURCES (JJK S1E1) ===');
const ANIME = ['animeflix', 'anineko', 'anikoto', 'anikage', 'anibd', '2dhive', 'anidoor', 'animegg',
  'hianime', 'animekai', 'animezey', 'anikototv', 'animesdigital', 'itachi', 'reanime',
  'anichan', 'animesuge', 'animotvslash', 'nikastream', 'allwish'];
for (const sid of ANIME) {
  const r = await j(`${BASE}/debug/source/${sid}?type=series&id=tmdb:95479:1:1`);
  console.log(`${sid}: count=${r.count ?? 'ERR'} ${r.timedOut ? 'TO' : ''} dt=${r.durationMs}ms ${(r.logs || []).slice(0, 2).join(' | ').slice(0, 150)}`);
}

// 3) re-probe the non-anime true-zeros with retries (2 rounds) to separate transient vs dead
console.log('\n=== NON-ANIME ZEROS RETRY ===');
for (const sid of ['stellarrip', 'acermovies', 'hindmoviez', 'verhdlink', 'desiflix', 'persianstremio', 'kmmovies']) {
  const r = await j(`${BASE}/debug/source/${sid}?type=movie&id=tmdb:27205`, 50000);
  const r2 = (r.count ?? 0) === 0 ? await j(`${BASE}/debug/source/${sid}?type=movie&id=tmdb:27205`, 50000) : null;
  const c2 = r2 ? (r2.count ?? 0) : '-';
  console.log(`${sid}: r1=${r.count ?? 'ERR'} r2=${c2} ${r2?.timedOut || r.timedOut ? 'TO' : ''} dt1=${r.durationMs} dt2=${r2?.durationMs} ${(r2?.logs || r.logs || []).slice(0, 3).join(' | ').slice(0, 160)}`);
}
