#!/usr/bin/env node
/** Task 57: validate 4khdhub_one Fetcher-transport path locally. */
import { createRequire } from 'module';
import { Fetcher } from '/home/z/my-project/phoenix-analysis/src/utils/Fetcher.js';
const require_ = createRequire(import.meta.url);
const { getStreams } = require_('/home/z/my-project/phoenix-analysis/src/nuvio/4khdhub_one.cjs');

const fetcher = new Fetcher(console);
const ctx = { hostUrl: new URL('http://localhost:7000/'), id: 'task57-local', ip: '127.0.0.1', config: { multi: 'on', en: 'on' } };

const t0 = Date.now();
const r = await getStreams(27205, 'movie', null, null, { fetcher, ctx });
console.log('movie (Fetcher): ' + r.length + ' cards @' + (Date.now() - t0) + 'ms');
for (const s of r.slice(0, 3)) console.log('  ', s.quality, '|', String(s.url).slice(0, 80));

const t1 = Date.now();
const r2 = await getStreams(1399, 'tv', 1, 1, { fetcher, ctx });
console.log('tv GoT S1E1 (Fetcher): ' + r2.length + ' cards @' + (Date.now() - t1) + 'ms');
for (const s of r2.slice(0, 3)) console.log('  ', s.quality, '|', String(s.url).slice(0, 80));
