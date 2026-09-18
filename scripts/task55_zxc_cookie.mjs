// zxcstream: token POST with cookie session (XSRF flow)
import crypto from 'crypto';
const BASE = 'https://player.zxcstream.xyz';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const SECRET = '23423653';
const F = {
  id: 'a7f39c821d604e5b9c7143f36e1547b',
  fToken: 'e83c4b719a52d8f3136052479c1635a',
  ts: '61d9a5274c8e3b29af75d6384c291e6',
  token: 'c492f7a183d6502b1e7436c538a716d',
};
const tmdbId = 265712;

// 1. warm up: GET the player page, capture cookies
const pageRes = await fetch(`${BASE}/embed/movie/${tmdbId}`, { headers: { 'User-Agent': UA } });
const setCookies = pageRes.headers.getSetCookie ? pageRes.headers.getSetCookie() : [];
const cookieHeader = setCookies.map(c => c.split(';')[0]).join('; ');
console.log('page:', pageRes.status, 'cookies:', setCookies.length ? cookieHeader : '(none)');

const ts = Date.now();
const xt = crypto.createHash('sha512').update(`${ts}:${SECRET}:${tmdbId}`).digest('hex').slice(0, 64);

const attempts = [
  ['json+cookies', 'application/json', JSON.stringify({ [F.id]: tmdbId, [F.fToken]: xt, [F.ts]: ts }), {}],
  ['form+cookies', 'application/x-www-form-urlencoded', new URLSearchParams({ [F.id]: String(tmdbId), [F.fToken]: xt, [F.ts]: String(ts) }).toString(), {}],
];

for (const [name, ct, body, extra] of attempts) {
  const headers = { 'Content-Type': ct, 'User-Agent': UA, 'Referer': `${BASE}/embed/movie/${tmdbId}`, 'Origin': BASE, 'Accept': 'application/json, text/plain, */*', ...extra };
  if (cookieHeader) headers['Cookie'] = cookieHeader;
  const xsrf = setCookies.find(c => c.startsWith('XSRF-TOKEN='));
  if (xsrf) headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf.split(';')[0].split('=').slice(1).join('='));
  try {
    const r = await fetch(`${BASE}/backend/a1b2c3`, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
    const t = await r.text();
    console.log(`${name}: ${r.status} ${t.slice(0, 200)}`);
    if (r.ok) {
      const j = JSON.parse(t);
      console.log('TOKEN VALUE:', j[F.token] ? 'GOT' : Object.keys(j));
      break;
    }
  } catch (e) { console.log(`${name}: ERR ${e.message}`); }
}
