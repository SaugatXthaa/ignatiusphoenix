#!/usr/bin/env node
/** Task 53: fetch /debug/stream timings right after a real /stream request
 *  to see where 19-22s actually goes. */
const BASE = 'https://ignatiusphoenix.onrender.com';
const type = process.argv[2] || 'movie';
const id = process.argv[3] || 'tmdb:27205';

const t0 = Date.now();
const r = await fetch(`${BASE}/stream/${type}/${id}.json`, { signal: AbortSignal.timeout(60000) });
const j = await r.json();
console.log(`/stream: ${(j.streams || []).length} streams in ${Date.now() - t0}ms`);

const t1 = Date.now();
const d = await fetch(`${BASE}/debug/stream`, { signal: AbortSignal.timeout(30000) }).then(x => x.json());
console.log(`debug fetched in ${Date.now() - t1}ms`);
const timings = d.sourceTimings || d.lastSourceTimings || [];
console.log('partial:', d.partial ?? d.lastResolveWasPartial, ' total:', d.totalMs ?? d.durationMs);
const rows = timings.slice().sort((a, b) => (b.queueMs || 0) - (a.queueMs || 0));
console.log('Top queue waits:', rows.slice(0, 8).map(t => `${t.id}:${t.queueMs}ms`).join('  '));
const slow = timings.slice().sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0));
console.log('Slowest sources:', slow.slice(0, 12).map(t => `${t.id}:${t.durationMs}ms/${t.count}`).join('  '));
const zero = timings.filter(t => t.status === 'ok' && t.count === 0).map(t => t.id);
console.log('Zero-yield ok sources:', zero.join(', ') || '(none)');
