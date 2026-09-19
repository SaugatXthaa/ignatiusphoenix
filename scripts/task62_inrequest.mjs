// Task 62: single in-request fetch of an uncommon title, count per-source landing.
// This is what a user's ONE refresh sees.
const BASE = 'https://ignatiusphoenix.onrender.com';
// uncommon titles to avoid caches
const candidates = process.argv.slice(2);
const [type, id, label] = candidates;
function attrib(s) {
  const bg = s.behaviorHints?.bingeGroup || '';
  const m = bg.match(/^phoenix-([a-z0-9]+)/i);
  return m ? m[1] : (s.name || '?').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14);
}
const t0 = Date.now();
const d = await (await fetch(`${BASE}/stream/${type}/${id}.json`, { signal: AbortSignal.timeout(150000) })).json();
const ms = Date.now() - t0;
const streams = d.streams || [];
const by = {};
for (const s of streams) { const k = attrib(s); by[k] = (by[k] || 0) + 1; }
console.log(`${label}: ${streams.length} cards from ${Object.keys(by).length} sources in ${ms}ms`);
console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
const html = streams.filter(s => /\.(html?)(\?|$)/i.test((s.url || '').split('?')[0]) && !/\.(m3u8|mp4|mkv|ts)(\?|$)/i.test((s.url || '').split('?')[0]));
console.log(`html-cards=${html.length} subbed=${streams.filter(s => (s.subtitles || []).length > 0).length}/${streams.length}`);
