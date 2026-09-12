// Task 14: run each raflix embed URL through the REAL ExtractorRegistry
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const { ExtractorRegistry } = await import(path.join(ROOT, 'src', 'extractor', 'ExtractorRegistry.js'));
const { createExtractors } = await import(path.join(ROOT, 'src', 'extractor', 'index.js'));

const mockFetcher = { json: async (_c, u) => { throw new Error('no network in mock'); }, head: async () => { throw new Error('x'); } };
const realFetcherMod = await import(path.join(ROOT, 'src', 'utils', 'index.js')).catch(() => null);
// Use the addon's real Fetcher so extractor probes hit the network properly
let fetcher = mockFetcher;
try {
  const { Fetcher } = await import(path.join(ROOT, 'src', 'utils', 'Fetcher.js'));
  fetcher = new Fetcher(console);
} catch (e) { /* keep mock */ }
const extractors = createExtractors(fetcher, console);
const registry = new ExtractorRegistry(console, extractors);

const URLS = [
  ['Anicine', 'https://api.anicine-embed.workers.dev/movie/299534'],
  ['XPass', 'https://play.xpass.top/e/movie/299534?autostart=true'],
  ['MoviesAPI', 'https://moviesapi.to/movie/299534'],
  ['FileSun', 'https://filesun.sbs/embed/movie/299534'],
  ['VidStorm', 'https://vidstorm.ru/movie/299534'],
  ['VidRift', 'https://embed.vidrift.in/embed/movie/299534'],
  ['APIPlayer', 'https://apiplayer.ru/embed/movie/299534?lang=en'],
  ['EmbedMaster', 'https://embedmaster.link/movie/299534'],
];

const ctx = { config: {}, hostUrl: new URL('http://127.0.0.1:4595'), logger: console };

async function isPlayable(u) {
  // quick byte-check: m3u8 / video magic / html detection
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
    const ct = r.headers.get('content-type') || '';
    const buf = Buffer.from(await (await r.arrayBuffer()).slice(0, 300));
    const head = buf.toString('utf8');
    if (/#EXTM3U/.test(head)) return `✅ m3u8 (${r.status})`;
    if (/text\/html/i.test(ct) || /<html|<!DOCTYPE/i.test(head)) return `❌ HTML ${r.status}`;
    if (/video|matroska|octet/i.test(ct) || /^(1a45dfa3|ftyp)/.test(buf.toString('hex', 0, 4))) return `✅ video ${r.status} ${ct}`;
    return `⚠️ ${r.status} ${ct || 'no-ct'} "${head.slice(0, 40).replace(/\s+/g, ' ')}"`;
  } catch (e) { return `💥 ${e.message?.slice(0, 50)}`; }
}

for (const [label, raw] of URLS) {
  const url = new URL(raw);
  const meta = { sourceId: 'raflix', sourceLabel: 'Raflix' };
  try {
    const results = await Promise.race([
      registry.handle(ctx, url, meta, true),
      new Promise(r => setTimeout(() => r(null), 30000)),
    ]);
    const n = Array.isArray(results) ? results.length : 0;
    console.log(`\n[${label}] extractor -> ${n} result(s)`);
    for (const r of (results || []).slice(0, 3)) {
      const href = typeof r.url === 'string' ? r.url : r.url?.href;
      const ext = r.isExternal ? ' [EXTERNAL]' : '';
      console.log(`   -> ${(r.format || '?')} ${ext} ${String(href).slice(0, 120)}`);
      if (!r.isExternal && href) console.log(`      bytes: ${await isPlayable(href)}`);
    }
    if (n === 0) console.log('   (dropped — no extractor produced output) bytes of raw:', await isPlayable(raw));
  } catch (e) {
    console.log(`[${label}] registry FAIL: ${e.message?.slice(0, 80)}`);
  }
}
