// Task 22: FINAL combo — NEW seed + single-hash PoW (as decoded from q()/M())
const crypto = require('node:crypto');
const SEED = 'iwTL6oi-9LLc3M4a1jcQV6jciugKj1_z6dYhdSbbtlg:';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function solvePoW(challenge, difficulty) {
  const zeros = '0'.repeat(difficulty);
  for (let n = 0; n <= 5e6; n++) {
    const hex = crypto.createHash('sha256').update(challenge + n).digest('hex');
    if (hex.startsWith(zeros)) return String(n);
  }
  throw new Error('PoW timeout');
}

async function resolveOnce(mediaType, id, season, episode) {
  const chRes = await fetch('https://api.stellar.gdn/api/challenge', {
    headers: { 'User-Agent': UA, Origin: 'https://stellar.gdn', Referer: 'https://stellar.gdn/' },
  });
  const ch = await chRes.json();
  const nonce = solvePoW(ch.challenge, ch.difficulty);

  const today = new Date().toISOString().slice(0, 10);
  const keyHash = crypto.createHash('sha256').update(SEED + today).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyHash, iv);
  const payload = { mediaType, id, season, episode, challenge: ch.challenge, nonce };
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const res = await fetch('https://api.stellar.gdn/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://stellar.gdn', Referer: 'https://stellar.gdn/' },
    body: JSON.stringify({ q: enc.toString('base64'), s: iv.toString('base64'), t: cipher.getAuthTag().toString('base64'), d: today }),
  });
  return { status: res.status, body: await res.text() };
}

(async () => {
  const r = await resolveOnce('tv', 1429, 1, 1);
  console.log('AoT S1E1 ->', r.status, r.body.slice(0, 500));
  if (r.status === 200) {
    const j = JSON.parse(r.body);
    console.log('\nurl:', (j.url || '').slice(0, 120));
    console.log('source:', j.source, '| subs:', (j.subtitles || []).length);
  }
})();
