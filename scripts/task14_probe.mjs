// Task 14: Probe zxcstream + raflix shipped stream URLs — what bytes do players actually get?
const BASE = 'http://127.0.0.1:4595';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const TITLES = [
  { label: 'Endgame', path: 'movie/tt4154796' },
  { label: 'BB-S1E1', path: 'tv/tt0903747:1:1' },
];

function pick(streams, re) {
  return streams.filter(s => re.test(s.name || ''));
}

async function probe(url, tag) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    const ct = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer().then(ab => ab.slice(0, 400)));
    const head = buf.toString('utf8', 0, 200).replace(/\s+/g, ' ');
    const isM3u8 = /#EXTM3U/.test(head);
    const isHtml = /^\s*(<\!DOCTYPE|<html|<\?xml)/i.test(head) || /text\/html/i.test(ct);
    const isJson = /^\s*[\{\[]/.test(head) || /application\/json/i.test(ct);
    const isVideo = /^(matroska|video\/|application\/octet|binary)/i.test(ct) || /^(1a45dfa3|0d1a|ftyp)/.test(buf.toString('hex', 0, 4));
    const verdict = isHtml ? '❌ HTML PAGE' : isM3u8 ? '✅ HLS' : isVideo ? '✅ VIDEO' : isJson ? '❌ JSON' : `⚠️ ${ct || 'unknown'}`;
    console.log(`  [${tag}] ${res.status} ${verdict} | ${url.slice(0, 90)}`);
    if (!isM3u8 && !isVideo) console.log(`     head: ${head.slice(0, 140)}`);
    return { verdict, isHtml, isM3u8 };
  } catch (e) {
    console.log(`  [${tag}] FETCH FAIL: ${e.message?.slice(0, 60)} | ${url.slice(0, 80)}`);
    return { verdict: 'fail' };
  }
}

for (const t of TITLES) {
  console.log(`\n===== ${t.label} =====`);
  const res = await fetch(`${BASE}/stream/${t.path}.json`);
  const { streams = [] } = await res.json();
  const zxc = pick(streams, /ZXCStream/i);
  const raf = pick(streams, /Raflix/i);
  console.log(`ZXCStream streams: ${zxc.length}, Raflix streams: ${raf.length}`);

  for (const s of zxc.slice(0, 4)) {
    const u = s.url || s.externalUrl || '';
    console.log(`  ZXC name: ${(s.name || '').replace(/\n/g, ' | ').slice(0, 70)}`);
    await probe(u, 'ZXC');
  }
  for (const s of raf.slice(0, 6)) {
    const u = s.url || s.externalUrl || '';
    console.log(`  RAF name: ${(s.name || '').replace(/\n/g, ' | ').slice(0, 70)}`);
    await probe(u, 'RAF');
  }
}
