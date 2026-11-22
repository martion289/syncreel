import crypto from 'node:crypto';
import type { UserRole } from '@syncreel/shared';

export const HOST_COOKIE_NAME = 'wt_host';
export const GUEST_COOKIE_NAME = 'wt_guest';

export interface HostSessionPayload {
  kind: 'host';
  role: UserRole;
  plexUserId: number;
  username: string;
  exp: number;
}

export interface GuestSessionPayload {
  kind: 'guest';
  roomCode: string;
  participantId: string;
  name: string;
  isSeat?: boolean;
  exp: number;
}

export type SessionPayload = HostSessionPayload | GuestSessionPayload;

export function signSessionToken(payload: SessionPayload, appSecret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', appSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionToken<T extends SessionPayload>(
  token: string | undefined,
  appSecret: string,
  expectedKind: T['kind']
): T | null {
  if (!token) return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;

  const body = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!body || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', appSecret).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed || parsed.kind !== expectedKind) return null;
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    if (parsed.kind === 'host' && !parsed.role) {
      (parsed as HostSessionPayload).role = 'admin';
    }
    return parsed as T;
  } catch {
    return null;
  }
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPin(pin: string, storedHash: string): boolean {
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) return false;
  const actual = crypto.scryptSync(pin, salt, 32);
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function isAllowedWsOrigin(
  originHeader: string | undefined,
  publicUrl: string,
  hostHeader: string | undefined
): boolean {
  // Non-browser WS clients or tests may omit Origin
  if (!originHeader) return true;

  let originUrl: URL;
  try {
    originUrl = new URL(originHeader);
  } catch {
    return false;
  }

  if (publicUrl) {
    try {
      const pub = new URL(publicUrl);
      if (originUrl.origin === pub.origin) return true;
    } catch {
      // Ignore malformed publicUrl
    }
  }

  if (hostHeader) {
    if (originUrl.host.toLowerCase() === hostHeader.toLowerCase()) {
      return true;
    }
  }

  return false;
}

export class PinRateLimiter {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts = 10, windowMs = 5 * 60_000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  private key(ip: string, roomCode: string): string {
    return `${ip}:${roomCode.toUpperCase()}`;
  }

  isBlocked(ip: string, roomCode: string, now = Date.now()): boolean {
    const k = this.key(ip, roomCode);
    const entry = this.attempts.get(k);
    if (!entry) return false;
    if (now >= entry.resetAt) {
      this.attempts.delete(k);
      return false;
    }
    return entry.count >= this.maxAttempts;
  }

  recordFailure(ip: string, roomCode: string, now = Date.now()): void {
    const k = this.key(ip, roomCode);
    const existing = this.attempts.get(k);
    if (!existing || now >= existing.resetAt) {
      this.attempts.set(k, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    existing.count += 1;
  }

  clear(ip: string, roomCode: string): void {
    this.attempts.delete(this.key(ip, roomCode));
  }
}
