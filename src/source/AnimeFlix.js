// src/source/AnimeFlix.js
// 9animes.me.uk (formerly animeflix.team — site migrated, old domain's search
// now only links here) — anime streaming site (series + anime movies)
// Same WordPress structure as 9anime.cl:
// Search: /?s={query} → anime page → episode links → episode page → iframe / base64 data-hash → embed URL

import * as cheerio from 'cheerio';
import { CountryCode } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';

// Shared candidate scorer (used by BOTH the wp-json and legacy search paths).
// Normalize typographic quotes — site headings use ’ (U+2019) while
// TMDB uses ' (U+0027). Without this, "Journey’s" never matches "Journey's".
function scoreCandidate(text, href, name, year) {
  const norm = (s) => s
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .trim();
  const nameLower = norm(name);
  const nameAscii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const textLower = norm(text);

  let score = 0;
  if (textLower === nameLower) score = 100;
  else if (textLower === nameAscii) score = 95;
  else if (textLower.includes(nameLower) || nameLower.includes(textLower)) {
    score = Math.min(textLower.length, nameLower.length) / Math.max(textLower.length, nameLower.length) * 90;
  }
  // Word-overlap fallback — handles TMDB titles that don't match any
  // site entry exactly (per-arc/per-season pages on anime sites).
  if (score < 50) {
    const nameWords = nameLower.split(/\s+/).filter(w => w.length > 2);
    const textWords = textLower.split(/\s+/).filter(w => w.length > 2);
    const common = nameWords.filter(w => textWords.includes(w));
    if (nameWords.length > 0 && common.length >= Math.min(nameWords.length, 2)) {
      const overlap = common.length / Math.max(nameWords.length, textWords.length);
      if (overlap >= 0.5) score = Math.max(score, overlap * 75);
    }
  }

  // Bonus for matching year
  if (score > 0 && year) {
    if (String(href).includes(String(year))) score += 5;
  }
  return score;
}

export class AnimeFlix extends Source {
  constructor(fetcher) {
    super();
    this.id = 'animeflix';
    this.label = 'AnimeFlix';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi, CountryCode.ja];
    this.baseUrl = 'https://9animes.me.uk';
    this.fetcher = fetcher;
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);
    const [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId);

    const candidates = await this.fetchAnimePageCandidates(ctx, name, year, tmdbId);
    if (candidates.length === 0) return [];

    const title = name + (tmdbId.season ? ` ${TmdbId.formatSeasonAndEpisode(tmdbId)}` : ` (${year})`);

    // Primary = best-scoring page (sub). If a DISTINCT "-dub" page also
    // scored above threshold, emit it as a second candidate so sub+dub
    // both ship (site lists them as separate /Anime/...-dub/ entries).
    const primary = candidates[0];
    const dub = candidates.find(c => /dub/i.test(c.href) && c.href !== primary.href);
    const chosen = dub ? [primary, dub] : [primary];

    const results = [];
    for (const cand of chosen) {
      try {
        const cards = await this.collectFromPage(ctx, cand, title, tmdbId, /dub/i.test(cand.href));
        results.push(...cards);
      } catch { /* one candidate failing must not kill the other */ }
    }
    return results;
  }

  // Extracts stream card(s) from one anime page (sub or dub variant):
  // anime page → episode link → episode page → direct iframe / data-hash iframes
  async collectFromPage(ctx, cand, title, tmdbId, isDub) {
    const animePageUrl = new URL(cand.href, this.baseUrl);
    const html = await this.fetcher.text(ctx, animePageUrl);
    const $ = cheerio.load(html);

    const cardTitle = isDub ? title + ' (Dub)' : title;

    // For movies (no season), get the first episode link
    // For series, find the matching episode
    let episodeUrl = null;

    if (tmdbId.season) {
      const epNum = tmdbId.episode || 1;
      // Boundary-aware match first: "episode-5/", "episode-5-" or "episode-5#"
      // but NOT "episode-50". DOM lists episodes DESCENDING, so the old naive
      // fallback (a[href*="episode-5"]) could grab episode-50 for episode 5.
      const epRe = new RegExp(`episode-${epNum}(?:/|-|#|$)`);
      const hrefs = $('a[href*="episode"]').map((_i, el) => $(el).attr('href')).get();
      const epLink = hrefs.find(h => h && epRe.test(h))
        || $(`a[href*="episode-${epNum}-"]`).first().attr('href')
        || $(`a[href*="episode-${epNum}"]`).first().attr('href');

      if (!epLink) return [];
      episodeUrl = new URL(epLink, this.baseUrl);
    } else {
      // Movie — get first episode link (last in list = episode 1)
      const firstEp = $(`a[href*="episode"]`).last().attr('href');
      if (!firstEp) return [];
      episodeUrl = new URL(firstEp, this.baseUrl);
    }

    // Fetch episode page to extract server data-hash (base64 iframe HTML)
    const epHtml = await this.fetcher.text(ctx, episodeUrl);
    const $ep = cheerio.load(epHtml);

    // Check for direct iframe first
    const directIframe = $ep('iframe').first().attr('src');
    if (directIframe) {
      return [{
        url: new URL(directIframe),
        meta: {
          countryCodes: [CountryCode.multi, CountryCode.ja],
          title: cardTitle,
          // Don't pass vidking for anime — speedracelight returns wrong content
        },
      }];
    }

    // Try data-hash attributes (base64-encoded iframe HTML)
    const results = [];
    const seenUrls = new Set();

    // Don't pass vidking for anime — speedracelight returns wrong content

    $ep('.server-item a[data-hash]').each((_i, el) => {
      const hash = $ep(el).attr('data-hash');
      if (!hash) return;
      try {
        const decoded = Buffer.from(hash, 'base64').toString('utf8');
        const iframeMatch = decoded.match(/src="([^"]+)"/);
        if (iframeMatch && iframeMatch[1]) {
          const url = iframeMatch[1].replace(/&amp;/g, '&');
          if (seenUrls.has(url)) return;
          seenUrls.add(url);
          results.push({
            url: new URL(url),
            meta: { countryCodes: [CountryCode.multi, CountryCode.ja], title: cardTitle },
          });
        }
      } catch { /* skip invalid base64 */ }
    });

    return results;
  }

  // Returns ALL anime pages matching the title above the acceptance
  // threshold, sorted best-first. Sub and dub variants are separate site
  // entries, so callers can emit both cards.
  //
  // Search strategy (Task 25): the site's ?s= HTML search now IGNORES the
  // query and returns the same latest-posts list for everything (same
  // upstream breakage class as moviesdrivev2's search.php in Task 24), so
  // the scored matcher refused every title → source went silent. The
  // WordPress REST search (/wp-json/wp/v2/search) still ranks properly, so
  // it is tried FIRST for every query variant; the legacy ?s= scrape is
  // kept as a fallback in case the REST endpoint ever goes away.
  async fetchAnimePageCandidates(ctx, name, year, tmdbId) {
    // Try multiple search queries — normalize special characters
    const queries = [
      name,
      name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
      name.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(),
    ].filter((q, i, arr) => q && arr.indexOf(q) === i);

    // ── primary: WordPress REST search (query is actually honored) ──
    const wpMatches = await this.wpJsonCandidates(ctx, queries, name, year);
    if (wpMatches.length > 0) return wpMatches;

    // ── fallback: legacy ?s= HTML scrape (query currently ignored by the
    //    site — the scoring below still refuses wrong-title posts) ──
    for (const query of queries) {
      const searchUrl = new URL(`/?s=${encodeURIComponent(query)}`, this.baseUrl);
      let html;
      try {
        html = await this.fetcher.text(ctx, searchUrl);
      } catch { continue; }

      const $ = cheerio.load(html);

      const scored = [];
      const seen = new Set();
      $('a[href*="/Anime/"]').each((_i, el) => {
        const href = $(el).attr('href');
        if (!href || href.includes('/Anime/?') || href.includes('/az-list') || href.includes('/genres/')) return;

        // The <a> tag's text is polluted with status/type labels.
        // Walk up to the nearest <article> and use its heading instead.
        const $article = $(el).closest('article');
        let text = '';
        if ($article.length > 0) {
          text = $article.find('h1, h2, h3, h4, h5, h6').first().text().trim();
        }
        if (!text) text = $(el).text().trim();
        if (!text) return;

        const score = scoreCandidate(text, href, name, year);
        if (score > 0 && !seen.has(href)) {
          seen.add(href);
          scored.push({ href, score });
        }
      });

      // Lower threshold to 40 (from 60) — per-arc pages on anime sites
      // often have slightly different titles than TMDB.
      const matches = scored.filter(s => s.score >= 40).sort((a, b) => b.score - a.score);
      if (matches.length > 0) return matches;
    }

    return [];
  }

  // WordPress REST search: /wp-json/wp/v2/search?search=… ranks exact and
  // partial title matches properly (unlike the broken ?s= page). Returns
  // candidates in the SAME {href, score} shape as the legacy scraper so the
  // rest of the chain (collectFromPage etc.) is untouched.
  async wpJsonCandidates(ctx, queries, name, year) {
    const scored = [];
    const seen = new Set();
    for (const query of queries) {
      const apiUrl = new URL(`/wp-json/wp/v2/search?search=${encodeURIComponent(query)}&per_page=20`, this.baseUrl);
      let arr;
      try {
        arr = await this.fetcher.json(ctx, apiUrl);
      } catch { continue; }
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        if (!entry?.url || !entry?.title) continue;
        if (!/\/Anime\//.test(entry.url)) continue; // only anime pages
        if (seen.has(entry.url)) continue;
        seen.add(entry.url);
        const score = scoreCandidate(entry.title, entry.url, name, year);
        if (score > 0) scored.push({ href: entry.url, score });
      }
      // wp-json honors the query — a first-query hit is authoritative, but
      // try the ASCII-folded variant too before giving up (same-title rule
      // as the legacy loop).
    }
    return scored.filter(s => s.score >= 40).sort((a, b) => b.score - a.score);
  }

  async fetchAnimePageUrl(ctx, name, year, tmdbId) {
    const candidates = await this.fetchAnimePageCandidates(ctx, name, year, tmdbId);
    return candidates.length > 0 ? new URL(candidates[0].href, this.baseUrl) : null;
  }
}
