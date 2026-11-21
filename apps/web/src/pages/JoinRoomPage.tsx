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
  const [name, setName] = useState(() =>
    isPreview ? 'Guest Preview' : localStorage.getItem('wt_guest_name') || ''
  );
  const [pin, setPin] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setNotFoundError(null);
    api
      .getRoomInfo(roomCode)
      .then((res) => {
        if (res.hasAccess) {
          onAuthorized();
          return;
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
        pin: pin.trim() || undefined
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
      <div className="min-h-screen bg-[#0E0E10] flex items-center justify-center text-[#9C9AA6] gap-2.5 text-sm">
        <Loader2 className="w-5 h-5 animate-spin text-[#E5A00D]" />
        <span>Checking screening room {roomCode}…</span>
      </div>
    );
  }

  if (notFoundError || !info) {
    return (
      <div className="min-h-screen bg-[#0E0E10] flex items-center justify-center px-5">
        <div className="w-full max-w-md rounded-2xl bg-[#16161A] border border-[#2B2B33] p-6 text-center space-y-4">
          <h1 className="text-lg font-bold text-[#F4F2EE]">Room Unavailable</h1>
          <p className="text-sm text-[#9C9AA6]">
            {notFoundError || `Screening room ${roomCode} doesn't exist or has ended.`}
          </p>
          <button
            onClick={onBackHome}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#202026] border border-[#2B2B33] text-sm font-medium text-[#F4F2EE] hover:border-[#E5A00D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Home</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0E0E10] text-[#F4F2EE] flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md rounded-2xl bg-[#16161A] border border-[#2B2B33] overflow-hidden shadow-2xl">
        {isPreview && (
          <div className="px-4 py-2 bg-[#E5A00D]/15 border-b border-[#E5A00D]/40 text-[11px] font-medium text-[#E5A00D]">
            Solo Multi-Viewer Guest Preview Tab — behaves as a real isolated guest
          </div>
        )}

        {info.currentMediaTitle && (
          <div className="flex items-center gap-3.5 p-4 bg-[#0E0E10] border-b border-[#2B2B33]">
            {info.currentMediaThumb ? (
              <img
                src={info.currentMediaThumb}
                alt={info.currentMediaTitle}
                className="w-12 h-16 object-cover rounded-lg shrink-0 bg-[#202026]"
              />
            ) : (
              <div className="w-12 h-16 rounded-lg bg-[#202026] flex items-center justify-center shrink-0 text-[#E5A00D]">
                <Film className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#E5A00D]">
                Now Playing
              </p>
              <p className="text-sm font-semibold text-[#F4F2EE] truncate">
                {info.currentMediaTitle}
              </p>
              {info.currentMediaSubtitle && (
                <p className="text-xs text-[#9C9AA6] truncate">{info.currentMediaSubtitle}</p>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleJoin} className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-[#F4F2EE]">{info.name}</h1>
              <p className="text-xs text-[#9C9AA6] flex items-center gap-1.5 mt-0.5">
                <Users className="w-3.5 h-3.5" />
                <span>
                  {info.participantCount === 0
                    ? 'Waiting for viewers'
                    : `${info.participantCount} watching`}
                </span>
              </p>
            </div>
            <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-[#0E0E10] border border-[#2B2B33] text-[#E5A00D]">
              {info.code}
            </span>
          </div>

          {joinError && (
            <div className="p-3 rounded-lg bg-[#D94848]/10 border border-[#D94848]/40 text-xs text-[#D94848]">
              {joinError}
            </div>
          )}

          <div>
            <label htmlFor="guest-name" className="block text-xs font-medium text-[#9C9AA6] mb-1.5">
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
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0E10] border border-[#2B2B33] text-sm text-[#F4F2EE] placeholder-[#686670] focus:outline-none focus:border-[#E5A00D]"
            />
          </div>

          {info.hasPin && (
            <div>
              <label
                htmlFor="guest-pin"
                className="flex items-center gap-1.5 text-xs font-medium text-[#9C9AA6] mb-1.5"
              >
                <Lock className="w-3.5 h-3.5 text-[#E5A00D]" />
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
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0E10] border border-[#2B2B33] text-sm text-[#F4F2EE] placeholder-[#686670] focus:outline-none focus:border-[#E5A00D]"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={joining || !name.trim()}
            className="w-full py-3 px-4 rounded-xl bg-[#E5A00D] text-[#111113] font-semibold text-sm hover:bg-[#f0ad1c] disabled:opacity-60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D]"
          >
            {joining ? 'Joining…' : 'Join Watch Party'}
          </button>

          <button
            type="button"
            onClick={onBackHome}
            className="w-full py-2 text-xs text-[#9C9AA6] hover:text-[#F4F2EE] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D] rounded-lg"
          >
            Back to Home
          </button>
        </form>
      </div>
    </div>
  );
}
