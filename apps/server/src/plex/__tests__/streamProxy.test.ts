import { describe, expect, it } from 'vitest';
import type { MediaDetails } from '@syncreel/shared';
import { PlexClient } from '../client.js';
import { PartMutex, StreamSessionManager, isSafeSubPath, rewriteM3u8Playlist } from '../streamProxy.js';

describe('rewriteM3u8Playlist', () => {
  it('rewrites relative, root-relative, tag URIs, and strips X-Plex-Token', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="session/abc/audio/index.m3u8?X-Plex-Token=SECRET"',
      '#EXT-X-STREAM-INF:BANDWIDTH=8000000,AUDIO="audio"',
      'session/abc/base/index.m3u8?X-Plex-Token=SECRET&foo=bar'
    ].join('\n');

    const rewrittenMaster = rewriteM3u8Playlist(master, 'tok123', 'start.m3u8');
    expect(rewrittenMaster).not.toContain('SECRET');
    expect(rewrittenMaster).toContain(
      'URI="/api/stream/tok123/session/abc/audio/index.m3u8"'
    );
    expect(rewrittenMaster).toContain(
      '/api/stream/tok123/session/abc/base/index.m3u8?foo=bar'
    );

    const mediaPlaylist = [
      '#EXTM3U',
      '#EXT-X-MAP:URI="init-stream0.m4s?X-Plex-Token=SECRET"',
      '#EXTINF:4.004,',
      'chunk-stream0-00001.m4s',
      '#EXTINF:4.004,',
      '/video/:/transcode/universal/session/abc/base/chunk-stream0-00002.m4s?X-Plex-Token=SECRET'
    ].join('\n');

    const rewrittenMedia = rewriteM3u8Playlist(
      mediaPlaylist,
      'tok123',
      'session/abc/base/index.m3u8'
    );
    expect(rewrittenMedia).not.toContain('SECRET');
    expect(rewrittenMedia).toContain('URI="/api/stream/tok123/session/abc/base/init-stream0.m4s"');
    expect(rewrittenMedia).toContain('/api/stream/tok123/session/abc/base/chunk-stream0-00001.m4s');
    expect(rewrittenMedia).toContain('/api/stream/tok123/session/abc/base/chunk-stream0-00002.m4s');
  });

  it('rejects directory traversal or external URLs in subPath validation', () => {
    expect(isSafeSubPath('session/abc/base/index.m3u8')).toBe(true);
    expect(isSafeSubPath('../etc/passwd')).toBe(false);
    expect(isSafeSubPath('session/../../secret')).toBe(false);
    expect(isSafeSubPath('https://evil.example/a.m3u8')).toBe(false);
  });
});

describe('PartMutex', () => {
  it('serializes concurrent operations on the same partId while allowing different partIds in parallel', async () => {
    const mutex = new PartMutex();
    const events: string[] = [];

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    await Promise.all([
      mutex.runExclusive(101, async () => {
        events.push('101-a-start');
        await delay(30);
        events.push('101-a-end');
      }),
      mutex.runExclusive(101, async () => {
        events.push('101-b-start');
        await delay(10);
        events.push('101-b-end');
      }),
      mutex.runExclusive(202, async () => {
        events.push('202-start');
        await delay(5);
        events.push('202-end');
      })
    ]);

    const aEndIdx = events.indexOf('101-a-end');
    const bStartIdx = events.indexOf('101-b-start');
    expect(aEndIdx).toBeLessThan(bStartIdx);
    expect(events).toContain('202-start');
    expect(events).toContain('202-end');
  });
});

describe('Eco Shared Stream & Embedded MKV Subtitles', () => {
  const sampleMedia: MediaDetails = {
    ratingKey: '555',
    type: 'movie',
    title: 'Sample MKV',
    durationMs: 6000000,
    partId: 777,
    markers: [],
    streams: [
      {
        id: 1,
        streamType: 1,
        codec: 'h264',
        displayTitle: '1080p',
        selected: true,
        default: true,
        forced: false,
        isTextSubtitle: false,
        isEmbeddedTextSubtitle: false,
        requiresBurnIn: false
      },
      {
        id: 2,
        streamType: 2,
        codec: 'aac',
        displayTitle: 'English',
        selected: true,
        default: true,
        forced: false,
        isTextSubtitle: false,
        isEmbeddedTextSubtitle: false,
        requiresBurnIn: false
      },
      {
        id: 99,
        streamType: 3,
        streamIndex: 2,
        codec: 'srt',
        displayTitle: 'English (Embedded SRT)',
        languageCode: 'en',
        selected: false,
        default: false,
        forced: false,
        isTextSubtitle: true,
        isEmbeddedTextSubtitle: true,
        requiresBurnIn: false
      }
    ]
  };

  it('shares a single Plex session across Eco Shared Stream viewers until the last viewer leaves', async () => {
    const calledUrls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      calledUrls.push(url);
      if (url.includes('/start.m3u8')) {
        return new Response('#EXTM3U\nchunk0.ts\n', {
          status: 200,
          headers: { 'content-type': 'application/vnd.apple.mpegurl' }
        });
      }
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const plex = new PlexClient({
      baseUrl: 'http://127.0.0.1:32400',
      token: 'tok',
      clientId: 'test',
      fetchFn
    });
    const manager = new StreamSessionManager(() => plex);

    try {
      const s1 = await manager.createParticipantStream({
        roomCode: 'ECO1',
        participantId: 'p1',
        media: sampleMedia,
        quality: 'original',
        streamMode: 'eco-shared',
        ecoQuality: '1080p-8m'
      });
      const s2 = await manager.createParticipantStream({
        roomCode: 'ECO1',
        participantId: 'p2',
        media: sampleMedia,
        quality: '480p-2m',
        streamMode: 'eco-shared',
        ecoQuality: '1080p-8m'
      });

      expect(s1.streamMode).toBe('eco-shared');
      expect(s2.ecoQuality).toBe('1080p-8m');

      await manager.fetchUpstreamStream(s1.streamToken, 'start.m3u8', '');
      await manager.fetchUpstreamStream(s2.streamToken, 'start.m3u8', '');

      // /decision was called only ONCE for both viewers
      const decisionCalls = calledUrls.filter((u) => u.includes('/universal/decision'));
      expect(decisionCalls).toHaveLength(1);

      // Stopping first viewer does NOT stop upstream transcode
      await manager.stopStreamByToken(s1.streamToken);
      expect(calledUrls.filter((u) => u.includes('/universal/stop'))).toHaveLength(0);

      // Stopping second (last) viewer cleanly stops upstream transcode
      await manager.stopStreamByToken(s2.streamToken);
      expect(calledUrls.filter((u) => u.includes('/universal/stop'))).toHaveLength(1);
    } finally {
      await manager.stopAll();
    }
  });

  it('extracts embedded MKV text subtitles via /library/streams or fallback and caches WebVTT', async () => {
    let subFetches = 0;
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/library/streams/99')) {
        return new Response('Not found', { status: 404 });
      }
      if (url.includes('/transcode/universal/subtitles')) {
        subFetches += 1;
        return new Response('1\n00:00:01,000 --> 00:00:03,000\nEmbedded subtitle!\n', {
          status: 200
        });
      }
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const plex = new PlexClient({
      baseUrl: 'http://127.0.0.1:32400',
      token: 'tok',
      clientId: 'test',
      fetchFn
    });
    const manager = new StreamSessionManager(() => plex);

    try {
      const s1 = await manager.createParticipantStream({
        roomCode: 'SUB1',
        participantId: 'p1',
        media: sampleMedia,
        quality: 'original'
      });

      expect(s1.textSubtitles).toHaveLength(1);
      expect(s1.textSubtitles[0].streamId).toBe(99);

      const vtt1 = await manager.fetchWebVttSubtitle(s1.streamToken, 99);
      const vtt2 = await manager.fetchWebVttSubtitle(s1.streamToken, 99);
      expect(vtt1).toContain('WEBVTT');
      expect(vtt1).toContain('00:00:01.000 --> 00:00:03.000\nEmbedded subtitle!');
      expect(vtt2).toBe(vtt1);
      expect(subFetches).toBe(1); // second request served from LRU cache
    } finally {
      await manager.stopAll();
    }
  });
});
