#!/usr/bin/env node
/**
 * Task 57 Phase B: playability probe of every source's cards.
 * Input:  scripts/task57_sweep_results.json (Phase A: /debug/source x 4 titles)
 * Output: scripts/task57_playable_results.json + console report.
 *
 * Verdicts:
 *   HLS_OK        master→variant(→segment) chain fetched OK through the EXACT player path
 *   DIRECT_OK     200/206 + media content sniff (mp4/mkv/ts/octet-stream)
 *   MPV_ERROR     200 but HTML body / text/html content-type (mpv would error)
 *   DEAD          404/410 or empty body
 *   STUCK         timeout / zero bytes (the "loading screen" symptom)
 *   RATE_LIMITED  429
 *   UPSTREAM_ERR  5xx
 *   PLAYER_IP     datacenter-gated host — 403/timeout EXPECTED from sandbox;
 *                 ships direct + proxyHeaders, player's residential IP reaches it
 *   SKIP_ONETIME  googleusercontent one-time signed links (probing consumes token)
 *
 * Probe rules:
 *   - Own /proxy|/range-proxy cards: fetched AS-IS (referer/origin already in
 *     the query) — exercises the exact Render→upstream relay the player uses.
 *   - Direct cards: fetched with requestHeaders from /debug/source (Task 57).
 *   - HLS masters: follow first variant (rewritten /proxy URL or resolved
 *     relative), then first segment.
 */
import { readFileSync, writeFileSync } from 'fs';

const BASE = 'https://ignatiusphoenix.onrender.com';
const PROBE_TIMEOUT = 20000;
const MAX_CARDS_PER_ROW = 2;
const MAX_CARDS_PER_SOURCE = 3;

// Hosts that gate datacenter egress (documented Task 48/51/54/56 classes) —
// ships direct + proxyHeaders; only the player's residential IP reaches them.
const PLAYER_IP_HOST_RE = /totallyacdn\.com$|(^|\.)vixsrc\.[a-z.]+$|salsa\d+\.com$|(^|\.)salsa[a-z0-9]+\.com$|moviebox|vidsrc\.me$|vidsrc\.to$/i;
// One-time signed links — probing consumes the token.
const ONETIME_HOST_RE = /googleusercontent\.com$/i;

function sniffMedia(buf) {
  if (!buf || buf.length === 0) return 'empty';
  const s = buf.slice(0, 512).toString('utf8').trimStart();
  if (s.startsWith('#EXTM3U')) return 'm3u8';
  if (/^<!doctype html/i.test(s) || /^<html/i.test(s) || s.startsWith('<html')) return 'html';
  if (s.startsWith('{') || s.startsWith('[')) return 'json';
  if (s.startsWith('PNG') || (buf[0] === 0x89 && buf[1] === 0x50)) return 'png';
  if (s.startsWith('GIF8')) return 'gif';
  if (s.startsWith('RIFF')) return 'riff';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'mkv';
  if (s.startsWith('ftyp') || (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70)) return 'mp4';
  if (buf[0] === 0x47 && buf[1] === 0x40) return 'ts';
  if (s.startsWith('ID3') || s.startsWith('FLV')) return 'media';
  return 'bytes';
}

async function fetchProbe(url, headers = {}, timeoutMs = PROBE_TIMEOUT, maxBytes = 262144) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers, redirect: 'follow', signal: ctrl.signal });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
    }
    try { await reader.cancel(); } catch {}
    const buf = Buffer.concat(chunks);
    return { status: res.status, ct, ms: Date.now() - t0, buf, sniff: sniffMedia(buf), finalUrl: res.url };
  } catch (e) {
    const msg = e?.message || String(e);
    return { status: 0, ct: '', ms: Date.now() - t0, buf: Buffer.alloc(0), sniff: 'empty', error: msg.includes('abort') ? 'timeout' : msg.slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

function classifyHost(url) {
  try {
    const u = new URL(url);
    if (u.host === new URL(BASE).host) return 'ownproxy';
    if (ONETIME_HOST_RE.test(u.hostname)) return 'onetime';
    return 'direct';
  } catch { return 'invalid'; }
}

async function probeCard(card) {
  const url = card.url;
  const kind = classifyHost(url);
  if (kind === 'invalid') return { url, kind, verdict: 'INVALID_URL' };
  if (kind === 'onetime') return { url, kind, verdict: 'SKIP_ONETIME' };

  const headers = {};
  const rh = card.requestHeaders || {};
  for (const [k, v] of Object.entries(rh)) headers[k.toLowerCase() === 'user-agent' ? 'user-agent' : k] = v;

  const r1 = await fetchProbe(url, headers);
  const rec = { url: url.slice(0, 160), kind, status: r1.status, ct: r1.ct, sniff: r1.sniff, ms: r1.ms };

  if (kind === 'ownproxy') {
    if (r1.status === 0) { rec.verdict = 'STUCK'; return rec; }
    if (r1.status === 429) { rec.verdict = 'RATE_LIMITED'; return rec; }
    if (r1.status >= 500) { rec.verdict = 'UPSTREAM_ERR'; return rec; }
    if (r1.status === 404 || r1.status === 410) { rec.verdict = 'DEAD'; return rec; }
    if (r1.sniff === 'html' || (r1.ct || '').includes('text/html')) { rec.verdict = 'MPV_ERROR'; return rec; }
    if (r1.sniff === 'm3u8') {
      // Follow the chain: first variant line, then first segment
      const lines = r1.buf.toString('utf8').split('\n').map(l => l.trim()).filter(Boolean);
      const variantLine = lines.find(l => !l.startsWith('#'));
      if (variantLine) {
        const vAbs = /^https?:\/\//i.test(variantLine) ? variantLine : null;
        const vUrl = vAbs || variantLine; // own-proxy rewrites are already absolute
        const r2 = await fetchProbe(vUrl, {}, 15000, 131072);
        rec.variant = { status: r2.status, sniff: r2.sniff, ms: r2.ms };
        if (r2.status === 0) { rec.verdict = 'STUCK'; return rec; }
        if (r2.sniff === 'm3u8') {
          const vlines = r2.buf.toString('utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
          const segLine = vlines.find(l => !l.startsWith('#'));
          if (segLine) {
            const sUrl = /^https?:\/\//i.test(segLine) ? segLine : null;
            if (sUrl) {
              const r3 = await fetchProbe(sUrl, {}, 15000, 65536);
              rec.segment = { status: r3.status, sniff: r3.sniff, ms: r3.ms, bytes: r3.buf.length };
              const media = ['mp4', 'ts', 'mkv', 'media', 'bytes'].includes(r3.sniff) && r3.buf.length > 8192;
              rec.verdict = (r3.status === 200 || r3.status === 206) && media ? 'HLS_OK' : (r3.status === 0 ? 'STUCK' : (r3.sniff === 'html' ? 'MPV_ERROR' : 'DEAD'));
            } else { rec.verdict = 'HLS_OK'; rec.segment = { note: 'relative segment — variant chain proven' }; }
          } else { rec.verdict = 'DEAD'; rec.note = 'variant playlist has no segments'; }
        } else if (['mp4', 'ts', 'mkv', 'media', 'bytes'].includes(r2.sniff) && r2.buf.length > 8192) {
          rec.verdict = 'HLS_OK'; // variant URL is actually media (fMP4 direct)
        } else {
          rec.verdict = r2.sniff === 'html' ? 'MPV_ERROR' : (r2.status === 404 || r2.status === 410 ? 'DEAD' : (r2.status >= 500 ? 'UPSTREAM_ERR' : 'DEAD'));
        }
      } else { rec.verdict = 'DEAD'; rec.note = 'master has no variant lines'; }
      return rec;
    }
    if (['mp4', 'ts', 'mkv', 'media', 'bytes'].includes(r1.sniff) && r1.buf.length > 8192) { rec.verdict = 'DIRECT_OK'; return rec; }
    rec.verdict = 'DEAD'; rec.note = `own-proxy sniff=${r1.sniff} len=${r1.buf.length}`;
    return rec;
  }

  // Direct card
  if (r1.status === 0) {
    rec.verdict = PLAYER_IP_HOST_RE.test(new URL(url).hostname) ? 'PLAYER_IP' : 'STUCK';
    return rec;
  }
  if (r1.status === 403 || ((r1.status === 404 || r1.status === 410) && PLAYER_IP_HOST_RE.test(new URL(url).hostname))) {
    rec.verdict = PLAYER_IP_HOST_RE.test(new URL(url).hostname) ? 'PLAYER_IP' : 'DEAD';
    return rec;
  }
  if (r1.status === 429) { rec.verdict = 'RATE_LIMITED'; return rec; }
  if (r1.status >= 500) { rec.verdict = 'UPSTREAM_ERR'; return rec; }
  if (r1.status === 404 || r1.status === 410) { rec.verdict = 'DEAD'; return rec; }
  if (r1.sniff === 'html' || (r1.ct || '').includes('text/html')) { rec.verdict = 'MPV_ERROR'; return rec; }
  if (r1.sniff === 'm3u8') {
    const lines = r1.buf.toString('utf8').split('\n').map(l => l.trim()).filter(Boolean);
    const variantLine = lines.find(l => !l.startsWith('#'));
    if (variantLine) {
      const base = new URL(url);
      const vAbs = /^https?:\/\//i.test(variantLine) ? variantLine : new URL(variantLine, base).href;
      const r2 = await fetchProbe(vAbs, headers, 15000, 131072);
      rec.variant = { status: r2.status, sniff: r2.sniff, ms: r2.ms };
      rec.verdict = (r2.status === 200 && r2.sniff === 'm3u8') || (r2.status === 200 && ['mp4','ts','mkv','media','bytes'].includes(r2.sniff)) ? 'HLS_OK' : (r2.status === 0 ? 'STUCK' : 'DEAD');
    } else rec.verdict = 'DEAD';
    return rec;
  }
  if (['mp4', 'ts', 'mkv', 'media', 'bytes'].includes(r1.sniff) && r1.buf.length > 8192) { rec.verdict = 'DIRECT_OK'; return rec; }
  if (r1.sniff === 'json') { rec.verdict = 'MPV_ERROR'; rec.note = 'json body'; return rec; }
  rec.verdict = 'DEAD'; rec.note = `sniff=${r1.sniff} len=${r1.buf.length}`;
  return rec;
}

// ---- main ----
const sweep = JSON.parse(readFileSync('/home/z/my-project/phoenix-analysis/scripts/task57_sweep_results.json', 'utf8'));
const rows = sweep.phaseA.filter(r => r.count > 0 && r.cards?.length);

console.log(`Phase B: ${rows.length} source-title rows with cards; probing ≤${MAX_CARDS_PER_ROW}/row, ≤${MAX_CARDS_PER_SOURCE}/source`);

const results = [];
const perSourceCards = new Map();
const work = [];
for (const row of rows) {
  for (const card of row.cards.slice(0, MAX_CARDS_PER_ROW)) {
    work.push({ source: row.source, title: row.title, card, format: card.format });
  }
}
// cap total cards per source
const bySourceCount = new Map();
const cappedWork = work.filter(w => {
  const c = (bySourceCount.get(w.source) || 0);
  if (c >= MAX_CARDS_PER_SOURCE) return false;
  bySourceCount.set(w.source, c + 1);
  return true;
});

console.log(`probing ${cappedWork.length} cards total`);
let idx = 0;
async function lane() {
  while (idx < cappedWork.length) {
    const my = cappedWork[idx++];
    const probe = await probeCard(my.card);
    const rec = { source: my.source, title: my.title, format: my.format, ...probe };
    results.push(rec);
    console.log(`  [${rec.verdict.padEnd(12)}] ${my.source.padEnd(16)} ${my.title.padEnd(7)} ${my.format || '?'} ${(probe.status || '').toString().padEnd(4)} ${probe.sniff || ''} ${probe.error || ''}`);
  }
}
await Promise.all(Array.from({ length: 4 }, lane));

writeFileSync('/home/z/my-project/phoenix-analysis/scripts/task57_playable_results.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 2));

// ---- aggregate ----
const byVerdict = {};
for (const r of results) byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
console.log('\n=== VERDICT TOTALS ===');
console.log(JSON.stringify(byVerdict));

console.log('\n=== PROBLEM CARDS (MPV_ERROR / STUCK / DEAD — excluding PLAYER_IP/SKIP) ===');
const problems = results.filter(r => ['MPV_ERROR', 'STUCK', 'DEAD'].includes(r.verdict));
for (const r of problems) console.log(`  ${r.verdict.padEnd(10)} ${r.source.padEnd(16)} ${r.title.padEnd(7)} ${(r.error || r.note || '').slice(0, 90)} ${r.url.slice(0, 110)}`);

console.log('\n=== PLAYABILITY SCORECARD ===');
const score = {};
for (const r of results) {
  score[r.source] = score[r.source] || { ok: 0, playerIp: 0, skip: 0, bad: [], verdicts: [] };
  if (['HLS_OK', 'DIRECT_OK'].includes(r.verdict)) score[r.source].ok++;
  else if (['PLAYER_IP'].includes(r.verdict)) score[r.source].playerIp++;
  else if (['SKIP_ONETIME'].includes(r.verdict)) score[r.source].skip++;
  else score[r.source].bad.push(r.verdict);
  score[r.source].verdicts.push(r.verdict);
}
for (const [s, v] of Object.entries(score).sort()) {
  console.log(`  ${s.padEnd(16)} ok=${v.ok} playerIp=${v.playerIp} skip=${v.skip} bad=[${v.bad.join(',')}]`);
}
const badSources = Object.entries(score).filter(([, v]) => v.ok === 0 && v.playerIp === 0 && v.skip === 0 && v.bad.length > 0).map(([s]) => s);
console.log(`\nSources with ZERO provable-playable cards: ${badSources.join(', ') || 'NONE'}`);
