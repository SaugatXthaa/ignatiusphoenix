#!/usr/bin/env node
/** Task 53: full timing breakdown via /debug/stream (single call — it runs
 *  its own resolve and reports its own per-source timings). */
const BASE = 'https://ignatiusphoenix.onrender.com';
const type = process.argv[2] || 'movie';
const id = process.argv[3] || 'tmdb:27205';
const t0 = Date.now();
const d = await fetch(`${BASE}/debug/stream?type=${type}&id=${id}`, { signal: AbortSignal.timeout(60000) }).then(x => x.json());
console.log(`total ${d.totalMs}ms  streams ${d.totalStreams}  partial=${d.partial}  budget=${d.clientBudgetMs}`);
const srcs = d.sources || [];
console.log('slowest 15:', srcs.slice(0, 15).map(t => `${t.id}(${t.status[0]})${t.count}@${(t.durationMs / 1000).toFixed(1)}s+q${((t.queueMs || 0) / 1000).toFixed(1)}`).join('  '));
const okZero = srcs.filter(t => t.status === 'ok' && t.count === 0);
console.log('zero-yield:', okZero.map(t => `${t.id}@${(t.durationMs / 1000).toFixed(1)}s`).join(', ') || '(none)');
const timeouts = srcs.filter(t => t.status === 'timeout');
console.log('timeouts:', timeouts.map(t => `${t.id}@${(t.durationMs / 1000).toFixed(1)}s`).join(', ') || '(none)');
const settled = srcs.filter(t => t.status === 'ok').length;
console.log(`settled ok: ${settled}/${srcs.length}  errors: ${srcs.filter(t => t.status === 'error').length}`);
