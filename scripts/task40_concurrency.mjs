// Task 40b — concurrency test: cineby provider + VidKing extractor path
// (fetchAllProviders via speedracelight.js) racing on the SAME mediaId —
// they must now coalesce into ONE /seed fetch via srlSeed.cjs and both deliver.
import { createRequire } from 'module';
import { Fetcher } from '../src/utils/Fetcher.js';
import { fetchAllProviders } from '../src/utils/speedracelight.js';
const require_ = createRequire(import.meta.url);
const { getStreams } = require_('../src/nuvio/cineby.cjs');

const fetcher = new Fetcher(console);

const meta = {
  title: "Frieren: Beyond Journey's End", year: '2023', imdbId: 'tt22248376',
};
let seedFetches = 0;
const origJson = fetcher.json.bind(fetcher);
fetcher.json = (ctx, url, opts) => {
  if (String(url).includes('/seed?')) { seedFetches++; console.log('[watch] /seed fetch #', seedFetches, String(url).slice(0, 70)); }
  return origJson(ctx, url, opts);
};

console.log('--- launching cineby + fetchAllProviders concurrently for tmdb 209867 ---');
const t0 = Date.now();
const [cinebyOut, vidkingOut] = await Promise.all([
  getStreams(209867, 'tv', 1, 1, meta).catch(e => { console.log('cineby ERR', e.message); return []; }),
  fetchAllProviders(fetcher, null, { meta, type: 'tv', tmdbId: 209867, seasonId: 1, episodeId: 1 }).catch(e => { console.log('vidking ERR', e.message); return []; }),
]);
console.log(`elapsed: ${Date.now() - t0}ms, total /seed upstream fetches: ${seedFetches} (expect 1)`);
console.log(`cineby: ${cinebyOut.length} streams — ${cinebyOut.slice(0, 3).map(s => s.quality).join(', ')}`);
const vkTotal = vidkingOut.reduce((n, r) => n + (r.json?.sources?.length || 0), 0);
console.log(`vidking extractor (2 providers): ${vkTotal} sources — ${vidkingOut.map(r => `${r.provider?.name}:${r.json?.sources?.length || 0}`).join(' ')}`);
console.log('DONE');
