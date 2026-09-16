// Task 22: empirically verify stellar.gdn PoW = H(H(challenge)||nonce) with new key
const crypto = require('node:crypto');
const SEED = 'iwTL6oi-9LLc3M4a1jcQV6jciugKj1_z6dYhdSbbtlg:';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Site q(): E = H(challenge) bytes; per nonce: H(E || String(nonce)) hex; first floor(d/2) BYTES zero (+nibble for odd d)
function solvePoWDoble(challenge, difficulty) {
  const inner = crypto.createHash('sha256').update(challenge).digest(); // 32 bytes
  const byteCheck = Math.floor(difficulty / 2);
  const odd = difficulty % 2 === 1;
  for (let n = 0; n <= 5e6; n++) {
    const h = crypto.createHash('sha256').update(inner).update(String(n)).digest();
    let ok = true;
    for (let i = 0; i < byteCheck; i++) if (h[i] !== 0) { ok = false; break; }
    if (ok && odd && h[byteCheck] >= 16) ok = false;
    if (ok) return String(n);
  }
  throw new Error('PoW timeout');
}

(async () => {
  const chRes = await fetch('https://api.stellar.gdn/api/challenge', {
    headers: { 'User-Agent': UA, Origin: 'https://stellar.gdn', Referer: 'https://stellar.gdn/' },
  });
  const ch = await chRes.json();
  console.log('challenge:', ch.challenge.slice(0, 16), 'difficulty:', ch.difficulty);
  const t0 = Date.now();
  const nonce = solvePoWDoble(ch.challenge, ch.difficulty);
  console.log('double-hash nonce:', nonce, 'in', Date.now() - t0, 'ms');

  const today = new Date().toISOString().slice(0, 10);
  const keyHash = crypto.createHash('sha256').update(SEED + today).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyHash, iv);
  const payload = { mediaType: 'tv', id: 1429, season: 1, episode: 1, challenge: ch.challenge, nonce };
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const body = {
    q: enc.toString('base64'), s: iv.toString('base64'), t: tag.toString('base64'), d: today,
  };
  const res = await fetch('https://api.stellar.gdn/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://stellar.gdn', Referer: 'https://stellar.gdn/' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log('resolve ->', res.status, text.slice(0, 400));
})();
