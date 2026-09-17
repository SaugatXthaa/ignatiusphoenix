// Task 49: atlantic isolated probe — is count=0 caused by Task 49 changes or upstream?
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const mod = require_(path.join(__dirname, '..', 'src', 'nuvio', 'atlantic.cjs'));

// Direct scraper probe — Inception movie
const t0 = Date.now();
const res = await mod.getStreams(27205, 'movie', null, null, { title: 'Inception', year: '2010', imdbId: 'tt1375666' });
console.log(`atlantic raw: ${Array.isArray(res) ? res.length : JSON.stringify(res)?.slice(0, 200)} streams in ${Date.now() - t0}ms`);
if (Array.isArray(res)) {
  for (const s of res.slice(0, 3)) console.log(`  - ${s.name || s.title || '?'} | ${(s.url || '').slice(0, 90)}`);
  console.log(`  subs on card0: ${res[0]?.subtitles?.length ?? 'none'}`);
}
