import { useEffect, useState } from 'react';
import type { AuthUser, StreamMode } from '@syncreel/shared';
import {
  ArrowRight,
  Dices,
  Download,
  ExternalLink,
  Film,
  Leaf,
  Loader2,
  LogOut,
  Plus,
  Shield,
  Tv
} from 'lucide-react';
import { api } from '../lib/api.js';
import { generateFunRoomSlug, saveSessionRoomPin } from '../lib/inviteShare.js';
import { usePwaInstall } from '../hooks/usePwaInstall.js';
import { AdminModal } from '../components/Admin/AdminModal.js';

interface HomePageProps {
  onNavigate: (path: string) => void;
  initialUser?: AuthUser | null;
}

export function HomePage({ onNavigate, initialUser }: HomePageProps) {
  const [user, setUser] = useState<AuthUser | null>(initialUser ?? null);
  const [authLoading, setAuthLoading] = useState(initialUser === undefined);
  const [authError, setAuthError] = useState<string | null>(null);

  const [pendingAuthUrl, setPendingAuthUrl] = useState<string | null>(null);
  const [pollingPinId, setPollingPinId] = useState<number | null>(null);

  const [roomName, setRoomName] = useState('Movie Night');
  const [customSlug, setCustomSlug] = useState('');
  const [roomPin, setRoomPin] = useState('');
  const [hostOnly, setHostOnly] = useState(false);
  const [streamMode, setStreamMode] = useState<StreamMode>('per-viewer');
  const [creating, setCreating] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  const [joinCode, setJoinCode] = useState('');
  const { canPromptInstall, promptInstall } = usePwaInstall();

  useEffect(() => {
    if (initialUser !== undefined) return;
    api
      .getAuthMe()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, [initialUser]);

  useEffect(() => {
    if (!pollingPinId) return;
    let cancelled = false;

    const timer = window.setInterval(async () => {
      try {
        const res = await api.pollPlexPin(pollingPinId);
        if (!cancelled && res.authenticated && res.user) {
          setUser(res.user);
          setPollingPinId(null);
          setPendingAuthUrl(null);
          setAuthError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setAuthError(err instanceof Error ? err.message : 'Plex sign-in failed');
          setPollingPinId(null);
          setPendingAuthUrl(null);
        }
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollingPinId]);

  const handlePlexSignIn = async () => {
    setAuthError(null);
    try {
      const pin = await api.createPlexPin();
      setPendingAuthUrl(pin.authUrl);
      setPollingPinId(pin.id);
      window.open(pin.authUrl, 'plex-auth', 'width=640,height=740,noopener');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to start Plex login');
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setAuthError(null);
    try {
      const created = await api.createRoom({
        name: roomName.trim() || 'Movie Night',
        slug: customSlug.trim() || undefined,
        pin: roomPin.trim() || undefined,
        hostOnlyControl: hostOnly,
        streamMode
      });
      if (roomPin.trim()) {
        saveSessionRoomPin(created.code, roomPin.trim());
      }
      onNavigate(`/room/${created.code}?invite=1`);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Could not create room');
    } finally {
      setCreating(false);
    }
  };

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = joinCode.trim().replace(/[^A-Za-z0-9-]/g, '');
    if (!cleaned) return;
    onNavigate(`/room/${cleaned}`);
  };

  return (
    <div className="min-h-screen bg-[#0E0E10] text-[#F4F2EE] flex flex-col">
      {/* Header */}
      <header className="border-b border-[#2B2B33] px-5 py-4 flex items-center justify-between max-w-5xl w-full mx-auto">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="w-8 h-8 rounded-lg" />
          <div>
            <h1 className="text-base font-bold tracking-tight text-[#F4F2EE]">SyncReel</h1>
            <p className="text-[11px] text-[#9C9AA6]">Watch Together for Plex</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canPromptInstall && (
            <button
              onClick={() => void promptInstall()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#202026] border border-[#2B2B33] text-xs font-medium text-[#F4F2EE] hover:border-[#E5A00D]/60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D]"
            >
              <Download className="w-3.5 h-3.5 text-[#E5A00D]" />
              <span>Install App</span>
            </button>
          )}
          {user?.role === 'admin' && (
            <button
              onClick={() => setAdminOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#202026] border border-[#2B2B33] text-xs font-medium text-[#F4F2EE] hover:border-[#E5A00D] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D]"
            >
              <Shield className="w-3.5 h-3.5 text-[#E5A00D]" />
              <span>Admin</span>
            </button>
          )}
          {user && (
            <button
              onClick={async () => {
                await api.logout();
                setUser(null);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[#9C9AA6] hover:text-[#F4F2EE] hover:bg-[#16161A] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D]"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Screening Entry Grid */}
      <main className="flex-1 flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Host Card */}
          <section className="rounded-2xl bg-[#16161A] border border-[#2B2B33] p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-[#E5A00D] text-xs font-semibold uppercase tracking-wider mb-3">
                <Film className="w-4 h-4" />
                <span>Host a Screening</span>
              </div>

              {authLoading ? (
                <div className="py-12 flex items-center justify-center text-[#9C9AA6] gap-2 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-[#E5A00D]" />
                  <span>Checking Plex session…</span>
                </div>
              ) : !user ? (
                <div className="space-y-4">
                  <h2 className="text-xl font-bold text-[#F4F2EE]">
                    Start a Plex screening room
                  </h2>
                  <p className="text-sm text-[#9C9AA6] leading-relaxed">
                    Sign in with Plex to browse your movies and shows, launch Swipe Match decks, and
                    host watch parties. Friends only need your invite link.
                  </p>

                  {authError && (
                    <div className="p-3 rounded-lg bg-[#D94848]/10 border border-[#D94848]/40 text-xs text-[#D94848]">
                      {authError}
                    </div>
                  )}

                  {pollingPinId ? (
                    <div className="p-4 rounded-xl bg-[#0E0E10] border border-[#2B2B33] space-y-3">
                      <div className="flex items-center gap-2 text-sm text-[#F4F2EE]">
                        <Loader2 className="w-4 h-4 animate-spin text-[#E5A00D]" />
                        <span>Waiting for Plex sign-in…</span>
                      </div>
                      {pendingAuthUrl && (
                        <a
                          href={pendingAuthUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-[#E5A00D] hover:underline"
                        >
                          <span>Popup didn&apos;t open? Click here to sign in on Plex</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => void handlePlexSignIn()}
                      className="w-full py-3 px-4 rounded-xl bg-[#E5A00D] text-[#111113] font-semibold text-sm hover:bg-[#f0ad1c] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D]"
                    >
                      Sign in with Plex
                    </button>
                  )}
                </div>
              ) : (
                <form onSubmit={handleCreateRoom} className="space-y-3.5">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#0E0E10] border border-[#2B2B33]">
                    <div>
                      <p className="text-xs font-semibold text-[#F4F2EE]">{user.username}</p>
                      <p className="text-[11px] text-[#34C77B]">
                        Connected to {user.serverName || 'Plex Server'}
                      </p>
                    </div>
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#E5A00D]/15 text-[#E5A00D]">
                      {user.role === 'admin' ? 'Owner' : 'Friend Host'}
                    </span>
                  </div>

                  {authError && (
                    <div className="p-3 rounded-lg bg-[#D94848]/10 border border-[#D94848]/40 text-xs text-[#D94848]">
                      {authError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="room-name"
                        className="block text-xs font-medium text-[#9C9AA6] mb-1"
                      >
                        Room Name
                      </label>
                      <input
                        id="room-name"
                        type="text"
                        value={roomName}
                        onChange={(e) => setRoomName(e.target.value)}
                        maxLength={80}
                        className="w-full px-3 py-2 rounded-xl bg-[#0E0E10] border border-[#2B2B33] text-xs text-[#F4F2EE] focus:outline-none focus:border-[#E5A00D]"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="custom-slug"
                        className="block text-xs font-medium text-[#9C9AA6] mb-1"
                      >
                        Custom URL (Optional)
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          id="custom-slug"
                          type="text"
                          value={customSlug}
                          onChange={(e) => setCustomSlug(e.target.value.toLowerCase())}
                          maxLength={32}
                          placeholder="friday-night"
                          className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-[#0E0E10] border border-[#2B2B33] text-xs font-mono text-[#F4F2EE] placeholder-[#686670] focus:outline-none focus:border-[#E5A00D]"
                        />
                        <button
                          type="button"
                          onClick={() => setCustomSlug(generateFunRoomSlug())}
                          aria-label="Generate memorable room code"
                          title="Generate fun room link"
                          className="p-2 rounded-xl bg-[#0E0E10] border border-[#2B2B33] text-[#E5A00D] hover:border-[#E5A00D] hover:bg-[#202026] transition shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D]"
                        >
                          <Dices className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-[10px] font-mono text-[#686670] mt-1 truncate">
                        {typeof window !== 'undefined' ? window.location.host : ''}/room/
                        <span className="text-[#9C9AA6]">
                          {customSlug.trim() || '<random-code>'}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="room-pin"
                      className="block text-xs font-medium text-[#9C9AA6] mb-1"
                    >
                      Optional Room PIN (leave blank for link-only)
                    </label>
                    <input
                      id="room-pin"
                      type="password"
                      value={roomPin}
                      onChange={(e) => setRoomPin(e.target.value)}
                      maxLength={24}
                      placeholder="••••"
                      className="w-full px-3 py-2 rounded-xl bg-[#0E0E10] border border-[#2B2B33] text-xs text-[#F4F2EE] placeholder-[#686670] focus:outline-none focus:border-[#E5A00D]"
                    />
                  </div>

                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2.5 text-xs text-[#9C9AA6] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hostOnly}
                        onChange={(e) => setHostOnly(e.target.checked)}
                        className="w-4 h-4 accent-[#E5A00D]"
                      />
                      <span>Host-only playback control (lock guest pause/seek)</span>
                    </label>

                    <label className="flex items-center gap-2.5 text-xs text-[#9C9AA6] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={streamMode === 'eco-shared'}
                        onChange={(e) =>
                          setStreamMode(e.target.checked ? 'eco-shared' : 'per-viewer')
                        }
                        className="w-4 h-4 accent-[#34C77B]"
                      />
                      <span className="inline-flex items-center gap-1.5">
                        <Leaf className="w-3.5 h-3.5 text-[#34C77B]" />
                        <span>Eco Shared Stream (1 transcode shared by whole room)</span>
                      </span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={creating}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#E5A00D] text-[#111113] font-semibold text-sm hover:bg-[#f0ad1c] disabled:opacity-60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D]"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{creating ? 'Creating Room…' : 'Create Screening Room'}</span>
                  </button>
                </form>
              )}
            </div>
          </section>

          {/* Join by Code Card (Friends & Smart TV Browsers) */}
          <section className="rounded-2xl bg-[#16161A] border border-[#2B2B33] p-6 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#9C9AA6] text-xs font-semibold uppercase tracking-wider">
                <Tv className="w-4 h-4 text-[#E5A00D]" />
                <span>Join a Room</span>
              </div>

              <h2 className="text-xl font-bold text-[#F4F2EE]">Have a room code or name?</h2>
              <p className="text-sm text-[#9C9AA6] leading-relaxed">
                Enter the 6-character code or custom room slug shared by the host. Works on
                laptops, phones, and Smart TV browsers — no Plex account needed.
              </p>

              <form onSubmit={handleJoinByCode} className="space-y-3 pt-1">
                <div>
                  <label
                    htmlFor="join-code"
                    className="block text-xs font-medium text-[#9C9AA6] mb-1.5"
                  >
                    Room Code or Slug
                  </label>
                  <input
                    id="join-code"
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    maxLength={32}
                    placeholder="K7M4QP or friday-night"
                    className="w-full px-4 py-3 rounded-xl bg-[#0E0E10] border border-[#2B2B33] font-mono text-base tracking-wide text-[#F4F2EE] placeholder-[#4E4C56] focus:outline-none focus:border-[#E5A00D]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!joinCode.trim()}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#202026] border border-[#2B2B33] text-sm font-semibold text-[#F4F2EE] hover:border-[#E5A00D] disabled:opacity-50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D]"
                >
                  <span>Enter Screening Room</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            </div>

            <div className="mt-6 pt-4 border-t border-[#2B2B33] text-xs text-[#686670] leading-relaxed">
              Tip: Want it on your TV? Open the invite link on your phone or laptop and tap{' '}
              <span className="text-[#9C9AA6]">AirPlay</span> or{' '}
              <span className="text-[#9C9AA6]">Chromecast</span> inside the player.
            </div>
          </section>
        </div>
      </main>

      {user?.role === 'admin' && (
        <AdminModal open={adminOpen} onClose={() => setAdminOpen(false)} />
      )}
    </div>
  );
}
