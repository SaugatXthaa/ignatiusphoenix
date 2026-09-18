#!/usr/bin/env node
/**
 * Task 52: comprehensive production probe of ALL sources.
 * Pass 1: movie (Inception tmdb:27205) for every source.
 * Pass 2: series (Breaking Bad tmdb:1396 S1E1) for sources that yielded 0 on movie.
 * Pass 3: anime (Frieren tmdb:209867 S1E1) for sources still at 0.
 * Output: JSON classification + console table.
 */
const BASE = 'https://ignatiusphoenix.onrender.com';

const MOVIE = { type: 'movie', id: 'tmdb:27205' };      // Inception
const SERIES = { type: 'series', id: 'tmdb:1396:1:1' }; // Breaking Bad S1E1
const ANIME = { type: 'series', id: 'tmdb:209867:1:1' }; // Frieren S1E1

const CONCURRENCY = 3;
const TIMEOUT_MS = 40000;

async function probe(sourceId, spec) {
  const url = `${BASE}/debug/source/${sourceId}?type=${spec.type}&id=${spec.id}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const data = await res.json();
    const dt = Date.now() - t0;
    if (data.timedOut) return { source: sourceId, spec: spec.type, count: -1, timedOut: true, ms: dt };
    const count = data.count ?? 0;
    const err = data.error || (data.results || []).length && null;
    return { source: sourceId, spec: spec.type, count, ms: dt, error: data.error || null };
  } catch (e) {
    return { source: sourceId, spec: spec.type, count: -2, error: e.message, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

async function runPool(items, worker) {
  const results = [];
  let idx = 0;
  async function lane() {
    while (idx < items.length) {
      const my = items[idx++];
      results.push(await worker(my));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, lane));
  return results;
}

const healthRes = await fetch(`${BASE}/health`);
const health = await healthRes.json();
const allSources = health.sources;
console.log(`Probing ${allSources.length} sources on ${BASE} (version below)`);
console.log(JSON.stringify((await (await fetch(`${BASE}/debug/env`)).json())));

// ---- Pass 1: movie for all ----
console.log(`\n=== PASS 1: MOVIE (${MOVIE.id}) ===`);
const p1 = await runPool(allSources, async (id) => {
  const r = await probe(id, MOVIE);
  process.stdout.write(`${id.padEnd(18)} ${String(r.count).padStart(4)}  ${r.ms}ms ${r.error ? 'ERR:' + r.error.slice(0, 60) : r.timedOut ? 'TIMEOUT' : ''}\n`);
  return r;
});

const zeroAfter1 = p1.filter(r => r.count <= 0);
console.log(`\nPass1: ${p1.filter(r => r.count > 0).length} sources with streams, ${zeroAfter1.length} zero/error`);

// ---- Pass 2: series for zeros ----
console.log(`\n=== PASS 2: SERIES (${SERIES.id}) for ${zeroAfter1.length} zero-yield sources ===`);
const p2 = await runPool(zeroAfter1.map(r => r.source), async (id) => {
  const r = await probe(id, SERIES);
  process.stdout.write(`${id.padEnd(18)} ${String(r.count).padStart(4)}  ${r.ms}ms ${r.error ? 'ERR:' + r.error.slice(0, 60) : r.timedOut ? 'TIMEOUT' : ''}\n`);
  return r;
});

const zeroAfter2 = p2.filter(r => r.count <= 0);
console.log(`\nPass2: ${p2.filter(r => r.count > 0).length} recovered on series, ${zeroAfter2.length} still zero`);

// ---- Pass 3: anime for still-zeros ----
console.log(`\n=== PASS 3: ANIME (${ANIME.id}) for ${zeroAfter2.length} still-zero sources ===`);
const p3 = await runPool(zeroAfter2.map(r => r.source), async (id) => {
  const r = await probe(id, ANIME);
  process.stdout.write(`${id.padEnd(18)} ${String(r.count).padStart(4)}  ${r.ms}ms ${r.error ? 'ERR:' + r.error.slice(0, 60) : r.timedOut ? 'TIMEOUT' : ''}\n`);
  return r;
});

const zeroAfter3 = p3.filter(r => r.count <= 0);
console.log(`\nPass3: ${p3.filter(r => r.count > 0).length} recovered on anime, ${zeroAfter3.length} still zero`);

// ---- Final classification ----
const best = new Map();
for (const r of [...p1, ...p2, ...p3]) {
  const cur = best.get(r.source) || { source: r.source, best: 0, types: [] };
  if (r.count > cur.best) cur.best = r.count;
  if (r.count > 0) cur.types.push(`${r.spec}:${r.count}`);
  best.set(r.source, cur);
}
const dead = [...best.values()].filter(v => v.best <= 0);

console.log('\n=== FINAL CLASSIFICATION ===');
console.log(`TOTAL sources: ${allSources.length}`);
console.log(`Producing streams: ${allSources.length - dead.length}`);
console.log(`Zero across ALL types: ${dead.length}`);
if (dead.length) {
  console.log('\nDEAD SOURCES:');
  dead.forEach(d => console.log(`  - ${d.source}`));
}

// Save full results
const out = { ts: new Date().toISOString(), pass1: p1, pass2: p2, pass3: p3, dead: dead.map(d => d.source) };
const fs = await import('fs');
fs.writeFileSync('scripts/task52_probe_results.json', JSON.stringify(out, null, 2));
console.log('\nSaved scripts/task52_probe_results.json');
