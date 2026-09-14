// src/extractor/VidSrcMe.js
// VidSrc.me / vidsrcme.ru — direct HLS via the vidsrcme.ru data API (necro embeds).
//
// Chain (fully mapped live 2026-09-15, Task 28 reverse-engineering + Task 30 unlock):
//   1. Necro emits https://vidsrc.me/embed/movie?tmdb=X (or /embed/tv?tmdb=X&season=S&episode=E)
//   2. vidsrc.me 301 → vidsrcme.ru (canonical); /vs_src.php?type=<t>&id=<tmdb>[&season=&episode=]
//      → { src: "https://cloudorchestranova.com/embed/…?vs=<sig>" }   (rotating decoy domains)
//   3. That page embeds the data API URL: data.vidsrcme.ru/api.php?type=…&tmdb=…
//   4. api.php + &stream_urls → { data: { title, imdb_id, file_name, stream_urls },
//      default_subs, thumbnails_url, vs: { w, wasm_url } }
//      stream_urls is a per-5-min-window ChaCha20 blob (nonce||ct, base64) decrypted
//      by a WASM module (vs.wasm_url) → 1-3 /pl/<gzip-blob> HLS masters on rotating hosts
//   5. Each /pl host gates the master behind <origin>/generate.php → JWT (4h exp)
//      whose payload carries ip_cidr of the MINTING /24 → playback MUST originate
//      from this server. Ship through /proxy (server-side fetch + child rewrite) so
//      the player's residential IP never touches the gated host.
//      Mint is flaky (empty body ~30% / egress-IP drift) → re-mint + revalidate loop.
//   6. Variant playlists + TS segments resolve ungated (verified 200 + 0x47 TS magic).
//
// No torrent, no browser URLs — everything lands as a server-side-proxied HLS master.

import { Format } from '../types.js';
import { Extractor } from './Extractor.js';
import { NotFoundError } from '../error/index.js';

const VSRCME_BASE = 'https://vidsrcme.ru';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MINT_REFERER = 'https://cloudorchestranova.com/';
// /pl blobs are per-5-min-window — cache results well below that
const EXTRACT_TTL = 4 * 60 * 1000;

async function fetchText(url, extraHeaders = {}, timeoutMs = 15000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...extraHeaders },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, text: await res.text() };
}

async function decryptStreamUrls(payload) {
  if (typeof payload.data.stream_urls !== 'string') return payload.data.stream_urls || [];
  const enc = Buffer.from(payload.data.stream_urls, 'base64');
  const wasmRes = await fetch(payload.vs.wasm_url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  const wasmBytes = Buffer.from(await wasmRes.arrayBuffer());
  const inst = await WebAssembly.instantiate(await WebAssembly.compile(wasmBytes), {});
  const ex = inst.exports;
  const ptr = ex.alloc(enc.length);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  const outLen = ex.decrypt(ptr, enc.length);
  return new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr + 12, outLen)).split('\n').filter(Boolean);
}

export class VidSrcMe extends Extractor {
  constructor(fetcher, logger) {
    super(fetcher, logger);
    this.id = 'vidsrcme';
    this.label = 'VidSrcMe';
    this.ttl = EXTRACT_TTL;
  }

  supports(_ctx, url) {
    return null !== url.host.match(/(^|\.)vidsrc\.me$|(^|\.)vidsrcme\.ru$/);
  }

  async extractInternal(ctx, url, meta) {
    // 1) derive chain params from the embed URL (vidsrc.me canonicalizes to vidsrcme.ru)
    const q = url.searchParams;
    const type = url.pathname.includes('/tv') || url.searchParams.has('season') ? 'tv' : 'movie';
    const tmdb = q.get('tmdb');
    if (!tmdb) throw new NotFoundError();
    const vsSrcQ = type === 'tv'
      ? `type=tv&id=${tmdb}&season=${q.get('season') || 1}&episode=${q.get('episode') || 1}`
      : `type=movie&id=${tmdb}`;

    // 2) vs_src.php → decoy embed src
    const s1 = await fetchText(`${VSRCME_BASE}/vs_src.php?${vsSrcQ}`, { Referer: `${VSRCME_BASE}/` });
    if (s1.status !== 200) throw new NotFoundError();
    let src;
    try { src = JSON.parse(s1.text).src; } catch { throw new NotFoundError(); }
    if (!src) throw new NotFoundError();

    // 3) decoy embed page → data API URL (query escapes '&' as \u0026)
    const s2 = await fetchText(src, { Referer: `${VSRCME_BASE}/` });
    const apiMatch = s2.text.match(/data\.vidsrcme\.ru\/api\.php\?[^"'<\s]+/);
    if (!apiMatch) throw new NotFoundError();
    const apiUrl = 'https://' + apiMatch[0].replace(/\\u0026/g, '&').replace(/&amp;/g, '&');

    // 4) api.php + stream_urls → decrypt
    const s3 = await fetchText(`${apiUrl}&stream_urls`, { Referer: src, accept: 'application/json' });
    if (s3.status !== 200) throw new NotFoundError();
    let payload;
    try { payload = JSON.parse(s3.text); } catch { throw new NotFoundError(); }
    if (!payload?.data?.stream_urls) throw new NotFoundError();
    const plUrls = await decryptStreamUrls(payload);
    if (!plUrls.length) throw new NotFoundError();

    // quality hint from upstream file_name (e.g. "... [1080p] ...")
    const qm = (payload.data.file_name || '').match(/\[(2160p|1080p|720p|480p)\]/i);
    const quality = qm ? qm[1].toUpperCase() : 'HLS';

    // 5) per unique origin: mint token (retry loop) + validate master server-side
    const seen = new Set();
    const results = [];
    for (const plUrl of plUrls) {
      const origin = new URL(plUrl).origin;
      if (seen.has(origin)) continue;
      seen.add(origin);

      let master = null;
      for (let attempt = 0; attempt < 3 && !master; attempt++) {
        const mint = await fetchText(`${origin}/generate.php`, { Referer: MINT_REFERER }).catch(() => null);
        let token = '';
        if (mint?.status === 200 && mint.text) {
          const t = mint.text.trim();
          try { const p = JSON.parse(t); token = p.token || p.data || p.string || p.result || ''; } catch { token = t; }
        }
        if (!token) continue;
        const sep = plUrl.includes('?') ? '&' : '?';
        const candidate = `${plUrl}${sep}token=${encodeURIComponent(token)}`;
        const probe = await fetchText(candidate, { accept: '*/*' }).catch(() => null);
        if (probe?.status === 200 && probe.text.startsWith('#EXTM3U')) master = candidate;
      }
      if (!master) {
        this.logger.debug?.(`[vidsrcme] ${origin} — no valid master after retries`);
        continue;
      }

      // 6) ship through /proxy — token JWT binds the minting /24, so playback
      //    must originate from THIS server (proxy fetches server-side + rewrites children)
      const proxyUrl = new URL('/proxy', ctx.hostUrl);
      proxyUrl.searchParams.set('url', master);
      results.push({
        url: proxyUrl,
        format: Format.hls,
        meta: {
          ...meta,
          title: `${quality} · VidSrcMe`,
          provider: 'VidSrcMe',
          countryCodes: meta?.countryCodes,
        },
      });
    }

    if (!results.length) throw new NotFoundError();
    this.logger.debug?.(`[vidsrcme] ${plUrls.length} pl urls → ${results.length} proxied masters (${quality})`);
    return results;
  }
}
