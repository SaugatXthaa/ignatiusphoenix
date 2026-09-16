// Inspect wisehive.top "fileNNN.html" segment content — disguised video or real HTML?
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const seg = process.argv[2] || 'https://wisehive.top/r2/cdn1/SlpBYjh1WlM0blZsczFSYVQ3Sy1SUTpVTzNVZnE4MlVpVFpQLXhmSktOdTBCcVcxMWE4Y3JFWld0VkZON1ZGc1drQ0tBVXVRQ0FKbFpRNkV4ZEw3Z3pR/file000.html';
const ref = process.argv[3];

const headers = { 'user-agent': UA, ...(ref ? { referer: ref } : {}) };
const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 20000);
try {
  const r = await fetch(seg, { headers, signal: ctrl.signal });
  console.log('status:', r.status, 'ct:', r.headers.get('content-type'), 'cl:', r.headers.get('content-length'));
  const reader = r.body.getReader();
  const chunks = []; let got = 0;
  while (got < 4096) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; }
  const buf = Buffer.concat(chunks);
  console.log('first 64 bytes hex:', buf.subarray(0, 64).toString('hex'));
  console.log('first 200 bytes ascii:', JSON.stringify(buf.subarray(0, 200).toString('latin1')));
  // TS magic: 0x47 at 0 and 188
  console.log('TS magic (0x47@0,188):', buf[0] === 0x47 && buf[188] === 0x47);
  console.log('MKV magic:', buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3);
  console.log('starts with <:', buf[0] === 0x3c);
} catch (e) { console.log('ERR', String(e.message || e).slice(0, 120)); }
finally { clearTimeout(t); }
