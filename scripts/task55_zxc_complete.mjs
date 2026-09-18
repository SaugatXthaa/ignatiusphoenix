// zxcstream: COMPLETE flow — token → sentinel → embed inspection
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
  season: 'd8427b59ce30684a2f957c3613e85b',
  episode: '91c6e4a728bd503d1f785c92346b713d',
  imdbId: 'f35a8c19d674b3265e871c4933a725f',
};

async function resolveZxc(tmdbId, mediaType = 'movie', season = null, episode = null, imdbId = '') {
  const ts = Date.now();
  const xt = crypto.createHash('sha512').update(`${ts}:${SECRET}:${tmdbId}`).digest('hex').slice(0, 64);
  const pagePath = mediaType === 'tv' ? `/embed/tv/${tmdbId}` + (season ? `/${season}/${episode}` : '') : `/embed/movie/${tmdbId}`;
  const r1 = await fetch(`${BASE}/backend/a1b2c3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': `${BASE}${pagePath}`, 'Origin': BASE },
    body: JSON.stringify({
      [F.id]: tmdbId, [F.fToken]: xt, [F.ts]: ts,
      [F.path]: pagePath, [F.mediaType]: mediaType,
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!r1.ok) { console.log('TOKEN FAIL:', r1.status, (await r1.text()).slice(0, 120)); return null; }
  const j1 = await r1.json();
  const token = j1[F.token] || j1.token;
  const serverTs = j1[F.ts] || j1.ts;
  console.log('token ok:', String(token).slice(0, 20) + '...', 'serverTs:', serverTs);

  const q = new URLSearchParams({
    [F.id]: String(tmdbId), b: mediaType, [F.ts]: String(serverTs), [F.token]: token, [F.fToken]: xt,
  });
  if (mediaType === 'tv' && season) { q.set(F.season, String(season)); q.set(F.episode, String(episode || 1)); }
  if (imdbId) q.set(F.imdbId, imdbId);
  const r2 = await fetch(`${BASE}/backend_/embed/sentinel?${q.toString()}`, {
    headers: { 'User-Agent': UA, 'Referer': `${BASE}${pagePath}` }, signal: AbortSignal.timeout(12000),
  });
  const t2 = await r2.text();
  console.log('SENTINEL:', r2.status, t2.slice(0, 300));
  if (!r2.ok) return null;
  let j2;
  try { j2 = JSON.parse(t2); } catch { return null; }
  const embed = j2.embed || j2[F.path] || null;
  return { embed, raw: j2 };
}

const [,, idArg, typeArg, sArg, eArg] = process.argv;
const tmdbId = parseInt(idArg || '265712', 10);
const mediaType = typeArg || 'movie';
const season = sArg ? parseInt(sArg, 10) : null;
const episode = eArg ? parseInt(eArg, 10) : null;
const out = await resolveZxc(tmdbId, mediaType, season, episode);
console.log('\nEMBED:', out?.embed);
if (out?.embed) {
  try {
    const r3 = await fetch(out.embed, { headers: { 'User-Agent': UA, 'Referer': `${BASE}/` }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
    const b3 = await r3.text();
    console.log('EMBED PAGE:', r3.status, 'final:', r3.url.slice(0, 100), 'len', b3.length);
    console.log('head:', b3.slice(0, 300).replace(/\s+/g, ' '));
    // look for player api hints
    const apis = [...new Set(b3.match(/(?:\/api\/|\/play|\/source|\/embed)[a-zA-Z0-9/_.?=-]{0,60}/g) || [])].slice(0, 12);
    console.log('api hints:', apis);
  } catch (e) { console.log('embed fetch err:', e.message); }
}
