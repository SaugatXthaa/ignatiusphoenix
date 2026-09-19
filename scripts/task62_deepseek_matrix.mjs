// Task 62: mock Range-ignoring upstream + proxy deep-seek behavior variants.
// Test with ffmpeg (same libavformat as mpv) to find which variant PLAYS.
import http from 'http';
import fs from 'fs';
import { spawn } from 'child_process';

// --- 1. Build a small real MKV test file with ffmpeg (Cues at end, ~40MB) ---
const TMP = '/tmp/t62';
fs.mkdirSync(TMP, { recursive: true });
const mediaFile = `${TMP}/test.mkv`;
if (!fs.existsSync(mediaFile)) {
  // 40s of test video ~ encode small; use ultrafast + low bitrate
  spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=40:size=320x240:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=40',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '500k',
    '-c:a', 'aac', '-b:a', '64k',
    // put Cues (seek index) at the END (default for mkv)
    '-f', 'matroska', mediaFile], { stdio: 'inherit' });
}
const media = fs.readFileSync(mediaFile);
const mediaSize = media.length;
console.log(`media: ${mediaFile} ${mediaSize} bytes`);

// Real Cues offset for an mkv: near the end. Find "Cues" EBML marker (0x1C53BB6B).
let cuesOff = mediaSize - 4096;
for (let i = mediaSize - 200000; i < mediaSize - 16; i++) {
  if (media[i] === 0x1c && media[i + 1] === 0x53 && media[i + 2] === 0xbb && media[i + 3] === 0x6b) { cuesOff = i; break; }
}
console.log(`cues offset ~ ${cuesOff} (${(cuesOff / mediaSize * 100).toFixed(1)}% of file)`);

// --- 2. Mock UPSTREAM: google-like (ignores Range, always 200 from byte 0) ---
const upstream = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'video/x-matroska', 'Content-Length': String(mediaSize) });
  res.end(media);
});
await new Promise(r => upstream.listen(47001, r));

// --- 3. Proxy variants ---
function makeProxy(mode) {
  return http.createServer((req, res) => {
    const range = req.headers.range;
    let start = 0;
    if (range) { const m = String(range).match(/bytes=(\d*)-(\d*)/); if (m && m[1]) start = parseInt(m[1], 10); }
    const open = !range || start === 0;
    if (open) {
      // open request: 206 with full range (like prod today)
      res.writeHead(206, {
        'Content-Type': 'video/x-matroska',
        'Content-Length': String(mediaSize),
        'Content-Range': `bytes 0-${mediaSize - 1}/${mediaSize}`,
        'Accept-Ranges': 'bytes',
      });
      res.end(media);
      return;
    }
    // deep seek — variant behavior
    if (mode === '416') { res.writeHead(416, { 'Content-Range': `bytes */${mediaSize}` }); return res.end(); }
    if (mode === '403') { res.writeHead(403); return res.end('no'); }
    if (mode === '502') { res.writeHead(502); return res.end('bad gateway'); }
    if (mode === '200') {
      // serve from byte 0 with honest 200 + full length (ffmpeg must discard)
      res.writeHead(200, { 'Content-Type': 'video/x-matroska', 'Content-Length': String(mediaSize) });
      res.end(media);
      return;
    }
    if (mode === 'close') { res.destroy(); return; }
  });
}

const ports = { '416': 47101, '403': 47102, '502': 47103, '200': 47104, 'close': 47105 };
for (const [mode, port] of Object.entries(ports)) {
  await new Promise(r => makeProxy(mode).listen(port, r));
}

// --- 4. ffmpeg playback test per variant (ASYNC spawn — mock lives in this process) ---
function testPlayback(label, url) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('timeout', ['-k', '3', '25', 'ffmpeg', '-nostdin', '-v', 'info', '-stats',
      '-i', url, '-t', '4', '-f', 'null', '-']);
    let err = '';
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('close', () => {
      const stats = err.split('\r').filter(l => /frame=/.test(l)).pop() || 'no-stats';
      const empty = /Output file is empty/.test(err);
      const ok = !empty && /time=00:00:0[2-9]|time=00:00:1/.test(stats);
      console.log(`${label.padEnd(10)} -> ${ok ? 'PLAYS OK' : 'FAILS'}  (${((Date.now() - t0) / 1000).toFixed(1)}s)  ${stats.trim().slice(0, 80)}`);
      if (!ok) console.log(`   err: ${err.replace(/\n/g, ' | ').replace(/\r/g, '').slice(-240)}`);
      resolve();
    });
  });
}

console.log('\n--- ffmpeg playback through each proxy variant ---');
for (const [mode, port] of Object.entries(ports)) {
  await testPlayback(`deep=${mode}`, `http://127.0.0.1:${port}/file.mkv`);
}
await testPlayback('direct-200', 'http://127.0.0.1:47001/file.mkv');

process.exit(0);
