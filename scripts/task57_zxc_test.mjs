#!/usr/bin/env node
/** Task 57: live test of the new /backend/abaygagoka protocol. */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { getStreams } = require_('/home/z/my-project/phoenix-analysis/src/nuvio/zxcstream.cjs');

const cases = [
  { name: 'Inception (movie)', tmdbId: 27205, type: 'movie' },
  { name: 'GoT S1E1 (tv)', tmdbId: 1399, type: 'tv', season: 1, episode: 1 },
];
for (const c of cases) {
  const t0 = Date.now();
  try {
    const out = await getStreams(c.tmdbId, c.type, c.season, c.episode);
    console.log(`\n== ${c.name}: ${Array.isArray(out) ? out.length : JSON.stringify(out)?.slice(0, 120)} @${Date.now() - t0}ms`);
    for (const s of (out || []).slice(0, 5)) console.log('   ', s.quality || s.title?.slice(0, 40), '|', String(s.url).slice(0, 110));
  } catch (e) {
    console.log(`\n== ${c.name}: ERROR ${e.message}`);
  }
}
