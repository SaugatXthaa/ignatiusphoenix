// src/nuvio/megaplay_decrypt.cjs
// Megaplay getSources/getSourcesNew decryption helper + transparent fetch shim.
//
// 2026-09: megaplay.buzz changed its sources API — the JSON response no longer
// contains { sources: { file: "https://...m3u8" } } directly. It now returns
//   { tracks: [...], t, intro, outro, server, enc: "<urlsafe-base64>" }
// where `enc` decrypts (AES-256-CBC) to { file: "https://...master.m3u8" }.
// The key/IV ship inside the site's own player bundle (newclient.min.js):
//   key = W("i?LMTAx0Q6,:}50U", 32)  → 16-char string zero-padded to 32 bytes
//   iv  = W("W0;27ToaUpl_P%'c", 16)  → used as-is
//   payload = urlsafe-base64 decode of `enc`
// The subtitle tracks (VTT, multi-language) remain in plaintext in the
// response and are unchanged.
//
// installMegaplayShim() patches globalThis.fetch ONCE so every consumer
// (obfuscated scrapers, plain scrapers, extractors) transparently sees the
// legacy { sources: { file } } shape they already parse. Idempotent.

'use strict';

const crypto = require('crypto');

// From megaplay.buzz/lib/newclient.min.js (trustAesKey / trustAesIv defaults)
const MP_AES_KEY_RAW = 'i?LMTAx0Q6,:}50U';
const MP_AES_IV_RAW = "W0;27ToaUpl_P%'c";

function b64urlDecode(s) {
  const std = String(s).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(std + '='.repeat((4 - (std.length % 4)) % 4), 'base64');
}

// Decrypt the `enc` blob → { file: "https://...m3u8" } (or null on failure)
function decryptMegaplayEnc(enc) {
  try {
    const key = Buffer.concat([Buffer.from(MP_AES_KEY_RAW, 'utf8'), Buffer.alloc(16, 0)]);
    const iv = Buffer.from(MP_AES_IV_RAW, 'utf8');
    const d = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const pt = Buffer.concat([d.update(b64urlDecode(enc)), d.final()]).toString('utf8');
    const obj = JSON.parse(pt);
    return obj && obj.file ? obj : null;
  } catch (e) {
    return null;
  }
}

const MEGAPLAY_SOURCES_RE = /^https?:\/\/([a-z0-9-]+\.)*megaplay\.buzz\/stream\/getSources(New)?\?/i;

let _installed = false;
function installMegaplayShim() {
  if (_installed) return;
  _installed = true;
  const origFetch = globalThis.fetch;
  if (typeof origFetch !== 'function') return;
  globalThis.fetch = async function megaplayShimmedFetch(input, init) {
    const res = await origFetch.call(this, input, init);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      if (MEGAPLAY_SOURCES_RE.test(url)) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json') && res.ok) {
          const data = await res.clone().json();
          if (data && !data.sources && data.enc) {
            const dec = decryptMegaplayEnc(data.enc);
            if (dec && dec.file) {
              // Restore the legacy shape every existing parser understands.
              // Keep tracks/t/server/intro/outro untouched.
              data.sources = { file: dec.file };
              const body = JSON.stringify(data);
              return new Response(body, {
                status: res.status,
                statusText: res.statusText,
                headers: { 'content-type': 'application/json' },
              });
            }
          }
        }
      }
    } catch (e) { /* never break the original response */ }
    return res;
  };
}

module.exports = { decryptMegaplayEnc, installMegaplayShim, MEGAPLAY_SOURCES_RE };
