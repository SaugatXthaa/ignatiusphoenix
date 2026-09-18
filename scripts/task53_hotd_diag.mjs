#!/usr/bin/env node
const BASE = 'https://ignatiusphoenix.onrender.com';
const env = await fetch(`${BASE}/debug/env`).then(r => r.json()).catch(() => ({}));
console.log('instance startedAt:', env.startedAt);

const t0 = Date.now();
const d = await fetch(`${BASE}/debug/stream?type=series&id=tmdb:94973:1:1`, { signal: AbortSignal.timeout(60000) }).then(x => x.json());
console.log(`HotD debug: total ${d.totalMs}ms streams ${d.totalStreams} partial=${d.partial} (wall ${Date.now() - t0}ms)`);
const srcs = d.sources || [];
console.log('slowest 14:', srcs.slice(0, 14).map(t => `${t.id}(${t.status[0]})${t.count}@${(t.durationMs / 1000).toFixed(1)}s`).join('  '));
for (const id of ['movieshuntv2', 'moviesdrivev2', 'uhdmovies', '4khdhub']) {
  const t = srcs.find(x => x.id === id);
  console.log(`  ${id}:`, t ? `${t.status} count=${t.count} dur=${(t.durationMs / 1000).toFixed(1)}s queue=${((t.queueMs||0)/1000).toFixed(1)}s` : 'NOT-RUN');
}
