import type {
  MediaDetails,
  MediaMarker,
  MediaStreamInfo,
  MediaSummary,
  PlexGenre,
  PlexLibrarySection,
  SoloDiscoverRequest,
  SwipeMatchConfig
} from '@syncreel/shared';

function asArray<T>(val: T | T[] | undefined | null): T[] {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

const TEXT_SUBTITLE_CODECS = new Set([
  'srt',
  'subrip',
  'vtt',
  'webvtt',
  'ass',
  'ssa',
  'mov_text',
  'tx3g',
  'text'
]);

const BURN_IN_SUBTITLE_CODECS = new Set([
  'pgs',
  'hdmv_pgs_subtitle',
  'vobsub',
  'dvd_subtitle',
  'dvb_subtitle',
  'pgssub'
]);

interface RawPlexStream {
  id: number | string;
  streamType: number;
  index?: number;
  codec?: string;
  displayTitle?: string;
  extendedDisplayTitle?: string;
  language?: string;
  languageCode?: string;
  selected?: boolean | number;
  default?: boolean | number;
  forced?: boolean | number;
  key?: string;
}

interface RawPlexPart {
  id: number | string;
  Stream?: RawPlexStream[] | RawPlexStream;
}

interface RawPlexMedia {
  Part?: RawPlexPart[] | RawPlexPart;
}

interface RawPlexMarker {
  type?: string;
  startTimeOffset?: number;
  endTimeOffset?: number;
}

interface RawPlexMetadata {
  ratingKey: string | number;
  parentRatingKey?: string | number;
  type?: string;
  title?: string;
  grandparentTitle?: string;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  year?: number;
  duration?: number;
  viewOffset?: number;
  thumb?: string;
  art?: string;
  grandparentThumb?: string;
  parentThumb?: string;
  summary?: string;
  rating?: number;
  audienceRating?: number;
  contentRating?: string;
  childCount?: number;
  viewCount?: number;
  lastViewedAt?: number;
  addedAt?: number;
  Genre?: Array<{ tag?: string }> | { tag?: string };
  Media?: RawPlexMedia[] | RawPlexMedia;
  Marker?: RawPlexMarker[] | RawPlexMarker;
}

function normalizeSummary(item: RawPlexMetadata): MediaSummary {
  const rawType = item.type ?? 'movie';
  const type: MediaSummary['type'] =
    rawType === 'episode' || rawType === 'show' || rawType === 'season' ? rawType : 'movie';

  const genres = asArray(item.Genre)
    .map((g) => g.tag)
    .filter((t): t is string => Boolean(t));

  return {
    ratingKey: String(item.ratingKey),
    type,
    title: item.title ?? 'Untitled',
    grandparentTitle: item.grandparentTitle,
    parentTitle: item.parentTitle,
    parentIndex: item.parentIndex,
    index: item.index,
    year: item.year,
    durationMs: typeof item.duration === 'number' ? item.duration : 0,
    viewOffsetMs: typeof item.viewOffset === 'number' ? item.viewOffset : undefined,
    thumb: item.thumb || item.parentThumb || item.grandparentThumb,
    art: item.art,
    summary: item.summary,
    rating:
      typeof item.audienceRating === 'number'
        ? item.audienceRating
        : typeof item.rating === 'number'
          ? item.rating
          : undefined,
    genres: genres.length > 0 ? genres : undefined,
    contentRating: item.contentRating,
    childCount: typeof item.childCount === 'number' ? item.childCount : undefined
  };
}

function normalizeStream(raw: RawPlexStream): MediaStreamInfo {
  const codec = (raw.codec ?? 'unknown').toLowerCase();
  const streamType = (raw.streamType === 1 || raw.streamType === 2 || raw.streamType === 3
    ? raw.streamType
    : 3) as 1 | 2 | 3;

  // Classify ALL text codecs (both sidecar with stream.key AND embedded inside MKV) as extractable text subtitles
  const isTextSub = streamType === 3 && TEXT_SUBTITLE_CODECS.has(codec);
  const isEmbeddedTextSubtitle = isTextSub && !raw.key;
  const requiresBurnIn =
    streamType === 3 && (!isTextSub || BURN_IN_SUBTITLE_CODECS.has(codec));

  return {
    id: Number(raw.id),
    streamType,
    streamIndex: typeof raw.index === 'number' ? raw.index : undefined,
    codec,
    displayTitle: raw.extendedDisplayTitle || raw.displayTitle || raw.language || codec.toUpperCase(),
    language: raw.language,
    languageCode: raw.languageCode,
    selected: Boolean(raw.selected),
    default: Boolean(raw.default),
    forced: Boolean(raw.forced),
    key: raw.key,
    isTextSubtitle: isTextSub,
    isEmbeddedTextSubtitle,
    requiresBurnIn
  };
}

export function shuffleCopy<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export interface PlexClientOptions {
  baseUrl: string;
  token: string;
  clientId: string;
  fetchFn?: typeof fetch;
}

export class PlexClient {
  readonly baseUrl: string;
  readonly token: string;
  readonly clientId: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: PlexClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.clientId = options.clientId;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Accept: 'application/json',
      'X-Plex-Token': this.token,
      'X-Plex-Client-Identifier': this.clientId,
      'X-Plex-Product': 'SyncReel for Plex',
      'X-Plex-Version': '1.0.0',
      'X-Plex-Platform': 'Web',
      ...extra
    };
  }

  async requestJson<T>(pathAndQuery: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`}`;
    const res = await this.fetchFn(url, {
      ...init,
      headers: {
        ...this.headers(),
        ...(init.headers as Record<string, string> | undefined)
      }
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Plex API error ${res.status} for ${pathAndQuery}: ${text.slice(0, 200)}`);
    }

    return (await res.json()) as T;
  }

  async requestRaw(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}${pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`}`;
    return this.fetchFn(url, {
      ...init,
      headers: {
        ...this.headers(),
        ...(init.headers as Record<string, string> | undefined)
      }
    });
  }

  async checkHealth(): Promise<{ ok: boolean; machineIdentifier?: string; version?: string }> {
    try {
      const json = await this.requestJson<{
        MediaContainer?: { machineIdentifier?: string; version?: string };
      }>('/identity');
      return {
        ok: true,
        machineIdentifier: json.MediaContainer?.machineIdentifier,
        version: json.MediaContainer?.version
      };
    } catch {
      return { ok: false };
    }
  }

  async getLibraries(): Promise<PlexLibrarySection[]> {
    const json = await this.requestJson<{
      MediaContainer?: {
        Directory?: Array<{ key: string; title: string; type: string }>;
      };
    }>('/library/sections');

    return asArray(json.MediaContainer?.Directory)
      .filter((d) => d.type === 'movie' || d.type === 'show')
      .map((d) => ({
        key: String(d.key),
        title: d.title,
        type: d.type as 'movie' | 'show'
      }));
  }

  async getGenres(libraryFilter = 'all'): Promise<PlexGenre[]> {
    const sections = await this.getLibraries();
    const targetSections = sections.filter((s) => {
      if (libraryFilter === 'all') return true;
      if (libraryFilter === 'movie' || libraryFilter === 'show') return s.type === libraryFilter;
      return s.key === libraryFilter;
    });

    const genreMap = new Map<string, PlexGenre>();
    for (const sec of targetSections) {
      const json = await this.requestJson<{
        MediaContainer?: {
          Directory?: Array<{ key: string; title: string }>;
        };
      }>(`/library/sections/${encodeURIComponent(sec.key)}/genre`).catch(() => ({
        MediaContainer: { Directory: [] }
      }));

      for (const g of asArray<{ key: string; title: string }>(json.MediaContainer?.Directory)) {
        if (!g.title) continue;
        const existing: PlexGenre = genreMap.get(g.title) ?? {
          title: g.title,
          keysBySection: {}
        };
        existing.keysBySection[sec.key] = String(g.key);
        genreMap.set(g.title, existing);
      }
    }

    return [...genreMap.values()].sort((a, b) => a.title.localeCompare(b.title));
  }

  async getContinueWatching(): Promise<MediaSummary[]> {
    const json = await this.requestJson<{
      MediaContainer?: {
        Metadata?: RawPlexMetadata[];
        Hub?: Array<{ Metadata?: RawPlexMetadata[] }>;
      };
    }>('/hubs/continueWatching');

    const direct = asArray(json.MediaContainer?.Metadata);
    const hubItems = asArray(json.MediaContainer?.Hub).flatMap((h) => asArray(h.Metadata));
    const items = direct.length > 0 ? direct : hubItems;
    return items.map(normalizeSummary);
  }

  async getRecentlyAdded(limit = 24): Promise<MediaSummary[]> {
    const json = await this.requestJson<{
      MediaContainer?: { Metadata?: RawPlexMetadata[] };
    }>(`/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=${limit}`);

    return asArray(json.MediaContainer?.Metadata)
      .filter((item) => item.type === 'movie' || item.type === 'episode' || item.type === 'season')
      .map(normalizeSummary);
  }

  async getSectionItems(
    sectionId: string,
    opts: {
      start?: number;
      size?: number;
      sort?: string;
      genreKey?: string;
      unwatchedOnly?: boolean;
      watchedOnly?: boolean;
    } = {}
  ): Promise<{ items: MediaSummary[]; totalSize: number }> {
    const params = new URLSearchParams({
      'X-Plex-Container-Start': String(opts.start ?? 0),
      'X-Plex-Container-Size': String(opts.size ?? 48)
    });
    if (opts.sort) params.set('sort', opts.sort);
    if (opts.genreKey) params.set('genre', opts.genreKey);
    if (opts.unwatchedOnly) params.set('unwatched', '1');
    if (opts.watchedOnly) params.set('unwatched', '0');

    const json = await this.requestJson<{
      MediaContainer?: { totalSize?: number; Metadata?: RawPlexMetadata[] };
    }>(`/library/sections/${encodeURIComponent(sectionId)}/all?${params.toString()}`);

    const items = asArray(json.MediaContainer?.Metadata).map(normalizeSummary);
    return {
      items,
      totalSize: json.MediaContainer?.totalSize ?? items.length
    };
  }

  async getCuratedDeckCandidates(input: SoloDiscoverRequest): Promise<MediaSummary[]> {
    const sections = await this.getLibraries();
    const targetSections = sections.filter((s) => {
      if (input.libraryFilter === 'all') return true;
      if (input.libraryFilter === 'movie' || input.libraryFilter === 'show') {
        return s.type === input.libraryFilter;
      }
      return s.key === input.libraryFilter;
    });

    const genres = input.genre ? await this.getGenres(input.libraryFilter) : [];
    const matchedGenre = input.genre
      ? genres.find((g) => g.title.toLowerCase() === input.genre!.toLowerCase())
      : undefined;

    const category = input.category || 'unwatched';
    const wantUnwatched = category === 'unwatched' ? true : category === 'comfort-rewatch' ? false : Boolean(input.unwatchedOnly);

    const fetchForSection = async (
      sec: PlexLibrarySection,
      opts: { sort: string; size: number; unwatchedOnly?: boolean; watchedOnly?: boolean }
    ) => {
      let genreKey: string | undefined;
      if (input.genre) {
        genreKey = matchedGenre?.keysBySection[sec.key];
        if (!genreKey) return [] as MediaSummary[];
      }
      const res = await this.getSectionItems(sec.key, {
        start: 0,
        size: opts.size,
        sort: opts.sort,
        genreKey,
        unwatchedOnly: opts.unwatchedOnly,
        watchedOnly: opts.watchedOnly
      }).catch(() => ({ items: [] as MediaSummary[], totalSize: 0 }));
      return res.items;
    };

    const rawPool: MediaSummary[] = [];

    for (const sec of targetSections) {
      switch (category) {
        case 'award-winning': {
          const topAudience = await fetchForSection(sec, {
            sort: 'audienceRating:desc',
            size: 120,
            unwatchedOnly: wantUnwatched
          });
          const topCritic =
            topAudience.length > 0
              ? topAudience
              : await fetchForSection(sec, {
                  sort: 'rating:desc',
                  size: 120,
                  unwatchedOnly: wantUnwatched
                });
          rawPool.push(...topCritic);
          break;
        }
        case 'popular-now': {
          const [recent, viewed, rated] = await Promise.all([
            fetchForSection(sec, {
              sort: 'addedAt:desc',
              size: 50,
              unwatchedOnly: wantUnwatched
            }),
            fetchForSection(sec, {
              sort: 'viewCount:desc',
              size: 50,
              unwatchedOnly: wantUnwatched
            }),
            fetchForSection(sec, {
              sort: 'audienceRating:desc',
              size: 40,
              unwatchedOnly: wantUnwatched
            })
          ]);
          rawPool.push(...recent.slice(0, 35), ...viewed.slice(0, 35), ...rated.slice(0, 30));
          break;
        }
        case 'short-sweet': {
          if (input.libraryFilter === 'all' && sec.type !== 'movie' && targetSections.some((t) => t.type === 'movie')) {
            continue;
          }
          const candidates = await fetchForSection(sec, {
            sort: 'random',
            size: 150,
            unwatchedOnly: wantUnwatched
          });
          rawPool.push(...candidates);
          break;
        }
        case 'throwback': {
          const candidates = await fetchForSection(sec, {
            sort: 'audienceRating:desc',
            size: 150,
            unwatchedOnly: wantUnwatched
          });
          rawPool.push(...candidates);
          break;
        }
        case 'comfort-rewatch': {
          const watched = await fetchForSection(sec, {
            sort: 'lastViewedAt:asc',
            size: 120,
            watchedOnly: true
          });
          if (watched.length > 0) {
            rawPool.push(...watched);
          } else {
            rawPool.push(
              ...(await fetchForSection(sec, {
                sort: 'audienceRating:desc',
                size: 100
              }))
            );
          }
          break;
        }
        case 'wildcard':
        case 'unwatched':
        default: {
          rawPool.push(
            ...(await fetchForSection(sec, {
              sort: 'random',
              size: 100,
              unwatchedOnly: wantUnwatched
            }))
          );
          break;
        }
      }
    }

    // Deduplicate while preserving initial preference order
    const dedupedMap = new Map<string, MediaSummary>();
    for (const item of rawPool) {
      if (!dedupedMap.has(item.ratingKey)) {
        dedupedMap.set(item.ratingKey, item);
      }
    }
    let filtered = [...dedupedMap.values()];

    if (category === 'award-winning') {
      const acclaimed = filtered.filter((m) => (m.rating ?? 0) >= 7.5);
      if (acclaimed.length >= Math.min(6, input.deckSize)) {
        filtered = acclaimed;
      }
    } else if (category === 'short-sweet') {
      const under100 = filtered.filter((m) => m.durationMs > 0 && m.durationMs <= 100 * 60 * 1000);
      if (under100.length >= 4) {
        filtered = under100;
      } else {
        const withDuration = filtered.filter((m) => m.durationMs > 0).sort((a, b) => a.durationMs - b.durationMs);
        if (withDuration.length > 0) filtered = withDuration;
      }
    } else if (category === 'throwback') {
      const pre2010 = filtered.filter((m) => typeof m.year === 'number' && m.year <= 2010);
      if (pre2010.length >= 4) {
        filtered = pre2010;
      } else {
        const withYear = filtered.filter((m) => typeof m.year === 'number').sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
        if (withYear.length > 0) filtered = withYear;
      }
    }

    if (filtered.length === 0 && wantUnwatched) {
      return this.getCuratedDeckCandidates({
        ...input,
        category: category === 'unwatched' ? 'wildcard' : category,
        unwatchedOnly: false
      });
    }

    return shuffleCopy(filtered).slice(0, input.deckSize);
  }

  async getRandomDeckCandidates(config: SwipeMatchConfig): Promise<MediaSummary[]> {
    if (config.category && config.category !== 'wildcard') {
      return this.getCuratedDeckCandidates({
        category: config.category,
        libraryFilter: config.libraryFilter,
        genre: config.genre,
        unwatchedOnly: config.unwatchedOnly,
        deckSize: config.deckSize
      });
    }

    const sections = await this.getLibraries();
    const targetSections = sections.filter((s) => {
      if (config.libraryFilter === 'all') return true;
      if (config.libraryFilter === 'movie' || config.libraryFilter === 'show') {
        return s.type === config.libraryFilter;
      }
      return s.key === config.libraryFilter;
    });

    const genres = config.genre ? await this.getGenres(config.libraryFilter) : [];
    const matchedGenre = config.genre
      ? genres.find((g) => g.title.toLowerCase() === config.genre!.toLowerCase())
      : undefined;

    const pool: MediaSummary[] = [];
    for (const sec of targetSections) {
      let genreKey: string | undefined;
      if (config.genre) {
        genreKey = matchedGenre?.keysBySection[sec.key];
        if (!genreKey) continue; // This section doesn't have this genre
      }

      const res = await this.getSectionItems(sec.key, {
        start: 0,
        size: 100,
        sort: 'random',
        genreKey,
        unwatchedOnly: config.unwatchedOnly
      });
      pool.push(...res.items);
    }

    // Fallback: if unwatched returned empty, try including watched titles
    if (pool.length === 0 && config.unwatchedOnly) {
      return this.getRandomDeckCandidates({ ...config, unwatchedOnly: false });
    }

    const deduped = new Map<string, MediaSummary>();
    for (const item of pool) {
      if (!deduped.has(item.ratingKey)) {
        deduped.set(item.ratingKey, item);
      }
    }

    return shuffleCopy([...deduped.values()]).slice(0, config.deckSize);
  }

  async getChildren(ratingKey: string): Promise<MediaSummary[]> {
    const json = await this.requestJson<{
      MediaContainer?: { Metadata?: RawPlexMetadata[] };
    }>(`/library/metadata/${encodeURIComponent(ratingKey)}/children`);

    return asArray(json.MediaContainer?.Metadata).map(normalizeSummary);
  }

  async search(query: string): Promise<MediaSummary[]> {
    const params = new URLSearchParams({
      query,
      limit: '16'
    });
    const json = await this.requestJson<{
      MediaContainer?: {
        Hub?: Array<{ type?: string; Metadata?: RawPlexMetadata[] }>;
      };
    }>(`/hubs/search?${params.toString()}`);

    const results: MediaSummary[] = [];
    for (const hub of asArray(json.MediaContainer?.Hub)) {
      for (const item of asArray(hub.Metadata)) {
        if (item.type === 'movie' || item.type === 'show' || item.type === 'episode') {
          results.push(normalizeSummary(item));
        }
      }
    }
    return results;
  }

  async resolvePlayableRatingKey(ratingKey: string): Promise<string> {
    const meta = await this.requestJson<{
      MediaContainer?: { Metadata?: Array<RawPlexMetadata & { OnDeck?: { Metadata?: RawPlexMetadata[] } }> };
    }>(`/library/metadata/${encodeURIComponent(ratingKey)}`);

    const item = asArray(meta.MediaContainer?.Metadata)[0];
    if (!item) {
      throw new Error(`Media item ${ratingKey} not found`);
    }
    if (item.type === 'movie' || item.type === 'episode') {
      return String(item.ratingKey);
    }

    // For TV Shows / Seasons: check OnDeck first, then first unwatched episode, else very first episode (S01E01)
    const onDeck = asArray(item.OnDeck?.Metadata)[0];
    if (onDeck?.ratingKey) {
      return String(onDeck.ratingKey);
    }

    const leavesJson = await this.requestJson<{
      MediaContainer?: { Metadata?: Array<RawPlexMetadata & { viewCount?: number }> };
    }>(`/library/metadata/${encodeURIComponent(ratingKey)}/allLeaves`);

    const episodes = asArray(leavesJson.MediaContainer?.Metadata);
    if (episodes.length === 0) {
      throw new Error(`No episodes found for ${item.title ?? ratingKey}`);
    }

    const firstUnwatched = episodes.find((ep) => !ep.viewCount || ep.viewCount === 0);
    return String((firstUnwatched ?? episodes[0]).ratingKey);
  }

  async getMediaDetails(ratingKey: string): Promise<MediaDetails> {
    const json = await this.requestJson<{
      MediaContainer?: { Metadata?: RawPlexMetadata[] };
    }>(`/library/metadata/${encodeURIComponent(ratingKey)}?includeMarkers=1`);

    const raw = asArray(json.MediaContainer?.Metadata)[0];
    if (!raw) {
      throw new Error(`Media item ${ratingKey} not found`);
    }

    const summary = normalizeSummary(raw);
    const mediaEntry = asArray(raw.Media)[0];
    const partEntry = asArray(mediaEntry?.Part)[0];
    const partId = partEntry ? Number(partEntry.id) : 0;
    const streams = asArray(partEntry?.Stream).map(normalizeStream);

    const markers: MediaMarker[] = asArray(raw.Marker)
      .filter((m) => m.type === 'intro' || m.type === 'credits')
      .map((m) => ({
        type: m.type as 'intro' | 'credits',
        startMs: Number(m.startTimeOffset ?? 0),
        endMs: Number(m.endTimeOffset ?? 0)
      }))
      .filter((m) => m.endMs > m.startMs);

    let nextEpisode: MediaSummary | undefined;
    if (summary.type === 'episode' && raw.parentRatingKey) {
      try {
        const siblings = await this.getChildren(String(raw.parentRatingKey));
        const idx = siblings.findIndex((ep) => ep.ratingKey === summary.ratingKey);
        if (idx >= 0 && idx + 1 < siblings.length) {
          nextEpisode = siblings[idx + 1];
        }
      } catch {
        // Non-fatal if season lookup fails
      }
    }

    return {
      ...summary,
      partId,
      streams,
      markers,
      nextEpisode
    };
  }

  async setPartStreams(
    partId: number,
    audioStreamId?: number,
    subtitleStreamId?: number
  ): Promise<void> {
    if (!partId) return;
    const params = new URLSearchParams({ allParts: '1' });
    if (typeof audioStreamId === 'number') {
      params.set('audioStreamID', String(audioStreamId));
    }
    if (typeof subtitleStreamId === 'number') {
      params.set('subtitleStreamID', String(subtitleStreamId));
    }

    const res = await this.requestRaw(`/library/parts/${partId}?${params.toString()}`, {
      method: 'PUT'
    });
    if (!res.ok) {
      await res.text().catch(() => '');
    }
  }

  async reportTimeline(input: {
    ratingKey: string;
    state: 'playing' | 'paused' | 'stopped';
    timeMs: number;
    durationMs: number;
  }): Promise<void> {
    const params = new URLSearchParams({
      ratingKey: input.ratingKey,
      key: `/library/metadata/${input.ratingKey}`,
      state: input.state,
      time: String(Math.max(0, Math.round(input.timeMs))),
      duration: String(Math.max(0, Math.round(input.durationMs))),
      identifier: 'com.plexapp.plugins.library'
    });

    await this.requestRaw(`/:/timeline?${params.toString()}`, { method: 'POST' }).catch(() => undefined);
  }

  async scrobble(ratingKey: string): Promise<void> {
    const params = new URLSearchParams({
      key: ratingKey,
      identifier: 'com.plexapp.plugins.library'
    });
    await this.requestRaw(`/:/scrobble?${params.toString()}`, { method: 'PUT' }).catch(() => undefined);
  }

  async fetchArtwork(
    plexPath: string,
    width = 500,
    height = 750
  ): Promise<{ contentType: string; buffer: Buffer } | null> {
    if (!plexPath.startsWith('/')) return null;
    const params = new URLSearchParams({
      url: plexPath,
      width: String(width),
      height: String(height),
      minSize: '1',
      upscale: '1'
    });
    const res = await this.requestRaw(`/photo/:/transcode?${params.toString()}`);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const arr = await res.arrayBuffer();
    return { contentType, buffer: Buffer.from(arr) };
  }
}
