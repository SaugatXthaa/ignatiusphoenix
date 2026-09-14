// health_watch.mjs — cron-style periodic health check for the PhoeniX addon.
//
// Runs scripts/task23_baseline.mjs (the committed regression suite: decrypt
// self-tests, videasyto speed/magic, boot + merged catalogs + anime matrix,
// source-level guards) on a fixed interval, and writes:
//   - download/health_reports/health_YYYY-MM-DD_HHMM.json  (full report)
//   - download/health_reports/health_YYYY-MM-DD_HHMM.md    (human-readable)
//   - download/health_log.txt                              (one line per run)
//
// Usage:
//   node scripts/health_watch.mjs                 # loop forever, 6h interval
//   HEALTH_INTERVAL_HOURS=12 node scripts/health_watch.mjs
//   RUN_ONCE=1 node scripts/health_watch.mjs      # single run (for cron/cron-tool use)
//
// Stop: kill $(cat /tmp/phoenix_health_watch.pid)

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..');
const REPORT_DIR = process.env.HEALTH_REPORT_DIR || '/home/z/my-project/download/health_reports';
const LOG_FILE = process.env.HEALTH_LOG_FILE || '/home/z/my-project/download/health_log.txt';
const INTERVAL_MS = (parseFloat(process.env.HEALTH_INTERVAL_HOURS || '6') || 6) * 3600 * 1000;
const LOCK_FILE = '/tmp/phoenix_health_watch.running';
const PID_FILE = '/tmp/phoenix_health_watch.pid';

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(PID_FILE, String(process.pid));

function ts() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function logLine(s) {
  const line = `[${new Date().toISOString()}] ${s}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function runBaseline() {
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn('node', ['scripts/task23_baseline.mjs'], {
      cwd: REPO,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 15 * 60 * 1000);
    child.on('close', code => {
      clearTimeout(killer);
      resolve({ code, durationMs: Date.now() - t0, out });
    });
  });
}

function parseResults(out) {
  const results = [...out.matchAll(/\[(PASS|FAIL)\] (.*?)(?:\s—\s(.*))?$/gm)]
    .map(m => ({ status: m[1], name: m[2], detail: (m[3] || '').trim() }));
  const summary = out.match(/=== RESULT: (\d+) PASS \/ (\d+) FAIL ===/);
  return { results, pass: summary ? +summary[1] : results.filter(r => r.status === 'PASS').length, fail: summary ? +summary[2] : results.filter(r => r.status === 'FAIL').length };
}

function writeReport(run) {
  const { pass, fail, durationMs, results } = run;
  const stamp = ts();
  const base = path.join(REPORT_DIR, `health_${stamp}`);
  const report = {
    timestamp: new Date().toISOString(),
    pass, fail,
    durationMs,
    verdict: fail === 0 ? 'HEALTHY' : (fail <= 2 ? 'DEGRADED' : 'UNHEALTHY'),
    results,
  };
  fs.writeFileSync(base + '.json', JSON.stringify(report, null, 2));

  const lines = [
    `# PhoeniX Health Report — ${new Date().toISOString()}`,
    ``,
    `**Verdict: ${report.verdict}** — ${pass} PASS / ${fail} FAIL in ${Math.round(durationMs / 1000)}s`,
    ``,
    `| Status | Check | Detail |`,
    `|--------|-------|--------|`,
    ...results.map(r => `| ${r.status} | ${r.name} | ${r.detail.replace(/\|/g, '/')} |`),
    ``,
  ];
  fs.writeFileSync(base + '.md', lines.join('\n'));
  return { base, verdict: report.verdict };
}

async function runCycle(trigger) {
  if (fs.existsSync(LOCK_FILE)) {
    logLine(`(${trigger}) previous run still in progress — skipping this cycle`);
    return;
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  try {
    logLine(`(${trigger}) starting baseline run…`);
    const { code, durationMs, out } = await runBaseline();
    const { pass, fail, results } = parseResults(out);
    const { base, verdict } = writeReport({ pass, fail, durationMs, results });
    logLine(`(${trigger}) ${verdict} — ${pass} PASS / ${fail} FAIL in ${Math.round(durationMs / 1000)}s -> ${base}.md`);
    if (fail > 0) {
      results.filter(r => r.status === 'FAIL').forEach(r => logLine(`    FAIL: ${r.name} (${r.detail})`));
    }
    if (code !== 0 && fail === 0) logLine(`    (note) baseline exited ${code} but reported 0 failures`);
  } finally {
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  }
}

function cleanup() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
  try { fs.unlinkSync(PID_FILE); } catch {}
  process.exit(0);
}
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// ─── main ───
const runOnce = process.env.RUN_ONCE === '1';
await runCycle(runOnce ? 'run-once' : 'startup');
if (!runOnce) {
  logLine(`watcher active — next runs every ${Math.round(INTERVAL_MS / 3600000)}h (pid ${process.pid})`);
  setInterval(() => runCycle('scheduled'), INTERVAL_MS);
}
