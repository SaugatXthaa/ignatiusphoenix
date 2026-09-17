// Task 51: dump raw speedracelight Yoru response for Homecoming to see fields
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);

// Boot a minimal fetcher context via the addon's own utilities is heavy —
// instead use the speedracelight module with a bare fetcher shim.
const fetcher = {
  async text(ctx, url, opts = {}) {
    const res = await fetch(url, { headers: opts.headers || {}, signal: AbortSignal.timeout(15000) });
    if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    return res.text();
  },
  async json(ctx, url, opts = {}) {
    return JSON.parse(await this.text(ctx, url, opts));
  },
};
const srl = await import('../src/utils/speedracelight.js');
const meta = { title: 'Spider-Man: Homecoming', year: '2017', imdbId: 'tt2250912' };
const json = await srl.fetchProvider(fetcher, null, {
  provider: { name: 'Yoru', endpoint: 'cdn/sources-with-title', countryCodes: ['multi'] },
  meta, type: 'movie', tmdbId: 315635, seasonId: 1, episodeId: 1,
});
console.log('keys:', Object.keys(json || {}));
console.log('sources:', (json?.sources || []).length);
for (const s of (json?.sources || []).slice(0, 6)) {
  console.log('  ', JSON.stringify(s).slice(0, 200));
}
