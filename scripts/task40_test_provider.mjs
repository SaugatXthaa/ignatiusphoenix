// Task 40 — direct test of the rewritten cineby.cjs provider
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { getStreams } = require_('../src/nuvio/cineby.cjs');

function show(label, streams) {
  console.log(`\n===== ${label}: ${streams.length} streams =====`);
  for (const s of streams) {
    console.log(`  [${s.quality}] ${s.title}`);
    console.log(`      url=${String(s.url).slice(0, 100)}`);
    if (s.subtitles?.length) console.log(`      subs: ${s.subtitles.map(x => x.lang).join(',')}`);
  }
}

// Movie — Inception
const t0 = Date.now();
const inc = await getStreams(27205, 'movie', null, null, { title: 'Inception', year: '2010', imdbId: 'tt1375666' });
show(`Inception (${Date.now() - t0}ms)`, inc);

// Anime TV — Frieren S1E1
const t1 = Date.now();
const fri = await getStreams(209867, 'tv', 1, 1, { title: "Frieren: Beyond Journey's End", year: '2023', imdbId: 'tt22024441' });
show(`Frieren S1E1 (${Date.now() - t1}ms)`, fri);

// Anime TV — One Piece S1E1 (master playlist expected)
const t2 = Date.now();
const op = await getStreams(37854, 'tv', 1, 1, { title: 'One Piece', year: '1999', imdbId: 'tt0388629' });
show(`One Piece S1E1 (${Date.now() - t2}ms)`, op);

// New content — Mutiny 2026
const t3 = Date.now();
const mut = await getStreams(1288445, 'movie', null, null, { title: 'Mutiny', year: '2026', imdbId: '' });
show(`Mutiny 2026 (${Date.now() - t3}ms)`, mut);

// Fallback TMDB path (no preloaded meta)
const t4 = Date.now();
const inc2 = await getStreams(27205, 'movie', null, null);
show(`Inception fallback-meta (${Date.now() - t4}ms)`, inc2);

console.log('\nDONE');
