import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import {
  GUEST_COOKIE_NAME,
  HOST_COOKIE_NAME,
  isAllowedWsOrigin,
  signSessionToken
} from '../../auth/tokens.js';
import { resolveRoomParticipant } from '../../context.js';
import { validateWebhookUrl } from '../../notifications/webhook.js';

const MOCK_PLEX_MEDIA = {
  MediaContainer: {
    Metadata: [
      {
        ratingKey: '555',
        type: 'movie',
        title: 'Inception',
        year: 2010,
        duration: 8_880_000,
        thumb: '/library/metadata/555/thumb/123',
        art: '/library/metadata/555/art/456',
        Media: [
          {
            Part: [
              {
                id: 777,
                Stream: [
                  { id: 1, streamType: 1, codec: 'h264', displayTitle: '1080p' },
                  { id: 2, streamType: 2, codec: 'aac', displayTitle: 'English (AAC)', selected: true },
                  {
                    id: 3,
                    streamType: 3,
                    codec: 'srt',
                    displayTitle: 'English (SRT)',
                    languageCode: 'en',
                    key: '/library/streams/3'
                  }
                ]
              }
            ]
          }
        ],
        Marker: [{ type: 'intro', startTimeOffset: 10_000, endTimeOffset: 75_000 }]
      }
    ]
  }
};

function createMockFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/identity')) {
      return new Response(
        JSON.stringify({ MediaContainer: { machineIdentifier: 'mock-machine', version: '1.41' } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.includes('/library/metadata/555')) {
      return new Response(JSON.stringify(MOCK_PLEX_MEDIA), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.includes('/library/sections/') && url.includes('/all')) {
      return new Response(
        JSON.stringify({
          MediaContainer: {
            Metadata: [
              {
                ratingKey: '555',
                type: 'movie',
                title: 'Inception',
                year: 2010,
                duration: 8_880_000,
                audienceRating: 8.8
              },
              {
                ratingKey: '556',
                type: 'movie',
                title: 'Short Indie',
                year: 2022,
                duration: 5_100_000,
                audienceRating: 6.9
              }
            ]
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.includes('/library/sections')) {
      return new Response(
        JSON.stringify({
          MediaContainer: { Directory: [{ key: '1', title: 'Movies', type: 'movie' }] }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response('Not Found', { status: 404 });
  }) as typeof fetch;
}

describe('Security, Guest Isolation, Setup & Role Boundaries', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function setupTestServer(options: { preconfigure?: boolean } = {}) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncreel-test-'));
    tempDirs.push(dataDir);

    const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const built = await buildApp({
      configOverrides: {
        NODE_ENV: 'test',
        DATA_DIR: dataDir,
        ...(options.preconfigure !== false ? { APP_SECRET: secret } : {}),
        PLEX_URL: 'http://127.0.0.1:32400',
        PUBLIC_URL: 'https://watch.example.com'
      },
      fetchFn: createMockFetch(),
      serveStatic: false
    });

    if (options.preconfigure !== false) {
      built.ctx.storage.setOwnerAuth({
        plexToken: 'super-secret-plex-token',
        plexUserId: 42,
        username: 'HostOwner',
        serverMachineId: 'mock-machine',
        serverName: 'HomePlex',
        plexUrl: 'http://127.0.0.1:32400',
        updatedAtMs: Date.now()
      });
      built.ctx.refreshPlexClient();
    }

    const activeSecret = built.config.appSecret;
    const hostCookie = signSessionToken(
      {
        kind: 'host',
        role: 'admin',
        plexUserId: 42,
        username: 'HostOwner',
        exp: Date.now() + 3_600_000
      },
      activeSecret
    );

    const friendCookie = signSessionToken(
      {
        kind: 'host',
        role: 'friend',
        plexUserId: 99,
        username: 'PlexFriend',
        exp: Date.now() + 3_600_000
      },
      activeSecret
    );

    return { ...built, dataDir, hostCookie, friendCookie };
  }

  it('auto-generates and persists secret.key when APP_SECRET is omitted', async () => {
    const { app, dataDir } = await setupTestServer({ preconfigure: false });
    try {
      expect(fs.existsSync(path.join(dataDir, 'secret.key'))).toBe(true);
      const status = await app.inject({ method: 'GET', url: '/api/setup/status' });
      expect(status.statusCode).toBe(200);
      expect(status.json().configured).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('isolates Plex/Admin routes from guests, Plex friends, and Guest Preview tabs', async () => {
    const { app, ctx, hostCookie, friendCookie } = await setupTestServer();
    try {
      const healthRes = await app.inject({ method: 'GET', url: '/api/health' });
      expect(healthRes.statusCode).toBe(200);
      expect(healthRes.json().hostAuthenticated).toBe(true);

      // Unauthenticated cannot browse Plex
      const unauthLib = await app.inject({ method: 'GET', url: '/api/plex/libraries' });
      expect(unauthLib.statusCode).toBe(401);

      // Friend blocked when allowPlexFriends is false; allowed to browse Plex when true, still 403 on /api/admin
      ctx.storage.setFriendAuth({
        plexToken: 'friend-token',
        plexUserId: 99,
        username: 'PlexFriend',
        updatedAtMs: Date.now()
      });
      ctx.storage.updateSettings({ allowPlexFriends: false });
      const friendBlocked = await app.inject({
        method: 'GET',
        url: '/api/plex/libraries',
        headers: { cookie: `${HOST_COOKIE_NAME}=${friendCookie}` }
      });
      expect(friendBlocked.statusCode).toBe(401);

      ctx.storage.updateSettings({ allowPlexFriends: true });
      const friendAllowedLib = await app.inject({
        method: 'GET',
        url: '/api/plex/libraries',
        headers: { cookie: `${HOST_COOKIE_NAME}=${friendCookie}` }
      });
      expect(friendAllowedLib.statusCode).toBe(200);

      const friendBlockedAdmin = await app.inject({
        method: 'GET',
        url: '/api/admin/overview',
        headers: { cookie: `${HOST_COOKIE_NAME}=${friendCookie}` }
      });
      expect(friendBlockedAdmin.statusCode).toBe(403);

      // Host creates PIN-protected room
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: { cookie: `${HOST_COOKIE_NAME}=${hostCookie}` },
        payload: { name: 'Friday Screening', slug: 'friday-night', pin: '2468' }
      });
      expect(createRes.statusCode).toBe(201);
      const { code } = createRes.json() as { code: string };
      expect(code).toBe('friday-night');

      const room = ctx.roomManager.getRoom(code)!;
      await ctx.roomManager.setRoomMedia(room, '555', 'HostOwner');

      // Wrong PIN rejected
      const badJoin = await app.inject({
        method: 'POST',
        url: `/api/rooms/${code}/join`,
        payload: { name: 'GuestAlex', pin: '0000' }
      });
      expect(badJoin.statusCode).toBe(401);

      // Valid PIN succeeds
      const goodJoin = await app.inject({
        method: 'POST',
        url: `/api/rooms/${code}/join`,
        payload: { name: 'GuestAlex', pin: '2468', previewGuest: true }
      });
      expect(goodJoin.statusCode).toBe(200);
      const { guestToken } = goodJoin.json() as { guestToken: string };
      expect(guestToken).toBeTruthy();

      // Even if wt_host cookie is present, x-syncreel-role: guest isolates the Guest Preview tab!
      const previewLib = await app.inject({
        method: 'GET',
        url: '/api/plex/libraries',
        headers: {
          cookie: `${HOST_COOKIE_NAME}=${hostCookie}`,
          'x-syncreel-role': 'guest',
          'x-syncreel-guest-token': guestToken
        }
      });
      expect(previewLib.statusCode).toBe(403);

      // Guest blocked from minting stream outside active ratingKey
      const badStream = await app.inject({
        method: 'POST',
        url: `/api/rooms/${code}/stream`,
        headers: {
          'x-syncreel-role': 'guest',
          'x-syncreel-guest-token': guestToken
        },
        payload: { ratingKey: '999', quality: 'original' }
      });
      expect(badStream.statusCode).toBe(403);

      // Guest CAN mint stream for active ratingKey without leaking Plex token
      const goodStream = await app.inject({
        method: 'POST',
        url: `/api/rooms/${code}/stream`,
        headers: {
          'x-syncreel-role': 'guest',
          'x-syncreel-guest-token': guestToken
        },
        payload: { ratingKey: '555', quality: '720p-4m' }
      });
      expect(goodStream.statusCode).toBe(200);
      expect(JSON.stringify(goodStream.json())).not.toContain('super-secret-plex-token');

      // Guest blocked from probing arbitrary artwork
      const badArt = await app.inject({
        method: 'GET',
        url: `/api/rooms/${code}/artwork?path=${encodeURIComponent('/library/metadata/999/thumb/1')}`,
        headers: {
          'x-syncreel-role': 'guest',
          'x-syncreel-guest-token': guestToken
        }
      });
      expect(badArt.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('blocks SSRF webhook URLs and untrusted WebSocket origins', () => {
    expect(validateWebhookUrl('https://discord.com/api/webhooks/123/abc').valid).toBe(true);
    expect(validateWebhookUrl('http://127.0.0.1:8080/hook').valid).toBe(false);
    expect(validateWebhookUrl('https://192.168.0.10/hook').valid).toBe(false);
    expect(validateWebhookUrl('https://localhost/hook').valid).toBe(false);

    expect(isAllowedWsOrigin('https://watch.example.com', 'https://watch.example.com', 'watch.example.com')).toBe(true);
    expect(isAllowedWsOrigin('https://evil.attacker', 'https://watch.example.com', 'watch.example.com')).toBe(false);
  });

  it('enables allowPlexFriends by default, discovers curated categories, preloads initialRatingKey, and isolates single-account couple seats', async () => {
    const { app, ctx, hostCookie } = await setupTestServer();
    try {
      expect(ctx.storage.getSettings().allowPlexFriends).toBe(true);

      // Curated category discovery returns serverMachineId + filtered items
      const discoverShort = await app.inject({
        method: 'GET',
        url: '/api/plex/discover?category=short-sweet&filter=movie&count=10',
        headers: { cookie: `${HOST_COOKIE_NAME}=${hostCookie}` }
      });
      expect(discoverShort.statusCode).toBe(200);
      const shortBody = discoverShort.json() as {
        items: Array<{ ratingKey: string }>;
        serverMachineId?: string;
      };
      expect(shortBody.serverMachineId).toBe('mock-machine');
      expect(shortBody.items.some((i) => i.ratingKey === '556')).toBe(true);

      // Creating a picker room pre-deals swipe deck and supports initialRatingKey preload
      const watchCreate = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: { cookie: `${HOST_COOKIE_NAME}=${hostCookie}` },
        payload: {
          name: 'Inception Night',
          purpose: 'picker',
          initialRatingKey: '555',
          autoStartSwipe: { category: 'award-winning', libraryFilter: 'all', genre: null, unwatchedOnly: false, deckSize: 10 }
        }
      });
      expect(watchCreate.statusCode).toBe(201);
      const { code, purpose } = watchCreate.json() as { code: string; purpose: string };
      expect(purpose).toBe('picker');
      const createdRoom = ctx.roomManager.getRoom(code)!;
      expect(createdRoom.currentMedia?.ratingKey).toBe('555');
      expect(createdRoom.swipeMatch?.deck.length).toBeGreaterThan(0);

      // Partner 2 joins with the SAME wt_host Plex cookie via forceGuestSeat: true
      const partnerJoin = await app.inject({
        method: 'POST',
        url: `/api/rooms/${code}/join`,
        headers: { cookie: `${HOST_COOKIE_NAME}=${hostCookie}` },
        payload: { name: 'Sarah', forceGuestSeat: true }
      });
      expect(partnerJoin.statusCode).toBe(200);
      const { guestToken, participantId, role } = partnerJoin.json() as {
        guestToken: string;
        participantId: string;
        role: string;
      };
      expect(role).toBe('guest');
      expect(participantId).not.toBe('host-42');

      const partnerResolved = resolveRoomParticipant(
        {
          headers: {},
          query: {},
          cookies: {
            [HOST_COOKIE_NAME]: hostCookie,
            [GUEST_COOKIE_NAME]: guestToken
          }
        } as unknown as Parameters<typeof resolveRoomParticipant>[0],
        ctx,
        code
      );
      expect(partnerResolved?.id).toBe(participantId);
      expect(partnerResolved?.name).toBe('Sarah');
      expect(partnerResolved?.role).toBe('guest');
    } finally {
      await app.close();
    }
  });
});
