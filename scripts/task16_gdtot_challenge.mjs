// Task 16 — decode gdtot /_challenge flow and attempt server-side completion
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const fileUrl = 'https://new28.gdtot.dad/file/11648485368';

// --- Pass 1: get challenge page + full script ---
const r1 = await gotScraping({ url: fileUrl, headers: { 'User-Agent': UA, 'Referer': 'https://abhilinks.site/' }, timeout: { request: 20000 }, retry: { limit: 0 }, throwHttpErrors: false });
const body1 = typeof r1.body === 'string' ? r1.body : r1.body.toString();
const cookies1 = r1.headers['set-cookie'] || [];
console.log('pass1 status:', r1.statusCode, '| cookies:', cookies1.map(c => c.split(';')[0]));

const script = body1.match(/<script[^>]*>([\s\S]{3000,}?)<\/script>/);
if (script) console.log('\n=== FULL CHALLENGE SCRIPT ===\n' + script[1]);

// nonce visible?
const nonce = body1.match(/nonce:\s*["']([^"']+)["']/) || body1.match(/"nonce":"([^"]+)"/);
console.log('\nnonce in page:', nonce ? nonce[1] : 'NOT VISIBLE');

// --- Pass 2: try completing the challenge ---
if (nonce) {
  const origin = new URL(fileUrl).origin;
  const r2 = await gotScraping({
    url: origin + '/_challenge/complete',
    method: 'POST',
    headers: {
      'User-Agent': UA, 'Content-Type': 'application/json', 'Referer': fileUrl,
      'Origin': origin,
      ...(cookies1.length ? { Cookie: cookies1.map(c => c.split(';')[0]).join('; ') } : {}),
    },
    body: JSON.stringify({ nonce: nonce[1] }),
    timeout: { request: 20000 }, retry: { limit: 0 }, throwHttpErrors: false,
  });
  console.log('\ncomplete status:', r2.statusCode, '| body:', String(r2.body).slice(0, 300));
  const cookies2 = r2.headers['set-cookie'] || [];
  console.log('complete cookies:', cookies2.map(c => c.split(';')[0]));

  const allCookies = [...cookies1, ...cookies2].map(c => c.split(';')[0]).join('; ');
  // --- Pass 3: re-fetch file page with cookies ---
  const r3 = await gotScraping({ url: fileUrl, headers: { 'User-Agent': UA, 'Referer': 'https://abhilinks.site/', ...(allCookies ? { Cookie: allCookies } : {}) }, timeout: { request: 20000 }, retry: { limit: 0 }, throwHttpErrors: false });
  const body3 = typeof r3.body === 'string' ? r3.body : r3.body.toString();
  console.log('\npass3 status:', r3.statusCode, '| len:', body3.length, '| still challenge:', body3.includes('_challenge'));
  if (!body3.includes('_challenge')) {
    const hrefs = [...new Set([...body3.matchAll(/(?:href|action)="([^"]+)"/g)].map(m => m[1]))];
    console.log('HREFS:', hrefs.filter(h => !/\.(css|png|ico|js)/.test(h)).slice(0, 25).join('\n  '));
    for (const kw of ['drive.google', 'googleusercontent', 'indexserver', 'dl.php', 'download', 'gdrive', 'token']) {
      const n = (body3.match(new RegExp(kw, 'gi')) || []).length;
      if (n) { const i = body3.search(new RegExp(kw, 'i')); console.log(`KW ${kw}: ${n}x | ${body3.slice(Math.max(0, i - 80), i + 150).replace(/\s+/g, ' ')}`); }
    }
  }
}
