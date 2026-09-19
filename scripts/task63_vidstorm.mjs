// Task 63: vidstorm.ru token decryptor (extracted from their SPA bundle)
// key = b64decode(gQ) each byte XOR 60 → hex-string → parse hex pairs → bytes
// token: urlsafe-b64 → [12B IV][ciphertext+GCM tag] → AES-GCM-128 decrypt → real URL
import crypto from 'crypto';

const GQ = 'C1oPWQVfDl0EXglYDVoIWQpdBV8PXgtYDlkJWgRdDV8IXgpYBVkOWgldBF8NXghYC1kFWg5dCV8EXg1YCFkLWg==';
const XOR = 60;

function deriveKey() {
  const raw = Buffer.from(GQ, 'base64');
  let hex = '';
  for (const b of raw) hex += String.fromCharCode(b ^ XOR);
  return Buffer.from(hex, 'hex');
}

function b64urlDecode(s) {
  let e = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (e.length % 4) e += '=';
  return Buffer.from(e, 'base64');
}

export function vidstormDecrypt(token) {
  if (typeof token !== 'string' || !token) return null;
  if (/^(https?:|blob:|data:|\/\/)/i.test(token)) return token;
  const buf = b64urlDecode(token);
  if (buf.length < 29) return null;
  const iv = buf.subarray(0, 12);
  const ct = buf.subarray(12);
  try {
    const tag = ct.subarray(ct.length - 16);
    const data = ct.subarray(0, ct.length - 16);
    const d = crypto.createDecipheriv('aes-128-gcm', deriveKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch (e) {
    return null;
  }
}

// self-test
if (process.argv[1]?.endsWith('task63_vidstorm.mjs')) {
  const key = deriveKey();
  console.log('key len:', key.length, 'key hex:', key.toString('hex').slice(0, 32));
  const api = await (await fetch('https://vidstorm.ru/api/movie/27205', { headers: { 'User-Agent': 'Mozilla/5.0' } })).json();
  for (const [name, srv] of Object.entries(api)) {
    if (!srv?.url) { console.log(`${name}: (no url)`); continue; }
    const real = vidstormDecrypt(srv.url);
    console.log(`${name}: type=${srv.type} lang=${srv.language} → ${real ? String(real).slice(0, 120) : 'DECRYPT FAILED'}`);
  }
}
