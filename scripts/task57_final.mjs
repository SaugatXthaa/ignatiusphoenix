#!/usr/bin/env node
/**
 * Task 57 FINAL: end-to-end playability audit on REAL /stream cards.
 * For each of 4 titles (movie/series/kdrama/anime):
 *   1. GET /stream/{type}/{id}.json (the exact merged response a player gets)
 *   2. Attribute cards to sources via behaviorHints.bingeGroup
 *      (`phoenix-<sourceId>-<extractorId>`)
 *   3. Probe up to N cards per source: own-/proxy cards AS-IS (player relay
 *      path), direct cards with behaviorHints.proxyHeaders.request headers,
 *      HLS chains followed master→variant→segment.
 *
 * Usage: node scripts/task57_final.mjs [--title movie|series|kdrama|anime]
 * Output: scripts/task57_final_<title>.json + console report.
 */
import { writeFileSync } from 'fs';

const BASE = 'https://ignatiusphoenix.onrender.com';
const PROBE_TIMEOUT = 20000;
const MAX_CARDS_PER_SOURCE = 2;

const TITLES = {
  movie:  { type: 'movie',  id: 'tmdb:27205',     label: 'Inception' },
  series: { type: 'series', id: 'tmdb:1399:1:1',  label: 'GoT S1E1' },
  kdrama: { type: 'series', id: 'tmdb:93405:1:1', label: 'Squid Game S1E1' },
  anime:  { type: 'series', id: 'tmdb:209867:2:1', label: 'Frieren S2E1' },
};

const titleKey = process.argv[2] || 'movie';
const spec = TITLES[titleKey] || TITLES.movie;

const PLAYER_IP_HOST_RE = /totallyacdn\.com$|(^|\.)vixsrc\.[a-z.]+$|salsa\d+\.com$|(^|\.)salsa[a-z0-9]+\.com$|moviebox|vidsrc\.me$|vidsrc\.to$/i;
const ONETIME_HOST_RE = /googleusercontent\.com$/i;

function sniffMedia(buf) {
  if (!buf || buf.length === 0) return 'empty';
  const s = buf.slice(0, 512).toString('utf8').trimStart();
  if (s.startsWith('#EXTM3U')) return 'm3u8';
  if (/^<!doctype html/i.test(s) || /^<html/i.test(s)) return 'html';
  if (s.startsWith('{') || s.startsWith('[')) return 'json';
  if (s.startsWith('PNG') || (buf[0] === 0x89 && buf[1] === 0x50)) return 'png';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'mkv';
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'mp4';
  if (buf[0] === 0x47) return 'ts';
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
    const chunks = []; let received = 0;
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.length;
    }
    try { await reader.cancel(); } catch {}
    const buf = Buffer.concat(chunks);
    return { status: res.status, ct, ms: Date.now() - t0, buf, sniff: sniffMedia(buf) };
  } catch (e) {
    const msg = e?.message || String(e);
    return { status: 0, ct: '', ms: Date.now() - t0, buf: Buffer.alloc(0), sniff: 'empty', error: msg.includes('abort') ? 'timeout' : msg.slice(0, 100) };
  } finally { clearTimeout(timer); }
}

function classifyCard(url) {
  try {
    const u = new URL(url);
    if (u.host === new URL(BASE).host) {
      return u.pathname.startsWith('/proxy') || u.pathname.startsWith('/range-proxy') ? 'ownproxy' : 'ownother';
    }
    if (ONETIME_HOST_RE.test(u.hostname)) return 'onetime';
    return 'direct';
  } catch { return 'invalid'; }
}

async function probeCard(card) {
  const url = card.url;
  const kind = classifyCard(url);
  if (kind === 'invalid') return { verdict: 'INVALID_URL', kind };
  if (kind === 'onetime') return { verdict: 'SKIP_ONETIME', kind };
  if (kind === 'ownother') return { verdict: 'SKIP_OWN_OTHER', kind, url: url.slice(0, 120) };

  const headers = {};
  const rh = card.behaviorHints?.proxyHeaders?.request || {};
  for (const [k, v] of Object.entries(rh)) headers[k.toLowerCase()] = v;

  const r1 = await fetchProbe(url, headers);
  const rec = { kind, status: r1.status, sniff: r1.sniff, ms: r1.ms, ct: r1.ct, url: url.slice(0, 150) };

  if (r1.status === 0) { rec.verdict = 'STUCK'; return rec; }
  if (r1.status === 429) { rec.verdict = 'RATE_LIMITED'; return rec; }
  if (r1.status >= 500) { rec.verdict = 'UPSTREAM_ERR'; return rec; }
  if (r1.status === 404 || r1.status === 410) {
    rec.verdict = kind === 'direct' && PLAYER_IP_HOST_RE.test(new URL(url).hostname) ? 'PLAYER_IP' : 'DEAD';
    return rec;
  }
  if (r1.status === 403) {
    rec.verdict = kind === 'direct' && PLAYER_IP_HOST_RE.test(new URL(url).hostname) ? 'PLAYER_IP' : 'MPV_ERROR';
    if (rec.verdict === 'MPV_ERROR') rec.note = '403 on player path';
    return rec;
  }
  if (r1.sniff === 'html' || (r1.ct || '').includes('text/html')) { rec.verdict = 'MPV_ERROR'; return rec; }

  if (r1.sniff === 'm3u8') {
    const lines = r1.buf.toString('utf8').split('\n').map(l => l.trim()).filter(Boolean);
    const child = lines.find(l => !l.startsWith('#'));
    if (!child) { rec.verdict = 'DEAD'; rec.note = 'no variant lines'; return rec; }
    const base = new URL(url);
    const childUrl = /^https?:\/\//i.test(child) ? child : new URL(child, base).href;
    const r2 = await fetchProbe(childUrl, kind === 'ownproxy' ? {} : headers, 15000, 131072);
    rec.variant = { status: r2.status, sniff: r2.sniff, ms: r2.ms };
    if (r2.status === 0) { rec.verdict = 'STUCK'; return rec; }
    if (r2.sniff === 'html') { rec.verdict = 'MPV_ERROR'; return rec; }
    if (r2.sniff === 'm3u8') {
      const seg = r2.buf.toString('utf8').split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#'));
      if (!seg) { rec.verdict = 'DEAD'; rec.note = 'variant has no segments'; return rec; }
      const segUrl = /^https?:\/\//i.test(seg) ? seg : new URL(seg, childUrl).href;
      const r3 = await fetchProbe(segUrl, kind === 'ownproxy' ? {} : headers, 15000, 65536);
      rec.segment = { status: r3.status, sniff: r3.sniff, bytes: r3.buf.length };
      const media = ['mp4', 'ts', 'mkv', 'media', 'bytes'].includes(r3.sniff) && r3.buf.length > 4096;
      rec.verdict = (r3.status === 200 || r3.status === 206) && media ? 'HLS_OK' : (r3.status === 0 ? 'STUCK' : (r3.sniff === 'html' ? 'MPV_ERROR' : 'DEAD'));
      return rec;
    }
    const mediaVar = ['mp4', 'ts', 'mkv', 'media', 'bytes'].includes(r2.sniff) && r2.buf.length > 4096;
    rec.verdict = r2.status === 200 && mediaVar ? 'HLS_OK' : 'DEAD';
    return rec;
  }

  if (['mp4', 'ts', 'mkv', 'media', 'bytes'].includes(r1.sniff) && r1.buf.length > 4096) { rec.verdict = 'DIRECT_OK'; return rec; }
  if (r1.sniff === 'json') { rec.verdict = 'MPV_ERROR'; rec.note = 'json body on media URL'; return rec; }
  rec.verdict = 'DEAD'; rec.note = `sniff=${r1.sniff} len=${r1.buf.length}`;
  return rec;
}

// ---- main ----
console.log(`=== ${spec.label} (${spec.id}) — real /stream audit ===`);
const t0 = Date.now();
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 55000);
const res = await fetch(`${BASE}/stream/${spec.type}/${encodeURIComponent(spec.id)}.json`, { signal: ctrl.signal });
const data = await res.json();
clearTimeout(timer);
const streams = data.streams || [];
console.log(`merged response: ${streams.length} cards @${((Date.now() - t0) / 1000).toFixed(1)}s`);

// attribute by source
const bySource = new Map();
for (const s of streams) {
  const bg = s.behaviorHints?.bingeGroup || '';
  const m = /^phoenix-([a-z0-9]+)-/i.exec(bg);
  const src = m ? m[1] : (bg || 'unknown');
  if (!bySource.has(src)) bySource.set(src, []);
  bySource.get(src).push(s);
}
console.log(`sources involved: ${bySource.size}`);
console.log([...bySource.entries()].map(([s, c]) => `${s}(${c.length})`).join(' '));

// probe
const results = [];
for (const [src, cards] of bySource) {
  const picked = [];
  // pick diverse formats: prefer one hls + one mp4/mkv-ish
  const seen = new Set();
  for (const c of cards) {
    const fmt = c.url.split('?')[0].split('.').pop().slice(0, 5);
    if (seen.has(fmt)) continue;
    seen.add(fmt); picked.push(c);
    if (picked.length >= MAX_CARDS_PER_SOURCE) break;
  }
  for (const c of picked) {
    const probe = await probeCard(c);
    results.push({ source: src, title: c.title?.slice(0, 60) || c.name?.slice(0, 40), ...probe });
    console.log(`  [${probe.verdict.padEnd(12)}] ${src.padEnd(16)} ${probe.status ?? ''} ${probe.sniff || ''} ${(probe.note || probe.error || '')}`);
  }
}

writeFileSync(`/home/z/my-project/phoenix-analysis/scripts/task57_final_${titleKey}.json`, JSON.stringify({ at: new Date().toISOString(), title: spec.label, streams: streams.length, sources: bySource.size, results }, null, 2));

const byVerdict = {};
for (const r of results) byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
console.log('\nVERDICTS:', JSON.stringify(byVerdict));
const bad = results.filter(r => ['MPV_ERROR', 'STUCK', 'DEAD', 'INVALID_URL'].includes(r.verdict));
if (bad.length) { console.log('PROBLEMS:'); for (const r of bad) console.log(`  ${r.verdict} ${r.source} ${r.url?.slice(0, 110)} ${r.note || ''}`); }
