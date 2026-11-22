import type { ChatMessage, MediaSummary } from '@syncreel/shared';
import { Heart } from 'lucide-react';
import type { FloatingReaction, RoomNotice } from '../../hooks/useRoomSocket.js';

export interface FloatingChatItem {
  message: ChatMessage;
  durationMs: number;
}

interface FloatingReactionsProps {
  reactions: FloatingReaction[];
  notices: RoomNotice[];
  ephemeralChat: FloatingChatItem[];
  showChatToasts: boolean;
  isFullscreen?: boolean;
  swipeMatchBanner?: MediaSummary | null;
  onOpenSwipeShortlist?: () => void;
}

export function FloatingReactions(props: FloatingReactionsProps) {
  const {
    reactions,
    notices,
    ephemeralChat,
    showChatToasts,
    isFullscreen = false,
    swipeMatchBanner,
    onOpenSwipeShortlist
  } = props;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-20">
      {/* Floating Emoji Reactions */}
      {reactions.map((r) => (
        <div
          key={r.id}
          style={{ left: `${r.xPercent}%` }}
          className="animate-float-reaction absolute bottom-20 flex flex-col items-center gap-0.5"
        >
          <span
            className={`${
              isFullscreen ? 'text-4xl sm:text-5xl' : 'text-3xl'
            } drop-shadow-[0_4px_12px_rgba(0,0,0,0.85)]`}
          >
            {r.emoji}
          </span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-black/75 border border-white/10 text-[#F5F7FA]">
            {r.participantName}
          </span>
        </div>
      ))}

      {/* Celebratory Unanimous Swipe Match Banner */}
      {swipeMatchBanner && (
        <div className="pointer-events-auto absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#101216]/95 border border-[#22C55E] backdrop-blur-md">
          <Heart className="w-4 h-4 text-[#22C55E] fill-current shrink-0" />
          <div className="text-xs">
            <span className="font-bold text-[#22C55E]">It&apos;s a Match! </span>
            <span className="text-[#F5F7FA] font-medium">{swipeMatchBanner.title}</span>
          </div>
          {onOpenSwipeShortlist && (
            <button
              type="button"
              onClick={onOpenSwipeShortlist}
              className="px-2 py-1 rounded bg-[#22C55E] text-[#07080A] text-[11px] font-semibold"
            >
              View
            </button>
          )}
        </div>
      )}

      {/* Room Notices */}
      {notices.length > 0 && (
        <div className="absolute top-14 left-4 flex flex-col gap-1.5 max-w-xs">
          {notices.map((n) => (
            <div
              key={n.id}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border backdrop-blur-sm ${
                n.level === 'warning'
                  ? 'bg-[#101216]/90 border-[#F43F5E]/40 text-[#F43F5E]'
                  : 'bg-[#101216]/90 border-white/12 text-[#F5F7FA]'
              }`}
            >
              {n.message}
            </div>
          ))}
        </div>
      )}

      {/* Floating Chat Messages in Upper-Right */}
      {showChatToasts && ephemeralChat.length > 0 && (
        <div className="absolute top-16 right-4 sm:right-6 flex flex-col items-end gap-2 max-w-[min(82vw,360px)]">
          {ephemeralChat.map((item) => (
            <div
              key={item.message.id}
              style={{ animationDuration: `${item.durationMs}ms` }}
              className={`animate-float-chat bg-[#07080A]/85 backdrop-blur-md border border-white/12 rounded-2xl px-3.5 py-2 text-left ${
                isFullscreen ? 'text-sm' : 'text-xs sm:text-sm'
              }`}
            >
              <span
                className={`font-semibold mr-1.5 ${
                  item.message.role === 'host' ? 'text-[#F5F7FA]' : 'text-[#22C55E]'
                }`}
              >
                {item.message.participantName}:
              </span>
              <span className="text-[#C6CCD8] break-words">{item.message.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
