// src/utils/prewarm.js — Task 45: idle-time catalog prewarm.
//
// WHY (production evidence, Sep 2026, Render 0.1-CPU free tier):
//   A cold /stream resolve of all 71 sources takes 33s+ of wall time, but the
//   client budget (Task 36) must answer in 15s. Fast sources land; multi-hop
//   chains (4khdhub/hdhub4uv2/moviesdrivev2 8-hop, Playwright sources) are
//   still mid-flight at t=15s and only reach the per-source caches AFTER the
//   user has already seen a 9-10-source partial. Re-opens only see the full
//   set when they land after the background continuation finished AND before
//   the per-source cache TTL expires. Users browsing fresh titles never get
//   the warm view.
//
// WHAT: a background loop that resolves the CURRENT TMDB trending titles
//   (what users overwhelmingly open first) through the addon's own /stream
//   endpoint while the instance is otherwise IDLE. Each self-request returns
//   at the 15s client budget (partial), and the resolver's built-in
//   background continuation fills the per-source caches — exactly the state
//   a real user's first open should find. Result: first open of any trending
//   title gets the FULL multi-source card set instantly, 4khdhub/hdhub4uv2
//   included.
//
// SAFETY (zero-breakage):
//   - Idle-gated: waits while globalThis.__phoenixLiveResolves > 0 (the
//     gauge index.js maintains around every resolve call) plus an 8s quiet
//     hysteresis, so a live user request NEVER competes with a prewarm start.
//   - One title in flight at a time + 20s gap between titles lets the
//     previous title's background continuation drain before the next.
//   - Auto-disabled when STREAM_CLIENT_BUDGET_MS is overridden (test/baseline
//     harnesses) or PHOENIX_PREWARM=0.
//   - Self-request goes over loopback HTTP to this same process; cards built
//     during prewarm are discarded (only Source.handle caches persist, which
//     hold upstream stream definitions — ctx.hostUrl-dependent card URLs are
//     rebuilt per real request, so no 127.0.0.1 leakage into user responses).
//   - Never throws: the whole loop is guarded; every fetch has a timeout.
'use strict';

import { TMDB_PRIMARY, TMDB_SECONDARY } from './site-secrets.cjs';

const TRENDING_TTL_MS = 10 * 60 * 1000;
const GAP_MS = 20 * 1000;
const BOOT_SETTLE_MS = 45 * 1000;
const ROTATION_PAUSE_MS = 10 * 60 * 1000;
const WARM_FETCH_TIMEOUT_MS = 45 * 1000; // response lands at the 15s budget

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function tmdbKey() {
  return TMDB_PRIMARY || TMDB_SECONDARY || '';
}

async function fetchTrending(kind, log) {
  const key = tmdbKey();
  if (!key) return [];
  const url = `https://api.themoviedb.org/3/trending/${kind}/week?api_key=${key}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) { log(`[prewarm] trending/${kind} HTTP ${res.status}`); return []; }
    const data = await res.json();
    return (data.results || []).map(r => r.id).filter(Boolean);
  } catch (e) {
    log(`[prewarm] trending/${kind} failed: ${String(e?.message || e).slice(0, 60)}`);
    return [];
  }
}

// Wait until no live user resolve is in flight, then keep waiting through an
// 8s quiet hysteresis so a burst of user requests never races a prewarm start.
async function waitIdle() {
  for (;;) {
    if ((globalThis.__phoenixLiveResolves || 0) === 0) {
      let quiet = true;
      for (let i = 0; i < 4; i++) {
        await sleep(2000);
        if ((globalThis.__phoenixLiveResolves || 0) > 0) { quiet = false; break; }
      }
      if (quiet) return;
    } else {
      await sleep(2000);
    }
  }
}

export function startPrewarm({ port, logger }) {
  const log = (msg) => { try { logger.log(msg); } catch { /* logger absent */ } };

  // Auto-off in test/baseline harnesses (they override the client budget) and
  // via explicit env kill-switch.
  if (process.env.PHOENIX_PREWARM === '0' || process.env.STREAM_CLIENT_BUDGET_MS) {
    log('[prewarm] disabled (env)');
    return null;
  }

  const maxTitles = Math.max(1, Math.min(30, parseInt(process.env.PHOENIX_PREWARM_TITLES, 10) || 12));
  const state = { running: false, passes: 0, warmed: 0, failed: 0, lastType: '', lastId: 0 };

  async function warmOne(type, tmdbId) {
    const url = `http://127.0.0.1:${port}/stream/${type}/tmdb:${tmdbId}.json`;
    const res = await fetch(url, {
      headers: { 'x-prewarm': '1', 'user-agent': 'PhoeniX-Prewarm/1' },
      signal: AbortSignal.timeout(WARM_FETCH_TIMEOUT_MS),
    });
    await res.arrayBuffer().catch(() => {});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function loop() {
    if (state.running) return;
    state.running = true;
    try {
      await sleep(BOOT_SETTLE_MS);
      for (;;) {
        const [movieIds, tvIds] = await Promise.all([
          fetchTrending('movie', log),
          fetchTrending('tv', log),
        ]);
        const plan = [
          ...movieIds.slice(0, maxTitles).map(id => ['movie', id]),
          ...tvIds.slice(0, maxTitles).map(id => ['series', id]),
        ];
        if (plan.length === 0) {
          log('[prewarm] no trending titles available; retrying in 10min');
          await sleep(ROTATION_PAUSE_MS);
          continue;
        }
        state.passes++;
        for (const [type, id] of plan) {
          await waitIdle();
          state.lastType = type; state.lastId = id;
          const t0 = Date.now();
          try {
            await warmOne(type, id);
            state.warmed++;
            log(`[prewarm] pass${state.passes} ${type} tmdb:${id} warmed in ${Date.now() - t0}ms (caches fill in background)`);
          } catch (e) {
            state.failed++;
            log(`[prewarm] pass${state.passes} ${type} tmdb:${id} skipped: ${String(e?.message || e).slice(0, 60)}`);
          }
          // Let this title's background continuation drain before the next.
          await sleep(GAP_MS);
        }
        log(`[prewarm] pass${state.passes} complete: ${plan.length} titles (${state.warmed} warmed, ${state.failed} skipped)`);
        await sleep(ROTATION_PAUSE_MS);
      }
    } catch (e) {
      log(`[prewarm] loop halted: ${String(e?.message || e).slice(0, 80)}`);
    } finally {
      state.running = false;
    }
  }

  loop();
  return state;
}
