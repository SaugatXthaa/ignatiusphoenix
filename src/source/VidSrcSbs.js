// src/source/VidSrcSbs.js
// vidsrc.sbs — TMDB-based movie/TV streaming with 3 server options
//
// The embed page at /embed/movie/{tmdbId}/ contains a CFG object with
// server URLs using TMDB IDs. Three servers:
//   Pro Multi (web.nxsha.app), Cinesrc (cinesrc.st), 4K (player.videasy.net)
//
// Same pattern as CineWave/WatchSeries — pass meta.vidking for the VidKing
// extractor to resolve via speedracelight's TMDB-based API.

import { CountryCode } from '../types.js';
import { getTmdbId, getTmdbNameAndYear, TmdbId } from '../utils/index.js';
import { Source } from './Source.js';

const EMBED_SOURCES = [
  { label: 'Pro Multi', movie: 'https://web.nxsha.app/embed/movie/{id}',      tv: 'https://web.nxsha.app/embed/tv/{id}/{s}/{e}?server=AwsPly-[Multi-Lang]' },
  { label: 'Cinesrc',   movie: 'https://cinesrc.st/embed/movie/{id}',         tv: 'https://cinesrc.st/embed/tv/{id}?s={s}&e={e}&color=FF1493&autoplay=true&autonext=true' },
  { label: '4K',        movie: 'https://player.videasy.net/movie/{id}',       tv: 'https://player.videasy.net/tv/{id}/{s}/{e}' },
];

export class VidSrcSbs extends Source {
  constructor(fetcher) {
    super();
    this.id = 'vidsrcsbs';
    this.label = 'VidSrcSbs';
    this.contentTypes = ['movie', 'series'];
    this.countryCodes = [CountryCode.multi];
    this.baseUrl = 'https://vidsrc.sbs';
    this.fetcher = fetcher;
  }

  async handleInternal(ctx, _type, id) {
    const tmdbId = await getTmdbId(this.fetcher, ctx, id);
    const [name, year] = await getTmdbNameAndYear(this.fetcher, ctx, tmdbId);

    const title = name + (tmdbId.season ? ` ${TmdbId.formatSeasonAndEpisode(tmdbId)}` : ` (${year})`);

    // Pass meta.vidking for BOTH movies and series — it routes embed URLs that
    // have no dedicated extractor (web.nxsha.app, cinesrc.st, player.videasy.net)
    // to the VidKing extractor's speedracelight API. Without it the TV embeds
    // match no extractor at all and the source returns ZERO series streams.
    // The old "wrong content for series" note dates from the title-fuzzy
    // matching era; the API now resolves TV by exact tmdbId + seasonId +
    // episodeId (verified live: watchseries/cinewave/vidking deliver correct
    // series content — BB S01E01 — through this exact path).
    const vidkingMeta = {
      name,
      year,
      tmdbId: tmdbId.id,
      ...(tmdbId.season && {
        season: Number(tmdbId.season),
        episode: Number(tmdbId.episode || 1),
      }),
    };

    const results = [];
    for (const source of EMBED_SOURCES) {
      const url = tmdbId.season
        ? source.tv.replace('{id}', tmdbId.id).replace('{s}', tmdbId.season).replace('{e}', tmdbId.episode)
        : source.movie.replace('{id}', tmdbId.id);

      results.push({
        url: new URL(url),
        meta: {
          countryCodes: [CountryCode.multi],
          title: `${title} (${source.label})`,
          ...(vidkingMeta && { vidking: vidkingMeta }),
        },
      });
    }

    return results;
  }
}
