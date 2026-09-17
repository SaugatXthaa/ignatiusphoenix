// Task 49: hdhub4u + 4khdhub deep verification — isolated sources, real cards,
// playability probes (status + magic bytes) through the exact URL shipped.
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);

const BASE = 'http://127.0.0.1:4597';

async function jget(url, timeoutMs = 60000) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    return { status: res.status, ms: Date.now() - t0, json: j, text };
  } catch (e) { return { status: 0, ms: Date.now() - t0, error: e?.message }; }
}

console.log('=== isolated /debug/source hdhub4uv2 (Inception) ===');
const h4 = await jget(`${BASE}/debug/source/hdhub4uv2?type=movie&id=tmdb:27205`);
console.log(`count=${h4.json?.count} in ${h4.ms}ms`, (h4.json?.results || []).slice(0, 2).map(r => `${r.meta?.title?.slice(0, 60)} | ${r.url?.slice(0, 70)}`).join('\n'));
console.log('logs:', (h4.json?.logs || []).slice(-4).join(' || ').slice(0, 400));

console.log('\n=== isolated /debug/source 4khdhub (Inception) ===');
const k4 = await jget(`${BASE}/debug/source/4khdhub?type=movie&id=tmdb:27205`);
console.log(`count=${k4.json?.count} in ${k4.ms}ms`, (k4.json?.results || []).slice(0, 2).map(r => `${r.meta?.title?.slice(0, 60)} | ${r.url?.slice(0, 70)}`).join('\n'));

console.log('\n=== real /stream warm: hdhub4u + 4khdhub cards, playability probe ===');
const st = await jget(`${BASE}/stream/movie/tmdb:27205.json`);
const streams = st.json?.streams || [];
console.log(`total ${streams.length} cards`);
const pick = (re) => streams.filter(s => re.test(s.name || ''));
const h4c = pick(/HDHub4u/).slice(0, 2);
const k4c = pick(/4KHDHub/).slice(0, 2);
console.log(`hdhub4u cards: ${pick(/HDHub4u/).length}, 4khdhub cards: ${pick(/4KHDHub/).length}`);

async function probe(s, tag) {
  const url = s.url || s.externalUrl;
  if (!url) return console.log(`${tag}: NO URL`);
  const abs = url.startsWith('http') ? url : BASE + url;
  const t0 = Date.now();
  try {
    const res = await fetch(abs, { signal: AbortSignal.timeout(25000), headers: { Range: 'bytes=0-63' } });
    const buf = new Uint8Array(await res.arrayBuffer());
    const magic = Array.from(buf.slice(0, 12)).map(b => b).join(',');
    const isTS = buf[0] === 0x47 && buf[188] === 0x47;
    const isMKV = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
    const isMP4 = (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79) || String.fromCharCode(...buf.slice(4, 8)) === 'ftyp';
    const isM3U8 = String.fromCharCode(...buf.slice(0, 7)).includes('#EXTM3U');
    console.log(`${tag}: HTTP ${res.status} ${Date.now() - t0}ms ct=${(res.headers.get('content-type') || '?').slice(0, 30)} magic: ${isTS ? 'MPEGTS' : isMKV ? 'MKV/EBML' : isMP4 ? 'MP4' : isM3U8 ? 'HLS' : 'bytes=' + magic.slice(0, 20)}`);
    console.log(`   ${abs.slice(0, 150)}`);
  } catch (e) { console.log(`${tag}: PROBE FAIL ${e?.message} (${Date.now() - t0}ms) ${abs.slice(0, 120)}`); }
}
for (const [i, s] of h4c.entries()) await probe(s, `hdhub4u card ${i + 1}`);
for (const [i, s] of k4c.entries()) await probe(s, `4khdhub card ${i + 1}`);
// also probe subs availability on the first hdhub4u card
const h4s = h4c[0];
if (h4s?.subtitles?.length) {
  const sub = h4s.subtitles.find(x => String(x.id).startsWith('gr-')) || h4s.subtitles[0];
  const r = await jget(sub.url, 15000);
  console.log(`hdhub4u card sub probe: ${sub.lang} → HTTP ${r.status} ${(r.text || '').slice(0, 40).replace(/\n/g, ' ')}`);
}
