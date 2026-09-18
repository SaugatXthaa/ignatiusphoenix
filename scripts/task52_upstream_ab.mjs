#!/usr/bin/env node
/**
 * Task 52: local transport A/B test against the dead sources' upstreams.
 * Determines: globally-down vs TLS-fingerprint vs IP-gated.
 */
import { gotScraping } from 'got-scraping';
import { HeaderGenerator } from 'header-generator';

const hg = new HeaderGenerator({ browsers: ['chrome'], devices: ['desktop'], operatingSystems: ['windows'], locales: ['en-US'] });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const TESTS = [
  { name: 'hianime search', url: 'https://hianime.at/search?keyword=attack%20on%20titan' },
  { name: 'animekai search', url: 'https://animekai.at/?s=frieren' },
  { name: 'reanime api', url: 'https://reanime.to/api/v1/search?q=frieren&limit=10' },
  { name: 'animezey worker A', url: 'https://1.animezey23112022.workers.dev/' },
  { name: 'animezey worker B', url: 'https://1.animezeydl.workers.dev/' },
  { name: 'anineko search', url: 'https://anineko.to/search?keyword=attack%20on%20titan' },
  { name: 'persianstremio', url: 'https://persianstremio.vercel.app/stream/movie/tt1375666.json' },
  { name: 'kmmovies magiclinks', url: 'https://w3.magiclinks.lol/' },
  { name: 'animezeY site', url: 'https://animezey.to/' },
];

for (const t of TESTS) {
  // Test 1: got-scraping (browser TLS)
  let got = 'THREW';
  try {
    const res = await gotScraping.get(t.url, {
      headers: { ...hg.getHeaders({ httpVersion: '2' }), 'User-Agent': UA },
      timeout: { request: 12000 }, throwHttpErrors: false, http2: true,
    });
    got = `${res.statusCode} len=${(res.body || '').length}`;
  } catch (e) { got = `THREW: ${e.message.slice(0, 50)}`; }
  // Test 2: plain fetch (node TLS)
  let pf = 'THREW';
  try {
    const res = await fetch(t.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    pf = `${res.status}`;
  } catch (e) { pf = `THREW: ${e.message.slice(0, 50)}`; }
  console.log(`${t.name.padEnd(24)} got=${got.padEnd(28)} fetch=${pf}`);
}
