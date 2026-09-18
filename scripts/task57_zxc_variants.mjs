#!/usr/bin/env node
/** Task 57: brute-force the new zxc token POST shape. */
import crypto from 'crypto';

const BASE = 'https://player.zxcstream.xyz';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const SECRET = '23423653';
const F = { id: 'a7f39c821d604e5b9c7143f36e1547b', fToken: 'e83c4b719a52d8f3136052479c1635a', ts: '61d9a5274c8e3b29af75d6384c291e6' };
const TMDB = 27205;

const variants = [];
function hash(seed, ts, id) {
  return crypto.createHash('sha512').update(`${ts}:${seed}:${id}`).digest('hex').slice(0, 64);
}
// v1: ms ts, hash(ts:secret:id) [Task 55 original]
variants.push({ label: 'v1 ms ts / hash(ts:secret:id)', body: () => { const ts = Date.now(); return { [F.id]: TMDB, [F.fToken]: hash(SECRET, ts, TMDB), [F.ts]: ts }; } });
// v2: string id
variants.push({ label: 'v2 string id', body: () => { const ts = Date.now(); return { [F.id]: String(TMDB), [F.fToken]: hash(SECRET, ts, TMDB), [F.ts]: ts }; } });
// v3: seconds ts
variants.push({ label: 'v3 seconds ts', body: () => { const ts = Math.floor(Date.now() / 1000); return { [F.id]: TMDB, [F.fToken]: hash(SECRET, ts, TMDB), [F.ts]: ts }; } });
// v4: hash(id:secret:ts)
variants.push({ label: 'v4 hash(id:secret:ts)', body: () => { const ts = Date.now(); return { [F.id]: TMDB, [F.fToken]: crypto.createHash('sha512').update(`${TMDB}:${SECRET}:${ts}`).digest('hex').slice(0, 64), [F.ts]: ts }; } });
// v5: hash(secret:ts:id)
variants.push({ label: 'v5 hash(secret:ts:id)', body: () => { const ts = Date.now(); return { [F.id]: TMDB, [F.fToken]: crypto.createHash('sha512').update(`${SECRET}:${ts}:${TMDB}`).digest('hex').slice(0, 64), [F.ts]: ts }; } });
// v6: sha256 instead of sha512?
variants.push({ label: 'v6 sha256(ts:secret:id)', body: () => { const ts = Date.now(); return { [F.id]: TMDB, [F.fToken]: crypto.createHash('sha256').update(`${ts}:${SECRET}:${TMDB}`).digest('hex').slice(0, 64), [F.ts]: ts }; } });

for (const v of variants) {
  try {
    const r = await fetch(`${BASE}/backend/abaygagoka`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': `${BASE}/embed/movie/${TMDB}`, 'Origin': BASE, 'Accept': 'application/json, text/plain, */*' },
      body: JSON.stringify(v.body()),
      signal: AbortSignal.timeout(10000),
    });
    const t = await r.text();
    console.log(`${v.label.padEnd(28)} → ${r.status} ${t.slice(0, 120).replace(/\n/g, '')}`);
    if (r.ok) break;
  } catch (e) { console.log(`${v.label.padEnd(28)} → ERR ${e.message}`); }
}
