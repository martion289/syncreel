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
    <div className="p-3 rounded-xl bg-[#07080A] border border-white/15 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F5F7FA]">
          <BarChart3 className="w-3.5 h-3.5" />
          <span>{poll.status === 'open' ? 'Quick Vote' : 'Poll Results'}</span>
        </div>
        {selfRole === 'host' && (
          <div className="flex items-center gap-1.5">
            {poll.status === 'open' && (
              <button
                onClick={() => sendEvent({ type: 'poll:close', autoPlayWinner: true })}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#F5F7FA] text-[#07080A] text-[10px] font-semibold"
              >
                <Play className="w-2.5 h-2.5 fill-current" />
                <span>Play Winner</span>
              </button>
            )}
            <button
              onClick={() => sendEvent({ type: 'poll:close', autoPlayWinner: false })}
              aria-label="Close poll"
              className="p-1 text-[#98A0B0] hover:text-[#F5F7FA]"
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
                  ? 'border-[#22C55E] bg-[#101216]'
                  : voted
                    ? 'border-[#F5F7FA] bg-[#101216]'
                    : 'border-white/10 bg-[#101216] hover:border-white/30'
              }`}
            >
              <div
                style={{ width: `${pct}%` }}
                className={`absolute inset-y-0 left-0 transition-all ${
                  isWinner ? 'bg-[#22C55E]/20' : 'bg-white/10'
                }`}
              />
              <div className="relative flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[#F5F7FA] truncate">{opt.media.title}</p>
                  <p className="text-[10px] text-[#98A0B0] truncate">
                    {formatMediaSubtitle(opt.media)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0 font-mono tabular-nums text-[11px] text-[#F5F7FA]">
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
