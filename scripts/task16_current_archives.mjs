// Task 16 — verify hubcloud/gdflix resolution on a CURRENT archive + vcloud bot-UA test
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchGS(url, referer, uaOverride) {
  const res = await gotScraping({
    url, headers: { 'User-Agent': uaOverride || UA, 'Accept': 'text/html,*/*', ...(referer ? { Referer: referer } : {}) },
    timeout: { request: 15000 }, retry: { limit: 0 }, throwHttpErrors: false, followRedirect: false,
  });
  return { status: res.statusCode, body: typeof res.body === 'string' ? res.body : (res.body ? res.body.toString() : ''), location: res.headers.location };
}

// --- 1. current archive 43476: resolve one hubcloud + one gdflix ---
console.log('=== archive 43476 link resolution ===');
const arch = await fetchGS('https://abhilinks.site/archives/43476/', 'https://movieshunt.casa/');
const hubLinks = [...new Set([...arch.body.matchAll(/href="(https:\/\/hubcloud\.[a-z]+\/(?:drive|video)\/([a-z0-9_]+))"/g)].map(m => m[1]))];
const gdLinks = [...new Set([...arch.body.matchAll(/href="(https:\/\/(?:new\d+\.)?gdflix\.[a-z]+\/file\/([A-Za-z0-9]+))"/g)].map(m => m[1]))];
console.log('hubcloud:', hubLinks.slice(0, 3));
console.log('gdflix:', gdLinks.slice(0, 3));

if (hubLinks[0]) {
  console.log('\n-- hubcloud resolve:', hubLinks[0]);
  const hp = await fetchGS(hubLinks[0], 'https://hubcloud.cx/');
  console.log('page:', hp.status, '| len:', hp.body.length);
  const gx = hp.body.match(/https:\/\/gamerxyt\.com\/hubcloud\.php\?[^"'\s]+/);
  const pixel = hp.body.match(/https:\/\/pixel\.hubcloud\.[a-z]+\/\?id=[^"'\s]+/);
  console.log('gamerxyt:', !!gx, '| pixel:', !!pixel);
  if (gx) {
    const gp = await fetchGS(gx[0], hubLinks[0]);
    console.log('gamerxyt page:', gp.status, '| len:', gp.body.length, '| lh3:', /lh3\.googleusercontent/.test(gp.body), '| pixeldrain:', /pixeldrain/.test(gp.body), '| pixel:', /pixel\.hubcloud/.test(gp.body));
    const lh3 = gp.body.match(/https:\/\/lh3\.googleusercontent\.com\/[^\s"'<>]+/);
    if (lh3) {
      const dl = lh3[0].split('#')[0].split('=m')[0] + '=d';
      const hd = await fetchGS(dl, undefined, UA);
      console.log('lh3=d HEAD:', hd.status, '| content-type:', hd.headers ? '' : '', hd.body ? '' : '');
    }
  }
}

if (gdLinks[0]) {
  console.log('\n-- gdflix resolve:', gdLinks[0]);
  const gp = await fetchGS(gdLinks[0]);
  console.log('page:', gp.status, '| len:', gp.body.length, '| indexserver:', /max\.indexserver\.site/.test(gp.body));
  const idx = gp.body.match(/https:\/\/max\.indexserver\.site\/[^\s"'<>]+/);
  if (idx) console.log('indexserver URL:', idx[0].slice(0, 110));
}

// --- 2. vcloud bot-UA test ---
console.log('\n=== vcloud.fit bot-UA test ===');
const bots = [
  ['googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  ['facebookexternalhit', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
  ['TelegramBot', 'TelegramBot (like TwitterBot)'],
  ['twitterbot', 'Twitterbot/1.0'],
  ['whatsapp', 'WhatsApp/2.23.20.0'],
];
for (const [name, ua] of bots) {
  try {
    const r = await fetchGS('https://vcloud.fit/bycxgtppyxcefne', 'https://abhilinks.site/', ua);
    const interesting = r.status === 200 && !r.body.includes('Just a moment');
    console.log(`${name}: ${r.status} len=${r.body.length} realPage=${interesting}`);
    if (interesting) {
      const links = [...new Set([...r.body.matchAll(/href="([^"]+)"/g)].map(m => m[1]))].filter(h => /drive|google|download|dl\.|indexserver|api/.test(h));
      console.log('  LINKS:', links.slice(0, 8));
    }
  } catch (e) { console.log(`${name}: ERR ${e.message}`); }
}
