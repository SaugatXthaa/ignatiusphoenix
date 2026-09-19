// Task 63: inspect real /stream cards attributed to raflix + stellarrip timing
const BASE = 'https://ignatiusphoenix.onrender.com';
async function j(url, ms = 60000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); return await r.json(); }
  catch (e) { return { _err: String(e).slice(0, 100) }; }
  finally { clearTimeout(t); }
}

const r = await j(`${BASE}/stream/movie/tt1375666.json`);
const streams = Array.isArray(r?.streams) ? r.streams : [];
console.log(`total cards: ${streams.length}`);
const raf = streams.filter(s => /raflix/i.test(s.name || '') || /raflix/i.test(s.title || '') || (s.behaviorHints?.bingeGroup || '').includes('raflix'));
console.log(`\n=== RAFLEX-ATTRIBUTED CARDS: ${raf.length} ===`);
for (const s of raf) {
  console.log(`- name=${s.name} title=${(s.title || '').slice(0, 70)}`);
  console.log(`  url=${String(s.url).slice(0, 130)}`);
  console.log(`  description=${(s.description || '').slice(0, 90)}`);
}

// also check stellar/stellarrip cards
const st = streams.filter(s => /stellar/i.test(s.name || '') || /stellar/i.test(s.title || ''));
console.log(`\n=== STELLAR* CARDS: ${st.length} ===`);
for (const s of st.slice(0, 6)) {
  console.log(`- name=${s.name} url=${String(s.url).slice(0, 110)}`);
}

// count how many total cards are embed-style (no m3u8/mp4 and not our proxy)
let suspicious = 0;
for (const s of streams) {
  const u = String(s.url);
  const isProxy = u.includes('/proxy') || u.includes('/range-proxy');
  const isDirect = /\.m3u8|\.mp4|\.mkv|\/hls|\/stream|\.ts(\?|$)|playlist|manifest/i.test(u) || isProxy;
  if (!isDirect) { suspicious++; if (suspicious <= 12) console.log(`SUSPECT: ${String(s.name).slice(0, 30)} ${u.slice(0, 110)}`); }
}
console.log(`\nnon-stream-looking urls: ${suspicious} / ${streams.length}`);
