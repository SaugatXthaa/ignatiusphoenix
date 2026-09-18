#!/usr/bin/env node
/**
 * Task 52: step-by-step animeworld.one chain trace for AoT S1E1.
 */
const BASE = 'https://watchanimeworld.one';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function get(url, extra = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', Referer: BASE + '/', ...extra },
    redirect: 'follow', signal: AbortSignal.timeout(20000),
  });
  return { status: res.status, body: await res.text() };
}

// Step 1: search
const s1 = await get(`${BASE}/?s=attack+on+titan`);
console.log('1. search:', s1.status, 'len', s1.body.length);
const seriesMatch = [...s1.body.matchAll(/href="(https:\/\/watchanimeworld\.(?:top|one)\/series\/([^\/"]+)\/)"/g)];
console.log('   series links:', seriesMatch.slice(0, 3).map(m => m[2]).join(', '));
const seriesUrl = `https://watchanimeworld.one/series/attack-on-titan/`;

// Step 2: series page → pid
const s2 = await get(seriesUrl);
console.log('2. series page:', s2.status, 'len', s2.body.length);
const pidM = s2.body.match(/[?&]post=(\d+)/) || s2.body.match(/var\s+pid\s*=\s*['"]?(\d+)/) || s2.body.match(/data-post\s*=\s*["'](\d+)/);
console.log('   pid:', pidM ? pidM[1] : 'NOT FOUND');
if (!pidM) {
  // dump snippets around 'post='
  const i = s2.body.indexOf('post=');
  console.log('   ctx:', i >= 0 ? s2.body.slice(i - 80, i + 80).replace(/\s+/g, ' ') : 'no post= anywhere');
  const season = s2.body.indexOf('season');
  console.log('   season ctx:', s2.body.slice(season - 50, season + 100).replace(/\s+/g, ' '));
}

// Step 3: season ajax (if pid found)
if (pidM) {
  const s3 = await get(`${BASE}/wp-admin/admin-ajax.php?action=action_select_season&season=1&post=${pidM[1]}`, { 'X-Requested-With': 'XMLHttpRequest' });
  console.log('3. season ajax:', s3.status, 'len', s3.body.length);
  const epMatch = [...s3.body.matchAll(/href="(https:\/\/watchanimeworld\.(?:top|one)\/episode\/([^"]+))"/g)];
  console.log('   episode links:', epMatch.slice(0, 3).map(m => m[1]).join(', '));
}

// Step 4: episode page
const epUrl = 'https://watchanimeworld.one/episode/attack-on-titan-1x1/';
const s4 = await get(epUrl);
console.log('4. episode page:', s4.status, 'len', s4.body.length);
const iframeM = s4.body.match(/(?:src|data-src)="(https:\/\/play\.zephyrix\.(?:top|org)\/video\/([a-f0-9]+))"/);
console.log('   zephyrix iframe:', iframeM ? iframeM[1] : 'NOT FOUND');
if (!iframeM) {
  const zi = s4.body.indexOf('zephyrix');
  console.log('   zephyrix ctx:', zi >= 0 ? s4.body.slice(zi - 120, zi + 120).replace(/\s+/g, ' ') : 'none');
  const ii = s4.body.indexOf('<iframe');
  console.log('   iframe ctx:', ii >= 0 ? s4.body.slice(ii - 50, ii + 250).replace(/\s+/g, ' ') : 'no iframe');
} else {
  // Step 5: getVideo
  const hash = iframeM[2];
  const res = await fetch('https://play.zephyrix.top/player/index.php?data=' + hash + '&do=getVideo', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Referer': 'https://watchanimeworld.one/', 'Origin': 'https://play.zephyrix.top', 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'hash=' + hash + '&r=' + encodeURIComponent('https://watchanimeworld.one/'),
    signal: AbortSignal.timeout(20000),
  });
  const txt = await res.text();
  console.log('5. getVideo:', res.status, 'len', txt.length);
  try {
    const j = JSON.parse(txt);
    console.log('   keys:', Object.keys(j).join(','));
    console.log('   securedLink:', (j.securedLink || '').slice(0, 80));
    console.log('   videoSource:', (j.videoSource || '').slice(0, 80));
  } catch { console.log('   body head:', txt.slice(0, 200)); }
}
