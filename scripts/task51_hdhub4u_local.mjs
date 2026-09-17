// Task 51: local diag of hdhub4u_v2 greenmotors decode chain for one title.
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const mod = require_('../src/nuvio/hdhub4u_v2.cjs');

const tmdbId = parseInt(process.argv[2] || '324857', 10);
const type = process.argv[3] || 'movie';
const streams = await mod.getStreams(tmdbId, type);
console.log(`\nTOTAL STREAMS: ${streams.length}`);
for (const s of streams.slice(0, 12)) {
  console.log(` - ${(s.name || '').slice(0, 60)} | ${(s.title || '').slice(0, 70)} | ${(s.url || '').slice(0, 80)}`);
}
