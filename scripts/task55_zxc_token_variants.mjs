// zxcstream: brute-force token POST variations
import crypto from 'crypto';
const BASE = 'https://player.zxcstream.xyz';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const SECRET = '23423653';
const F = {
  id: 'a7f39c821d604e5b9c7143f36e1547b',
  fToken: 'e83c4b719a52d8f3136052479c1635a',
  ts: '61d9a5274c8e3b29af75d6384c291e6',
  token: 'c492f7a183d6502b1e7436c538a716d',
  imdbId: 'f35a8c19d674b3265e871c4933a725f',
};
const tmdbId = 265712;
const ts = Date.now();
const xt = crypto.createHash('sha512').update(`${ts}:${SECRET}:${tmdbId}`).digest('hex').slice(0, 64);

const variants = [
  ['json-num', 'application/json', JSON.stringify({ [F.id]: tmdbId, [F.fToken]: xt, [F.ts]: ts })],
  ['json-str', 'application/json', JSON.stringify({ [F.id]: String(tmdbId), [F.fToken]: xt, [F.ts]: String(ts) })],
  ['json+imdb', 'application/json', JSON.stringify({ [F.id]: tmdbId, [F.fToken]: xt, [F.ts]: ts, [F.imdbId]: 'tt3722564' })],
  ['form', 'application/x-www-form-urlencoded', new URLSearchParams({ [F.id]: String(tmdbId), [F.fToken]: xt, [F.ts]: String(ts) }).toString()],
];

for (const [name, ct, body] of variants) {
  try {
    const r = await fetch(`${BASE}/backend/a1b2c3`, {
      method: 'POST',
      headers: { 'Content-Type': ct, 'User-Agent': UA, 'Referer': `${BASE}/embed/movie/${tmdbId}`, 'Origin': BASE, 'Accept': 'application/json' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    const t = await r.text();
    console.log(`${name}: ${r.status} ${t.slice(0, 160)}`);
    if (r.ok) break;
  } catch (e) { console.log(`${name}: ERR ${e.message}`); }
}
// also apex domain
try {
  const r = await fetch(`https://zxcstream.xyz/backend/a1b2c3`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': `${BASE}/`, 'Origin': BASE },
    body: JSON.stringify({ [F.id]: tmdbId, [F.fToken]: xt, [F.ts]: ts }), signal: AbortSignal.timeout(10000),
  });
  console.log('apex:', r.status, (await r.text()).slice(0, 160));
} catch (e) { console.log('apex: ERR', e.message); }
