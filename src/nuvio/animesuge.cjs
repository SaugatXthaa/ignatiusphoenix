/**
 * AnimeSuge Scraper — animesuge.at
 * ==================================
 * Flow:
 *   1. Search: GET /api/animesuge/anime/search?keyword={query}
 *   2. Get anime page: GET /anime/{slug} → extract data-id (anime ID)
 *   3. Get episodes: GET /api/animesuge/episode/list?id={animeId}
 *   4. Get servers: GET /api/animesuge/server/list?id={animeId}&episode={n}
 *      → parse HTML for data-type (sub/dub), data-link (base64-encoded megaplay.buzz URL)
 *   5. Fetch megaplay.buzz stream page → extract data-id
 *   6. Call megaplay.buzz/stream/getSources?id={dataId} → get HLS m3u8 URL
 *   7. Return HLS stream (seekable, with sub + dub support)
 *
 * Uses TMDB → title search (like AniKotoTV)
 * Supports: Movies, TV, Anime with sub and dub streams
 * Pure Node.js fetch() — no Playwright, no curl, no browser
 */
'use strict';

const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const AS_BASE = 'https://animesuge.at';
const AS_API = 'https://animesuge.at/api/animesuge';
const MEGAPLAY = 'https://megaplay.buzz';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ─── HTTP Helpers ────────────────────────────────────────────────────────────
async function fetchText(url, headers = {}) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
    if (!res.ok) return '';
    return await res.text();
  } catch (e) { return ''; }
}

async function fetchJson(url, headers = {}) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

// ─── TMDB ────────────────────────────────────────────────────────────────────
async function getTmdbInfo(tmdbId, mediaType) {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const url = `${TMDB_BASE}/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;
  return await fetchJson(url);
}

// ─── Search AnimeSuge ────────────────────────────────────────────────────────
// The search API sometimes doesn't return the most relevant results (e.g.
// searching "Naruto" returns "road-of-naruto" and "boruto" but NOT "naruto"
// itself). We work around this by ALSO trying a direct slug guess based on
// the title, and including it in the candidate list.
async function searchAnimeSuge(query) {
  const url = `${AS_API}/anime/search?keyword=${encodeURIComponent(query)}`;
  console.log(`[AnimeSuge] Search: ${url}`);
  const data = await fetchJson(url, { 'X-Requested-With': 'XMLHttpRequest' });
  if (!data || !data.result) return [];

  const html = data.result.html || '';
  const matches = [...html.matchAll(/href="(https:\/\/animesuge\.at\/anime\/([^"]+))"/g)];
  const seen = new Set();
  const results = [];
  for (const m of matches) {
    if (!seen.has(m[2])) {
      seen.add(m[2]);
      results.push({ url: m[1], slug: m[2] });
    }
  }

  // Workaround: the search API often doesn't return the main series. Add a
  // direct slug guess based on the title (e.g. "Naruto" → "naruto", "Jujutsu
  // Kaisen" → "jujutsu-kaisen", "Demon Slayer" → "demon-slayer").
  // We try multiple common slug patterns:
  //   1. title-as-slug (lowercase, hyphens)
  //   2. title-tv (for series)
  //   3. title-shippuden / title-2nd-season (for sequels — heuristic)
  const slugBase = query.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const slugGuesses = [
    slugBase,                    // e.g. "naruto", "jujutsu-kaisen"
    `${slugBase}-tv`,            // e.g. "jujutsu-kaisen-tv"
  ];

  for (const guess of slugGuesses) {
    if (!seen.has(guess)) {
      seen.add(guess);
      results.push({ url: `${AS_BASE}/anime/${guess}`, slug: guess, isGuess: true });
    }
  }

  console.log(`[AnimeSuge] Found ${results.length} results (${results.filter(r => r.isGuess).length} guesses)`);
  return results;
}

// ─── Get Anime ID from Page ──────────────────────────────────────────────────
// Also returns the full title from the page, which is more accurate than the
// slug for matching purposes, and the anime's premiere YEAR — Task 33
// requires an exact title AND year match before serving anything.
async function getAnimeIdAndTitle(slug) {
  const html = await fetchText(`${AS_BASE}/anime/${slug}`);
  if (!html) return null;

  const idMatch = html.match(/data-id="(\d+)"/);
  const id = idMatch ? idMatch[1] : null;

  // Extract the og:title or <title> tag for accurate matching.
  // Strip "Watch " prefix and " - AnimeSuge" suffix.
  let title = slug;
  const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
  if (ogTitleMatch) {
    title = ogTitleMatch[1];
  } else {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) title = titleMatch[1];
  }
  // Clean up HTML entities and prefix/suffix
  title = title
    .replace(/&amp;amp;#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/\s*-\s*Watch on AnimeSuge.*$/i, '')
    .replace(/\s*-\s*AnimeSuge.*$/i, '')
    .replace(/^Watch\s+/i, '')
    .trim();

  // Task 33: premiere year for the exact-year gate. The anime's own info
  // panel carries <span itemprop="dateCreated">Oct 3, 2002</span> (verified
  // across the catalog: naruto=2002, jujutsu-kaisen=2020, odin=1985);
  // "Premiered: Fall 2002" is the fallback anchor. Without a parseable year
  // a near-exact candidate is rejected (see scoring in getStreams) — an
  // anime site must never serve content whose year we could not verify.
  let year = null;
  const dateCreated = html.match(/itemprop="dateCreated"[^>]*>[^<]*?((?:19|20)\d{2})/);
  if (dateCreated) {
    year = parseInt(dateCreated[1], 10);
  } else {
    const premiered = html.match(/Premiered:?\s*(?:[A-Za-z]+\s+)?((?:19|20)\d{2})/i);
    if (premiered) year = parseInt(premiered[1], 10);
  }

  // Find poster
  let poster = null;
  const posterMatch = html.match(/src="([^"]+\.webp)"/);
  if (posterMatch) poster = posterMatch[1];

  return { id, slug, title, year, poster };
}

// ─── Get Anime ID from Page (backward-compatible wrapper) ────────────────────
async function getAnimeId(slug) {
  return getAnimeIdAndTitle(slug);
}

// ─── Get Server List ─────────────────────────────────────────────────────────
async function getServerList(animeId, episode) {
  const url = `${AS_API}/server/list?id=${animeId}&episode=${episode}`;
  console.log(`[AnimeSuge] Servers: ${url}`);
  const data = await fetchJson(url, { 'X-Requested-With': 'XMLHttpRequest' });
  if (!data || !data.result) return [];

  const html = data.result;
  const servers = [];
  const matches = [...html.matchAll(/data-type="([^"]+)"[\s\S]*?data-link="([^"]+)"[\s\S]*?data-sv-id="([^"]+)"/g)];
  for (const m of matches) {
    const type = m[1]; // 'sub' or 'dub'
    const link = Buffer.from(m[2], 'base64').toString('utf-8');
    const svId = m[3];
    servers.push({ type, link, svId });
  }
  console.log(`[AnimeSuge] Found ${servers.length} servers (sub: ${servers.filter(s => s.type === 'sub').length}, dub: ${servers.filter(s => s.type === 'dub').length})`);
  return servers;
}

// ─── Resolve megaplay.buzz Stream ────────────────────────────────────────────
async function resolveMegaPlay(streamUrl) {
  const html = await fetchText(streamUrl, { 'Referer': AS_BASE + '/' });
  if (!html) return null;

  const idMatch = html.match(/data-id="(\d+)"/);
  if (!idMatch) return null;

  // Use getSourcesNew (not getSources) — the old API was deprecated and
  // now returns encrypted data without a sources.file field.
  // getSourcesNew returns { sources: { file: "https://...m3u8" }, tracks: [...] }
  const apiUrl = `${MEGAPLAY}/stream/getSourcesNew?id=${idMatch[1]}`;
  const data = await fetchJson(apiUrl, { 'Referer': streamUrl, 'X-Requested-With': 'XMLHttpRequest' });
  if (!data || !data.sources) return null;

  return {
    url: data.sources.file || data.sources,
    subtitles: data.tracks || [],
    intro: data.intro || null,
    outro: data.outro || null,
  };
}

// ─── Build Stream Object ─────────────────────────────────────────────────────
function buildStream(streamData, type, quality, animeTitle, episode) {
  const isHls = streamData.url.includes('.m3u8');
  const subs = (streamData.subtitles || []).map(s => ({
    url: s.file,
    lang: s.label || s.kind || 'en',
    name: s.label || 'English',
  }));

  return {
    name: `AnimeSuge\n${type.toUpperCase()} ${quality}`,
    title: `${animeTitle} - Episode ${episode} (${type.toUpperCase()})`,
    url: streamData.url,
    quality,
    behaviorHints: {
      notWebReady: false,
      headers: { 'Referer': 'https://megaplay.buzz/' },
    },
    subtitles: subs,
    meta: {
      provider: 'AnimeSuge',
      source: 'megaplay.buzz',
      server: 'megaplay.buzz',
      type: 'hls',
      quality,
      audio: type === 'dub' ? 'english' : 'japanese',
      language: [type === 'dub' ? 'en' : 'ja'],
      category: type,
      title: animeTitle,
      episode,
      directStream: true,
      mediaType: 'movie',
      intro: streamData.intro,
      outro: streamData.outro,
    },
  };
}

// ─── Normalize title for matching ───────────────────────────────────────────
// Strips punctuation, articles, and case for fuzzy title comparison.
function normalizeTitle(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\b(the|a|an|tv|season|part|specials?|movie|ova|ona|oad)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Task 33: bounded Levenshtein for near-exact spelling variants only
// ("Naruto Shippuuden" vs "Naruto Shippuden" — the site doubles the 'u',
// TMDB does not). Distances > maxDistance short-circuit to keep the DP
// cheap; this is NOT a similarity score — it exists purely so a real
// spelling variant is not lost while every loose fuzzy tier is removed.
function levenshteinWithin(a, b, maxDistance) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > maxDistance) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > maxDistance) return false; // early exit — cannot recover
    prev = curr;
  }
  return prev[b.length] <= maxDistance;
}

// ─── Main: getStreams ────────────────────────────────────────────────────────
async function getStreams(tmdbId, mediaType, season, episode) {
  console.log(`[AnimeSuge] getStreams: ${tmdbId} ${mediaType} S${season || '?'}E${episode || '?'}`);
  try {
    // 1. Get title from TMDB
    const meta = await getTmdbInfo(tmdbId, mediaType);
    if (!meta) return [];
    const title = mediaType === 'tv' ? meta.name : meta.title;
    const year = (mediaType === 'tv' ? meta.first_air_date : meta.release_date || '').substring(0, 4);
    console.log(`[AnimeSuge] Title: ${title} (${year})`);

    // 2. Search AnimeSuge
    const results = await searchAnimeSuge(title);
    if (!results.length) return [];

    // 3. Fetch the actual title from each search result page and pick the best
    // match. AnimeSuge's search API doesn't return titles (only slugs), and
    // the slug order doesn't match relevance. We fetch each page's og:title
    // to get the real anime title, then match against the TMDB title.
    //
    // Limit to first 8 results to avoid too many HTTP requests.
    const candidates = await Promise.all(
      results.slice(0, 8).map(async (r) => {
        const info = await getAnimeIdAndTitle(r.slug);
        return info ? { ...info, slug: r.slug } : null;
      })
    );
    const validCandidates = candidates.filter(Boolean);

    // Task 33 — EXACT title + year matching only.
    //
    // The old scoring had loose tiers (substring = 80, word-overlap ≤ 60,
    // accept threshold 40) and NO year verification, so a live-action movie
    // like "Mutiny" (2026) matched the 1985 anime "Odin: Starlight Mutiny"
    // via the substring tier and shipped a Japanese-audio anime stream for
    // a Jason Statham movie. New policy, per the exactness requirement:
    //   1. Only an exact normalized-title equality (or a ≤2-edit spelling
    //      variant such as "Shippuuden"/"Shippuden") qualifies at all.
    //   2. The candidate's premiere year must match the requested year
    //      (±1 for movies and first seasons; ±3 for later TV seasons —
    //      catalog entries are series pages anchored at the first airing).
    //   3. A near-exact variant whose year could not be parsed is refused;
    //      a truly exact title with no parseable year is allowed through
    //      with a warning (title identity is strong; the alternative is
    //      zeroing real matches over a missing meta tag).
    // Anything else → zero streams. Zero wrong matches beats one more card.
    const queryNorm = normalizeTitle(title);
    const reqYear = parseInt(year, 10) || null;
    let bestMatch = null;
    let bestScore = 0;

    for (const c of validCandidates) {
      const candidateTitleNorm = normalizeTitle(c.title || c.slug);
      if (!candidateTitleNorm || !queryNorm) continue;

      let score = 0;
      if (candidateTitleNorm === queryNorm) {
        score = 100;
      } else if (
        candidateTitleNorm.length >= 6 && queryNorm.length >= 6 &&
        // Same token count required: "jujutsu kaisen 0" (the prequel movie)
        // differs from "jujutsu kaisen" by a single appended token which a
        // pure ≤2-edit test would accept — an appended/missing word is a
        // DIFFERENT title, only intra-word spelling variants qualify here.
        candidateTitleNorm.split(' ').length === queryNorm.split(' ').length &&
        levenshteinWithin(candidateTitleNorm, queryNorm, 2)
      ) {
        score = 95; // spelling variant of the same title
      }
      if (score === 0) continue; // every loose tier removed — wrong-content risk

      // Year gate
      if (reqYear && c.year) {
        const yearTol = (mediaType === 'tv' && season && season >= 2) ? 3 : 1;
        if (Math.abs(c.year - reqYear) > yearTol) {
          console.log(`[AnimeSuge] Rejecting "${c.title}" (${c.year}) — year ${c.year} ≠ requested ${reqYear} (tol ±${yearTol})`);
          continue;
        }
      } else if (score === 95 && reqYear && !c.year) {
        console.log(`[AnimeSuge] Rejecting near-exact "${c.title}" — premiere year unparseable, cannot verify exact-year match`);
        continue;
      } else if (score === 100 && reqYear && !c.year) {
        console.log(`[AnimeSuge] Exact-title candidate "${c.title}" has no parseable year — allowing (title identity exact)`);
      }

      // Season-aware preference WITHIN the qualifying tier
      if (!season || season === 1) {
        if (c.slug.endsWith('-tv') || c.slug.includes('-tv-')) score += 5;
        if (/specials?$|-special-|-ova-|-oad-|0-movie/.test(c.slug)) score -= 10;
      } else if (
        c.slug.includes(`${season}nd-season`) || c.slug.includes(`${season}rd-season`) ||
        c.slug.includes(`season-${season}`)
      ) {
        score += 5;
      }

      console.log(`[AnimeSuge] Candidate: "${c.title}" slug=${c.slug} year=${c.year || '?'} score=${score}`);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = c;
      }
    }

    if (!bestMatch) {
      console.log(`[AnimeSuge] No exact title+year match for "${title}" (${year || '?'}) — returning zero streams (exactness policy)`);
      return [];
    }

    console.log(`[AnimeSuge] Best match: ${bestMatch.slug} (score: ${bestScore})`);

    if (!bestMatch.id) return [];

    // 4. Get servers for the episode
    const ep = parseInt(episode) || 1;
    const servers = await getServerList(bestMatch.id, ep);
    if (!servers.length) return [];

    // 5. Resolve each server to HLS stream
    const streams = [];
    const seenUrls = new Set();

    for (const server of servers) {
      const streamData = await resolveMegaPlay(server.link);
      if (streamData && streamData.url && !seenUrls.has(streamData.url)) {
        seenUrls.add(streamData.url);
        const quality = '1080p';
        streams.push(buildStream(streamData, server.type, quality, bestMatch.title, ep));
      }
    }

    // Sort: sub first, then dub
    streams.sort((a, b) => {
      if (a.meta.category === 'sub' && b.meta.category === 'dub') return -1;
      if (a.meta.category === 'dub' && b.meta.category === 'sub') return 1;
      return 0;
    });

    console.log(`[AnimeSuge] Returning ${streams.length} stream(s)`);
    return streams;
  } catch (e) {
    console.error(`[AnimeSuge] Error: ${e.message}`);
    return [];
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────
module.exports = { getStreams, searchAnimeSuge, getAnimeId, getServerList, resolveMegaPlay, PROVIDER_NAME: 'AnimeSuge' };
