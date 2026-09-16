// task25_verify_fix_cards.mjs — verify the newly-delivered stellarrip/imdbplay
// cards (post-fix) actually play: fetch each card URL (self-proxy class) and
// magic-check the response (HLS text or binary video head).
const BASE = 'http://127.0.0.1:4598';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36' };

const res = await fetch(`${BASE}/stream/movie/tt4154796.json`, { signal: AbortSignal.timeout(120000) });
const d = await res.json();
const targets = ['stellarrip', 'imdbplay'];
const cards = [];
for (const s of d.streams || []) {
  const bg = s.behaviorHints?.bingeGroup || '';
  const sid = bg.split('-')[1] || '?';
  if (targets.includes(sid) && s.url) cards.push({ sid, url: s.url.replace(/^https:\/\/127\.0\.0\.1:/, 'http://127.0.0.1:'), title: s.title });
}
console.log(`found ${cards.length} target cards`);
let ok = 0;
for (const c of cards.slice(0, 4)) {
  try {
    const r = await fetch(c.url, { headers: { ...UA, Range: 'bytes=0-2047' }, signal: AbortSignal.timeout(45000) });
    const reader = r.body.getReader();
    const { value } = await reader.read();
    const b = Buffer.from(value || []); // Uint8Array.toString() ignores encoding — must wrap in Buffer
    try { await reader.cancel(); } catch {}
    const text = b.toString('latin1');
    const magic = b[0] === 0x1a && b[1] === 0x45 ? 'EBML' : b.subarray(4, 8).toString('latin1') === 'ftyp' ? 'MP4' : b[0] === 0x47 ? 'MPEG-TS' : text.includes('#EXTM3U') ? 'HLS' : '?';
    const pass = r.status === 200 || r.status === 206;
    if (pass && magic !== '?') ok++;
    console.log(`[${pass && magic !== '?' ? 'OK' : 'FAIL'}] ${c.sid} status=${r.status} magic=${magic} head=${text.slice(0, 40).replace(/\n/g, '⏎')}`);
  } catch (e) { console.log(`[ERR] ${c.sid} ${e.message.slice(0, 60)}`); }
}
console.log(`RESULT: ${ok}/${Math.min(4, cards.length)} verified`);
