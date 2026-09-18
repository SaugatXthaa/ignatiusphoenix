// src/utils/playbackGate.cjs
//
// Task 54 — PLAYBACK PRIORITY GATE.
//
// Root cause of "every source stuck on the loading screen" (production,
// Render free tier, Sep 2026): the /stream endpoint returns at the 13s client
// budget, but the sources that missed the budget keep resolving in the
// background at FULL concurrency (up to 15 concurrent chains, minutes-class
// on the 0.1-CPU instance). When the user taps a stream card DURING that
// window, the player's /proxy + /range-proxy requests (playlist, init
// segment, media segments) queue behind that background work and the player
// hangs on the loading screen until it times out — for EVERY source, because
// every card is served through the same saturated instance.
//
// Proof (Task 54, sun.peakstorm.top/r6/*.m3u8 through /proxy):
//   during background churn:  0 bytes in 20s (client abort)
//   75s later, instance idle: 200 + 653KB in 1.08s
//
// The gate is a counter of in-flight playback requests. The StreamResolver's
// post-budget (background) source starts wait for a quiet window before
// beginning new upstream work. In-budget (client-facing) resolves are NEVER
// gated — only background tail work yields.

let pressure = 0;
let lastReleaseAt = 0;

/** Called when a /proxy or /range-proxy request starts serving. */
function begin() {
  pressure++;
}

/** Called when a /proxy or /range-proxy request finished (success or error). */
function end() {
  pressure = Math.max(0, pressure - 1);
  lastReleaseAt = Date.now();
}

/** Current in-flight playback request count. */
function pressureNow() {
  return pressure;
}

/**
 * Resolve `true` as soon as no playback request has been in flight for
 * `settleMs` (hysteresis so background work doesn't start-stop between
 * consecutive HLS segment fetches). Bounded by `maxMs` — resolves `false`
 * on timeout so background work still progresses (at reduced concurrency)
 * during very long continuous playback.
 */
async function quiet(maxMs = 60000, settleMs = 1500) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (pressure === 0 && Date.now() - lastReleaseAt >= settleMs) return true;
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

module.exports = { begin, end, pressureNow, quiet };
