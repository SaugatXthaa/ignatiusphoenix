// Task 22: try PoW variants (inner=bytes vs hex-string) + client-style retry
const crypto = require('node:crypto');
const SEED = 'iwTL6oi-9LLc3M4a1jcQV6jciugKj1_z6dYhdSbbtlg:';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function solveVariant(challenge, difficulty, innerMode) {
  const inner = crypto.createHash('sha256').update(challenge).digest();
  const innerVal = innerMode === 'bytes' ? inner : inner.toString('hex');
  const byteCheck = Math.floor(difficulty / 2);
  const odd = difficulty % 2 === 1;
  for (let n = 0; n <= 5e6; n++) {
    const h = crypto.createHash('sha256').update(innerVal).update(String(n)).digest();
    let ok = true;
    for (let i = 0; i < byteCheck; i++) if (h[i] !== 0) { ok = false; break; }
    if (ok && odd && h[byteCheck] >= 16) ok = false;
    if (ok) return String(n);
  }
  throw new Error('PoW timeout');
}

async function attempt(variant) {
  const chRes = await fetch('https://api.stellar.gdn/api/challenge', {
    headers: { 'User-Agent': UA, Origin: 'https://stellar.gdn', Referer: 'https://stellar.gdn/' },
  });
  const ch = await chRes.json();
  const nonce = solveVariant(ch.challenge, ch.difficulty, variant);
  const today = new Date().toISOString().slice(0, 10);
  const keyHash = crypto.createHash('sha256').update(SEED + today).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyHash, iv);
  const payload = { mediaType: 'tv', id: 1429, season: 1, episode: 1, challenge: ch.challenge, nonce };
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    body: JSON.stringify({ q: enc.toString('base64'), s: iv.toString('base64'), t: tagToString(cipher), d: today }),
  };
}
function tagToString(cipher) { return cipher.getAuthTag().toString('base64'); }

(async () => {
  for (const variant of ['bytes', 'hex']) {
    for (let tryN = 1; tryN <= 2; tryN++) {   // client retries once on this exact error
      const { body } = await attempt(variant);
      const res = await fetch('https://api.stellar.gdn/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://stellar.gdn', Referer: 'https://stellar.gdn/' },
        body,
      });
      const text = await res.text();
      console.log(`${variant} try${tryN} -> ${res.status}: ${text.slice(0, 260)}`);
      if (res.ok) { console.log('SUCCESS with variant:', variant); process.exit(0); }
    }
  }
})();
