// Task 28 — verify final animotvslash URLs play like a player would
const { getStreams } = require('/home/z/my-project/phoenix-analysis/src/nuvio/animotvslash.cjs');

const cases = [
  ['Frieren S2E1', 209867, 'tv', 2, 1],
  ['OnePiece E1178', 37854, 'tv', 21, 1178],
  ['MugenTrain movie', 635302, 'movie', null, null],
];

async function verify(s) {
  const url = s.url;
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36', ...(s.headers || {}) };
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000), redirect: 'follow' });
    if (!res.ok) return `FAIL ${res.status}`;
    const ct = res.headers.get('content-type') || '';
    if (/m3u8|mpegurl|master\.txt|octet/i.test(ct) || /\.txt$/i.test(url)) {
      const txt = await res.text();
      if (txt.includes('#EXTM3U')) {
        const resos = [...txt.matchAll(/RESOLUTION=(\d+)x(\d+)/g)].map(m => `${m[1]}p`);
        return `PASS HLS master (${resos.slice(0, 3).join(',') || 'renditions'})`;
      }
      return `FAIL not-m3u8 (${txt.slice(0, 30)})`;
    }
    // non-HLS: Range-probe like a player (never buffer the whole file)
    const r2 = await fetch(url, { headers: { ...headers, Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(10000), redirect: 'follow' });
    const buf = Buffer.from(await r2.arrayBuffer());
    if (buf.length >= 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'PASS MP4 ftyp';
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'PASS EBML/MKV';
    return `FAIL magic (${buf.slice(0, 8).toString('hex')} ct=${ct.slice(0, 30)})`;
  } catch (e) {
    return `FAIL ${e?.message || e}`;
  }
}

(async () => {
  for (const [label, id, type, s, e] of cases) {
    const streams = await Promise.race([
      getStreams(id, type, s, e),
      new Promise(r => setTimeout(() => r([]), 55000)),
    ]);
    console.log(`=== ${label}: ${streams.length} streams ===`);
    for (const st of streams) {
      const verdict = await verify(st);
      const subs = st.subtitles?.length ? ` subs=${st.subtitles.length}` : '';
      console.log(`  ${verdict}  [${String(st.name).replace(/\n/g, ' ')}]${subs}`);
      // also verify first subtitle track is fetchable
      if (st.subtitles?.length) {
        try {
          const sub = st.subtitles[0];
          const r2 = await fetch(sub.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
          const t2 = await r2.text();
          console.log(`     sub[${sub.lang}]: ${r2.ok && (t2.includes('WEBVTT') || t2.includes('-->')) ? 'PASS VTT' : 'FAIL ' + r2.status + ' ' + t2.slice(0, 25)}`);
        } catch (e2) { console.log(`     sub: FAIL ${e2.message}`); }
      }
    }
  }
  process.exit(0);
})();
