// zxcstream: sentinel param matrix
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
};
const tmdbId = 265712;

async function getToken() {
  const ts = Date.now();
  const xt = crypto.createHash('sha512').update(`${ts}:${SECRET}:${tmdbId}`).digest('hex').slice(0, 64);
  const r = await fetch(`${BASE}/backend/a1b2c3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': `${BASE}/embed/movie/${tmdbId}`, 'Origin': BASE },
    body: JSON.stringify({ [F.id]: tmdbId, [F.fToken]: xt, [F.ts]: ts, [F.path]: `/embed/movie/${tmdbId}`, [F.mediaType]: 'movie' }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json();
  return { xt, token: j.token || j[F.token], serverTs: j.ts || j[F.ts] };
}

const { xt, token, serverTs } = await getToken();
console.log('got token', String(token).slice(0, 16));

const variants = [
  ['hashed-fields', { [F.id]: String(tmdbId), b: 'movie', [F.ts]: String(serverTs), [F.token]: token, [F.fToken]: xt }],
  ['plain-fields', { id: String(tmdbId), b: 'movie', ts: String(serverTs), token, fToken: xt }],
  ['no-fToken', { [F.id]: String(tmdbId), b: 'movie', [F.ts]: String(serverTs), [F.token]: token }],
  ['b-film', { [F.id]: String(tmdbId), b: 'film', [F.ts]: String(serverTs), [F.token]: token, [F.fToken]: xt }],
];

for (const [name, params] of variants) {
  const q = new URLSearchParams(params);
  try {
    const r = await fetch(`${BASE}/backend_/embed/sentinel?${q.toString()}`, {
      headers: { 'User-Agent': UA, 'Referer': `${BASE}/embed/movie/${tmdbId}` }, signal: AbortSignal.timeout(10000),
    });
    const t = await r.text();
    const isHtml = t.trimStart().startsWith('<');
    console.log(`${name}: ${r.status} ${isHtml ? '(html)' : t.slice(0, 150)}`);
    if (r.ok && !isHtml) {
      console.log('SUCCESS:', t.slice(0, 400));
      break;
    }
  } catch (e) { console.log(`${name}: ERR ${e.message}`); }
}
