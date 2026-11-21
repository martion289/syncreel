import type { ClientEvent, MoviePoll, ParticipantRole } from '@syncreel/shared';
import { BarChart3, Check, Play, X } from 'lucide-react';
import { formatMediaSubtitle } from '../../lib/format.js';

interface PollPanelProps {
  poll: MoviePoll;
  selfParticipantId: string | null;
  selfRole: ParticipantRole;
  totalViewers: number;
  sendEvent: (event: ClientEvent) => void;
}

export function PollPanel({
  poll,
  selfParticipantId,
  selfRole,
  totalViewers,
  sendEvent
}: PollPanelProps) {
  const denom = Math.max(1, totalViewers);

  return (
    <div className="p-3 rounded-xl bg-[#0E0E10] border border-[#E5A00D]/40 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#E5A00D]">
          <BarChart3 className="w-3.5 h-3.5" />
          <span>{poll.status === 'open' ? 'Quick Vote' : 'Poll Results'}</span>
        </div>
        {selfRole === 'host' && (
          <div className="flex items-center gap-1.5">
            {poll.status === 'open' && (
              <button
                onClick={() => sendEvent({ type: 'poll:close', autoPlayWinner: true })}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#E5A00D] text-[#111113] text-[10px] font-semibold"
              >
                <Play className="w-2.5 h-2.5 fill-current" />
                <span>Play Winner</span>
              </button>
            )}
            <button
              onClick={() => sendEvent({ type: 'poll:close', autoPlayWinner: false })}
              aria-label="Close poll"
              className="p-1 text-[#9C9AA6] hover:text-[#F4F2EE]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {poll.options.map((opt) => {
          const voted = selfParticipantId ? opt.voterIds.includes(selfParticipantId) : false;
          const pct = Math.min(100, Math.round((opt.voterIds.length / denom) * 100));
          const isWinner = poll.status === 'closed' && poll.winnerRatingKey === opt.media.ratingKey;

          return (
            <button
              key={opt.media.ratingKey}
              disabled={poll.status !== 'open'}
              onClick={() => sendEvent({ type: 'poll:vote', ratingKey: opt.media.ratingKey })}
              className={`relative w-full text-left p-2 rounded-lg border overflow-hidden transition ${
                isWinner
                  ? 'border-[#34C77B] bg-[#16161A]'
                  : voted
                    ? 'border-[#E5A00D] bg-[#16161A]'
                    : 'border-[#2B2B33] bg-[#16161A] hover:border-[#9C9AA6]'
              }`}
            >
              <div
                style={{ width: `${pct}%` }}
                className={`absolute inset-y-0 left-0 transition-all ${
                  isWinner ? 'bg-[#34C77B]/20' : 'bg-[#E5A00D]/15'
                }`}
              />
              <div className="relative flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[#F4F2EE] truncate">{opt.media.title}</p>
                  <p className="text-[10px] text-[#9C9AA6] truncate">
                    {formatMediaSubtitle(opt.media)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0 font-mono text-[11px] text-[#E5A00D]">
                  {voted && <Check className="w-3 h-3" />}
                  <span>{opt.voterIds.length}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
