#!/usr/bin/env node
/**
 * Task 52: detailed diagnosis of the 12 dead sources.
 * For each: probe movie (Inception) + anime (Attack on Titan S1E1) + capture logs.
 */
const BASE = 'https://ignatiusphoenix.onrender.com';

const DEAD = ['netlio','anineko','2dhive','hianime','animekai','animezey','animeworldindia','reanime','animotvslash','persianstremio','stellarrip','kmmovies'];

const SPECS = [
  { label: 'movie', qs: 'type=movie&id=tmdb:27205' },
  { label: 'aot', qs: 'type=series&id=tmdb:1429:1:1' },  // Attack on Titan S1E1
];

async function probe(sourceId, qs) {
  const url = `${BASE}/debug/source/${sourceId}?${qs}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return await res.json();
  } catch (e) {
    return { error: e.message };
  } finally { clearTimeout(timer); }
}

for (const id of DEAD) {
  console.log('\n###############################################');
  console.log('# SOURCE:', id);
  for (const spec of SPECS) {
    const r = await probe(id, spec.qs);
    console.log(`\n--- ${spec.label} --- count=${r.count ?? 'ERR'} ms=${r.durationMs ?? '?'} ${r.error ? 'ERROR: ' + r.error : ''} ${r.timedOut ? 'TIMEDOUT' : ''}`);
    if (r.count === 0 || r.error || r.timedOut) {
      (r.logs || []).slice(0, 25).forEach(l => console.log('   |', l));
    } else if (r.results) {
      r.results.slice(0, 2).forEach(x => console.log('   >', (x.url || '').slice(0, 110), '|', x.format || '', '|', x.name || ''));
    }
  }
}
