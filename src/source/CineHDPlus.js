// src/source/CineHDPlus.js
// Ported from research/webstreamr-mbg/src/source/CineHDPlus.ts
// 2025-09 re-fit to upstream changes:
//   - Site canonical domain is now cinehdplus.surf (biz serves same catalog)
//   - GET DLE search is dead server-side (returns a default listing regardless
//     of query) — switched to the working POST form search
//   - All titles (series included) now live under /peliculas/{id}-{slug}.html
//   - Per-episode players are vimeus.com embeds (view_key + tmdb id embedded in
//     the page JS) whose embeds[] resolve to vimeos.net packed-JW pages
//     (FileMoon-family, resolved by the FileMoon extractor)
//   - Legacy data-num/.mirrors[data-link] markup kept as a fallback path

import * as cheerio from 'cheerio';
import { CountryCode } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';

// Accents/case-insensitive title comparison (TMDB "La casa del dragón" vs page "La Casa del Dragón")
const normalizeTitle = (s) => (s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export class CineHDPlus extends Source {
  constructor(fetcher) {
    super();
    this.id = 'cinehdplus';
    this.label = 'CineHDPlus';
    this.contentTypes = ['series'];
    this.countryCodes = [CountryCode.es, CountryCode.mx];
    this.baseUrl = 'https://cinehdplus.surf';
    this.fetcher = fetcher;
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);

    let name, year;
    try {
      [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId, 'es');
    } catch {
      return [];
    }

    const seriesPageUrl = await this.fetchSeriesPageUrl(ctx, name);
    if (!seriesPageUrl) {
      return [];
    }

    const html = await this.fetcher.text(ctx, seriesPageUrl);

    const $ = cheerio.load(html);

    const countryCodes = [(($('.details__langs').html()) || '').includes('Latino') ? CountryCode.mx : CountryCode.es];

    const title = `${(($('meta[property="og:title"]').attr('content')) || name).trim()} ${TmdbId.formatSeasonAndEpisode(tmdbId)}`;

    const vidkingMeta = tmdbId.season ? null : { name, year, tmdbId: tmdbId.id };

    // ─── Primary: vimeus.com per-episode embeds (2025+ player) ───
    const vimeusResults = await this.fetchVimeusEmbeds(ctx, html, seriesPageUrl, tmdbId, title, countryCodes, vidkingMeta);
    if (vimeusResults.length > 0) return vimeusResults;

    // ─── Fallback: legacy data-num/.mirrors markup (kept for rollback safety) ───
    return Promise.all(
      $(`[data-num="${tmdbId.season}x${tmdbId.episode}"]`)
        .siblings('.mirrors')
        .children('[data-link]')
        .map((_i, el) => new URL(($(el).attr('data-link')).replace(/^(https:)?\/\//, 'https://')))
        .toArray()
        .filter(url => !url.host.match(/cinehdplus/))
        .map(url => ({ url, meta: { countryCodes, referer: seriesPageUrl.href, title, ...(vidkingMeta && { vidking: vidkingMeta }) } })),
    );
  }

  // Fetch the vimeus.com episode embed page and return vimeos.net embed URLs.
  // Page JS template (verified 2025-09):
  //   function vimeusUrl(se, ep) {
  //     var url = 'https://vimeus.com/e/serie?tmdb=' + tmdb
  //       + '&view_key=5yXx8bsITsFlRG-...' + '&title=' + encodeURIComponent(title) + '&theme=minimal';
  //     if (se) { url += '&se=' + se; } if (ep) { url += '&ep=' + ep; }
  // The vimeus page embeds a JSON blob: {"embeds":[{"url":"https://vimeos.net/embed-x.html","lang":"Latino",...}]}
  async fetchVimeusEmbeds(ctx, html, seriesPageUrl, tmdbId, title, countryCodes, vidkingMeta) {
    if (!tmdbId.season || !html.includes('vimeus.com')) return [];

    const viewKey = html.match(/view_key=([A-Za-z0-9_-]+)/)?.[1];
    // 2026-09 upstream template change: tmdbRaw is now '<id>-<slug>'
    // (e.g. var tmdbRaw = '1396-breaking-bad';) — capture the LEADING digits
    // instead of requiring a pure-number literal. Pure-digit form still matches.
    const showTmdb = html.match(/var\s+tmdb\s*=\s*['"](\d+)['"]/)?.[1]
      || html.match(/var\s+tmdbRaw\s*=\s*['"](\d+)[^'"]*['"]/)?.[1];
    if (!viewKey || !showTmdb) return [];

    const showTitle = html.match(/var\s+title\s*=\s*['"]([^'"]*)['"]/)?.[1] || title;
    const vimeusUrl = new URL('https://vimeus.com/e/serie');
    vimeusUrl.searchParams.set('tmdb', showTmdb);
    vimeusUrl.searchParams.set('view_key', viewKey);
    vimeusUrl.searchParams.set('title', showTitle);
    vimeusUrl.searchParams.set('theme', 'minimal');
    vimeusUrl.searchParams.set('se', String(tmdbId.season));
    vimeusUrl.searchParams.set('ep', String(tmdbId.episode || 1));

    let embedHtml;
    try {
      embedHtml = await this.fetcher.text(ctx, vimeusUrl, { headers: { Referer: seriesPageUrl.href } });
    } catch {
      return [];
    }

    // Parse the embeds JSON array objects: {url, lang, quality, ...}
    const results = [];
    const seen = new Set();
    for (const m of embedHtml.matchAll(/\{[^{}]*"url"\s*:\s*"(https?:\/\/vimeos\.net\/embed-[^"]+)"[^{}]*\}/g)) {
      let url;
      try { url = new URL(m[1].replace(/\\u002F/g, '/')); } catch { continue; }
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      const lang = m[0].match(/"lang"\s*:\s*"([^"]*)"/)?.[1] || '';
      const quality = m[0].match(/"quality"\s*:\s*"([^"]*)"/)?.[1] || '';
      const codes = /latino/i.test(lang) ? [CountryCode.mx] : countryCodes;
      results.push({
        url,
        meta: {
          countryCodes: codes,
          referer: vimeusUrl.origin + '/',
          title: `${title}${lang ? ` · ${lang}` : ''}${quality ? ` · ${quality}` : ''}`,
          ...(vidkingMeta && { vidking: vidkingMeta }),
        },
      });
    }
    return results;
  }

  // Case-insensitive match handles TMDB/CineHDPlus capitalization differences (e.g. "La casa de dragón" vs "La Casa del Dragón")
  async fetchSeriesPageUrl(ctx, name) {
    // DLE POST form search — the GET variant (/?story=&do=search) now ignores
    // the query and returns a default listing (verified 2025-09).
    let html;
    try {
      html = await this.fetcher.textPost(
        ctx,
        new URL('/index.php?do=search&subaction=search', this.baseUrl),
        `story=${encodeURIComponent(name)}&do=search&subaction=search&search_start=0&full_search=0&result_from=1&result_num=50`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
    } catch {
      return null;
    }

    const $ = cheerio.load(html);

    const wanted = normalizeTitle(name);
    const candidates = $('.card__title a[href]').toArray()
      .map(el => ({ href: $(el).attr('href'), text: normalizeTitle($(el).text()) }))
      .filter(c => c.href && c.text && c.text === wanted);

    // Prefer URLs under the current /peliculas/ path; fall back to first match
    const picked = candidates.find(c => /\/peliculas\//.test(c.href))?.href || candidates[0]?.href;

    return picked ? new URL(picked) : null;
  }
}
