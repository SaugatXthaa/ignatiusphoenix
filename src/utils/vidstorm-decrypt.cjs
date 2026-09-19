// src/utils/vidstorm-decrypt.cjs
// vidstorm.ru stream-token decryptor (reverse-engineered from their SPA
// bundle assets/index-*.js, Sep 2026).
//
// vidstorm.ru/api/movie/{tmdbId} | /api/tv/{tmdbId}/{s}/{e} returns
//   { lithium: {url,type,language,flag}, helium: {...}, carbon: {...}, ... }
// where `url` is a base64url AES-256-GCM blob:
//   [12-byte IV][ciphertext+16-byte GCM tag]
// decrypting to the REAL stream URL (e.g. https://dreadnought.*.workers.dev/…).
//
// Key derivation (verbatim from the bundle):
//   gQ = "C1oPWQVf…==" ; key = b64decode(gQ) → each byte XOR 60 → ASCII hex
//   string (64 chars) → parse as hex pairs → 32 raw key bytes.
//
// Playback requires Origin: https://vidstorm.ru on every request (master,
// variant, segment) — verified 200 vs 403 "Forbidden". Ship through /proxy
// with origin= + referer= so the whole HLS tree authenticates.
'use strict';

const crypto = require('crypto');

const GQ = 'C1oPWQVfDl0EXglYDVoIWQpdBV8PXgtYDlkJWgRdDV8IXgpYBVkOWgldBF8NXghYC1kFWg5dCV8EXg1YCFkLWg==';
const XOR_BYTE = 60;

let _key = null;
function getKey() {
  if (_key) return _key;
  const raw = Buffer.from(GQ, 'base64');
  let hex = '';
  for (const b of raw) hex += String.fromCharCode(b ^ XOR_BYTE);
  _key = Buffer.from(hex, 'hex'); // 32 bytes
  return _key;
}

function b64urlDecode(s) {
  let e = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (e.length % 4) e += '=';
  return Buffer.from(e, 'base64');
}

// Decrypt a vidstorm token → real URL string, or null on failure.
// Pass-through strings that are already URLs (mirrors the site's oL()).
function vidstormDecrypt(token) {
  if (typeof token !== 'string' || !token) return null;
  if (/^(https?:|blob:|data:|\/\/)/i.test(token)) return token;
  const buf = b64urlDecode(token);
  if (buf.length < 29) return null; // site's own guard: iv+tag minimum
  const iv = buf.subarray(0, 12);
  const ct = buf.subarray(12);
  if (ct.length <= 16) return null;
  try {
    const tag = ct.subarray(ct.length - 16);
    const data = ct.subarray(0, ct.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch (e) {
    return null;
  }
}

module.exports = { vidstormDecrypt };
