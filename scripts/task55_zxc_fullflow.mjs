// zxcstream: full token → sentinel → embed flow with the NEW protocol
import crypto from 'crypto';
const BASE = 'https://player.zxcstream.xyz';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const SECRET = '23423653';
const FIELD_MAP = {
  id: 'a7f39c821d604e5b9c7143f36e1547b',
  fToken: 'e83c4b719a52d8f3136052479c1635a',
  ts: '61d9a5274c8e3b29af75d6384c291e6',
  token: 'c492f7a183d6502b1e7436c538a716d',
  title: '5e28c9147a306d531e829f3674b392a1',
  year: 'b731e6c94f082a169d725f8341c306e',
  season: 'd8427b59ce30684a2f957c3613e85b',
  episode: '91c6e4a728bd503d1f785c92346b713d',
  imdbId: 'f35a8c19d674b3265e871c4933a725f',
  path: '6b491e7253ad8f14d392e7561a9384c',
  mediaType: 'c285f91ab306d281e947a35632e816b',
  date: 'e164932c50216ad739e5814b3027',
  latestDate: 'e16932c54356416ad739e5814b3027',
};

function genToken(tmdbId) {
  const ts = Date.now();
  const xt = crypto.createHash('sha512').update(`${ts}:${SECRET}:${tmdbId}`).digest('hex').slice(0, 64);
  return { xt, ts };
}

async function resolveEmbed(tmdbId, type = 'movie', season = null, episode = null) {
  const { xt, ts } = genToken(tmdbId);
  const tokBody = { [FIELD_MAP.id]: tmdbId, [FIELD_MAP.fToken]: xt, [FIELD_MAP.ts]: ts };
  const r1 = await fetch(`${BASE}/backend/a1b2c3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': `${BASE}/`, 'Origin': BASE },
    body: JSON.stringify(tokBody),
    signal: AbortSignal.timeout(12000),
  });
  const t1 = await r1.text();
  console.log('TOKEN:', r1.status, t1.slice(0, 200));
  if (!r1.ok) return null;
  const j1 = JSON.parse(t1);
  const token = j1[FIELD_MAP.token];
  const serverTs = j1[FIELD_MAP.ts];

  const q = new URLSearchParams({
    [FIELD_MAP.id]: tmdbId,
    b: type === 'tv' ? 'tv' : 'movie',
    [FIELD_MAP.ts]: String(serverTs),
    [FIELD_MAP.token]: token,
    [FIELD_MAP.fToken]: xt,
  });
  if (type === 'tv' && season && episode) { q.set('season', String(season)); q.set('episode', String(episode)); }
  const sentinelUrl = `${BASE}/backend_/embed/sentinel?${q.toString()}`;
  const r2 = await fetch(sentinelUrl, {
    headers: { 'User-Agent': UA, 'Referer': `${BASE}/embed/${type}/${tmdbId}` },
    signal: AbortSignal.timeout(12000),
  });
  const t2 = await r2.text();
  console.log('SENTINEL:', r2.status, t2.slice(0, 400));
  if (!r2.ok) return null;
  return JSON.parse(t2);
}

const id = process.argv[2] ? parseInt(process.argv[2], 10) : 265712;
const type = process.argv[3] || 'movie';
const s = process.argv[4] || null, e = process.argv[5] || null;
const result = await resolveEmbed(id, type, s, e);
console.log('\nRESULT:', JSON.stringify(result, null, 1)?.slice(0, 800));

// If embed is an iframe URL, fetch it to see the real stream backend
if (result?.embed) {
  try {
    const r3 = await fetch(result.embed, { headers: { 'User-Agent': UA, 'Referer': `${BASE}/` }, signal: AbortSignal.timeout(12000) });
    const b3 = await r3.text();
    console.log('\nEMBED PAGE:', r3.status, 'len', b3.length, 'head:', b3.slice(0, 200).replace(/\n/g, ' '));
  } catch (er) { console.log('embed fetch fail:', er.message); }
}
