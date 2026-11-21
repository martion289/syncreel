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
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-black/75 border border-white/10 text-[#F4F2EE]">
            {r.participantName}
          </span>
        </div>
      ))}

      {/* Celebratory Unanimous Swipe Match Banner */}
      {swipeMatchBanner && (
        <div className="pointer-events-auto absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#16161A]/95 border border-[#34C77B] shadow-2xl">
          <Heart className="w-4 h-4 text-[#34C77B] fill-current shrink-0" />
          <div className="text-xs">
            <span className="font-bold text-[#34C77B]">It&apos;s a Match! </span>
            <span className="text-[#F4F2EE] font-medium">{swipeMatchBanner.title}</span>
          </div>
          {onOpenSwipeShortlist && (
            <button
              type="button"
              onClick={onOpenSwipeShortlist}
              className="px-2 py-1 rounded bg-[#34C77B] text-[#111113] text-[11px] font-semibold"
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
                  ? 'bg-[#16161A]/90 border-[#E5A00D]/50 text-[#E5A00D]'
                  : 'bg-[#16161A]/90 border-[#2B2B33] text-[#F4F2EE]'
              }`}
            >
              {n.message}
            </div>
          ))}
        </div>
      )}

      {/* Floating Chat Messages in Upper-Right (avoids subtitles & player scrubber) */}
      {showChatToasts && ephemeralChat.length > 0 && (
        <div className="absolute top-16 right-4 sm:right-6 flex flex-col items-end gap-2 max-w-[min(82vw,360px)]">
          {ephemeralChat.map((item) => (
            <div
              key={item.message.id}
              style={{ animationDuration: `${item.durationMs}ms` }}
              className={`animate-float-chat bg-[#0E0E10]/82 backdrop-blur-md border border-white/15 rounded-2xl px-3.5 py-2 shadow-2xl text-left ${
                isFullscreen ? 'text-sm' : 'text-xs sm:text-sm'
              }`}
            >
              <span
                className={`font-semibold mr-1.5 ${
                  item.message.role === 'host' ? 'text-[#E5A00D]' : 'text-[#34C77B]'
                }`}
              >
                {item.message.participantName}:
              </span>
              <span className="text-[#F4F2EE] break-words">{item.message.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
