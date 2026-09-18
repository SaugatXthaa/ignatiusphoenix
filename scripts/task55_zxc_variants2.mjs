// zxcstream: more token variants — extra FIELD_MAP fields + details warmup
import crypto from 'crypto';
const BASE = 'https://player.zxcstream.xyz';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const SECRET = '23423653';
const F = {
  id: 'a7f39c821d604e5b9c7143f36e1547b',
  fToken: 'e83c4b719a52d8f3136052479c1635a',
  ts: '61d9a5274c8e3b29af75d6384c291e6',
  token: 'c492f7a183d6502b1e7436c538a716d',
  path: '6b491e7253ad8f14d392e7561a9384c',
  mediaType: 'c285f91ab306d281e947a35632e816b',
  imdbId: 'f35a8c19d674b3265e871c4933a725f',
};
const tmdbId = 265712;
const H = { 'User-Agent': UA, 'Referer': `${BASE}/embed/movie/${tmdbId}`, 'Origin': BASE };

// warmup: details endpoint
try {
  const r0 = await fetch(`${BASE}/backend/tmdb/details/movie/${tmdbId}`, { headers: H, signal: AbortSignal.timeout(10000) });
  const t0 = await r0.text();
  console.log('DETAILS:', r0.status, t0.slice(0, 250));
} catch (e) { console.log('DETAILS ERR:', e.message); }

const variants = [
  ['with-path-mediaType', { [F.id]: tmdbId, [F.fToken]: 'X', [F.ts]: Date.now(), [F.path]: `/embed/movie/${tmdbId}`, [F.mediaType]: 'movie' }],
  ['with-mediaType', { [F.id]: tmdbId, [F.fToken]: 'X', [F.ts]: Date.now(), [F.mediaType]: 'movie' }],
];

for (const [name, base] of variants) {
  const ts = Date.now();
  const xt = crypto.createHash('sha512').update(`${ts}:${SECRET}:${tmdbId}`).digest('hex').slice(0, 64);
  const body = { ...base, [F.fToken]: xt, [F.ts]: ts };
  try {
    const r = await fetch(`${BASE}/backend/a1b2c3`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...H },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    console.log(`${name}: ${r.status} ${(await r.text()).slice(0, 150)}`);
  } catch (e) { console.log(`${name}: ERR ${e.message}`); }
}

// What does a plain GET on /backend/a1b2c3 say? (route existence check)
for (const m of ['GET', 'PUT']) {
  try {
    const r = await fetch(`${BASE}/backend/a1b2c3`, { method: m, headers: H, signal: AbortSignal.timeout(8000) });
    console.log(`${m}: ${r.status} ${(await r.text()).slice(0, 100)}`);
  } catch (e) { console.log(`${m}: ERR ${e.message}`); }
}
