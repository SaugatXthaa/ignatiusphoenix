// src/utils/srlSeed.cjs — shared seed store for api.speedracelight.com consumers
//
// WHY THIS EXISTS (Task 40): the API ROTATES seeds on every /seed request.
// Two consumers fetching /seed?mediaId=<same id> in parallel (e.g. the VidKing
// extractor via speedracelight.js and the cineby source both starting in
// StreamResolver wave-1 for the same media) invalidate each other's seed
// mid-flight → "decrypt failed: bad seed" / HTTP 401 → each side refetches →
// invalidates the other again → retry cascades that blow the 30s wrapper race
// (reproduced on production TV: cineby Frieren 0 @30s while isolated runs
// delivered in ~7s).
//
// This module is a tiny process-wide store: a 25s TTL cache (server seed TTL
// is ~30s) plus an in-flight promise registry so concurrent /seed fetches for
// the SAME mediaId coalesce into ONE upstream request. Consumers keep their
// own fetch implementations (repo Fetcher vs global fetch) — only the store
// is shared.
//
// CJS on purpose: both ESM modules (speedracelight.js) and CJS providers
// (src/nuvio/cineby.cjs via createRequire) must be able to load it.

'use strict';

const SEED_TTL = 25_000;

const cache = new Map();   // key: String(tmdbId) → { seed, ts }
const inflight = new Map(); // key: String(tmdbId) → Promise<string>

function getCached(key) {
  const hit = cache.get(String(key));
  if (hit && Date.now() - hit.ts < SEED_TTL) return hit.seed;
  if (hit) cache.delete(String(key));
  return null;
}

function storeSeed(key, seed) {
  cache.set(String(key), { seed, ts: Date.now() });
}

function invalidateSeed(key) {
  cache.delete(String(key));
}

function getInFlight(key) {
  return inflight.get(String(key)) || null;
}

function setInFlight(key, promise) {
  inflight.set(String(key), promise);
}

function clearInFlight(key) {
  inflight.delete(String(key));
}

module.exports = {
  SEED_TTL,
  getCached,
  storeSeed,
  invalidateSeed,
  getInFlight,
  setInFlight,
  clearInFlight,
};
