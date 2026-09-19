// Task 61 Phase 2b: ISOLATED per-source verification for every source that
// showed zero cards in the merged sweep. /debug/source bypasses cache and
// races each source alone (35s cap) — no contention, no cross-source rate
// limit interference. Classifies: OK (count>0) / upstream-dead / timeout / error.
// Usage: node task61_isolated.mjs <batch>  (batch = m | a | x)
import fs from 'fs';

const BASE = 'https://ignatiusphoenix.onrender.com';
const OUT = '/home/z/my-project/phoenix-analysis/scripts/task61';
const batch = process.argv[2] || 'm';

// Inception (tt1375666) for movies/series sources; Frieren S2E1 for anime-only.
const ANIME = new Set(['animeflix','anineko','anikoto','anikage','anibd','2dhive','anidoor','animegg','hianime','animekai','animesdigital','itachi','anikototv','animeworldindia','animezey','animotvslash','allwish','animesuge','reanime','nikastream','anichan']);

const MOVIE_BATCH = ['4khdhub','primeshows','necro','vidking','vidfast','vegamovies','vidsrcsbs','meinecloud','hindmoviez','rivestream','kmmovies','vidzee','cinejoyaio','cinehdplus','atlantic','persianstremio','verhdlink','nowhdtime','zxcstream','stellarrip','stellar'];
const ANIME_BATCH = ['anineko','anikoto','anikototv','animekai','animezey','animesdigital','animeworldindia','itachi','anidoor','2dhive','animegg','allwish','animesuge','animotvslash','nikastream','reanime'];
const EXTRA = ['watchseries','cinefreak','acermovies','playimdb','raflix','desiflix','bollyflix','movieshuntv2','uhdmovies','moviesdrivev2','framextv','cinebyrocks','stellar','vixsrc','videasy','vidlink2','moviebox','cineby','peckle','pantyflix','streamxtv','anichan','hianime','anikage','anibd','netlio','cineby','fourkhdhubone','hdhub4uv2','movielinkbd','cineby','vegamovies2','imdbplay','hindmovie','cinewave'];

const list = batch === 'm' ? MOVIE_BATCH : batch === 'a' ? ANIME_BATCH : EXTRA;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const results = [];
for (const id of list) {
  const isAnime = ANIME.has(id);
  const type = isAnime ? 'series' : 'movie';
  const iid = isAnime ? 'tmdb:209867:2:1' : 'tt1375666';
  const label = isAnime ? 'FrierenS2E1' : 'Inception';
  const t0 = Date.now();
  try {
    const raw = await (await fetch(`${BASE}/debug/source/${id}?type=${type}&id=${encodeURIComponent(iid)}`, { signal: AbortSignal.timeout(60000) })).json();
    const dt = Date.now() - t0;
    const rec = {
      id, title: label, count: raw.count ?? null, timedOut: !!raw.timedOut,
      error: raw.error || null, durationMs: raw.durationMs || dt,
    };
    // capture a sample URL format for sanity
    if (raw.count > 0 && raw.results?.length) {
      rec.sampleFormat = raw.results[0].format;
      rec.sampleUrlHead = String(raw.results[0].url || '').slice(0, 60);
    } else if (raw.logs?.length) {
      rec.logTail = raw.logs.slice(-2);
    }
    results.push(rec);
    console.log(`${rec.count > 0 ? 'OK  ' : rec.timedOut ? 'TMO ' : 'ZERO'} ${id.padEnd(16)} count=${String(rec.count).padStart(3)} ${String(rec.durationMs).padStart(6)}ms ${rec.error || ''}${rec.timedOut ? ' TIMEOUT' : ''}`);
  } catch (e) {
    results.push({ id, error: 'probe: ' + String(e).slice(0, 100), durationMs: Date.now() - t0 });
    console.log(`ERR  ${id}: ${String(e).slice(0, 80)}`);
  }
  fs.writeFileSync(`${OUT}/isolated_${batch}.json`, JSON.stringify(results, null, 1));
  await wait(1500);
}
console.log('done');
