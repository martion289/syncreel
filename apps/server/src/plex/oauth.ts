import type { DiscoveredPlexConnection, DiscoveredPlexServer, UserRole } from '@syncreel/shared';

export interface PlexPinCreated {
  id: number;
  code: string;
  authUrl: string;
  expiresAt?: string;
}

export interface PlexPinCheckResult {
  claimed: boolean;
  authToken: string | null;
}

export interface VerifiedPlexUser {
  role: UserRole;
  plexUserId: number;
  username: string;
  email?: string;
  thumb?: string;
  serverMachineId: string;
  serverName: string;
}

function plexHeaders(clientId: string, token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Plex-Client-Identifier': clientId,
    'X-Plex-Product': 'SyncReel',
    'X-Plex-Version': '1.0.0',
    'X-Plex-Platform': 'Web',
    'X-Plex-Device': 'SyncReel Server'
  };
  if (token) {
    headers['X-Plex-Token'] = token;
  }
  return headers;
}

/** Validate and normalize a same-origin relative return path. */
export function sanitizeReturnPath(returnPath?: string): string {
  if (!returnPath || typeof returnPath !== 'string') return '/';
  if (/[\r\n\0]/.test(returnPath)) return '/';
  const trimmed = returnPath.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return '/';
  }
  return trimmed;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const first = raw.split(',')[0]?.trim();
  return first || undefined;
}

export interface BuildSameOriginForwardUrlParams {
  protocol?: string;
  forwardedProto?: string;
  host?: string;
  forwardedHost?: string;
  fallbackIsHttps: boolean;
  returnPath?: string;
  pinId: number;
  pinParamName?: 'authPin' | 'setupPin';
}

/**
 * Construct a strict same-origin `forwardUrl` for Plex OAuth PIN completion,
 * appending `?authPin=<id>` (or `?setupPin=<id>`) while stripping stale params.
 */
export function buildSameOriginForwardUrl(
  params: BuildSameOriginForwardUrlParams
): string | undefined {
  const rawHost = firstHeaderValue(params.forwardedHost) ?? firstHeaderValue(params.host);
  if (!rawHost || /[\s/\\@?#]/.test(rawHost)) {
    return undefined;
  }

  const candidateProto =
    firstHeaderValue(params.forwardedProto)?.toLowerCase() ??
    params.protocol?.trim().toLowerCase();
  const proto =
    candidateProto === 'http' || candidateProto === 'https'
      ? candidateProto
      : params.fallbackIsHttps
        ? 'https'
        : 'http';

  const origin = `${proto}://${rawHost}`;
  try {
    const baseUrl = new URL(origin);
    if ((baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') || !baseUrl.hostname) {
      return undefined;
    }

    const url = new URL(sanitizeReturnPath(params.returnPath), baseUrl);
    if (url.origin !== baseUrl.origin) {
      return undefined;
    }

    url.searchParams.delete('authPin');
    url.searchParams.delete('setupPin');
    url.searchParams.set(params.pinParamName ?? 'authPin', String(params.pinId));
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Build a `forwardUrl` factory from an incoming Fastify/HTTP request and return path. */
export function createRequestForwardUrlBuilder(
  req: { protocol?: string; headers: Record<string, string | string[] | undefined> },
  fallbackIsHttps: boolean,
  returnPath: string | undefined,
  pinParamName: 'authPin' | 'setupPin'
): (pinId: number) => string | undefined {
  return (pinId: number) =>
    buildSameOriginForwardUrl({
      protocol: req.protocol,
      forwardedProto: firstHeaderValue(req.headers['x-forwarded-proto']),
      host: firstHeaderValue(req.headers.host),
      forwardedHost: firstHeaderValue(req.headers['x-forwarded-host']),
      fallbackIsHttps,
      returnPath,
      pinId,
      pinParamName
    });
}

export async function createPlexAuthPin(
  clientId: string,
  fetchFn: typeof fetch = fetch,
  options?: { buildForwardUrl?: (pinId: number) => string | undefined }
): Promise<PlexPinCreated> {
  const res = await fetchFn('https://plex.tv/api/v2/pins?strong=true', {
    method: 'POST',
    headers: plexHeaders(clientId)
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to create Plex auth PIN (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { id: number; code: string; expiresAt?: string };
  const params = new URLSearchParams({
    clientID: clientId,
    code: data.code,
    'context[device][product]': 'SyncReel'
  });

  const forwardUrl = options?.buildForwardUrl?.(data.id);
  if (forwardUrl && (forwardUrl.startsWith('https://') || forwardUrl.startsWith('http://'))) {
    params.set('forwardUrl', forwardUrl);
  }

  return {
    id: data.id,
    code: data.code,
    authUrl: `https://app.plex.tv/auth#?${params.toString()}`,
    expiresAt: data.expiresAt
  };
}

export async function checkPlexAuthPin(
  clientId: string,
  pinId: number,
  fetchFn: typeof fetch = fetch
): Promise<PlexPinCheckResult> {
  const res = await fetchFn(`https://plex.tv/api/v2/pins/${pinId}`, {
    method: 'GET',
    headers: plexHeaders(clientId)
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to check Plex auth PIN (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { authToken?: string | null };
  return {
    claimed: Boolean(data.authToken),
    authToken: data.authToken ?? null
  };
}

async function probeConnection(
  uri: string,
  token: string,
  clientId: string,
  expectedMachineId: string,
  fetchFn: typeof fetch
): Promise<{ reachable: boolean; latencyMs?: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const clean = uri.replace(/\/+$/, '');
    const res = await fetchFn(`${clean}/identity`, {
      headers: plexHeaders(clientId, token),
      signal: controller.signal
    });
    if (!res.ok) return { reachable: false };
    const json = (await res.json()) as { MediaContainer?: { machineIdentifier?: string } };
    if (
      expectedMachineId &&
      json.MediaContainer?.machineIdentifier &&
      json.MediaContainer.machineIdentifier !== expectedMachineId
    ) {
      return { reachable: false };
    }
    return { reachable: true, latencyMs: Math.max(1, Date.now() - started) };
  } catch {
    return { reachable: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverPlexServers(
  token: string,
  clientId: string,
  fetchFn: typeof fetch = fetch
): Promise<DiscoveredPlexServer[]> {
  const res = await fetchFn('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=0', {
    headers: plexHeaders(clientId, token)
  });
  if (!res.ok) {
    throw new Error(`Failed to discover Plex servers (${res.status})`);
  }

  const resources = (await res.json()) as Array<{
    name?: string;
    clientIdentifier?: string;
    owned?: boolean;
    provides?: string;
    connections?: Array<{ uri: string; local?: boolean; relay?: boolean; protocol?: string }>;
  }>;

  const servers = resources.filter(
    (r) => r.owned && (r.provides ?? '').split(',').includes('server') && r.clientIdentifier
  );

  const results: DiscoveredPlexServer[] = [];
  for (const srv of servers) {
    const machineId = srv.clientIdentifier!;
    const rawConns = srv.connections ?? [];
    const seen = new Set<string>();
    const candidateUris: Array<{ uri: string; local: boolean; relay: boolean }> = [];

    for (const c of rawConns) {
      if (!c.uri || seen.has(c.uri)) continue;
      seen.add(c.uri);
      candidateUris.push({ uri: c.uri, local: Boolean(c.local), relay: Boolean(c.relay) });
    }

    // Also probe Docker host gateway & localhost convenience URLs
    for (const extra of ['http://host.docker.internal:32400', 'http://127.0.0.1:32400']) {
      if (!seen.has(extra)) {
        seen.add(extra);
        candidateUris.push({ uri: extra, local: true, relay: false });
      }
    }

    const probed: DiscoveredPlexConnection[] = await Promise.all(
      candidateUris.map(async (c) => {
        const resProbe = await probeConnection(c.uri, token, clientId, machineId, fetchFn);
        return {
          uri: c.uri,
          local: c.local,
          relay: c.relay,
          reachable: resProbe.reachable,
          latencyMs: resProbe.latencyMs
        };
      })
    );

    probed.sort((a, b) => {
      if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
      if (a.local !== b.local) return a.local ? -1 : 1;
      return (a.latencyMs ?? 99999) - (b.latencyMs ?? 99999);
    });

    results.push({
      name: srv.name || 'Plex Media Server',
      machineIdentifier: machineId,
      owned: true,
      connections: probed
    });
  }

  return results;
}

export async function verifyPlexUserForServer(options: {
  token: string;
  plexUrl: string;
  clientId: string;
  expectedMachineId?: string;
  allowFriends?: boolean;
  fetchFn?: typeof fetch;
}): Promise<VerifiedPlexUser> {
  const {
    token,
    plexUrl,
    clientId,
    expectedMachineId,
    allowFriends = false,
    fetchFn = fetch
  } = options;
  const normalizedPlexUrl = plexUrl.replace(/\/+$/, '');

  // 1. Fetch server machineIdentifier from PMS
  const idRes = await fetchFn(`${normalizedPlexUrl}/identity`, {
    headers: plexHeaders(clientId, token)
  });
  if (!idRes.ok) {
    throw new Error(`Cannot reach Plex Media Server at ${normalizedPlexUrl} (${idRes.status})`);
  }
  const idJson = (await idRes.json()) as {
    MediaContainer?: { machineIdentifier?: string; friendlyName?: string };
  };
  const machineId = idJson.MediaContainer?.machineIdentifier;
  if (!machineId) {
    throw new Error('Plex server /identity response did not include machineIdentifier');
  }
  if (expectedMachineId && machineId !== expectedMachineId) {
    throw new Error('Selected server machineIdentifier does not match configured Plex server');
  }

  // 2. Fetch user profile from plex.tv
  const userRes = await fetchFn('https://plex.tv/api/v2/user', {
    headers: plexHeaders(clientId, token)
  });
  if (!userRes.ok) {
    throw new Error(`Failed to verify Plex user profile (${userRes.status})`);
  }
  const userJson = (await userRes.json()) as {
    id: number;
    username?: string;
    title?: string;
    email?: string;
    thumb?: string;
  };

  // 3. Check resources for ownership or shared access
  let serverName = idJson.MediaContainer?.friendlyName || 'Plex Media Server';
  let hasServerAccess = false;
  let isOwner = false;

  const resourcesRes = await fetchFn('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=0', {
    headers: plexHeaders(clientId, token)
  });
  if (resourcesRes.ok) {
    const resources = (await resourcesRes.json()) as Array<{
      clientIdentifier?: string;
      owned?: boolean;
      name?: string;
    }>;
    const match = resources.find((r) => r.clientIdentifier === machineId);
    if (match) {
      if (match.name) serverName = match.name;
      hasServerAccess = true;
      isOwner = Boolean(match.owned);
    }
  }

  // 4. Fallback ownership check directly against PMS /myplex/account
  if (!isOwner) {
    const acctRes = await fetchFn(`${normalizedPlexUrl}/myplex/account`, {
      headers: plexHeaders(clientId, token)
    });
    if (acctRes.ok) {
      isOwner = true;
      hasServerAccess = true;
    }
  }

  if (!isOwner && !(allowFriends && hasServerAccess)) {
    throw new Error(
      allowFriends
        ? 'Your Plex account does not have access to this Plex Media Server.'
        : 'Only the Plex Server Owner can sign in (Plex Friend hosting is disabled by admin).'
    );
  }

  return {
    role: isOwner ? 'admin' : 'friend',
    plexUserId: userJson.id,
    username: userJson.username || userJson.title || 'Plex Host',
    email: userJson.email,
    thumb: userJson.thumb,
    serverMachineId: machineId,
    serverName
  };
}
