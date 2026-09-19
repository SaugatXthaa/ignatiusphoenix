// Task 63: broad subtitle verification via the REAL Stremio path (tt ids)
const BASE = 'https://ignatiusphoenix.onrender.com';
async function j(url, ms = 65000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); return await r.json(); }
  finally { clearTimeout(t); }
}

const TITLES = [
  { name: 'Inception', path: 'movie/tt1375666.json' },
  { name: 'Obsession', path: 'movie/tt37287335.json' },
  { name: 'GoT S1E1', path: 'series/tt0944947:1:1.json' },
  { name: 'SquidGame S1E1', path: 'series/tt9174598:1:1.json' },
  { name: 'Frieren S1E1', path: 'series/tt21106846:1:1.json' }, // anime
];

for (const t of TITLES) {
  const r = await j(`${BASE}/stream/${t.path}`);
  const streams = Array.isArray(r?.streams) ? r.streams : [];
  const subbed = streams.filter(s => s.subtitles?.length);
  const enSubs = streams.filter(s => s.subtitles?.some(x => /eng|en/i.test(x.lang || '')));
  console.log(`${t.name}: cards=${streams.length} subbed=${subbed.length}${streams.length ? ` (${Math.round(100 * subbed.length / streams.length)}%)` : ''} withEnglish=${enSubs.length}`);
  // fetch one sub and validate
  const s0 = subbed[0]?.subtitles?.[0];
  if (s0) {
    try {
      const u = s0.url.startsWith('//') ? 'https:' + s0.url : s0.url;
      const rr = await fetch(u, { signal: AbortSignal.timeout(15000) });
      const body = await rr.text();
      const valid = body.startsWith('WEBVTT') || body.startsWith('[') || /-->/.test(body.slice(0, 2000));
      console.log(`  sample: ${rr.status} ${rr.headers.get('content-type')} validVTT=${valid} head=${body.slice(0, 50).replace(/\n/g, ' ')}`);
    } catch (e) { console.log(`  sample ERR ${String(e).slice(0, 60)}`); }
  }
}
