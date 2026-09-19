// src/utils/subtitle-normalize.cjs — Task 60
//
// toWebVtt(text): normalize an SRT or WebVTT subtitle payload into VALID
// WebVTT served as text/vtt.
//
// Why: the natsuki provider (natsuki.hls.lol) ships .srt files with MALFORMED
// timestamps ("0:00:00,00" — hours not zero-padded, only 2 millisecond
// digits) and text/plain content-type. mpv's SRT parser accepts
// HH:MM:SS,mmm strictly — malformed cues collapse to zero-length or get the
// whole track rejected, which users see as "subtitles not working" on every
// source that proxies these files through /proxy. Converting to normalized
// WebVTT (comma→dot, zero-padded HH:MM:SS.mmm, WEBVTT header) makes every
// track load correctly in Stremio's players on all platforms.
//
// Idempotent: valid WebVTT input passes through with timestamps normalized
// (no double header, cue text untouched). SRT input: sequence-number lines
// are dropped, WEBVTT header prepended. Nothing else (fonts, markup,
// positioning) is touched.

function pad(n, w) {
  return String(n).padStart(w, '0');
}

// "0:00:05,00" / "00:00:05.000" / "0:00:05" → "00:00:05.000"
function normalizeTimestamp(ts) {
  const t = ts.trim().replace(',', '.');
  const m = /^(?:(\d+):)?(\d+):(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const mm = parseInt(m[2], 10);
  const ss = parseInt(m[3], 10);
  let ms = m[4] || '0';
  // Truncate or pad the fractional part to exactly 3 digits (SRT often has 2)
  ms = (ms + '000').slice(0, 3);
  return `${pad(h, 2)}:${pad(mm, 2)}:${pad(ss, 2)}.${ms}`;
}

// Convert SRT cue blocks into WebVTT text lines. Returns [] when the input
// doesn't look like SRT at all (no timed blocks).
function srtBlocksToVttLines(text) {
  const out = [];
  const blocks = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n{2,}/);
  let found = 0;
  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) continue;
    // Skip a sequence-number first line
    let i = 0;
    if (/^\d+$/.test(lines[0].trim())) i = 1;
    if (i >= lines.length) continue;
    const tm = lines[i].match(/([0-9:,\.]+)\s*-->\s*([0-9:,\.]+)/);
    if (!tm) continue; // not a cue line — block without timestamps, skip
    const start = normalizeTimestamp(tm[1]);
    const end = normalizeTimestamp(tm[2]);
    if (!start || !end) continue;
    out.push(`${start} --> ${end}`);
    for (let k = i + 1; k < lines.length; k++) out.push(lines[k]);
    out.push('');
    found++;
  }
  return found > 0 ? out : null;
}

// Normalize WebVTT timestamps in already-VTT input (fixes 2-digit ms and
// comma decimals some upstreams emit) while preserving the rest verbatim.
function normalizeVttTimestamps(text) {
  return text.replace(/(\d{1,2}:)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/g, (full, h, m, s, ms) => {
    return `${pad(parseInt(h ? h.replace(':', '') : '0', 10), 2)}:${pad(parseInt(m, 10), 2)}:${pad(parseInt(s, 10), 2)}.${(ms + '000').slice(0, 3)}`;
  });
}

function toWebVtt(text) {
  const src = String(text || '');
  if (!src.trim()) return 'WEBVTT\n';

  const isVtt = /^\uFEFF?WEBVTT/.test(src.trimStart());
  if (isVtt) {
    // Ensure a standalone "WEBVTT" header line exists, normalize timestamps.
    let body = src.replace(/^\uFEFF/, '');
    // Some upstreams serve "WEBVTT" glued to content or missing entirely
    if (!/^WEBVTT\s*($|\n)/m.test(body.split('\n')[0])) {
      body = 'WEBVTT\n' + body;
    }
    return normalizeVttTimestamps(body);
  }

  const lines = srtBlocksToVttLines(src);
  if (lines) return 'WEBVTT\n\n' + lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

  // Unknown format — serve as plain VTT so the player at least tries.
  return 'WEBVTT\n\n' + normalizeVttTimestamps(src.replace(/^\uFEFF/, ''));
}

module.exports = { toWebVtt, normalizeTimestamp };
