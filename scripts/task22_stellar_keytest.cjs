// Task 22: validate the NEW stellar.gdn key seed extracted from the live bundle
const crypto = require('node:crypto');

const NEW_SEED = 'iwTL6oi-9LLc3M4a1jcQV6jciugKj1_z6dYhdSbbtlg:';
const OLD_SEED = 'KT1b67W1DU2ebpGxQkMiFVyz1iaP/PeMgv/xJQDdDoU=:';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function encryptPayload(data, seed) {
  const today = new Date().toISOString().slice(0, 10);
  const keyHash = crypto.createHash('sha256').update(seed + today).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyHash, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { q: enc.toString('base64'), s: iv.toString('base64'), t: tag.toString('base64'), d: today };
}

(async () => {
  for (const [label, seed] of [['OLD', OLD_SEED], ['NEW', NEW_SEED]]) {
    // 1. challenge
    const chRes = await fetch('https://api.stellar.gdn/api/challenge', {
      headers: { 'User-Agent': UA, Origin: 'https://stellar.gdn', Referer: 'https://stellar.gdn/' },
    });
    const ch = await chRes.json();
    // 2. PoW
    let nonce = 0;
    const zeros = '0'.repeat(ch.difficulty || 4);
    while (!crypto.createHash('sha256').update(ch.challenge + nonce).digest('hex').startsWith(zeros)) nonce++;
    // 3. encrypt payload
    const payload = { mediaType: 'tv', id: 1429, season: 1, episode: 1, challenge: ch.challenge, nonce };
    const enc = encryptPayload(payload, seed);
    // 4. resolve
    const res = await fetch('https://api.stellar.gdn/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://stellar.gdn', Referer: 'https://stellar.gdn/' },
      body: JSON.stringify(enc),
    });
    const body = await res.text();
    console.log(`${label} seed -> HTTP ${res.status}: ${body.slice(0, 220)}`);
  }
})();
