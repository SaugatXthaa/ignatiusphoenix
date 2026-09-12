// One clean request (warm caches) → FULL per-source aggregation, all labels shown
const BASE = 'http://127.0.0.1:4595';
function labelOf(s) {
  const name = (s.name || '').split('\n').map(t => t.trim()).filter(Boolean);
  const line = name.find(l => /PhoeniX/i.test(l)) || name[0] || '';
  const seg = line.split('·').map(t => t.trim());
  if (seg.length >= 3) return seg[2];
  if (seg.length === 2) return seg[1];
  return line || 'unknown';
}
const t0 = Date.now();
const res = await fetch(`${BASE}/stream/movie/tt4154796.json`);
const data = await res.json();
const streams = data.streams || [];
const bySrc = {};
for (const s of streams) { const l = labelOf(s); bySrc[l] = (bySrc[l] || 0) + 1; }
console.log(`${streams.length} streams in ${Date.now() - t0}ms | ${Object.keys(bySrc).length} distinct source labels`);
console.log('='.repeat(50));
for (const [l, c] of Object.entries(bySrc).sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(3)}  ${l}`);
// Check specific family
console.log('='.repeat(50));
for (const f of ['VidKing', 'VidFast', 'Vidzee', 'Primeshows', 'VidSrc', 'MeineCloud', 'ImdbPlay', 'Vidsrcsbs']) {
  const found = Object.keys(bySrc).filter(k => k.toLowerCase().includes(f.toLowerCase()));
  console.log(`${f}: ${found.length ? found.map(k => `${k}=${bySrc[k]}`).join(', ') : 'ABSENT'}`);
}
