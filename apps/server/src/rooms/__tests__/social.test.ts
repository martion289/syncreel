import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { MediaDetails, MediaSummary, ServerEvent } from '@syncreel/shared';
import { PlexClient } from '../../plex/client.js';
import { StreamSessionManager } from '../../plex/streamProxy.js';
import { RoomManager, validateVanitySlug } from '../roomManager.js';

function createMockSocket() {
  const sent: ServerEvent[] = [];
  let closedCode: number | undefined;
  const ws = {
    readyState: 1,
    send: (raw: string) => {
      sent.push(JSON.parse(raw) as ServerEvent);
    },
    close: (code?: number) => {
      closedCode = code;
      (ws as { readyState: number }).readyState = 3;
    }
  } as unknown as WebSocket;

  return {
    ws,
    sent,
    getClosedCode: () => closedCode
  };
}

function createMockPlex() {
  const deckMovies: MediaSummary[] = [
    { ratingKey: '101', type: 'movie', title: 'Movie One', durationMs: 6000000, year: 2021 },
    { ratingKey: '102', type: 'show', title: 'Show Two', durationMs: 0, year: 2023, childCount: 2 },
    { ratingKey: '103', type: 'movie', title: 'Movie Three', durationMs: 5400000, year: 2019 }
  ];

  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/library/sections?')) {
      return new Response(JSON.stringify({ MediaContainer: { Directory: [] } }), { status: 200 });
    }
    if (url.endsWith('/library/sections')) {
      return new Response(
        JSON.stringify({
          MediaContainer: {
            Directory: [
              { key: '1', title: 'Movies', type: 'movie' },
              { key: '2', title: 'TV Shows', type: 'show' }
            ]
          }
        }),
        { status: 200 }
      );
    }
    if (url.includes('/library/sections/1/all')) {
      return new Response(
        JSON.stringify({ MediaContainer: { Metadata: [deckMovies[0], deckMovies[2]] } }),
        { status: 200 }
      );
    }
    if (url.includes('/library/sections/2/all')) {
      return new Response(
        JSON.stringify({ MediaContainer: { Metadata: [deckMovies[1]] } }),
        { status: 200 }
      );
    }
    if (url.includes('/library/metadata/102/allLeaves')) {
      return new Response(
        JSON.stringify({
          MediaContainer: {
            Metadata: [
              { ratingKey: '2001', type: 'episode', title: 'Pilot', viewCount: 1, duration: 2700000 },
              { ratingKey: '2002', type: 'episode', title: 'Episode 2', viewCount: 0, duration: 2700000 }
            ]
          }
        }),
        { status: 200 }
      );
    }
    const keyMatch = url.match(/\/library\/metadata\/(\d+)$/) || url.match(/\/library\/metadata\/(\d+)\?includeMarkers=1/);
    if (keyMatch) {
      const rk = keyMatch[1];
      const base =
        rk === '2002'
          ? { ratingKey: '2002', type: 'episode', title: 'Episode 2', grandparentTitle: 'Show Two', parentIndex: 1, index: 2, duration: 2700000 }
          : rk === '102'
            ? { ratingKey: '102', type: 'show', title: 'Show Two', duration: 0 }
            : { ratingKey: rk, type: 'movie', title: `Title ${rk}`, duration: 6000000 };
      return new Response(
        JSON.stringify({
          MediaContainer: {
            Metadata: [{ ...base, Media: [{ Part: [{ id: 10, Stream: [] }] }] }]
          }
        }),
        { status: 200 }
      );
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const client = new PlexClient({
    baseUrl: 'http://127.0.0.1:32400',
    token: 'tok',
    clientId: 'test',
    fetchFn
  });

  return { client, fetchFn };
}

describe('RoomManager Social Features (Swipe Match, Polls, Ready Check, Slugs, Moderation)', () => {
  it('validates custom vanity slugs and blocks reserved words or collisions', () => {
    expect(validateVanitySlug('Friday-Night')).toBe('friday-night');
    expect(() => validateVanitySlug('admin')).toThrow(/reserved/i);
    expect(() => validateVanitySlug('ab')).toThrow();

    const { client, fetchFn } = createMockPlex();
    const sm = new StreamSessionManager(() => client);
    const rm = new RoomManager({
      getPlexClient: () => client,
      getPlexUrl: () => 'http://127.0.0.1:32400',
      clientIdentifier: 'test',
      streamManager: sm,
      getWebhookConfig: () => ({ webhookUrl: '', webhookAutoNotify: false, publicUrl: '' }),
      fetchFn
    });

    try {
      const r1 = rm.createRoom({ slug: 'friday-night' });
      expect(r1.code).toBe('friday-night');
      expect(rm.getRoom('FRIDAY-NIGHT')).toBe(r1);
      expect(() => rm.createRoom({ slug: 'friday-night' })).toThrow(/already active/i);
    } finally {
      void sm.stopAll();
      void rm.shutdown();
    }
  });

  it('runs Tinder-style Swipe Match across movies + TV shows and triggers unanimous match + episode resolution', async () => {
    const { client, fetchFn } = createMockPlex();
    const sm = new StreamSessionManager(() => client);
    const rm = new RoomManager({
      getPlexClient: () => client,
      getPlexUrl: () => 'http://127.0.0.1:32400',
      clientIdentifier: 'test',
      streamManager: sm,
      getWebhookConfig: () => ({ webhookUrl: '', webhookAutoNotify: false, publicUrl: '' }),
      fetchFn
    });

    try {
      const room = rm.createRoom({ name: 'Date Night' });
      const hostSock = createMockSocket();
      const guestSock = createMockSocket();

      rm.attachSocket(room, { id: 'host-1', name: 'Ryan', role: 'host' }, hostSock.ws);
      rm.attachSocket(room, { id: 'guest-1', name: 'Sam', role: 'guest' }, guestSock.ws);

      await rm.startSwipeMatch(
        room,
        { libraryFilter: 'all', genre: null, unwatchedOnly: false, deckSize: 15 },
        'Ryan'
      );

      const hostSwipeEvt = [...hostSock.sent].reverse().find((e) => e.type === 'swipe:updated');
      const guestSwipeEvt = [...guestSock.sent].reverse().find((e) => e.type === 'swipe:updated');
      expect(hostSwipeEvt?.type).toBe('swipe:updated');
      expect(guestSwipeEvt?.type).toBe('swipe:updated');
      if (hostSwipeEvt?.type === 'swipe:updated' && guestSwipeEvt?.type === 'swipe:updated') {
        expect(hostSwipeEvt.selfSwipeOrder).toHaveLength(3);
        expect(guestSwipeEvt.selfSwipeOrder).toHaveLength(3);
      }

      // Host likes 101 & 102; Guest passes 101 and likes 102 -> 102 ("Show Two") matches!
      const v1 = rm.recordSwipeVote(room, 'host-1', '101', 'yes');
      expect(v1.matchedMedia).toBeNull();
      const v2 = rm.recordSwipeVote(room, 'guest-1', '101', 'no');
      expect(v2.matchedMedia).toBeNull();

      rm.recordSwipeVote(room, 'host-1', '102', 'yes');
      const v4 = rm.recordSwipeVote(room, 'guest-1', '102', 'yes');
      expect(v4.matchedMedia?.ratingKey).toBe('102');

      // Playing matched TV show 102 auto-resolves to first unwatched episode (2002)
      const loaded: MediaDetails = await rm.playSwipeMatchItem(room, '102', 'Ryan');
      expect(loaded.ratingKey).toBe('2002');
      expect(room.currentMedia?.ratingKey).toBe('2002');
    } finally {
      await sm.stopAll();
      await rm.shutdown();
    }
  });

  it('supports Movie Polls, Ready Check 3-2-1 countdown, Kick, and Host Transfer', async () => {
    vi.useFakeTimers();
    const { client, fetchFn } = createMockPlex();
    const sm = new StreamSessionManager(() => client);
    const rm = new RoomManager({
      getPlexClient: () => client,
      getPlexUrl: () => 'http://127.0.0.1:32400',
      clientIdentifier: 'test',
      streamManager: sm,
      getWebhookConfig: () => ({ webhookUrl: '', webhookAutoNotify: false, publicUrl: '' }),
      fetchFn
    });

    try {
      const room = rm.createRoom({ name: 'Party' });
      const hostSock = createMockSocket();
      const guestSock = createMockSocket();
      rm.attachSocket(room, { id: 'host-1', name: 'Ryan', role: 'host' }, hostSock.ws);
      rm.attachSocket(room, { id: 'guest-1', name: 'Sam', role: 'guest' }, guestSock.ws);

      // Movie Poll
      await rm.startPoll(room, ['101', '103'], 'Ryan');
      rm.votePoll(room, 'host-1', '103');
      rm.votePoll(room, 'guest-1', '103');
      const closed = await rm.closePoll(room, 'Ryan', true);
      expect(closed?.winnerRatingKey).toBe('103');
      expect(room.currentMedia?.ratingKey).toBe('103');

      // Ready Check -> both ack -> 3s countdown -> auto-play
      rm.startReadyCheck(room, 'Ryan');
      rm.ackReady(room, 'host-1', true);
      expect(room.readyCheck.countdownEndServerTimeMs).toBeNull();
      rm.ackReady(room, 'guest-1', true);
      expect(room.readyCheck.countdownEndServerTimeMs).not.toBeNull();

      vi.advanceTimersByTime(3000);
      expect(room.sync.getState().status).toBe('playing');

      // Host transfer + Kick
      expect(rm.transferHost(room, 'host-1', 'guest-1')).toBe(true);
      expect(rm.getParticipantRole(room, 'guest-1', 'guest')).toBe('host');
      expect(rm.getParticipantRole(room, 'host-1', 'host')).toBe('guest');

      expect(rm.kickParticipant(room, 'guest-1', 'host-1')).toBe(true);
      expect(rm.isParticipantKicked(room, 'host-1')).toBe(true);
      expect(hostSock.getClosedCode()).toBe(4008);
    } finally {
      vi.useRealTimers();
      await sm.stopAll();
      await rm.shutdown();
    }
  });

  it('runs synced multi-phone 1v1 Knockout voting with 1-1 tie detection and coin-flip tie-breaker', async () => {
    const { client, fetchFn } = createMockPlex();
    const sm = new StreamSessionManager(() => client);
    const rm = new RoomManager({
      getPlexClient: () => client,
      getPlexUrl: () => 'http://127.0.0.1:32400',
      clientIdentifier: 'test',
      streamManager: sm,
      getWebhookConfig: () => ({ webhookUrl: '', webhookAutoNotify: false, publicUrl: '' }),
      fetchFn
    });

    try {
      const room = rm.createRoom({ name: 'Couple Picker', purpose: 'picker' });
      const p1Sock = createMockSocket();
      const p2Sock = createMockSocket();

      rm.attachSocket(room, { id: 'host-1', name: 'Ryan', role: 'host' }, p1Sock.ws);
      rm.attachSocket(room, { id: 'guest-1', name: 'Sam', role: 'guest' }, p2Sock.ws);

      await rm.startSwipeMatch(
        room,
        { libraryFilter: 'all', genre: null, unwatchedOnly: false, deckSize: 15 },
        'Ryan'
      );

      // Both players match on titles 101 and 103
      rm.recordSwipeVote(room, 'host-1', '101', 'yes');
      rm.recordSwipeVote(room, 'guest-1', '101', 'yes');
      rm.recordSwipeVote(room, 'host-1', '103', 'yes');
      rm.recordSwipeVote(room, 'guest-1', '103', 'yes');

      const ko = rm.startSwipeKnockout(room, 'Ryan');
      expect(ko.roundContenderCount).toBe(2);
      expect(ko.tied).toBe(false);
      expect(ko.champion).toBeNull();

      const matchup = ko.matchups[0];
      // Split vote: 1-1 tie
      const afterP1 = rm.voteSwipeKnockout(room, 'host-1', matchup.left.ratingKey);
      expect(afterP1?.tied).toBe(false);
      expect(afterP1?.champion).toBeNull();

      const afterTie = rm.voteSwipeKnockout(room, 'guest-1', matchup.right.ratingKey);
      expect(afterTie?.tied).toBe(true);
      expect(afterTie?.champion).toBeNull();

      // Coin flip tie-breaker crowns a champion cleanly
      const afterCoin = rm.resolveSwipeKnockoutTie(room, 'Sam', 'coinflip');
      expect(afterCoin?.tied).toBe(false);
      expect(afterCoin?.champion).not.toBeNull();
      expect(afterCoin?.lastTieBreakMessage).toContain('Coin flip');
    } finally {
      await sm.stopAll();
      await rm.shutdown();
    }
  });
});
