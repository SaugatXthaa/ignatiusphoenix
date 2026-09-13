// audit17_conc_test.mjs — reproduce api.framextv.tech concurrency stall
// Merged runs: framextv (1 query) + streamxtv (batches of 5) hit the same API
// simultaneously → all 7s timeouts. Isolated: both pass. This script runs
// them CONCURRENTLY in one process (same as merged) to confirm.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);

const framextv = require_(path.join(__dirname, '..', 'src', 'nuvio', 'framextv.cjs'));
const streamxtv = require_(path.join(__dirname, '..', 'src', 'nuvio', 'streamxtv.cjs'));

const mode = process.argv[2] || 'concurrent';

if (mode === 'sequential') {
  let t0 = Date.now();
  const fx = await framextv.getStreams('1396', 'tv', 1, 1);
  console.log(`framextv alone: ${fx.length} streams in ${Date.now() - t0}ms`);
  t0 = Date.now();
  const sx = await streamxtv.getStreams('1396', 'tv', 1, 1);
  console.log(`streamxtv alone (after): ${sx.length} streams in ${Date.now() - t0}ms`);
} else {
  const t0 = Date.now();
  const [fx, sx] = await Promise.all([
    framextv.getStreams('1396', 'tv', 1, 1).catch(e => [{ err: String(e) }]),
    streamxtv.getStreams('1396', 'tv', 1, 1).catch(e => [{ err: String(e) }]),
  ]);
  console.log(`CONCURRENT: framextv=${fx.length} streams, streamxtv=${sx.length} streams, total ${Date.now() - t0}ms`);
}
