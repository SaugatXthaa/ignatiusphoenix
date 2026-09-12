// task12_md_4k_check.mjs — fresh-resolve MoviesDrive Endgame, validate 2160p + all
import { createRequire } from 'module';
import { execSync } from 'child_process';
const require_ = createRequire(import.meta.url);
const md = require_('/home/z/my-project/phoenix-analysis/src/nuvio/moviesdrive_v2.cjs');

const streams = await md.getStreams('299534', 'movie', null, null);
console.log(`MoviesDrive Endgame: ${streams.length} streams`);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

for (const s of streams) {
  const out = execSync(
    `curl -s -o /dev/null -w "%{http_code}|%{content_type}|%{size_download}" -A "${UA}" -r 0-1023 --max-time 30 "${s.url}" || true`,
    { encoding: 'utf8' });
  const [code, ct, dl] = out.split('|');
  console.log(`  ${s.quality} → ${code} | ${String(ct).slice(0, 30)} | ${dl} bytes | ${s.url.slice(0, 60)}...`);
}
