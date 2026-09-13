// src/utils/site-secrets.cjs
// ─── Central registry of site-extracted credentials (hardening plan §3.1) ───
//
// Single source of truth for every secret the addon replays/fabricates against
// upstream sites. Policy (see download/hardening_plan.md §2-3):
//   - env override FIRST, in-repo default SECOND — zero-config deploys keep
//     working; private deployments can bring their own values.
//   - When a site rotates a secret, change it HERE, once.
//   - These are NOT the maintainer's secrets: every value was reverse-
//     engineered out of a public site/app. The registry exists for rotation
//     ergonomics and auditability, not for hiding (client-side "hiding" in a
//     public repo is obfuscation, not security — plan §4).
//
// CJS ON PURPOSE: loadable from ESM sources (`import { X } from
// '../utils/site-secrets.cjs'`) AND from the require()-loaded
// src/nuvio/*.cjs providers (`require('../utils/site-secrets.cjs')`).
//
// Provenance + extraction method per value: download/secrets_inventory.json
// (machine-readable) and download/SECRETS.md (human-readable rotation table).

'use strict';

const env = (name, fallback) => process.env[name] || fallback;

// ── Class A — shared/community TMDB v3 keys (public by design) ──────────────
// The Stremio community's shared keys; upstream projects ship the same values.
// Consolidated for rotation, not secrecy. Real exposure is TMDB-side rate
// limiting. Full key census (7 distinct): secrets_inventory.json.
const TMDB_PRIMARY = env('TMDB_API_KEY', '439c478a771f35c05022f9feabcca01c'); // utils/tmdb.js canonical
const TMDB_SECONDARY = env('TMDB_API_KEY_2', '8476a7ab80ad76f0936744df0430e67c'); // stellar/hindmovie + 10 more
const TMDB_TERTIARY = env('TMDB_API_KEY_3', '1c29a5198ee1854bd5eb45dbe8d17d92'); // zxcstream/hdhub4u/vidlink family
// Registered only — consumed inside obfuscated/readable Gen-3 modules not yet
// wired here (rotation requires editing those modules directly today):
//   d80ba92b… (animeworld.cjs), 68e09469… (animesdigital.cjs, playimdb.cjs),
//   1865f43a… (cineby.cjs, uhdmovies.cjs), f3d75782… (purstream.cjs)

// ── Class B — site-extracted secrets (the real rotation watch-list) ─────────

// vidzee.wtf — SHA-256 → AES-256-GCM KEK for core.vidzee.wtf API-key decrypt
// (extracted from vidzee player bundle; consumer: src/extractor/Vidzee.js)
const VIDZEE_AES_SEED = env('VIDZEE_AES_SEED', '4f2a9c7d1e8b3a6f0d5c2e9a7b1f4d8c');

// stellar.gdn — AES-256-GCM key seed, hashed with the daily date
// (ROTATED upstream on 2026-09-02; extracted from stellar.gdn JS bundle;
// consumer: src/nuvio/stellar.cjs)
const STELLAR_GDN_KEY = env('STELLAR_GDN_KEY', 'KT1b67W1DU2ebpGxQkMiFVyz1iaP/PeMgv/xJQDdDoU=:');

// nhdapi.com — X-API-Key header (consumer: src/source/NowHDTime.js)
const NOWHDTIME_API_KEY = env('NOWHDTIME_API_KEY', '7d5239afc1d0a4fa374587d1d3feb1b0');

// player.zxcstream.xyz — sha512 token-flow salt (consumer: src/nuvio/zxcstream.cjs)
const ZXC_SALT = env('ZXC_SALT', '24356351231432574635345245245252324');

// streams.iqsmartgames.com — API token (consumer: src/nuvio/hindmovie.cjs)
const HINDMOVIE_TOKEN = env('HINDMOVIE_TOKEN', 'e11a7debaaa4f5d25b671706ffe4d2acb56efbd4');

// zokoanime.video / hianime.at — XOR key for the window.__P payload
// (consumers: src/source/AnimeKai.js, src/source/HiAnime.js)
const OTAKU_XOR_KEY = env('OTAKU_XOR_KEY', 'otaku-embed-v1');

// FlixCloud (reamime.to) — 16-byte XOR key decrypting HLS segment payloads
// (extracted from FlixCloud's hls.js fork; consumers: src/index.js
// /reanime-proxy route + src/nuvio/reanime.cjs — previously byte-identical
// duplicates in both files, now one constant)
const REANIME_SEG_KEY_BYTES = [157, 42, 241, 71, 179, 142, 92, 112, 166, 25, 228, 59, 216, 98, 15, 197];
function reanimeSegmentKey() {
  return Buffer.from(REANIME_SEG_KEY_BYTES);
}

// ── Class B — registered only (consumers are OBFUSCATED modules) ────────────
// Consumed inside javascript-obfuscator-packed src/nuvio/*.cjs modules —
// wiring is blocked until those modules are replaced by readable ports.
// Values are documented so rotation is a copy-paste, not an archaeology dig.

// anikototv — TVDB v4 API key (POST /v4/login → module-cached bearer)
// (extracted via deobfuscation of nuvio/anikototv.cjs)
const ANIKO_TVDB_KEY = env('ANIKO_TVDB_KEY', '777140fb-de92-440a-aec2-95eb51e2d7ab');

module.exports = {
  // Class A
  TMDB_PRIMARY, TMDB_SECONDARY, TMDB_TERTIARY,
  // Class B (wired)
  VIDZEE_AES_SEED, STELLAR_GDN_KEY, NOWHDTIME_API_KEY, ZXC_SALT,
  HINDMOVIE_TOKEN, OTAKU_XOR_KEY, reanimeSegmentKey,
  // Class B (registered — consumers obfuscated)
  ANIKO_TVDB_KEY,
};
