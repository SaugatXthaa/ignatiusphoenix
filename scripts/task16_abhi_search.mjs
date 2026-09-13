// Task 16 — gdflix 302 follow + abhilinks site search for re-posted archives
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchGS(url, referer, follow) {
  const res = await gotScraping({
    url, headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', ...(referer ? { Referer: referer } : {}) },
    timeout: { request: 15000 }, retry: { limit: 0 }, throwHttpErrors: false, followRedirect: follow !== false,
  });
  return { status: res.statusCode, body: typeof res.body === 'string' ? res.body : (res.body ? res.body.toString() : ''), location: res.headers.location };
}

// 1. gdflix 302 target
console.log('=== gdflix 302 follow ===');
const g1 = await fetchGS('https://gdflix.dev/file/N0ok72OpkmAOoKn', undefined, false);
console.log('no-follow:', g1.status, '→', g1.location);
if (g1.location) {
  const target = g1.location.startsWith('http') ? g1.location : new URL(g1.location, 'https://gdflix.dev/').toString();
  const g2 = await fetchGS(target);
  console.log('followed:', target.slice(0, 90), '→', g2.status, '| len:', g2.body.length, '| indexserver:', /max\.indexserver\.site/.test(g2.body), '| challenge:', /challenge|Just a moment/.test(g2.body));
  const idx = g2.body.match(/https:\/\/max\.indexserver\.site\/[^\s"'<>]+/);
  if (idx) console.log('INDEXSERVER:', idx[0].slice(0, 120));
  else console.log('page head:', g2.body.slice(0, 400).replace(/\s+/g, ' '));
}

// 2. abhilinks site search — does it have re-posted archives for old titles?
console.log('\n=== abhilinks.site search ===');
for (const q of ['avengers endgame', 'interstellar']) {
  const s = await fetchGS('https://abhilinks.site/?s=' + encodeURIComponent(q), 'https://movieshunt.casa/');
  console.log(`search "${q}":`, s.status, '| len:', s.body.length);
  const posts = [...new Set([...s.body.matchAll(/href="(https:\/\/abhilinks\.site\/archives\/(\d+)\/?)"/g)].map(m => m[1] + ' #' + m[2]))];
  console.log('  archives found:', posts.length ? posts.slice(0, 10) : 'NONE');
  const titles = [...new Set([...s.body.matchAll(/<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)</g)].map(m => m[2].trim() + ' → ' + m[1]))];
  console.log('  titles:', titles.slice(0, 6));
}

// 3. If an Endgame archive exists beyond 1040, check its link families
console.log('\n=== Endgame archive families (all hits) ===');
const s2 = await fetchGS('https://abhilinks.site/?s=' + encodeURIComponent('avengers endgame'));
const archs = [...new Set([...s2.body.matchAll(/https:\/\/abhilinks\.site\/archives\/(\d+)\//g)].map(m => m[1]))];
for (const a of archs.slice(0, 8)) {
  const p = await fetchGS('https://abhilinks.site/archives/' + a + '/');
  const f = {
    hubcloud: [...new Set([...p.body.matchAll(/href="(https:\/\/hubcloud\.[a-z]+\/(?:drive|video)\/[a-z0-9_]+)"/g)].map(m => m[1]))].length,
    gdflix: [...new Set([...p.body.matchAll(/href="(https:\/\/(?:new\d+\.)?gdflix\.[a-z]+\/file\/[A-Za-z0-9]+)"/g)].map(m => m[1]))].length,
    vcloud: [...new Set([...p.body.matchAll(/href="(?:https:\/\/href\.li\/)?(https:\/\/vcloud\.fit\/[a-z0-9]+)"/g)].map(m => m[1]))].length,
    gdtot: [...new Set([...p.body.matchAll(/href="(https:\/\/(?:new\d+\.)?gdtot\.[a-z]+\/file\/\d+)"/g)].map(m => m[1]))].length,
  };
  console.log(`archive #${a}:`, JSON.stringify(f));
}
