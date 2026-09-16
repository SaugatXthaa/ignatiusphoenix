// Task 40 — test the Cineby wrapper class directly (bypass HTTP layer)
import { Fetcher } from '../src/utils/Fetcher.js';
import { Cineby } from '../src/source/Cineby.js';
import { ImdbId, TmdbId } from '../src/utils/index.js';

const fetcher = new Fetcher(console);
const src = new Cineby(fetcher);

const ctx = {
  hostUrl: new URL('https://test.local'),
  id: 'test',
  ip: '127.0.0.1',
  config: { multi: 'on', en: 'on' },
};

console.log('--- movie tt1375666 ---');
try {
  const t0 = Date.now();
  const out = await src.handle(ctx, 'movie', ImdbId.fromString('tt1375666'));
  console.log(`OK ${Date.now() - t0}ms — ${out.length} results`);
  for (const r of out.slice(0, 4)) {
    console.log(' -', r.meta?.title?.slice(0, 80), '|', r.url?.href?.slice(0, 80));
    if (r.meta?.subtitles?.length) console.log('   subs:', r.meta.subtitles.map(s => s.lang).join(','));
  }
} catch (e) {
  console.log('THREW:', e.constructor.name, e.message);
}

console.log('--- series tmdb:209867:1:1 ---');
try {
  const t0 = Date.now();
  const out = await src.handle(ctx, 'series', TmdbId.fromString('209867:1:1'));
  console.log(`OK ${Date.now() - t0}ms — ${out.length} results`);
  for (const r of out.slice(0, 4)) {
    console.log(' -', r.meta?.title?.slice(0, 80), '|', r.url?.href?.slice(0, 80));
  }
} catch (e) {
  console.log('THREW:', e.constructor.name, e.message);
}
