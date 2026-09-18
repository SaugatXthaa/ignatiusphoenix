#!/usr/bin/env node
/** Task 57: step-timed HubCloud chain probe (4khdhub hang diagnosis). */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function step(label, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    console.log(`${label.padEnd(28)} ${String(out.status ?? '').padStart(3)} ${Date.now() - t0}ms ${out.note || ''}`);
    return out;
  } catch (e) {
    console.log(`${label.padEnd(28)} ERR ${Date.now() - t0}ms ${e.message.slice(0, 90)}`);
    return null;
  }
}

async function get(url, referer, timeout = 15000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  return { status: res.status, text, finalUrl: res.url };
}

const drive = process.argv[2] || 'https://hubcloud.ist/drive/cdce53ddaelbqjj';
console.log('chain for', drive);

const r1 = await step('1. drive page', () => get(drive));
if (!r1) process.exit(1);
// extract redirect: look for url= / href= patterns common in hubcloud
const m = r1.text.match(/(?:url|href)\s*=\s*['"]([^'"]+)['"]/i) ||
          r1.text.match(/https?:\/\/[^\s'"<>]+\/(?:download|links|drive)[^\s'"<>]*/i);
console.log('   redirect candidate:', m ? m[1].slice(0, 110) : '(none)');
console.log('   page len:', r1.text.length, '| title:', (r1.text.match(/<title>([^<]*)</) || [])[1] || '');

if (m) {
  const red = m[1].startsWith('http') ? m[1] : new URL(m[1], drive).href;
  const r2 = await step('2. redirect/links page', () => get(red, drive));
  if (r2) {
    console.log('   links len:', r2.text.length, '| title:', (r2.text.match(/<title>([^<]*)</) || [])[1] || '');
    const links = [...r2.text.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{2,40})</g)].slice(0, 10);
    for (const [_, href, label] of links) console.log('   link:', label.trim().slice(0, 30), '→', href.slice(0, 90));
  }
}
