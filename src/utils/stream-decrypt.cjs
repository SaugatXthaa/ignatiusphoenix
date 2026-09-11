// src/utils/stream-decrypt.cjs — reusable stream-decryption toolkit
//
// Implements the techniques from the Stream Reverse Engineering guide
// (docs/SOURCE_ONBOARDING.md §encryption) as pure, dependency-free helpers so
// ANY future web source can be onboarded without re-implementing them:
//
//   §5.1  base64-encoded URLs/playlists ...... base64DecodeStrict, decodeMaybeBase64
//   §5.2  XOR segments disguised as WebP/PNG . isWebPDisguise, isPngDisguise,
//                                            stripFakeImageHeader, xorDecrypt
//   §5.3  WASM key derivation ............... createWasmRunner
//   §5.4  AES-256-CBC after PBKDF2→XOR→SHA .. deriveAesKeyChain, aes256CbcDecrypt
//   §5.5  SHA-256 obfuscated field names .... sha256Hex, deriveFieldNames
//   §6.4  content-type auto-dispatch ........ detectAndDecrypt
//   §9.4  MPEG-TS sync-byte verification .... verifyMpegTs
//
// Plus a drop-in /proxy decrypt handler (decryptProxyResponse) wired from
// src/index.js behind OPT-IN query params — default /proxy behavior is
// byte-identical when the params are absent.
//
// CJS on purpose: ESM sources `import { x } from '../utils/stream-decrypt.cjs'`
// (same pattern as site-secrets.cjs) and .cjs nuvio modules `require()` it.

'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// §5.2 Disguise detection (magic bytes)
// ---------------------------------------------------------------------------

/** WebP-disguised body: "RIFF" + 4 len bytes + "WEBP" (12-byte fake header). */
function isWebPDisguise(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50; // WEBP
}

/** PNG-disguised body: 8-byte signature 89 50 4E 47 0D 0A 1A 0A. */
function isPngDisguise(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
    buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A;
}

/** Length of the fake image header to strip (12 WebP | 8 PNG | 0 none). */
function fakeImageHeaderLen(buf) {
  if (isWebPDisguise(buf)) return 12;
  if (isPngDisguise(buf)) return 8;
  return 0;
}

function stripFakeImageHeader(buf, hintLen) {
  const n = typeof hintLen === 'number' && hintLen > 0 ? hintLen : fakeImageHeaderLen(buf);
  return n > 0 ? buf.slice(n) : buf;
}

// ---------------------------------------------------------------------------
// §5.2 Cyclic XOR (Buffer.alloc + for loop — the fast pattern; spread-based
// loops are measurably slower on multi-MB segments, see guide §7 "Proxy is slow")
// ---------------------------------------------------------------------------

function xorDecrypt(buf, key) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (!Buffer.isBuffer(key) || key.length === 0) return Buffer.from(buf);
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length];
  return out;
}

// ---------------------------------------------------------------------------
// §5.1 / §6 Base64 (strict — avoids false positives on binary segments)
// ---------------------------------------------------------------------------

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decode only if the string is *plausibly* base64; returns Buffer or null. */
function base64DecodeStrict(str) {
  if (typeof str !== 'string') return null;
  const flat = str.replace(/\s+/g, '');
  if (flat.length < 8 || flat.length % 4 !== 0 || !B64_RE.test(flat)) return null;
  try {
    const buf = Buffer.from(flat, 'base64');
    // Buffer.from is lenient — confirm round-trip length to reject silent gaps
    const expected = Math.floor(flat.length * 3 / 4) - (flat.endsWith('==') ? 2 : flat.endsWith('=') ? 1 : 0);
    return buf.length === expected ? buf : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// §9.4 MPEG-TS verification (0x47 sync byte every 188 bytes)
// ---------------------------------------------------------------------------

/**
 * Verify decrypted bytes are valid MPEG-TS. Checks up to `maxPackets` packets
 * (default 8) so a truncated tail doesn't fail an otherwise valid segment.
 * Returns { valid, checked, packets }.
 */
function verifyMpegTs(buf, maxPackets = 8) {
  if (!Buffer.isBuffer(buf) || buf.length < 188) return { valid: false, checked: 0, packets: 0 };
  const total = Math.floor(buf.length / 188);
  const checked = Math.min(maxPackets, total);
  for (let p = 0; p < checked; p++) {
    if (buf[p * 188] !== 0x47) return { valid: false, checked: p + 1, packets: total };
  }
  return { valid: true, checked, packets: total };
}

// ---------------------------------------------------------------------------
// §5.4 Key-derivation chain: PBKDF2 → XOR-with-seed → SHA-256 → AES key
// ---------------------------------------------------------------------------

/**
 * Derive an AES-256 key from a WASM/derived key fragment + per-request seed.
 * Order per guide §5.4: PBKDF2(secret, seed) → XOR with seed bytes → SHA-256.
 * @returns {Buffer} 32-byte AES key
 */
function deriveAesKeyChain({ secret, seed, iterations = 1000, keyLen = 32, digest = 'sha256' }) {
  const secretBuf = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret), 'utf8');
  const seedStr = String(seed);
  const w = crypto.pbkdf2Sync(secretBuf, seedStr, iterations, keyLen, digest);
  const tt = Buffer.from(w);
  const seedBuf = Buffer.from(seedStr, 'utf8');
  for (let i = 0; i < keyLen; i++) tt[i] ^= seedBuf[i % seedBuf.length];
  return crypto.createHash('sha256').update(tt).digest();
}

/** AES-256-CBC decrypt → utf8 text (auto-padding). Throws on bad key/IV. */
function aes256CbcDecrypt(key, iv, data) {
  const d = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// §5.5 SHA-256 obfuscated field names (computed per-request, never hardcoded)
// ---------------------------------------------------------------------------

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

/**
 * Derive dynamic JSON field names from a per-request seed (guide §5.5):
 *   hashE = seed chained 3× (sha256(prev + i))
 *   hashA = hashE chained 3× more
 *   containerName = "cd_" + hashE[24..32), keyField = "kf_" + hashE[8..16),
 *   tokenField   = hashE[48..64) + "_" + hashE[56..64)
 * hashA is returned too — some sites derive extra fields from the second chain.
 */
function deriveFieldNames(seed) {
  let e = String(seed);
  for (let i = 0; i < 3; i++) e = sha256Hex(e + i);
  let a = e;
  for (let i = 0; i < 3; i++) a = sha256Hex(a + i);
  return {
    containerName: 'cd_' + e.substring(24, 32),
    keyField: 'kf_' + e.substring(8, 16),
    tokenField: e.substring(48, 64) + '_' + e.substring(56, 64),
    hashE: e,
    hashA: a,
  };
}

// ---------------------------------------------------------------------------
// §5.3 WASM runner (Node runs WebAssembly natively — no browser)
// ---------------------------------------------------------------------------

/**
 * Compile a base64-encoded WASM payload and expose memory read/write helpers.
 * Memory layout and export names are site-specific — read the player JS to
 * learn which exports to call (guide §5.3 WARN).
 * @returns {Promise<{exports: object, memory: Uint8Array, write, read, call}>}
 */
async function createWasmRunner(b64, imports = {}) {
  const bytes = Buffer.isBuffer(b64) ? b64 : base64DecodeStrict(String(b64).replace(/\s+/g, ''));
  if (!bytes) throw new Error('wasm: payload is not valid base64');
  const mod = await WebAssembly.compile(bytes);
  const inst = await WebAssembly.instantiate(mod, imports);
  const ex = inst.exports;
  // Memory export name is site-specific ("memory", "mem", "m", …) — find the
  // exported WebAssembly.Memory regardless of name.
  const findMemory = () => {
    for (const v of Object.values(ex)) {
      if (v instanceof WebAssembly.Memory) return v;
    }
    return null;
  };
  const mem = () => {
    const m = findMemory();
    if (!m) throw new Error('wasm: module does not export a WebAssembly.Memory (check the player JS for how it accesses memory)');
    return new Uint8Array(m.buffer);
  };
  return {
    exports: ex,
    get memory() { return mem(); },
    /** Grow-check + write bytes at offset; returns bytes.length. */
    write(offset, data) {
      const m = mem();
      if (offset + data.length > m.length) throw new Error('wasm: write out of range');
      m.set(data, offset);
      return data.length;
    },
    /** Read `len` bytes at offset as Buffer. */
    read(offset, len) {
      const m = mem();
      if (offset + len > m.length) throw new Error('wasm: read out of range');
      return Buffer.from(m.subarray(offset, offset + len));
    },
  };
}

// ---------------------------------------------------------------------------
// §6.4 Content-type auto-dispatch (detection by magic bytes, guide order)
// ---------------------------------------------------------------------------

/**
 * Detect what an upstream body is and decrypt it accordingly.
 * Detection order (mirrors the battle-tested /reanime-proxy logic, generalized):
 *   1. WebP disguise  → strip 12 + XOR → segment (video/mp2t)
 *   2. PNG disguise   → strip 8  + XOR → segment (video/mp2t)
 *   3. stripHint      → strip N    + XOR → segment (site uses a custom fake header)
 *   4. plain #EXTM3U  → playlist, untouched
 *   5. expectBase64   → base64-decode (+XOR) → must yield #EXTM3U, else fall through
 *   6. auto base64    → strict base64-decode (+XOR) → #EXTM3U → playlist
 *   7. whole-body XOR → #EXTM3U → playlist; else → segment (video/mp2t)
 *
 * @returns {{ kind: 'segment'|'playlist'|'passthrough', payload: Buffer,
 *             contentType: string, playlistText?: string }}
 */
function detectAndDecrypt(body, { xorKey = null, stripHint = 0, expectBase64 = false } = {}) {
  if (!Buffer.isBuffer(body)) body = Buffer.from(body || []);

  // 1-2. Fake-image-disguised segments
  const disguise = fakeImageHeaderLen(body);
  if (disguise > 0 && xorKey) {
    return {
      kind: 'segment',
      payload: xorDecrypt(body.slice(disguise), xorKey),
      contentType: 'video/mp2t',
    };
  }

  // 3. Site declares its own header length (e.g. 16-byte magic + TS)
  const hint = parseInt(stripHint, 10) || 0;
  if (hint > 0 && hint < body.length && xorKey) {
    return {
      kind: 'segment',
      payload: xorDecrypt(body.slice(hint), xorKey),
      contentType: 'video/mp2t',
    };
  }

  // 4. Plain playlist (already decoded)
  if (body.slice(0, 7).toString('utf8') === '#EXTM3U') {
    return { kind: 'playlist', payload: body, contentType: 'application/vnd.apple.mpegurl', playlistText: body.toString('utf8') };
  }

  // 5. Caller asserts base64 (guide §6.2 base64 m3u8 path)
  if (expectBase64) {
    const dec = base64DecodeStrict(body.toString('utf8'));
    if (dec) {
      const plain = xorKey ? xorDecrypt(dec, xorKey) : dec;
      if (plain.slice(0, 7).toString('utf8') === '#EXTM3U') {
        return { kind: 'playlist', payload: plain, contentType: 'application/vnd.apple.mpegurl', playlistText: plain.toString('utf8') };
      }
    }
  }

  // 6. Auto-detect base64 (variant playlists written as b64 even when master wasn't)
  const dec = base64DecodeStrict(body.toString('utf8', 'utf8'));
  if (dec) {
    const plain = xorKey ? xorDecrypt(dec, xorKey) : dec;
    if (plain.slice(0, 7).toString('utf8') === '#EXTM3U') {
      return { kind: 'playlist', payload: plain, contentType: 'application/vnd.apple.mpegurl', playlistText: plain.toString('utf8') };
    }
  }

  // 7. Whole-body XOR — playlist-shaped result wins, else assume TS segment
  if (xorKey) {
    const plain = xorDecrypt(body, xorKey);
    if (plain.slice(0, 7).toString('utf8') === '#EXTM3U') {
      return { kind: 'playlist', payload: plain, contentType: 'application/vnd.apple.mpegurl', playlistText: plain.toString('utf8') };
    }
    return { kind: 'segment', payload: plain, contentType: 'video/mp2t' };
  }

  // No key — pass through as generic segment data
  return { kind: 'passthrough', payload: body, contentType: 'application/octet-stream' };
}

/**
 * Parse the /proxy `xor` query param into a key Buffer (or null).
 * Disambiguation: a strict pure-hex even-length string (>= 8 chars) is treated
 * as HEX first (base64 of a key can also look hex-ish); everything else is
 * tried as base64. Callers that need byte-exact control should pass hex.
 */
function parseXorKeyParam(raw) {
  if (!raw) return null;
  const s = String(raw);
  if (/^[0-9a-fA-F]+$/.test(s) && s.length >= 8 && s.length % 2 === 0) return Buffer.from(s, 'hex');
  const buf = Buffer.from(s, 'base64');
  return buf.length >= 4 ? buf : null;
}

// ---------------------------------------------------------------------------
// /proxy opt-in decrypt handler (called from src/index.js when ?xor= is set)
// ---------------------------------------------------------------------------

/**
 * Fetch upstream (buffered), auto-detect + decrypt, serve playlist or segment.
 * m3u8 URLs are rewritten through the SAME /proxy with the decrypt params
 * propagated (xor/strip/ct) so variant playlists and segments decrypt too.
 *
 * @param {object} d deps from the caller:
 *   req, res, targetUrl, rawXor, referer, stripHint, expectBase64, ctOverride,
 *   logger, addonName, rewrite(text) — m3u8 rewriter bound to the caller.
 */
async function decryptProxyResponse(d) {
  const { req, res, targetUrl, rawXor, referer, stripHint, expectBase64, ctOverride, logger, addonName, rewrite } = d;
  const xorKey = parseXorKeyParam(rawXor);
  if (!xorKey) {
    res.status(400).send('Invalid xor parameter (need >=4 bytes as base64 or hex)');
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  logger.log(`[${addonName}] proxy-decrypt ${targetUrl.hostname}${targetUrl.pathname.slice(0, 50)}`);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': '*/*',
  };
  if (referer) headers['Referer'] = referer;
  // Range matters for direct MP4 passthrough; encrypted TS is served whole.
  headers['Range'] = req.headers.range || 'bytes=0-';

  const { gotScraping } = await import('got-scraping');
  const upstream = await gotScraping.get(targetUrl.href, {
    headers,
    timeout: { request: 30000 },
    throwHttpErrors: false,
    followRedirect: true,
    http2: false,
    responseType: 'buffer', // binary-safe — text decoding corrupts TS payloads
  });

  if (upstream.statusCode >= 400) {
    logger.error(`[${addonName}] proxy-decrypt upstream ${upstream.statusCode} for ${targetUrl.hostname}`);
    return res.status(upstream.statusCode).send(`Upstream error: ${upstream.statusCode}`);
  }

  const result = detectAndDecrypt(upstream.body, { xorKey, stripHint, expectBase64 });
  const contentType = ctOverride || result.contentType;

  // Verified-decryption log line (guide §9.4) — cheap, first packets only
  if (result.kind === 'segment') {
    const v = verifyMpegTs(result.payload, 4);
    logger.log(`[${addonName}] proxy-decrypt segment ${result.payload.length}B ts=${v.valid ? 'ok' : 'unchecked'}`);
  }

  if (req.method === 'HEAD') {
    res.status(200);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', result.payload.length);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', result.kind === 'playlist' ? 'no-store' : 'public, max-age=86400');
    return res.end();
  }

  if (result.kind === 'playlist' && typeof rewrite === 'function') {
    const rewritten = rewrite(result.playlistText);
    res.status(200);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Content-Length', Buffer.byteLength(rewritten));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', 'bytes');
    return res.end(rewritten);
  }

  res.status(200);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', result.payload.length);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Accept-Ranges', 'bytes');
  return res.end(result.payload);
}

module.exports = {
  isWebPDisguise,
  isPngDisguise,
  fakeImageHeaderLen,
  stripFakeImageHeader,
  xorDecrypt,
  base64DecodeStrict,
  verifyMpegTs,
  deriveAesKeyChain,
  aes256CbcDecrypt,
  sha256Hex,
  deriveFieldNames,
  createWasmRunner,
  detectAndDecrypt,
  parseXorKeyParam,
  decryptProxyResponse,
};
