// ZXCStream Scraper for Nuvio Local Scrapers
// ---------------------------------------------------------------
// Task 55 REWRITE — the site migrated its API and its OLD integration became
// a user-facing bug: the fallback card shipped the player PAGE URL
// (https://player.zxcstream.xyz/embed/movie/<id>) as a "stream" — an HTML
// page mpv/Stremio cannot play (user report: "Zxcstreams showing mpv error").
// That card is GONE: this provider now ships ONLY real extracted media URLs,
// and returns [] when nothing playable can be resolved (honest zero).
//
// CURRENT PROTOCOL (recovered live 2026-09-18 from the deployed player bundle,
// chunk _next/static/chunks/17.xyfizyv1uh.js + 0pe_jpahr9cn8.js):
//   1. fToken = sha512(`${ts}:${SECRET}:${tmdbId}`).slice(0,64)   ts=Date.now()
//      SECRET is now "23423653" (was "24356351231432574635345245245252324")
//   2. POST /backend/a1b2c3   body keys are OBFUSCATED (FIELD_MAP below, also
//      verbatim from the bundle) and the endpoint REQUIRES the page `path` and
//      `mediaType` fields (verified live: without them → 400 "Invalid request",
//      with them → 200 {token, ts}). Response keys observed PLAIN ("token",
//      "ts") — both plain and FIELD_MAP spellings are read.
//      NOTE: the site's OWN frontend currently POSTs without path/mediaType and
//      gets 400 — verified in a real browser session (agent-browser, 2026-09-18);
//      their bundle is behind their backend. Our request shape is the backend's,
//      not the broken bundle's.
//   3. GET /backend_/embed/sentinel?id=<F.id>&b=movie|tv&ts=<serverTs>&token=<t>&fToken=<fToken>
//      [+ F.season/F.episode for tv, + F.imdbId when known] → {embed}
//      (live 2026-09-18: this endpoint 502s site-wide — their backend origin is
//      down; we return [] until it recovers. The token stage IS verified 200.)
//   4. The embed is a 3rd-party player page (iframe class). We fetch it and
//      extract REAL media URLs (.m3u8/.mp4) server-side. Only extracted media
//      ships — the embed/player HTML itself NEVER ships (zero-html rule).
//
// No Playwright, no FlareSolverr — plain fetch() + crypto.

"use strict";

var crypto = require("crypto");

var PROVIDER_NAME = "ZXCStream";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
var BASE_URL = "https://player.zxcstream.xyz";

var USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

// Verbatim from the deployed player bundle (chunk 17.xyfizyv1uh.js, module 55790).
var SECRET = "23423653";
var FIELD_MAP = {
  id: "a7f39c821d604e5b9c7143f36e1547b",
  fToken: "e83c4b719a52d8f3136052479c1635a",
  ts: "61d9a5274c8e3b29af75d6384c291e6",
  token: "c492f7a183d6502b1e7436c538a716d",
  title: "5e28c9147a306d531e829f3674b392a1",
  year: "b731e6c94f082a169d725f8341c306e",
  season: "d8427b59ce30684a2f957c3613e85b",
  episode: "91c6e4a728bd503d1f785c92346b713d",
  imdbId: "f35a8c19d674b3265e871c4933a725f",
  path: "6b491e7253ad8f14d392e7561a9384c",
  mediaType: "c285f91ab306d281e947a35632e816b",
  date: "e164932c50216ad739e5814b3027",
  latestDate: "e16932c54356416ad739e5814b3027",
};

function generateFrontendToken(tmdbId) {
  var ts = Date.now();
  // Task 57: hash the id as STRING — byte-identical to the site frontend
  // (route params are strings; `${i}:${r}:${t}` string-concatenates them).
  var input = ts + ":" + SECRET + ":" + String(tmdbId);
  var xt = crypto.createHash("sha512").update(input).digest("hex").slice(0, 64);
  return { xt: xt, rt: ts };
}

function getTMDBInfo(tmdbId, type) {
  var endpoint = type === "tv" ? "tv" : "movie";
  var url = "https://api.themoviedb.org/3/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
  return fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8000) })
    .then(function (r) { return r.text(); })
    .then(function (body) {
      var d = JSON.parse(body);
      if (!d || d.success === false) return null;
      return {
        title: type === "tv" ? d.name : d.title,
        year: ((d.first_air_date || d.release_date || "") + "").split("-")[0],
        imdbId: (d.external_ids && d.external_ids.imdb_id) || (d.imdb_id || ""),
        type: type
      };
    })
    .catch(function () { return null; });
}

// Stage 1+2: token POST → sentinel GET → { embed } | null. Every fetch is
// status-checked; a failure at any stage returns null (the caller ships []).
function tryGetEmbedUrl(tmdbId, type, season, episode, imdbId) {
  var idNum = parseInt(tmdbId, 10);
  if (!idNum) return Promise.resolve(null);
  var tokenData = generateFrontendToken(idNum);
  var isTv = type === "tv";
  // Task 57 (2026-09-19): site redeployed — token route /backend/a1b2c3 is GONE
  // (404); new route /backend/abaygagoka. The new frontend POSTs ONLY
  // {id, fToken, ts} — the previously-required path/mediaType fields are no
  // longer sent (bundle emb_12.-a.xn1yxai.js + module 55790 extracted live).
  // SECRET + FIELD_MAP are UNCHANGED ("23423653" + same hex field names).
  // Referer/Origin headers kept — harmless and matches the site's axios call.
  var pagePath = BASE_URL + "/embed/" + (isTv ? "tv" : "movie") + "/" + idNum;

  // Task 57: the new frontend sends the id as a STRING (route params are
  // strings) and generateFrontendToken hashes the same string — captured from
  // a live browser session (agent-browser). Byte-identical to the site.
  var tokenBody = {
    [FIELD_MAP.id]: String(idNum),
    [FIELD_MAP.fToken]: tokenData.xt,
    [FIELD_MAP.ts]: tokenData.rt,
  };

  return fetch(BASE_URL + "/backend/abaygagoka", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "Referer": pagePath,
      "Origin": BASE_URL,
    },
    body: JSON.stringify(tokenBody),
    signal: AbortSignal.timeout(8000),
  })
    .then(function (r) {
      if (!r.ok) { console.log("[ZXCStream] token POST " + r.status); return null; }
      return r.json();
    })
    .then(function (j) {
      if (!j) return null;
      var token = j[FIELD_MAP.token] || j.token;
      var serverTs = j[FIELD_MAP.ts] || j.ts;
      if (!token || !serverTs) { console.log("[ZXCStream] token response missing fields"); return null; }

      var q = new URLSearchParams();
      q.set(FIELD_MAP.id, String(idNum));
      q.set("b", isTv ? "tv" : "movie");
      q.set(FIELD_MAP.ts, String(serverTs));
      q.set(FIELD_MAP.token, String(token));
      q.set(FIELD_MAP.fToken, tokenData.xt);
      if (isTv && season) { q.set(FIELD_MAP.season, String(season)); q.set(FIELD_MAP.episode, String(episode || 1)); }
      if (imdbId) q.set(FIELD_MAP.imdbId, String(imdbId));

      return fetch(BASE_URL + "/backend_/embed/sentinel?" + q.toString(), {
        headers: { "User-Agent": USER_AGENT, "Referer": pagePath },
        signal: AbortSignal.timeout(8000),
      }).then(function (r2) {
        if (!r2.ok) { console.log("[ZXCStream] sentinel " + r2.status + " (site backend down = expected during their outage)"); return null; }
        return r2.json();
      }).then(function (j2) {
        if (j2 && typeof j2.embed === "string" && /^https?:\/\//.test(j2.embed)) return j2.embed;
        return null;
      });
    })
    .catch(function (e) {
      console.log("[ZXCStream] embed flow failed: " + (e && e.message ? e.message : e));
      return null;
    });
}

// Stage 3: fetch the embed PLAYER PAGE and pull out REAL media URLs. Only
// direct .m3u8/.mp4 references ship — never the page itself.
function extractFromEmbed(embedUrl) {
  return fetch(embedUrl, {
    headers: { "User-Agent": USER_AGENT, "Referer": BASE_URL + "/" },
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
  })
    .then(function (r) {
      if (!r.ok) { console.log("[ZXCStream] embed page " + r.status); return []; }
      return r.text();
    })
    .then(function (html) {
      if (!html) return [];
      var found = [];
      var seen = new Set();
      // Direct media references in the page (player configs, source arrays).
      var rx = /https?:\/\/[^"'\s\\<>]+?\.(?:m3u8|mp4)(?:\?[^"'\s\\<>]*)?/gi;
      var m;
      while ((m = rx.exec(html)) !== null) {
        var u = m[0].replace(/&amp;/g, "&");
        if (seen.has(u)) continue;
        seen.add(u);
        found.push(u);
        if (found.length >= 6) break;
      }
      if (found.length === 0) {
        console.log("[ZXCStream] embed page carried no direct media URLs (player uses a JS API — not server-extractable)");
      }
      return found;
    })
    .catch(function (e) {
      console.log("[ZXCStream] embed fetch failed: " + (e && e.message ? e.message : e));
      return [];
    });
}

function getStreams(tmdbId, type, season, episode) {
  var isMovie = type !== "tv";
  console.log("[ZXCStream] Request: tmdb=" + tmdbId + " type=" + type +
    (isMovie ? "" : " S" + season + "E" + episode));

  return getTMDBInfo(tmdbId, type)
    .then(function (info) {
      if (!info || !info.title) {
        console.log("[ZXCStream] Could not resolve TMDB info");
        return [];
      }
      console.log("[ZXCStream] TMDB: " + info.title + " (" + info.year + ")");

      return tryGetEmbedUrl(tmdbId, type, season, episode, info.imdbId)
        .then(function (embedUrl) {
          if (!embedUrl) {
            // Task 55: NO player-page fallback. The old fallback shipped an
            // HTML page as a "stream" — guaranteed mpv error for the user.
            // Honest zero until the site's backend serves an embed again.
            console.log("[ZXCStream] No embed resolved — returning 0 streams (no broken cards)");
            return [];
          }
          console.log("[ZXCStream] Got embed URL: " + embedUrl.slice(0, 80));
          return extractFromEmbed(embedUrl).then(function (mediaUrls) {
            var titleLine = info.title + (isMovie ? "" : " S" + String(season || 1).padStart(2, "0") + "E" + String(episode || 1).padStart(2, "0")) + " (" + info.year + ")";
            var streams = mediaUrls.map(function (u) {
              var isHls = /\.m3u8/i.test(u);
              return {
                name: PROVIDER_NAME + " - " + (isHls ? "HLS" : "Direct"),
                title: titleLine,
                url: u,
                quality: "HD",
                type: isHls ? "hls" : "mp4",
                headers: { "User-Agent": USER_AGENT, "Referer": embedUrl },
                behaviorHints: { bingeGroup: "zxcstream-" + (isHls ? "hls" : "mp4") }
              };
            });
            console.log("[ZXCStream] Returning " + streams.length + " extracted stream(s)");
            return streams;
          });
        });
    })
    .catch(function (err) {
      console.log("[ZXCStream] Error: " + (err && err.message ? err.message : err));
      return [];
    });
}

module.exports = { getStreams: getStreams };
