// task25_videasyto_probe.mjs — is the videasyto 403 an IP-wide CDN block or
// just one unlucky server? Probes EVERY m3u8 URL returned for F1.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');
const require_ = createRequire(import.meta.url);

const mod = require_(path.join(REPO, 'src/nuvio/videasyto.cjs'));
const streams = await mod.getStreams('911430', 'movie', null, null);
console.log(`total streams: ${streams.length}`);
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36', Referer: 'https://videasy.to/' };

const hls = streams.filter(s => /\.m3u8($|\?)/.test(s.url || ''));
console.log(`m3u8 streams: ${hls.length}`);
let pass = 0;
for (const s of hls) {
  try {
    const res = await fetch(s.url, { headers: UA, signal: AbortSignal.timeout(12000) });
    const body = await res.text().catch(() => '');
    const ok = res.status === 200 && (body.includes('#EXTM3U') || body.includes('#EXT-X'));
    if (ok) pass++;
    console.log(`  [${ok ? 'MAGIC-OK' : 'FAIL'}] status=${res.status} len=${body.length} server=${new URL(s.url).host} head=${body.slice(0, 40).replace(/\n/g, '⏎')}`);
  } catch (e) {
    console.log(`  [ERR] ${new URL(s.url).host} — ${e.message.slice(0, 60)}`);
  }
}
console.log(`RESULT: ${pass}/${hls.length} m3u8 pass magic check`);
