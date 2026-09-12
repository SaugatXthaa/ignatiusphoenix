// Task 13: Per-source aggregation on merged endpoint — explain "why few sources return streams"
// Hits /stream/movie for Endgame (canonical baseline) twice: first (cold caches) and second (warm caches).
// Aggregates stream counts by source label extracted from stream.name / stream.id.
const BASE = 'http://127.0.0.1:4595';

function labelOf(s) {
  // name line 2 format: "🐦‍🔥 PhoeniX · 4K · MoviesDrive · Nuvio" → source = segment[2]
  const name = (s.name || '').split('\n').map(t => t.trim()).filter(Boolean);
  const line = name.find(l => /PhoeniX/i.test(l)) || name[0] || '';
  const seg = line.split('·').map(t => t.trim());
  if (seg.length >= 3) return seg[2];
  if (seg.length === 2) return seg[1];
  if (s.id) {
    const m = String(s.id).match(/^([a-z0-9_]+?)[-_]/i);
    if (m) return m[1];
  }
  return line || 'unknown';
}

async function hit(tag) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/stream/movie/tt4154796.json`);
  const data = await res.json();
  const ms = Date.now() - t0;
  const streams = data.streams || [];
  const bySrc = {};
  for (const s of streams) {
    const l = labelOf(s);
    bySrc[l] = (bySrc[l] || 0) + 1;
  }
  const cacheCtl = res.headers.get('cache-control') || '';
  console.log(`\n=== ${tag}: ${streams.length} streams in ${ms}ms | cache-control: ${cacheCtl}`);
  const sorted = Object.entries(bySrc).sort((a, b) => b[1] - a[1]);
  for (const [l, c] of sorted) console.log(`  ${String(c).padStart(3)}  ${l}`);
  console.log(`  -> sources WITH streams: ${sorted.length}`);
  return { total: streams.length, bySrc: sorted, ms, cacheCtl };
}

const cold = await hit('COLD (1st request, empty per-source caches)');
// Warm-up: a couple of quick re-hits to let late sources finish filling caches
await new Promise(r => setTimeout(r, 2500));
const warm = await hit('WARM (2nd request after 2.5s)');
await new Promise(r => setTimeout(r, 2500));
const warm2 = await hit('WARM2 (3rd request after another 2.5s)');

console.log('\n=== DELTA (sources that appeared only after warm) ===');
const coldSet = new Set(cold.bySrc.map(([l]) => l));
for (const [l, c] of warm2.bySrc) {
  if (!coldSet.has(l)) console.log(`  + ${String(c).padStart(3)}  ${l}`);
}
const totalDiff = warm2.total - cold.total;
console.log(`Total: cold=${cold.total} -> warm2=${warm2.total} (${totalDiff >= 0 ? '+' : ''}${totalDiff})`);
