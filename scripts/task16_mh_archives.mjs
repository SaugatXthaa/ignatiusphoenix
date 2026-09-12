// Task 16 — check recent abhilinks archives link families + vcloud retry w/ full headers
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchGS(url, referer, extraHeaders = {}) {
  const res = await gotScraping({
    url, headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', ...(referer ? { Referer: referer } : {}), ...extraHeaders },
    timeout: { request: 15000 }, retry: { limit: 0 }, throwHttpErrors: false,
  });
  return { status: res.statusCode, body: typeof res.body === 'string' ? res.body : (res.body ? res.body.toString() : ''), headers: res.headers };
}

function families(html) {
  const count = (re) => [...new Set([...html.matchAll(re)].map(m => m[1]))];
  return {
    abhilinks: count(/href="(https:\/\/abhilinks\.site\/archives\/\d+\/?)"/g),
    hubcloud: count(/href="(https:\/\/hubcloud\.[a-z]+\/(?:drive|video)\/[a-z0-9_]+)"/g),
    gdflix: count(/href="(https:\/\/(?:new\d+\.)?gdflix\.[a-z]+\/file\/[A-Za-z0-9]+)"/g),
    vcloud: count(/href="(?:https:\/\/href\.li\/)?(https:\/\/vcloud\.fit\/[a-z0-9]+)"/g),
    gdtot: count(/href="(https:\/\/(?:new\d+\.)?gdtot\.[a-z]+\/file\/\d+)"/g),
    pixel: count(/href="(https:\/\/pixeldrain\.[a-z]+\/[uU]\/[A-Za-z0-9]+)"/g),
    gdrive: count(/href="(https:\/\/drive\.google\.com\/[^"]+)"/g),
  };
}

// 1. recent archives
console.log('=== recent abhilinks archives ===');
const posts = ['haiwaan-2026-hindi-full-movie', 'the-revolutionaries-2026-season-1-multi-audio-complete-amazon-prime-web-series', 'mahaprabhu-jagannath-2026-hindi-full-movie'];
for (const slug of posts) {
  const p = await fetchGS('https://movieshunt.casa/' + slug + '/');
  if (p.status !== 200) { console.log(slug, '→', p.status); continue; }
  const arch = [...new Set([...p.body.matchAll(/href="(https:\/\/abhilinks\.site\/archives\/(\d+)\/?)"/g)].map(m => m[1]))];
  for (const a of arch.slice(0, 3)) {
    const ap = await fetchGS(a, 'https://abhilinks.site/');
    const f = families(ap.body);
    const summary = Object.entries(f).filter(([, v]) => v.length).map(([k, v]) => `${k}:${v.length}`).join(' ') || 'NONE';
    console.log(`${slug.slice(0, 40)} → ${a.slice(-14)} (${ap.status}): ${summary}`);
  }
}

// 2. vcloud retry with full browser headers
console.log('\n=== vcloud.fit full-header retry ===');
const fullHeaders = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'cross-site',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};
for (const u of ['https://vcloud.fit/bycxgtppyxcefne']) {
  const r = await fetchGS(u, 'https://abhilinks.site/', fullHeaders);
  console.log(u, '→', r.status, '| len:', r.body.length, '| just-a-moment:', r.body.includes('Just a moment'));
  if (r.status !== 200) continue;
  const f = families(r.body);
  console.log('families:', JSON.stringify(Object.fromEntries(Object.entries(f).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]))));
  console.log('body head:', r.body.slice(0, 300).replace(/\s+/g, ' '));
}
