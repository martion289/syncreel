import { describe, expect, it } from 'vitest';
import {
  clearPendingAuthPin,
  consumeReturnedAuthPin,
  getCurrentReturnPath,
  resolveAuthSessionFromReturn,
  savePendingAuthPin
} from './plexAuthReturn.js';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (idx) => Array.from(map.keys())[idx] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    }
  };
}

describe('plexAuthReturn', () => {
  it('builds sanitized current return paths without stale authPin/setupPin params', () => {
    expect(
      getCurrentReturnPath({
        pathname: '/swipe',
        search: '?mode=solo&authPin=123&setupPin=456'
      })
    ).toBe('/swipe?mode=solo');
    expect(
      getCurrentReturnPath({
        pathname: '/',
        search: '?authPin=99'
      })
    ).toBe('/');
  });

  it('consumes authPin from URL, preserves unrelated params & hash, and cleans history + storage', () => {
    const storage = createMemoryStorage();
    savePendingAuthPin('auth', 111, storage);

    let replacedUrl = '';
    const consumed = consumeReturnedAuthPin('auth', {
      location: {
        pathname: '/swipe',
        search: '?category=unwatched&authPin=4242',
        hash: '#deck'
      },
      history: {
        replaceState: (_data, _unused, url) => {
          replacedUrl = String(url);
        }
      },
      storage
    });

    expect(consumed).toEqual({ pinId: 4242, fromRedirect: true });
    expect(replacedUrl).toBe('/swipe?category=unwatched#deck');
    expect(storage.getItem('syncreel_pending_auth_pin')).toBeNull();
  });

  it('falls back to fresh sessionStorage PIN when URL param is absent and ignores expired entries', () => {
    const storage = createMemoryStorage();
    storage.setItem(
      'syncreel_pending_auth_pin',
      JSON.stringify({ pinId: 777, savedAt: 1_000_000 })
    );

    const fresh = consumeReturnedAuthPin('auth', {
      location: { pathname: '/', search: '', hash: '' },
      history: { replaceState: () => {} },
      storage,
      now: 1_000_000 + 60_000
    });
    expect(fresh).toEqual({ pinId: 777, fromRedirect: false });
    expect(storage.getItem('syncreel_pending_auth_pin')).toBeNull();

    storage.setItem(
      'syncreel_pending_setup_pin',
      JSON.stringify({ pinId: 888, savedAt: 1_000_000 })
    );
    const expired = consumeReturnedAuthPin('setup', {
      location: { pathname: '/', search: '', hash: '' },
      history: { replaceState: () => {} },
      storage,
      now: 1_000_000 + 11 * 60_000
    });
    expect(expired).toBeNull();
    clearPendingAuthPin('setup', storage);
  });

  it('falls back cleanly to existing session on abandoned non-redirect back navigation', async () => {
    const existingUser = {
      role: 'admin' as const,
      plexUserId: 1,
      username: 'Ryan'
    };
    let pollCalls = 0;
    const outcome = await resolveAuthSessionFromReturn(
      { pinId: 505, fromRedirect: false },
      {
        pollPin: async () => {
          pollCalls += 1;
          return { authenticated: false };
        },
        getMe: async () => ({ authenticated: true, user: existingUser })
      }
    );

    expect(pollCalls).toBe(1);
    expect(outcome).toEqual({ user: existingUser, error: null });
  });
});
