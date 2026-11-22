import { useEffect, useState } from 'react';
import type { RoomPublicInfo } from '@syncreel/shared';
import { ArrowLeft, Film, Loader2, Lock, Users } from 'lucide-react';
import { api, isGuestPreviewTab } from '../lib/api.js';

interface JoinRoomPageProps {
  roomCode: string;
  onAuthorized: () => void;
  onBackHome: () => void;
}

export function JoinRoomPage({ roomCode, onAuthorized, onBackHome }: JoinRoomPageProps) {
  const [info, setInfo] = useState<RoomPublicInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFoundError, setNotFoundError] = useState<string | null>(null);

  const isPreview = isGuestPreviewTab();
  const [hostSeatPrompt, setHostSeatPrompt] = useState(false);
  const [name, setName] = useState(() =>
    isPreview ? 'Guest Preview' : localStorage.getItem('wt_guest_name') || ''
  );
  const [pin, setPin] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setNotFoundError(null);
    setHostSeatPrompt(false);
    api
      .getRoomInfo(roomCode)
      .then((res) => {
        const isCreatorTab =
          typeof sessionStorage !== 'undefined' &&
          sessionStorage.getItem(`syncreel_host_created_${roomCode.toLowerCase()}`) === '1';

        if (res.hasAccess && !(res.hostAlreadyConnected && !isCreatorTab)) {
          onAuthorized();
          return;
        }
        if (res.hasAccess && res.hostAlreadyConnected && !isCreatorTab) {
          setHostSeatPrompt(true);
        }
        setInfo(res);
      })
      .catch((err) => {
        setNotFoundError(err instanceof Error ? err.message : 'Room not found');
      })
      .finally(() => setLoading(false));
  }, [roomCode, onAuthorized]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setJoining(true);
    setJoinError(null);

    try {
      if (!isPreview) {
        localStorage.setItem('wt_guest_name', trimmed);
      }
      await api.joinRoom(roomCode, {
        name: trimmed,
        pin: pin.trim() || undefined,
        forceGuestSeat: hostSeatPrompt
      });
      onAuthorized();
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Unable to join room');
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07080A] flex items-center justify-center text-[#98A0B0] gap-2.5 text-sm">
        <Loader2 className="w-5 h-5 animate-spin text-[#F5F7FA]" />
        <span>Checking screening room {roomCode}…</span>
      </div>
    );
  }

  if (notFoundError || !info) {
    return (
      <div className="min-h-screen bg-[#07080A] flex items-center justify-center px-5">
        <div className="w-full max-w-md rounded-2xl bg-[#101216] border border-white/10 p-6 text-center space-y-4">
          <h1 className="font-display text-lg font-bold text-[#F5F7FA]">Room Unavailable</h1>
          <p className="text-sm text-[#98A0B0]">
            {notFoundError || `Screening room ${roomCode} doesn't exist or has ended.`}
          </p>
          <button
            onClick={onBackHome}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#181B22] border border-white/10 text-sm font-medium text-[#F5F7FA] hover:border-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Home</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07080A] text-[#F5F7FA] flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md rounded-2xl bg-[#101216] border border-white/10 overflow-hidden">
        {isPreview && (
          <div className="px-4 py-2 bg-white/[0.06] border-b border-white/10 text-[11px] font-medium text-[#F5F7FA]">
            Solo Multi-Viewer Guest Preview Tab — behaves as a real isolated guest
          </div>
        )}

        {hostSeatPrompt && (
          <div className="px-4 py-2.5 bg-[#22C55E]/10 border-b border-[#22C55E]/30 text-[11px] text-[#E6FAEE] leading-relaxed">
            Already signed in as <span className="font-semibold">{info.selfName || 'Host'}</span> on
            another device — enter your own name below to join as a 2nd person (ideal for couples
            sharing one account).
          </div>
        )}

        {info.currentMediaTitle && (
          <div className="flex items-center gap-3.5 p-4 bg-[#07080A] border-b border-white/8">
            {info.currentMediaThumb ? (
              <img
                src={info.currentMediaThumb}
                alt={info.currentMediaTitle}
                className="w-12 h-16 object-cover rounded-lg shrink-0 bg-[#181B22]"
              />
            ) : (
              <div className="w-12 h-16 rounded-lg bg-[#181B22] flex items-center justify-center shrink-0 text-[#F5F7FA]">
                <Film className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#98A0B0]">
                Now Playing
              </p>
              <p className="text-sm font-semibold text-[#F5F7FA] truncate">
                {info.currentMediaTitle}
              </p>
              {info.currentMediaSubtitle && (
                <p className="text-xs text-[#98A0B0] truncate">{info.currentMediaSubtitle}</p>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleJoin} className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-display text-xl font-bold text-[#F5F7FA] tracking-tight">
                {info.name}
              </h1>
              <p className="text-xs text-[#98A0B0] flex items-center gap-1.5 mt-0.5">
                <Users className="w-3.5 h-3.5" />
                <span>
                  {info.participantCount === 0
                    ? 'Waiting for viewers'
                    : `${info.participantCount} watching`}
                </span>
              </p>
            </div>
            <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-[#07080A] border border-white/10 text-[#F5F7FA]">
              {info.code}
            </span>
          </div>

          {joinError && (
            <div className="p-3 rounded-lg bg-[#F43F5E]/10 border border-[#F43F5E]/30 text-xs text-[#F43F5E]">
              {joinError}
            </div>
          )}

          <div>
            <label htmlFor="guest-name" className="block text-xs font-medium text-[#98A0B0] mb-1.5">
              Your Display Name
            </label>
            <input
              id="guest-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="Alex"
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#07080A] border border-white/10 text-sm text-[#F5F7FA] placeholder-[#5C6475] focus:outline-none focus:border-white/30"
            />
          </div>

          {info.hasPin && (
            <div>
              <label
                htmlFor="guest-pin"
                className="flex items-center gap-1.5 text-xs font-medium text-[#98A0B0] mb-1.5"
              >
                <Lock className="w-3.5 h-3.5 text-[#F5F7FA]" />
                <span>Room PIN</span>
              </label>
              <input
                id="guest-pin"
                type="password"
                required
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                maxLength={24}
                placeholder="Enter PIN"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#07080A] border border-white/10 text-sm text-[#F5F7FA] placeholder-[#5C6475] focus:outline-none focus:border-white/30"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={joining || !name.trim()}
            className="w-full py-3 px-4 rounded-xl bg-[#F5F7FA] text-[#07080A] font-semibold text-sm hover:bg-white disabled:opacity-60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            {joining
              ? 'Joining…'
              : info.purpose === 'picker'
                ? 'Join Swipe Session'
                : 'Join Watch Party'}
          </button>

          {hostSeatPrompt && (
            <button
              type="button"
              onClick={onAuthorized}
              className="w-full py-1.5 text-xs text-[#F5F7FA] hover:underline"
            >
              Or continue as host ({info.selfName || 'Owner'}) on this device
            </button>
          )}

          <button
            type="button"
            onClick={onBackHome}
            className="w-full py-2 text-xs text-[#98A0B0] hover:text-[#F5F7FA] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 rounded-lg"
          >
            Back to Home
          </button>
        </form>
      </div>
    </div>
  );
}
