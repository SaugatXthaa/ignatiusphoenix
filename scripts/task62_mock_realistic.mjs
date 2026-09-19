// Task 62 realistic mock: SLOW streaming open (like production ~2MB/s), variants on the deep seek.
import http from 'http';
import fs from 'fs';

const media = fs.readFileSync('/tmp/t62/test_padded.mkv');
const mediaSize = media.length;
const CHUNK = 64 * 1024;
const MS_PER_CHUNK = 30; // ~2MB/s

function streamSlow(req, res, status, headers) {
  res.writeHead(status, headers);
  let sent = 0;
  const timer = setInterval(() => {
    if (res.destroyed) { clearInterval(timer); return; }
    const end = Math.min(sent + CHUNK, mediaSize);
    res.write(media.subarray(sent, end));
    sent = end;
    if (sent >= mediaSize) { clearInterval(timer); res.end(); }
  }, MS_PER_CHUNK);
  req.on('close', () => clearInterval(timer));
}

// upstream: google-like (ignores Range, always 200 from byte 0, slow)
const upstream = http.createServer((req, res) => {
  streamSlow(req, res, 200, { 'Content-Type': 'video/x-matroska', 'Content-Length': String(mediaSize) });
});
upstream.listen(47001);

function makeProxy(mode) {
  return http.createServer((req, res) => {
    const range = req.headers.range;
    let start = 0;
    if (range) { const m = String(range).match(/bytes=(\d*)-(\d*)/); if (m && m[1]) start = parseInt(m[1], 10); }
    console.log(`[${mode}] range=${range || '-'} -> ${start === 0 ? 'OPEN' : 'SEEK ' + start}`);
    const open = !range || start === 0;
    if (open) {
      streamSlow(req, res, 206, {
        'Content-Type': 'video/x-matroska',
        'Content-Length': String(mediaSize),
        'Content-Range': `bytes 0-${mediaSize - 1}/${mediaSize}`,
        'Accept-Ranges': 'bytes',
      });
      return;
    }
    if (mode === 'close') { res.destroy(); return; }
    if (mode === 'skip-realistic') {
      // byte-skip 24MB-budget emulation: discard then serve (deep seek = 61MB > budget → treat as close)
      res.destroy(); return;
    }
  });
}
const ports = { 'close': 47105 };
for (const [mode, port] of Object.entries(ports)) makeProxy(mode).listen(port);
console.log('realistic mock up');
setInterval(() => {}, 60000);
