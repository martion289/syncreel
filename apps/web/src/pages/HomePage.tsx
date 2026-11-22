import { useEffect, useRef, useState } from 'react';
import type { AuthUser, StreamMode } from '@syncreel/shared';
import {
  ArrowRight,
  Dices,
  Download,
  Film,
  Flame,
  Leaf,
  Loader2,
  LogOut,
  Plus,
  Shield,
  Swords,
  Tv
} from 'lucide-react';
import { api } from '../lib/api.js';
import { generateFunRoomSlug, saveSessionRoomPin } from '../lib/inviteShare.js';
import {
  consumeReturnedAuthPin,
  getCurrentReturnPath,
  resolveAuthSessionFromReturn,
  savePendingAuthPin,
  type ReturnedAuthPin
} from '../lib/plexAuthReturn.js';
import { usePwaInstall } from '../hooks/usePwaInstall.js';
import { AdminModal } from '../components/Admin/AdminModal.js';

interface HomePageProps {
  onNavigate: (path: string) => void;
  initialUser?: AuthUser | null;
}

export function HomePage({ onNavigate, initialUser }: HomePageProps) {
  const [user, setUser] = useState<AuthUser | null>(initialUser ?? null);
  const [authLoading, setAuthLoading] = useState(initialUser === undefined);
  const [completingSignIn, setCompletingSignIn] = useState(false);
  const [redirectingAuth, setRedirectingAuth] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const returnedPinRef = useRef<ReturnedAuthPin | null | undefined>(undefined);

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
    let cancelled = false;
    if (returnedPinRef.current === undefined) {
      returnedPinRef.current = consumeReturnedAuthPin('auth');
    }
    const returned = returnedPinRef.current;

    if (returned) {
      if (returned.fromRedirect) setCompletingSignIn(true);
      resolveAuthSessionFromReturn(returned, {
        pollPin: api.pollPlexPin,
        getMe: api.getAuthMe
      })
        .then((outcome) => {
          if (cancelled) return;
          setUser(outcome.user);
          if (outcome.error) setAuthError(outcome.error);
        })
        .finally(() => {
          if (!cancelled) {
            setCompletingSignIn(false);
            setAuthLoading(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    api
      .getAuthMe()
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialUser]);

  const handleMediaSignIn = async () => {
    setAuthError(null);
    setRedirectingAuth(true);
    try {
      const pin = await api.createPlexPin(getCurrentReturnPath());
      savePendingAuthPin('auth', pin.id);
      window.location.assign(pin.authUrl);
    } catch (err) {
      setRedirectingAuth(false);
      setAuthError(err instanceof Error ? err.message : 'Unable to start sign-in');
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
      try {
        sessionStorage.setItem(`syncreel_host_created_${created.code.toLowerCase()}`, '1');
      } catch {
        // Ignore storage failures
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
    <div className="min-h-screen bg-[#07080A] text-[#F5F7FA] flex flex-col">
      {/* Header */}
      <header className="border-b border-white/8 px-5 py-4 flex items-center justify-between max-w-5xl w-full mx-auto">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="w-8 h-8 rounded-lg" />
          <div>
            <h1 className="font-display text-base font-bold tracking-tight text-[#F5F7FA]">
              SyncReel
            </h1>
            <p className="text-[11px] text-[#98A0B0]">Watch Together &amp; Movie Picker</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canPromptInstall && (
            <button
              onClick={() => void promptInstall()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#101216] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install App</span>
            </button>
          )}
          {user?.role === 'admin' && (
            <button
              onClick={() => setAdminOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#101216] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Admin</span>
            </button>
          )}
          {user && (
            <button
              onClick={async () => {
                await api.logout();
                setUser(null);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[#98A0B0] hover:text-[#F5F7FA] hover:bg-[#101216] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Screening Entry Grid */}
      <main className="flex-1 flex flex-col items-center justify-center px-5 py-8 gap-6">
        {/* Standalone & Couch Movie Picker Launcher */}
        <section className="w-full max-w-4xl rounded-2xl bg-[#101216] border border-white/12 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#98A0B0]">
              <Flame className="w-3.5 h-3.5 text-[#F5F7FA]" />
              <span>Standalone &amp; Couch Mode</span>
            </div>
            <h2 className="font-display text-lg sm:text-xl font-bold text-[#F5F7FA] tracking-tight">
              Not sure what to watch? Try Swipe + 1v1 Knockout
            </h2>
            <p className="text-xs text-[#98A0B0] leading-relaxed max-w-xl">
              Jump straight into swiping solo, passing one phone as a couple, or scanning a QR code
              on the couch — then settle the finalists in a live 1v1 bracket.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/swipe')}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#F5F7FA] text-[#07080A] text-sm font-bold hover:bg-white transition shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <Swords className="w-4 h-4" />
            <span>Open Movie Picker</span>
          </button>
        </section>

        <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Host Card */}
          <section className="rounded-2xl bg-[#101216] border border-white/10 p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-[#98A0B0] text-[11px] font-semibold uppercase tracking-wider mb-3">
                <Film className="w-3.5 h-3.5 text-[#F5F7FA]" />
                <span>Host a Screening</span>
              </div>

              {authLoading ? (
                <div className="py-12 flex items-center justify-center text-[#98A0B0] gap-2 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-[#F5F7FA]" />
                  <span>{completingSignIn ? 'Completing sign-in…' : 'Checking session…'}</span>
                </div>
              ) : !user ? (
                <div className="space-y-4">
                  <h2 className="font-display text-xl font-bold text-[#F5F7FA] tracking-tight">
                    Start a screening room
                  </h2>
                  <p className="text-sm text-[#98A0B0] leading-relaxed">
                    Sign in with your media account to browse your library, launch Swipe Match decks,
                    and host synchronized watch parties. Friends only need your invite link.
                  </p>

                  {authError && (
                    <div className="p-3 rounded-lg bg-[#F43F5E]/10 border border-[#F43F5E]/30 text-xs text-[#F43F5E]">
                      {authError}
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={redirectingAuth}
                    onClick={() => void handleMediaSignIn()}
                    className="w-full py-3 px-4 rounded-xl bg-[#F5F7FA] text-[#07080A] font-semibold text-sm hover:bg-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-60 inline-flex items-center justify-center gap-2"
                  >
                    {redirectingAuth ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Redirecting to sign in…</span>
                      </>
                    ) : (
                      <span>Sign in with Media Account</span>
                    )}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleCreateRoom} className="space-y-3.5">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#07080A] border border-white/10">
                    <div>
                      <p className="text-xs font-semibold text-[#F5F7FA]">{user.username}</p>
                      <p className="text-[11px] text-[#22C55E]">
                        Connected to {user.serverName || 'Media Server'}
                      </p>
                    </div>
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-white/10 text-[#F5F7FA]">
                      {user.role === 'admin' ? 'Owner' : 'Friend Host'}
                    </span>
                  </div>

                  {authError && (
                    <div className="p-3 rounded-lg bg-[#F43F5E]/10 border border-[#F43F5E]/30 text-xs text-[#F43F5E]">
                      {authError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="room-name"
                        className="block text-xs font-medium text-[#98A0B0] mb-1"
                      >
                        Room Name
                      </label>
                      <input
                        id="room-name"
                        type="text"
                        value={roomName}
                        onChange={(e) => setRoomName(e.target.value)}
                        maxLength={80}
                        className="w-full px-3 py-2 rounded-xl bg-[#07080A] border border-white/10 text-xs text-[#F5F7FA] focus:outline-none focus:border-white/30"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="custom-slug"
                        className="block text-xs font-medium text-[#98A0B0] mb-1"
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
                          className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-[#07080A] border border-white/10 text-xs font-mono text-[#F5F7FA] placeholder-[#5C6475] focus:outline-none focus:border-white/30"
                        />
                        <button
                          type="button"
                          onClick={() => setCustomSlug(generateFunRoomSlug())}
                          aria-label="Generate memorable room code"
                          title="Generate fun room link"
                          className="p-2 rounded-xl bg-[#07080A] border border-white/10 text-[#F5F7FA] hover:border-white/30 hover:bg-[#181B22] transition shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                        >
                          <Dices className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-[10px] font-mono text-[#5C6475] mt-1 truncate">
                        {typeof window !== 'undefined' ? window.location.host : ''}/room/
                        <span className="text-[#98A0B0]">
                          {customSlug.trim() || '<random-code>'}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="room-pin"
                      className="block text-xs font-medium text-[#98A0B0] mb-1"
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
                      className="w-full px-3 py-2 rounded-xl bg-[#07080A] border border-white/10 text-xs text-[#F5F7FA] placeholder-[#5C6475] focus:outline-none focus:border-white/30"
                    />
                  </div>

                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2.5 text-xs text-[#98A0B0] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hostOnly}
                        onChange={(e) => setHostOnly(e.target.checked)}
                        className="w-4 h-4 accent-[#F5F7FA]"
                      />
                      <span>Host-only playback control (lock guest pause/seek)</span>
                    </label>

                    <label className="flex items-center gap-2.5 text-xs text-[#98A0B0] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={streamMode === 'eco-shared'}
                        onChange={(e) =>
                          setStreamMode(e.target.checked ? 'eco-shared' : 'per-viewer')
                        }
                        className="w-4 h-4 accent-[#22C55E]"
                      />
                      <span className="inline-flex items-center gap-1.5">
                        <Leaf className="w-3.5 h-3.5 text-[#22C55E]" />
                        <span>Eco Shared Stream (1 transcode shared by whole room)</span>
                      </span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={creating}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#F5F7FA] text-[#07080A] font-semibold text-sm hover:bg-white disabled:opacity-60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{creating ? 'Creating Room…' : 'Create Screening Room'}</span>
                  </button>
                </form>
              )}
            </div>
          </section>

          {/* Join by Code Card */}
          <section className="rounded-2xl bg-[#101216] border border-white/10 p-6 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[#98A0B0] text-[11px] font-semibold uppercase tracking-wider">
                <Tv className="w-3.5 h-3.5 text-[#F5F7FA]" />
                <span>Join a Room</span>
              </div>

              <h2 className="font-display text-xl font-bold text-[#F5F7FA] tracking-tight">
                Have a room code or name?
              </h2>
              <p className="text-sm text-[#98A0B0] leading-relaxed">
                Enter the 6-character code or custom room slug shared by the host. Works on
                laptops, phones, and Smart TV browsers — no account needed.
              </p>

              <form onSubmit={handleJoinByCode} className="space-y-3 pt-1">
                <div>
                  <label
                    htmlFor="join-code"
                    className="block text-xs font-medium text-[#98A0B0] mb-1.5"
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
                    className="w-full px-4 py-3 rounded-xl bg-[#07080A] border border-white/10 font-mono text-base tracking-wide text-[#F5F7FA] placeholder-[#5C6475] focus:outline-none focus:border-white/30"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!joinCode.trim()}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#181B22] border border-white/12 text-sm font-semibold text-[#F5F7FA] hover:border-white/30 disabled:opacity-50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <span>Enter Screening Room</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            </div>

            <div className="mt-6 pt-4 border-t border-white/8 text-xs text-[#5C6475] leading-relaxed">
              Tip: Want it on your TV? Open the invite link on your phone or laptop and tap{' '}
              <span className="text-[#98A0B0]">AirPlay</span> or{' '}
              <span className="text-[#98A0B0]">Chromecast</span> inside the player.
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
