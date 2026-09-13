// Task 21: run the REAL production AniChan.handleInternal in-process
import { Fetcher } from '../src/utils/Fetcher.js';
import { AniChan } from '../src/source/AniChan.js';
import { TmdbId } from '../src/utils/index.js';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const fetcher = new Fetcher(logger);
const src = new AniChan(fetcher);

const ctx = {
  hostUrl: new URL('https://addon.example'),
  id: 'task21',
  ip: '127.0.0.1',
  config: { multi: 'on', en: 'on' },
};

const id = TmdbId.fromString('1429:1:1');
const t0 = Date.now();
try {
  const results = await Promise.race([
    src.handleInternal(ctx, 'series', id),
    new Promise(r => setTimeout(() => r({ __timeout: true }), 35000)),
  ]);
  const dt = Date.now() - t0;
  if (results?.__timeout) { console.log(`TIMEOUT after ${dt}ms`); process.exit(0); }
  console.log(`count=${results.length} in ${dt}ms`);
  for (const r of results) console.log(' -', r.meta?.title, '|', r.url?.href?.slice(0, 90));
} catch (e) {
  console.log('THREW:', e?.message, '\n', e?.stack?.split('\n').slice(0, 6).join('\n'));
}
process.exit(0);
