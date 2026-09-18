#!/usr/bin/env node
/**
 * Task 57: comprehensive all-source health sweep (user request):
 *   "Check if all sources are actively involved and getting on real playable
 *    stream or not. Make sure no mpv errors and no loading screen stuck for
 *    all sources movies/series/kdrama and animes."
 *
 * Phase A (involvement): /debug/source/<id> x 4 titles (movie/series/kdrama/anime)
 *   with full=1 → count + up to 3 full card URLs per source-title.
 * Phase B (playability, separate script): probe cards.
 *
 * Output: scripts/task57_sweep_results.json
 */
import { writeFileSync } from 'fs';

const BASE = 'https://ignatiusphoenix.onrender.com';

const TITLES = [
  { key: 'movie',  label: 'Inception (movie)',      type: 'movie',  id: 'tmdb:27205' },
  { key: 'series', label: 'GoT S1E1 (series)',      type: 'series', id: 'tmdb:1399:1:1' },
  { key: 'kdrama', label: 'Squid Game S1E1 (kdrama)', type: 'series', id: 'tmdb:93405:1:1' },
  { key: 'anime',  label: 'Frieren S2E1 (anime)',   type: 'series', id: 'tmdb:209867:2:1' },
];

const CONCURRENCY = 3;
const TIMEOUT_MS = 50000; // upstream wait is 40s client budget; debug endpoint races 35s per source

async function probeOne(sourceId, spec, attempt = 1) {
  const url = `${BASE}/debug/source/${sourceId}?type=${spec.type}&id=${encodeURIComponent(spec.id)}&full=1`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const data = await res.json();
    const dt = Date.now() - t0;
    const results = Array.isArray(data.results) ? data.results : [];
    const cards = results.map(r => ({
      url: r.url || '',
      format: r.format || '',
      title: (r.meta && r.meta.title) || '',
      requestHeaders: r.requestHeaders || null,
      notWebReady: r.notWebReady,
    })).filter(c => c.url);
    return {
      source: sourceId, title: spec.key, count: data.count ?? 0,
      timedOut: !!data.timedOut, error: data.error || null, ms: dt, attempt,
      cards,
    };
  } catch (e) {
    return { source: sourceId, title: spec.key, count: -2, error: e.message, ms: Date.now() - t0, attempt, cards: [] };
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

const health = await (await fetch(`${BASE}/health`)).json();
const allSources = health.sources;
console.log(`Task 57 sweep: ${allSources.length} sources x ${TITLES.length} titles → ${allSources.length * TITLES.length} probes`);

const phaseA = [];
for (const spec of TITLES) {
  console.log(`\n=== ${spec.label} — ${spec.id} ===`);
  const rows = await runPool(allSources, (id) => probeOne(id, spec));
  writeFileSync('/home/z/my-project/phoenix-analysis/scripts/task57_progress.json', JSON.stringify({ at: new Date().toISOString(), doneTitles: phaseA.map(r => r.title), pending: spec.key, latest: rows.map(r => ({ s: r.source, c: r.count })) }, null, 2));
  rows.sort((a, b) => (b.count || 0) - (a.count || 0));
  const alive = rows.filter(r => r.count > 0);
  const zero = rows.filter(r => r.count === 0);
  const bad = rows.filter(r => r.count < 0 || r.timedOut || r.error);
  console.log(`alive=${alive.length} zero=${zero.length} err/timeout=${bad.length}`);
  for (const r of alive) console.log(`  ✓ ${r.source.padEnd(18)} ${String(r.count).padStart(3)} cards @${(r.ms / 1000).toFixed(1)}s`);
  for (const r of zero) console.log(`  · ${r.source.padEnd(18)} 0 @${(r.ms / 1000).toFixed(1)}s${r.error ? ' err=' + r.error.slice(0, 80) : ''}`);
  for (const r of bad) console.log(`  ! ${r.source.padEnd(18)} ${r.timedOut ? 'TIMEOUT' : 'ERR ' + (r.error || '').slice(0, 80)} @${(r.ms / 1000).toFixed(1)}s`);
  phaseA.push(...rows);
}

writeFileSync('/home/z/my-project/phoenix-analysis/scripts/task57_sweep_results.json', JSON.stringify({ at: new Date().toISOString(), base: BASE, health_version: health.version, phaseA }, null, 2));

// Summary matrix
console.log('\n=== SUMMARY: sources with ZERO across ALL 4 titles ===');
const bySource = {};
for (const r of phaseA) {
  bySource[r.source] = bySource[r.source] || { counts: {}, total: 0 };
  bySource[r.source].counts[r.title] = r.count;
  bySource[r.source].total += Math.max(r.count, 0);
}
const dead = Object.entries(bySource).filter(([, v]) => v.total === 0);
const active = Object.entries(bySource).filter(([, v]) => v.total > 0);
for (const [s, v] of active.sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  ACTIVE ${s.padEnd(18)} movie=${v.counts.movie} series=${v.counts.series} kdrama=${v.counts.kdrama} anime=${v.counts.anime}`);
}
for (const [s] of dead) console.log(`  DEAD   ${s}`);
console.log(`\nactive=${active.length}/${allSources.length}  dead=${dead.length}`);
