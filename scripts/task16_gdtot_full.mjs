// Task 16 — full gdtot flow: challenge complete → real page → find download target
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const fileUrl = process.argv[2] || 'https://new28.gdtot.dad/file/11648485368';

let cookieJar = [];

function collectCookies(res) {
  const sc = res.headers['set-cookie'] || [];
  for (const c of sc) {
    const [kv] = c.split(';');
    const name = kv.split('=')[0];
    cookieJar = cookieJar.filter(c2 => !c2.startsWith(name + '='));
    cookieJar.push(kv);
  }
}

function cookieHeader() { return cookieJar.join('; '); }

const r1 = await gotScraping({ url: fileUrl, headers: { 'User-Agent': UA, 'Referer': 'https://abhilinks.site/' }, timeout: { request: 20000 }, retry: { limit: 0 }, throwHttpErrors: false });
collectCookies(r1);
const body1 = typeof r1.body === 'string' ? r1.body : r1.body.toString();
const nonce = body1.match(/nonce:\s*["']([^"']+)["']/);
const path = new URL(fileUrl).pathname;
if (!nonce) { console.log('NO NONCE — page len', body1.length); process.exit(1); }

const origin = new URL(fileUrl).origin;
const r2 = await gotScraping({
  url: origin + '/_challenge/complete', method: 'POST',
  headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Referer': fileUrl, 'Origin': origin, 'Cookie': cookieHeader() },
  body: JSON.stringify({ nonce: nonce[1], path }), timeout: { request: 20000 }, retry: { limit: 0 }, throwHttpErrors: false,
});
collectCookies(r2);
console.log('challenge complete:', r2.statusCode, String(r2.body).slice(0, 120));

const r3 = await gotScraping({ url: fileUrl, headers: { 'User-Agent': UA, 'Referer': 'https://abhilinks.site/', 'Cookie': cookieHeader() }, timeout: { request: 20000 }, retry: { limit: 0 }, throwHttpErrors: false });
collectCookies(r3);
const body3 = typeof r3.body === 'string' ? r3.body : r3.body.toString();
console.log('file page:', r3.statusCode, '| len:', body3.length, '| challenge:', body3.includes('_challenge'));
console.log('\n=== FULL FILE PAGE (text-stripped head 3000) ===');
console.log(body3.replace(/<script[\s\S]*?<\/script>/g, '[SCRIPT]').replace(/<style[\s\S]*?<\/style>/g, '[STYLE]').replace(/\s+/g, ' ').slice(0, 3000));

// Forms
const forms = [...body3.matchAll(/<form[\s\S]*?<\/form>/g)].map(f => f[0].replace(/\s+/g, ' ').slice(0, 400));
console.log('\n=== FORMS (' + forms.length + ') ===');
forms.forEach((f, i) => console.log(`form #${i}: ${f}`));

// Buttons with onclick / ids
const btns = [...body3.matchAll(/<(?:button|a|div)[^>]*(?:onclick|id)="[^"]*(?:download|dl|gen|link)[^"]*"[^>]*>[\s\S]{0,200}?(?:<\/|>)/gi)].map(b => b[0].replace(/\s+/g, ' '));
console.log('\n=== DOWNLOAD-ISH ELEMENTS ===');
[...new Set(btns)].slice(0, 10).forEach(b => console.log('  ', b.slice(0, 250)));

const scripts = [...body3.matchAll(/<script[^>]*>([\s\S]{200,}?)<\/script>/g)].map(m => m[1]);
console.log('\n=== SCRIPTS (' + scripts.length + ') ===');
scripts.forEach((s, i) => { console.log(`--- #${i} (${s.length}) ---\n${s.slice(0, 1200)}\n`); });
