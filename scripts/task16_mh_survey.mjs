// Task 16 — survey movieshunt casa/cc: which link families do current posts use?
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchGS(url, referer) {
  const res = await gotScraping({
    url, headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', ...(referer ? { Referer: referer } : {}) },
    timeout: { request: 15000 }, retry: { limit: 0 }, throwHttpErrors: false,
  });
  return { status: res.statusCode, body: typeof res.body === 'string' ? res.body : (res.body ? res.body.toString() : '') };
}

function families(html) {
  const count = (re) => [...new Set([...html.matchAll(re)].map(m => m[1]))];
  return {
    abhilinks: count(/href="(https:\/\/abhilinks\.site\/archives\/\d+\/?)"/g),
    hubcloud: count(/href="(https:\/\/hubcloud\.[a-z]+\/(?:drive|video)\/[a-z0-9_]+)"/g),
    gdflix: count(/href="(https:\/\/(?:new\d+\.)?gdflix\.[a-z]+\/file\/[A-Za-z0-9]+)"/g),
    vcloud: count(/href="(?:https:\/\/href\.li\/)?(https:\/\/vcloud\.fit\/[a-z0-9]+)"/g),
    gdtot: count(/href="(https:\/\/(?:new\d+\.)?gdtot\.[a-z]+\/file\/\d+)"/g),
    pixelDrain: count(/href="(https:\/\/pixeldrain\.[a-z]+\/[uU]\/[A-Za-z0-9]+)"/g),
    drivegoogle: count(/href="(https:\/\/drive\.google\.com\/[^"]+)"/g),
    otherDl: count(/href="(https:\/\/(?:gofile|krakenfiles|mirror|onedrive|1fichier|mega\.nz|dropbox)[^"]+)"/gi),
  };
}

function showFamilies(tag, f) {
  const parts = Object.entries(f).filter(([, v]) => v.length).map(([k, v]) => `${k}:${v.length}`).join(' ');
  console.log(`${tag}: ${parts || 'NONE'}`);
}

// 1. casa homepage → recent slugs
console.log('=== movieshunt.casa homepage ===');
const home = await fetchGS('https://movieshunt.casa/');
console.log('status:', home.status);
const slugs = [...new Set([...home.body.matchAll(/href="https:\/\/movieshunt\.casa\/([a-z0-9-]{8,})\/"/g)].map(m => m[1]))]
  .filter(s => !/^(category|tag|page|wp-|feed|comment|search|author|disclaimer|dmca|privacy|contact|about|season|episode)/.test(s))
  .slice(0, 6);
console.log('recent slugs:', slugs);

for (const slug of slugs) {
  const p = await fetchGS('https://movieshunt.casa/' + slug + '/');
  if (p.status !== 200) { console.log(slug, '→ HTTP', p.status); continue; }
  showFamilies(slug, families(p.body));
}

// 2. Endgame page again (reference)
const eg = await fetchGS('https://movieshunt.casa/avengers-endgame-2019-dual-audio-hindi-english/');
showFamilies('[Endgame reference]', families(eg.body));

// 3. movieshunt.cc
console.log('\n=== movieshunt.cc ===');
const cc = await fetchGS('https://movieshunt.cc/');
console.log('homepage status:', cc.status, '| len:', cc.body.length);
if (cc.status === 200) {
  const ccSlugs = [...new Set([...cc.body.matchAll(/href="https?:\/\/[^"]*?\/([a-z0-9-]{8,})\/"/g)].map(m => m[1]))]
    .filter(s => !/^(category|tag|page|wp-|feed|comment|search|author|disclaimer|dmca|privacy|contact|about)/.test(s))
    .slice(0, 6);
  console.log('cc slugs sample:', ccSlugs);
  const ccSearch = await fetchGS('https://movieshunt.cc/?s=' + encodeURIComponent('Avengers Endgame'));
  const ccResults = [...new Set([...ccSearch.body.matchAll(/href="(https?:\/\/[^"]*?\/([a-z0-9-]*avengers[a-z0-9-]*)\/)"/g)].map(m => m[1]))];
  console.log('cc Endgame pages:', ccResults);
  for (const u of ccResults.slice(0, 2)) {
    const p = await fetchGS(u);
    if (p.status === 200) showFamilies(u.slice(0, 60), families(p.body));
  }
}
