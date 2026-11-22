import type {
  AdminOverview,
  AuthUser,
  DiscoveredPlexServer,
  MediaDetails,
  MediaSummary,
  PlexGenre,
  PlexLibrarySection,
  QualityPreset,
  RoomPublicInfo,
  SetupStatus,
  SoloDiscoverRequest,
  SoloDiscoverResponse,
  StreamMode,
  StreamSessionResponse,
  SwipeMatchConfig
} from '@syncreel/shared';

export function isGuestPreviewTab(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('asGuest') === '1';
}

const PREVIEW_GUEST_TOKEN_KEY = 'syncreel_preview_guest_token';

export function getPreviewGuestToken(roomCode: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(`${PREVIEW_GUEST_TOKEN_KEY}:${roomCode.toUpperCase()}`);
}

export function setPreviewGuestToken(roomCode: string, token: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(`${PREVIEW_GUEST_TOKEN_KEY}:${roomCode.toUpperCase()}`, token);
}

async function fetchJson<T>(url: string, init: RequestInit = {}, roomCodeHint?: string): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined)
  };
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (isGuestPreviewTab()) {
    headers['x-syncreel-role'] = 'guest';
    if (roomCodeHint) {
      const tok = getPreviewGuestToken(roomCodeHint);
      if (tok) headers['x-syncreel-guest-token'] = tok;
    }
  }
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers
  });

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const api = {
  // Setup Wizard
  getSetupStatus: () => fetchJson<SetupStatus>('/api/setup/status'),

  createSetupPin: () =>
    fetchJson<{ id: number; code: string; authUrl: string }>('/api/setup/plex/pin', {
      method: 'POST'
    }),

  pollSetupPin: (pinId: number) =>
    fetchJson<{
      claimed: boolean;
      setupTicket?: string;
      username?: string;
      servers?: DiscoveredPlexServer[];
    }>(`/api/setup/plex/pin/${pinId}`),

  rediscoverServers: (setupTicket: string) =>
    fetchJson<{ servers: DiscoveredPlexServer[] }>('/api/setup/plex/servers', {
      method: 'POST',
      body: JSON.stringify({ setupTicket })
    }),

  completeSetup: (input: {
    setupTicket: string;
    plexUrl: string;
    allowPlexFriends: boolean;
    webhookUrl?: string;
    webhookAutoNotify?: boolean;
  }) =>
    fetchJson<{ configured: boolean; user: AuthUser }>('/api/setup/complete', {
      method: 'POST',
      body: JSON.stringify(input)
    }),

  // Auth
  getAuthMe: () => fetchJson<{ authenticated: boolean; user: AuthUser | null }>('/api/auth/me'),

  createPlexPin: () =>
    fetchJson<{ id: number; code: string; authUrl: string }>('/api/auth/plex/pin', {
      method: 'POST'
    }),

  pollPlexPin: (pinId: number) =>
    fetchJson<{ authenticated: boolean; user?: AuthUser }>(`/api/auth/plex/pin/${pinId}`),

  logout: () => fetchJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  // Admin
  getAdminOverview: () => fetchJson<AdminOverview>('/api/admin/overview'),

  updateAdminSettings: (input: {
    plexUrl?: string;
    allowPlexFriends?: boolean;
    webhookUrl?: string;
    webhookAutoNotify?: boolean;
    defaultHostOnlyControl?: boolean;
  }) =>
    fetchJson<{ ok: boolean }>('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(input)
    }),

  testWebhook: (webhookUrl?: string) =>
    fetchJson<{ ok: boolean }>('/api/admin/webhook/test', {
      method: 'POST',
      body: JSON.stringify({ webhookUrl })
    }),

  adminCloseRoom: (code: string) =>
    fetchJson<{ ok: boolean }>(`/api/admin/rooms/${encodeURIComponent(code)}`, {
      method: 'DELETE'
    }),

  adminKillStream: (token: string) =>
    fetchJson<{ ok: boolean }>(`/api/admin/streams/${encodeURIComponent(token)}`, {
      method: 'DELETE'
    }),

  // Plex Browsing
  getLibraries: () => fetchJson<{ sections: PlexLibrarySection[] }>('/api/plex/libraries'),

  getGenres: (filter = 'all') =>
    fetchJson<{ genres: PlexGenre[] }>(`/api/plex/genres?filter=${encodeURIComponent(filter)}`),

  getRandomPicks: (count = 4, filter = 'all', genre?: string) => {
    const params = new URLSearchParams({ count: String(count), filter });
    if (genre) params.set('genre', genre);
    return fetchJson<{ items: MediaSummary[] }>(`/api/plex/random?${params.toString()}`);
  },

  discoverPlex: (input: SoloDiscoverRequest) => {
    const params = new URLSearchParams({
      category: input.category,
      filter: input.libraryFilter,
      count: String(input.deckSize)
    });
    if (input.genre) params.set('genre', input.genre);
    if (input.unwatchedOnly) params.set('unwatchedOnly', '1');
    return fetchJson<SoloDiscoverResponse>(`/api/plex/discover?${params.toString()}`);
  },

  getContinueWatching: () => fetchJson<{ items: MediaSummary[] }>('/api/plex/continue-watching'),

  getRecentlyAdded: () => fetchJson<{ items: MediaSummary[] }>('/api/plex/recently-added'),

  getSectionItems: (sectionId: string, start = 0, size = 48) =>
    fetchJson<{ items: MediaSummary[]; totalSize: number }>(
      `/api/plex/sections/${encodeURIComponent(sectionId)}?start=${start}&size=${size}`
    ),

  getChildren: (ratingKey: string) =>
    fetchJson<{ items: MediaSummary[] }>(`/api/plex/children/${encodeURIComponent(ratingKey)}`),

  searchPlex: (q: string) =>
    fetchJson<{ items: MediaSummary[] }>(`/api/plex/search?q=${encodeURIComponent(q)}`),

  getMediaDetails: (ratingKey: string) =>
    fetchJson<{ item: MediaDetails }>(`/api/plex/metadata/${encodeURIComponent(ratingKey)}`),

  // Rooms
  createRoom: (input: {
    name?: string;
    slug?: string;
    pin?: string;
    purpose?: 'watch' | 'picker';
    hostOnlyControl?: boolean;
    streamMode?: StreamMode;
    ecoQuality?: QualityPreset;
    initialRatingKey?: string;
    autoStartSwipe?: SwipeMatchConfig;
  }) =>
    fetchJson<{
      code: string;
      name: string;
      purpose?: 'watch' | 'picker';
      hasPin: boolean;
      hostOnlyControl: boolean;
      streamMode: StreamMode;
      ecoQuality: QualityPreset;
    }>('/api/rooms', {
      method: 'POST',
      body: JSON.stringify(input)
    }),

  getRoomInfo: (code: string) =>
    fetchJson<RoomPublicInfo>(
      `/api/rooms/${encodeURIComponent(code)}/info`,
      {},
      code
    ),

  joinRoom: async (
    code: string,
    input: { name: string; pin?: string; forceGuestSeat?: boolean }
  ) => {
    const previewGuest = isGuestPreviewTab();
    const res = await fetchJson<{
      joined: boolean;
      role: 'host' | 'guest';
      participantId: string;
      name: string;
      roomCode: string;
      guestToken?: string;
    }>(
      `/api/rooms/${encodeURIComponent(code)}/join`,
      {
        method: 'POST',
        body: JSON.stringify({ ...input, previewGuest })
      },
      code
    );
    if (previewGuest && res.guestToken) {
      setPreviewGuestToken(code, res.guestToken);
    }
    return res;
  },

  createRoomPlexLinkPin: (code: string) =>
    fetchJson<{ id: number; code: string; authUrl: string }>(
      `/api/rooms/${encodeURIComponent(code)}/plex-link/pin`,
      { method: 'POST' },
      code
    ),

  pollRoomPlexLinkPin: (code: string, pinId: number) =>
    fetchJson<{ linked: boolean }>(
      `/api/rooms/${encodeURIComponent(code)}/plex-link/pin/${pinId}`,
      {},
      code
    ),

  mintStream: (
    code: string,
    input: {
      ratingKey: string;
      quality: QualityPreset;
      audioStreamId?: number;
      subtitleStreamId?: number;
    }
  ) =>
    fetchJson<StreamSessionResponse>(
      `/api/rooms/${encodeURIComponent(code)}/stream`,
      {
        method: 'POST',
        body: JSON.stringify(input)
      },
      code
    )
};
