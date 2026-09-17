// Task 51: probe individual sources on PRODUCTION for one title.
// Sequential with small concurrency to avoid stress-testing the 0.1-CPU instance.
// Usage: node scripts/task51_source_probe.mjs <type> <tmdbId> [source1,source2,...]
const BASE = 'https://ignatiusphoenix.onrender.com';
const type = process.argv[2] || 'movie';
const id = process.argv[3] || 'tmdb:324857';
const sources = (process.argv[4] ||
  '4khdhub,fourkhdhubone,hdhub4uv2,movieshuntv2,moviesdrivev2,vegamovies2,cinehdplus,vidzee,kmmovies,vixsrc,allwish,hindmoviez,hindmovie,raflix,stellarrip,netlio,nowhdtime,kmmovies,pantyflix,nikastream,desiflix,anichan,rivestream,reanime,imdbplay,cineby,uhdmovies,bollyflix,framextv,cinejoyaio,stellar,atlantic,vegamovies,acermovies,cinefreak,peckle,2dhive')
  .split(',').filter((v, i, a) => a.indexOf(v) === i);

async function probe(src) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/debug/source/${src}?type=${type}&id=${id}`, { signal: AbortSignal.timeout(45000) });
    const j = await res.json();
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    if (j.error) return `✗ ${src}: ERROR ${dt}s — ${j.error}`;
    if (j.timedOut) return `✗ ${src}: TIMEOUT >35s`;
    const errs = (j.logs || []).filter(l => /error|fail|timeout|ENOTFOUND|ECONN|403|429/i.test(l)).slice(0, 2);
    const tag = j.count > 0 ? '✓' : '∅';
    let out = `${tag} ${src}: count=${j.count} @${dt}s`;
    if (errs.length) out += ` | ${errs.join(' || ')}`;
    return out;
  } catch (e) {
    return `✗ ${src}: FETCH-FAIL ${(Date.now() - t0) / 1000}s — ${e.message}`;
  }
}

const CONC = 3;
for (let i = 0; i < sources.length; i += CONC) {
  const batch = sources.slice(i, i + CONC);
  const results = await Promise.all(batch.map(probe));
  results.forEach(r => console.log(r));
}
