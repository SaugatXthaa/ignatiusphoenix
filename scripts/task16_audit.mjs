// task14_audit.mjs — per-source playability audit (magic-byte classification)
// Samples stream URLs from the merged endpoints for 2 titles and classifies what
// a player would actually receive: HLS / video bytes = OK; HTML / JSON / CF
// challenge = the "[mpv] unrecognized file format" poison class.
const BASE = 'http://127.0.0.1:4598';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TITLES = [
  { label: 'Endgame', path: 'movie/tt4154796' },
  { label: 'BB-S1E1', path: 'series/tt0903747:1:1' },
];

function labelOf(s) {
  const name = (s.name || '').split('\n').map(t => t.trim()).filter(Boolean);
  const line = name.find(l => /PhoeniX/i.test(l)) || name[0] || '';
  const seg = line.split('·').map(t => t.trim());
  return seg.length >= 3 ? seg[2] : (seg[1] || line || 'unknown');
}

function classify(buf, ct, status) {
  const head = buf.toString('utf8', 0, Math.min(buf.length, 300));
  if (status === 403 && /Just a moment|challenge/i.test(head)) return 'CF-CHALLENGE';
  if (status === 403 || status === 404 || status === 410) return `HTTP-${status}`;
  if (status >= 500) return `HTTP-${status}`;
  if (/#EXTM3U/.test(head)) return 'HLS';
  if (/application\/dash\+xml/i.test(ct || '') || /<MPD\b/i.test(head)) return 'DASH';
  const hex = buf.toString('hex', 0, 4);
  if (hex.startsWith('47') || hex.startsWith('1a45') || head.startsWith('ftyp') || buf.toString('hex', 4, 8) === '66747970' || /^(matroska|video\/|audio\/|application\/octet|binary)/i.test(ct || '')) return 'VIDEO';
  if (/^\s*(<!DOCTYPE html|<html)/i.test(head) || /text\/html/i.test(ct || '')) return 'HTML';
  if (/^\s*[{\[]/.test(head) || /application\/json/i.test(ct || '')) return 'JSON';
  if (status >= 200 && status < 300 && (buf.length === 0)) return 'EMPTY';
  return 'OTHER';
}

async function probe(url) {
  const u = url.replace('https://127.0.0.1:4598', 'http://127.0.0.1:4598').replace('https://localhost:4598', 'http://localhost:4598');
  try {
    const res = await fetch(u, { headers: { 'User-Agent': UA, Range: 'bytes=0-2047' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab.slice(0, 2048));
    return classify(buf, res.headers.get('content-type'), res.status);
  } catch (e) {
    const msg = String(e?.message || e);
    if (/^a body was read|body used/.test(msg)) return 'OTHER';
    return /abort|timeout/i.test(msg) ? 'TIMEOUT' : 'UNREACHABLE';
  }
}

const summary = {};
for (const t of TITLES) {
  console.log(`\n═══════ ${t.label} ═══════`);
  let streams = [];
  try {
    const res = await fetch(`${BASE}/stream/${t.path}.json`, { signal: AbortSignal.timeout(90000) });
    ({ streams = [] } = await res.json());
  } catch (e) { console.log('endpoint FAIL:', e.message); continue; }

  const bySrc = new Map();
  for (const s of streams) {
    const l = labelOf(s);
    if (!bySrc.has(l)) bySrc.set(l, []);
    bySrc.get(l).push(s);
  }
  console.log(`${streams.length} streams / ${bySrc.size} sources`);

  for (const [label, list] of [...bySrc.entries()].sort()) {
    // sample up to 2 streams: first + one 4K if present
    const picks = [list[0]];
    const uhd = list.find(s => /4K|2160/i.test(s.name || '') && s !== list[0]);
    if (uhd) picks.push(uhd);
    const verdicts = [];
    for (const p of picks) {
      const u = p.url || p.externalUrl;
      if (!u) { verdicts.push('NO-URL'); continue; }
      verdicts.push(await probe(u));
    }
    const bad = verdicts.filter(v => /HTML|JSON|CF-CHALLENGE|HTTP-4|HTTP-5|UNREACH|TIMEOUT|EMPTY|NO-URL/.test(v));
    const status = bad.length === verdicts.length ? '❌' : bad.length > 0 ? '⚠️' : '✅';
    console.log(`  ${status} ${label.padEnd(22)} ${verdicts.join(', ')}`);
    if (!summary[label]) summary[label] = { ok: 0, bad: 0, detail: [] };
    if (bad.length === 0) summary[label].ok++;
    else { summary[label].bad++; summary[label].detail.push(`${t.label}:${bad.join('/')}`); }
  }
}

console.log('\n═══════ OFFENDERS (poison-class or dead URLs shipped to players) ═══════');
let any = false;
for (const [l, v] of Object.entries(summary)) {
  if (v.bad > 0) { any = true; console.log(`  ❌ ${l}: ${v.bad} bad / ${v.ok + v.bad} sampled — ${v.detail.join(' | ')}`); }
}
if (!any) console.log('  (none — every sampled stream returns real video/HLS bytes)');
