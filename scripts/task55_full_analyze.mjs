// Task 55 — analyze a FULL production resolve: per-source card counts, heights, subs, playability classes
const BASE = 'https://ignatiusphoenix.onrender.com';

async function j(url, opts = {}, timeoutMs = 90000) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text.slice(0, 300) }; }
}

const [, , type, id, durStr] = process.argv;
const waitMs = parseInt(durStr || '0', 10);
const label = `${type} ${id}`;
console.log(`\n=== FULL RESOLVE ${label} ===`);

if (waitMs > 0) { console.log(`waiting ${waitMs}ms first...`); await new Promise(r => setTimeout(r, waitMs)); }
const t0 = Date.now();
const r = await j(`${BASE}/stream/${type}/${id}.json`);
console.log(`HTTP ${r.status} in ${Date.now() - t0}ms, total=${(r.data?.streams || []).length}`);

const streams = r.data?.streams || [];
const bySrc = new Map();
for (const s of streams) {
  // name like: 🐦‍🔥 PhoeniX · 4K · 4KHDHub · 📥  or  🐦‍🔥 PhoeniX · 1080p · Atlantic · Orbit
  const parts = String(s.name).split('·').map(x => x.trim());
  const src = parts[2] || 'unknown';
  if (!bySrc.has(src)) bySrc.set(src, { total: 0, h4k: 0, h1080: 0, lower: 0, subs: 0, proxied: 0, direct: 0 });
  const e = bySrc.get(src);
  e.total++;
  const q = parts[1] || '';
  if (/4K/.test(q)) e.h4k++;
  else if (/1080p/.test(q)) e.h1080++;
  else e.lower++;
  if (Array.isArray(s.subtitles) && s.subtitles.length) e.subs++;
  const u = String(s.url || '');
  if (u.includes('/proxy') || u.includes('/range-proxy')) e.proxied++; else e.direct++;
}

console.log('\nper-source:');
for (const [src, e] of [...bySrc.entries()].sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  ${src.padEnd(16)} total=${String(e.total).padStart(3)} 4K=${String(e.h4k).padStart(3)} 1080p=${String(e.h1080).padStart(3)} lower=${String(e.lower).padStart(2)} subs=${String(e.subs).padStart(3)} proxy=${e.proxied} direct=${e.direct}`);
}

// Sample one 4K card's URL + one Atlantic card if any
const atl = streams.filter(s => /Atlantic/i.test(String(s.name)));
console.log(`\nAtlantic cards: ${atl.length}`);
for (const s of atl.slice(0, 3)) console.log('  ', String(s.name).slice(0, 80), '|', String(s.url).slice(0, 100), '| subs:', (s.subtitles || []).length);

const fourkCards = streams.filter(s => /4KHDHub/i.test(String(s.name)));
console.log(`4KHDHub cards: ${fourkCards.length}`);
for (const s of fourkCards.slice(0, 5)) console.log('  ', String(s.name).slice(0, 80), '|', String(s.url).slice(0, 100));

const zxc = streams.filter(s => /ZXC/i.test(String(s.name)));
console.log(`ZXC cards: ${zxc.length}`);
for (const s of zxc.slice(0, 3)) console.log('  ', String(s.name).slice(0, 80), '|', String(s.url).slice(0, 110));

// subtitle URL sanity — grab one granite URL and probe it
const subUrl = streams.find(s => s.subtitles?.length)?.subtitles?.[0]?.url;
if (subUrl) {
  const sr = await fetch(subUrl, { signal: AbortSignal.timeout(10000) });
  const body = await sr.text();
  console.log(`\nsubtitle probe: ${sr.status} len=${body.length} head=${body.slice(0, 40).replace(/\n/g, '\\n')}`);
}
