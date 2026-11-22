import type { AuthUser, DiscoveredPlexServer } from '@syncreel/shared';

export type AuthPinKind = 'auth' | 'setup';

export interface ReturnedAuthPin {
  pinId: number;
  fromRedirect: boolean;
}

export interface PlexAuthReturnEnv {
  location?: Pick<Location, 'pathname' | 'search' | 'hash'>;
  history?: Pick<History, 'replaceState'>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  now?: number;
}

const PENDING_PIN_TTL_MS = 10 * 60_000;
const RETRY_DELAY_MS = 800;
const MAX_REDIRECT_RETRIES = 6;

const inflightPinResolutions = new Map<string, Promise<unknown>>();

function getStorageKey(kind: AuthPinKind): string {
  return `syncreel_pending_${kind}_pin`;
}

function getQueryParamName(kind: AuthPinKind): 'authPin' | 'setupPin' {
  return kind === 'setup' ? 'setupPin' : 'authPin';
}

function defaultLocation(): Pick<Location, 'pathname' | 'search' | 'hash'> | undefined {
  return typeof window !== 'undefined' ? window.location : undefined;
}

function defaultHistory(): Pick<History, 'replaceState'> | undefined {
  return typeof window !== 'undefined' ? window.history : undefined;
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Return the current relative path + search string, stripping any transient
 * `authPin` or `setupPin` query params so `forwardUrl` stays clean.
 */
export function getCurrentReturnPath(loc?: Pick<Location, 'pathname' | 'search'>): string {
  const target = loc ?? defaultLocation();
  if (!target) return '/';

  const params = new URLSearchParams(target.search || '');
  params.delete('authPin');
  params.delete('setupPin');
  const qs = params.toString();
  const pathname = target.pathname && target.pathname.startsWith('/') ? target.pathname : '/';
  return qs ? `${pathname}?${qs}` : pathname;
}

export function savePendingAuthPin(
  kind: AuthPinKind,
  pinId: number,
  storage?: Pick<Storage, 'setItem'>
): void {
  const store = storage ?? defaultStorage();
  if (!store) return;
  try {
    store.setItem(getStorageKey(kind), JSON.stringify({ pinId, savedAt: Date.now() }));
  } catch {
    // Ignore private-browsing / storage quota failures
  }
}

export function clearPendingAuthPin(
  kind: AuthPinKind,
  storage?: Pick<Storage, 'removeItem'>
): void {
  const store = storage ?? defaultStorage();
  if (!store) return;
  try {
    store.removeItem(getStorageKey(kind));
  } catch {
    // Ignore storage access errors
  }
}

/**
 * Inspect `?authPin=` / `?setupPin=` in the URL first (stripping it via
 * `history.replaceState`), then fall back to `sessionStorage` in case the user
 * returned manually without Plex honoring `forwardUrl`.
 */
export function consumeReturnedAuthPin(
  kind: AuthPinKind,
  env?: PlexAuthReturnEnv
): ReturnedAuthPin | null {
  const loc = env?.location ?? defaultLocation();
  const hist = env?.history ?? defaultHistory();
  const store = env?.storage ?? defaultStorage();
  const now = env?.now ?? Date.now();
  const paramName = getQueryParamName(kind);

  if (loc) {
    const params = new URLSearchParams(loc.search || '');
    const raw = params.get(paramName);
    if (raw !== null) {
      const parsed = Number(raw);
      params.delete(paramName);
      const qs = params.toString();
      const pathname = loc.pathname && loc.pathname.startsWith('/') ? loc.pathname : '/';
      const cleanUrl = `${pathname}${qs ? `?${qs}` : ''}${loc.hash || ''}`;
      try {
        hist?.replaceState?.({}, '', cleanUrl);
      } catch {
        // Ignore history restriction errors
      }
      clearPendingAuthPin(kind, store);
      if (Number.isInteger(parsed) && parsed > 0) {
        return { pinId: parsed, fromRedirect: true };
      }
    }
  }

  if (!store) return null;
  try {
    const rawStored = store.getItem(getStorageKey(kind));
    clearPendingAuthPin(kind, store);
    if (!rawStored) return null;
    const parsed = JSON.parse(rawStored) as { pinId?: unknown; savedAt?: unknown };
    if (
      typeof parsed.pinId === 'number' &&
      Number.isInteger(parsed.pinId) &&
      parsed.pinId > 0 &&
      typeof parsed.savedAt === 'number' &&
      now - parsed.savedAt >= -5_000 &&
      now - parsed.savedAt < PENDING_PIN_TTL_MS
    ) {
      return { pinId: parsed.pinId, fromRedirect: false };
    }
  } catch {
    clearPendingAuthPin(kind, store);
  }
  return null;
}

async function pollPinWithRetry<T>(
  cacheKey: string,
  fromRedirect: boolean,
  pollFn: () => Promise<T>,
  isComplete: (res: T) => boolean
): Promise<T> {
  const existing = inflightPinResolutions.get(cacheKey) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  const run = (async () => {
    const totalAttempts = fromRedirect ? MAX_REDIRECT_RETRIES + 1 : 1;
    let latest = await pollFn();
    for (let attempt = 1; attempt < totalAttempts; attempt += 1) {
      if (isComplete(latest)) {
        return latest;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      latest = await pollFn();
    }
    return latest;
  })();

  inflightPinResolutions.set(cacheKey, run);
  try {
    return await run;
  } finally {
    setTimeout(() => {
      if (inflightPinResolutions.get(cacheKey) === run) {
        inflightPinResolutions.delete(cacheKey);
      }
    }, 3_000);
  }
}

/**
 * Claim a returned account sign-in PIN (retrying briefly after `forwardUrl` redirect)
 * and fall back cleanly to checking the active cookie session when appropriate.
 */
export async function resolveAuthSessionFromReturn(
  returned: ReturnedAuthPin,
  handlers: {
    pollPin: (pinId: number) => Promise<{ authenticated: boolean; user?: AuthUser }>;
    getMe: () => Promise<{ authenticated: boolean; user: AuthUser | null }>;
  }
): Promise<{ user: AuthUser | null; error: string | null }> {
  try {
    const res = await pollPinWithRetry(
      `auth:${returned.pinId}`,
      returned.fromRedirect,
      () => handlers.pollPin(returned.pinId),
      (r) => r.authenticated && Boolean(r.user)
    );
    if (res.authenticated && res.user) {
      return { user: res.user, error: null };
    }
  } catch (err) {
    if (returned.fromRedirect) {
      return {
        user: null,
        error: err instanceof Error ? err.message : 'Account sign-in failed'
      };
    }
  }

  try {
    const me = await handlers.getMe();
    if (me.user) {
      return { user: me.user, error: null };
    }
  } catch {
    // Ignore cookie session check failure
  }

  return {
    user: null,
    error: returned.fromRedirect ? 'Account sign-in was not completed. Please try again.' : null
  };
}

export interface SetupPollResponse {
  claimed: boolean;
  setupTicket?: string;
  username?: string;
  servers?: DiscoveredPlexServer[];
}

/** Claim a returned initial-setup OAuth PIN with brief retries after `forwardUrl` redirect. */
export async function resolveSetupPinFromReturn(
  returned: ReturnedAuthPin,
  pollSetupPin: (pinId: number) => Promise<SetupPollResponse>
): Promise<{ result: SetupPollResponse | null; error: string | null }> {
  try {
    const res = await pollPinWithRetry(
      `setup:${returned.pinId}`,
      returned.fromRedirect,
      () => pollSetupPin(returned.pinId),
      (r) => r.claimed && Boolean(r.setupTicket)
    );
    if (res.claimed && res.setupTicket) {
      return { result: res, error: null };
    }
    return {
      result: null,
      error: returned.fromRedirect ? 'Account sign-in was not completed. Please try again.' : null
    };
  } catch (err) {
    return {
      result: null,
      error: returned.fromRedirect
        ? err instanceof Error
          ? err.message
          : 'Account sign-in failed'
        : null
    };
  }
}
