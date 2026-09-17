// Task 49: smoke-test the shared subtitle module + the merge helper locally.
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { fetchUnifiedSubs, mergeSubtitleTracks } = require_('/home/z/my-project/phoenix-analysis/src/utils/siteSubtitles.cjs');

const t0 = Date.now();
// Inception (movie, tmdb 27205) — granite+natsuki verified live in Task 48
const subs = await fetchUnifiedSubs({ tmdbId: 27205, type: 'movie', hostUrl: 'https://ignatiusphoenix.onrender.com' });
console.log(`movie 27205: ${subs.length} subs in ${Date.now() - t0}ms`);
console.log('first 6:', subs.slice(0, 6).map(s => s.lang).join(' | '));
const langs = new Set(subs.map(s => s.lang));
console.log('unique langs:', langs.size);

// cache-hit pass
const t1 = Date.now();
const subs2 = await fetchUnifiedSubs({ tmdbId: 27205, type: 'movie', hostUrl: 'https://ignatiusphoenix.onrender.com' });
console.log(`cache-hit: ${subs2.length} in ${Date.now() - t1}ms, same ref: ${subs === subs2}`);

// TV path (Breaking Bad S1E1, tmdb 1396)
const tv = await fetchUnifiedSubs({ tmdbId: 1396, type: 'series', season: 1, episode: 1, hostUrl: 'https://ignatiusphoenix.onrender.com' });
console.log(`tv 1396 S1E1: ${tv.length} subs; sample: ${tv.slice(0, 4).map(s => s.lang).join(' | ')}`);

// merge helper: primary (OpenSubs-style) + universal dedupe
const primary = [
  { id: 'os-en', url: 'https://x/os-en.srt', lang: 'English' },
  { id: 'os-ko', url: 'https://x/os-ko.srt', lang: 'Korean' },
];
const merged = mergeSubtitleTracks(primary, subs2);
console.log(`merge: primary 2 + universal ${subs2.length} → ${merged.length} (dupes removed: ${2 + subs2.length - merged.length})`);
console.log('merged first 5:', merged.slice(0, 5).map(s => s.lang).join(' | '));
// HI coexistence check: "English" + "English (HI)" must BOTH survive
const withHi = mergeSubtitleTracks([{ id: 'a', url: 'https://a', lang: 'English' }], [{ id: 'b', url: 'https://b', lang: 'English (HI)' }]);
console.log(`HI coexistence: ${withHi.length} (expect 2): ${withHi.map(s => s.lang).join(' | ')}`);
// cap check
const big = mergeSubtitleTracks(null, Array.from({ length: 60 }, (_, i) => ({ id: 'x' + i, url: 'https://x' + i, lang: 'Lang' + i })));
console.log(`cap: ${big.length} (expect 48)`);
