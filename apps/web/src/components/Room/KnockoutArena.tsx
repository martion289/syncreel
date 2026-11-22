import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MediaSummary,
  Participant,
  ParticipantRole,
  SwipeKnockoutState
} from '@syncreel/shared';
import {
  Award,
  Check,
  Crown,
  Dices,
  ExternalLink,
  Film,
  Info,
  Play,
  Plus,
  RotateCcw,
  Share2,
  Star,
  Swords,
  Tv,
  X
} from 'lucide-react';
import { formatMediaSubtitle, formatTimeMs } from '../../lib/format.js';
import { advanceKnockoutBracket, createKnockoutBracket } from '../../lib/knockoutBracket.js';
import { resolveCardArtworkUrl } from './SwipeDeckStage.js';

interface KnockoutArenaProps {
  candidates: MediaSummary[];
  roomCode?: string;
  serverMachineId?: string;
  serverName?: string;
  subtitle?: string;
  syncedKnockout?: SwipeKnockoutState | null;
  participants?: Participant[];
  selfParticipantId?: string | null;
  selfRole?: ParticipantRole;
  onSyncedVote?: (ratingKey: string) => void;
  onSyncedTieBreak?: (mode: 'coinflip' | 'pick', ratingKey?: string) => void;
  onWatchNow?: (item: MediaSummary) => void;
  onStartWatchParty?: (item: MediaSummary) => void;
  onQueueItem?: (item: MediaSummary) => void;
  onRestart?: () => void;
  restartLabel?: string;
}

function getPlexWebUrl(serverMachineId: string, ratingKey: string): string {
  return `https://app.plex.tv/desktop/#!/server/${encodeURIComponent(serverMachineId)}/details?key=${encodeURIComponent(
    `/library/metadata/${ratingKey}`
  )}`;
}

function getPlexNativeAppUrl(serverMachineId: string, ratingKey: string): string {
  return `plex://preplay/?metadataKey=${encodeURIComponent(
    `/library/metadata/${ratingKey}`
  )}&server=${encodeURIComponent(serverMachineId)}`;
}

function isMobileClient(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

interface ContenderCardProps {
  item: MediaSummary;
  roomCode?: string;
  sideLabel: string;
  selected: boolean;
  selectedLabel?: string;
  voteCount?: number;
  ctaLabel?: string;
  disabled: boolean;
  showSynopsis: boolean;
  onToggleSynopsis: () => void;
  onPick: () => void;
}

function ContenderCard({
  item,
  roomCode,
  sideLabel,
  selected,
  selectedLabel = 'WINNER',
  voteCount = 0,
  ctaLabel = 'Choose Winner',
  disabled,
  showSynopsis,
  onToggleSynopsis,
  onPick
}: ContenderCardProps) {
  const thumbUrl = resolveCardArtworkUrl(item.thumb, roomCode, 600, 900);

  return (
    <div
      className={`relative rounded-2xl overflow-hidden bg-[#101216] border-2 transition-all duration-150 flex flex-col min-h-[240px] sm:min-h-[380px] h-full ${
        selected
          ? 'border-[#22C55E] scale-[0.985]'
          : 'border-white/10 hover:border-white/40'
      }`}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onPick}
        aria-label={`Pick ${item.title}`}
        className="group relative flex-1 w-full h-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={item.title}
            loading="eager"
            className="w-full h-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-[#101216] text-[#5C6475] px-4 text-center">
            {item.type === 'show' ? <Tv className="w-12 h-12" /> : <Film className="w-12 h-12" />}
            <span className="text-xs font-medium text-[#98A0B0]">{item.title}</span>
          </div>
        )}

        <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />

        <div className="absolute top-3 left-3 flex items-center gap-1.5 flex-wrap max-w-[calc(100%-3.5rem)]">
          <span className="px-2 py-0.5 rounded-md bg-black/75 border border-white/15 text-[10px] font-mono uppercase tracking-wider text-[#F5F7FA]">
            {sideLabel}
          </span>
          {item.rating && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/75 border border-white/15 text-[11px] font-mono tabular-nums text-[#F5F7FA]">
              <Star className="w-3 h-3 fill-current" />
              {item.rating.toFixed(1)}
            </span>
          )}
          {voteCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#22C55E] text-[10px] font-bold text-[#07080A]">
              {voteCount} {voteCount === 1 ? 'vote' : 'votes'}
            </span>
          )}
        </div>

        {selected && (
          <div className="absolute inset-0 bg-[#22C55E]/15 flex items-center justify-center pointer-events-none">
            <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#22C55E] text-[#07080A] text-xs font-bold">
              <Check className="w-4 h-4" />
              {selectedLabel}
            </span>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 pt-16 pb-3.5 px-3.5 bg-gradient-to-t from-black/95 via-black/75 to-transparent">
          <h3 className="font-display text-base sm:text-lg font-bold text-[#F5F7FA] leading-snug line-clamp-2">
            {item.title}
          </h3>
          <p className="text-[11px] text-[#C6CCD8] mt-0.5 truncate">
            {formatMediaSubtitle(item)}
            {item.durationMs > 0 && item.type === 'movie'
              ? ` • ${formatTimeMs(item.durationMs)}`
              : ''}
          </p>
          {item.genres && item.genres.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {item.genres.slice(0, 2).map((g) => (
                <span
                  key={g}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-white/12 text-[#F5F7FA]"
                >
                  {g}
                </span>
              ))}
            </div>
          )}
          <div className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F5F7FA] text-[#07080A] text-xs font-semibold group-hover:bg-white transition">
            <span>{ctaLabel}</span>
          </div>
        </div>
      </button>

      {/* Info Toggle Button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSynopsis();
        }}
        aria-label={`Plot synopsis for ${item.title}`}
        className={`absolute top-3 right-3 z-10 w-8 h-8 rounded-full border flex items-center justify-center backdrop-blur-md transition ${
          showSynopsis
            ? 'bg-[#F5F7FA] border-[#F5F7FA] text-[#07080A]'
            : 'bg-black/70 border-white/20 text-[#F5F7FA] hover:border-white/40'
        }`}
      >
        <Info className="w-4 h-4" />
      </button>

      {showSynopsis && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 z-20 bg-[#07080A]/94 backdrop-blur-md p-4 flex flex-col justify-between overflow-y-auto"
        >
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="font-display text-sm font-bold text-[#F5F7FA]">{item.title}</h4>
                <p className="text-[11px] text-[#98A0B0]">{formatMediaSubtitle(item)}</p>
              </div>
              <button
                type="button"
                onClick={onToggleSynopsis}
                aria-label="Close synopsis"
                className="p-1.5 rounded-lg bg-white/10 text-[#F5F7FA] hover:bg-white/20 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#C6CCD8] leading-relaxed">
              {item.summary?.trim() || 'No plot synopsis available.'}
            </p>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={onPick}
            className="mt-4 w-full py-2 rounded-lg bg-[#F5F7FA] text-[#07080A] text-xs font-bold"
          >
            Choose {item.title}
          </button>
        </div>
      )}
    </div>
  );
}

export function KnockoutArena({
  candidates,
  roomCode,
  serverMachineId,
  serverName,
  subtitle,
  syncedKnockout,
  participants,
  selfParticipantId,
  selfRole,
  onSyncedVote,
  onSyncedTieBreak,
  onWatchNow,
  onStartWatchParty,
  onQueueItem,
  onRestart,
  restartLabel = 'New Deck'
}: KnockoutArenaProps) {
  const candidatesKey = useMemo(
    () => candidates.map((c) => c.ratingKey).join(','),
    [candidates]
  );

  const [localBracket, setLocalBracket] = useState(() => createKnockoutBracket(candidates));
  const [pickingKey, setPickingKey] = useState<string | null>(null);
  const [synopsisSide, setSynopsisSide] = useState<'left' | 'right' | null>(null);
  const advanceTimerRef = useRef<number | null>(null);

  const isSynced = Boolean(syncedKnockout);
  const bracket = syncedKnockout ?? localBracket;

  useEffect(() => {
    if (isSynced) return;
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    setLocalBracket(createKnockoutBracket(candidates));
    setPickingKey(null);
    setSynopsisSide(null);
  }, [candidatesKey, isSynced]);

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current !== null) {
        window.clearTimeout(advanceTimerRef.current);
      }
    };
  }, []);

  // Preload contender posters
  useEffect(() => {
    for (const item of candidates) {
      const url = resolveCardArtworkUrl(item.thumb, roomCode, 600, 900);
      if (url) {
        const img = new Image();
        img.src = url;
      }
    }
  }, [candidates, roomCode]);

  const activeMatch =
    !bracket.champion && bracket.currentMatchIndex < bracket.matchups.length
      ? bracket.matchups[bracket.currentMatchIndex]
      : null;

  useEffect(() => {
    setSynopsisSide(null);
  }, [activeMatch?.id]);

  const handlePick = useCallback(
    (winnerKey: string) => {
      if (!activeMatch) return;
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(15);
        } catch {
          // Ignore unsupported vibrate
        }
      }

      if (isSynced) {
        setSynopsisSide(null);
        onSyncedVote?.(winnerKey);
        return;
      }

      if (pickingKey) return;
      setPickingKey(winnerKey);
      setSynopsisSide(null);

      if (advanceTimerRef.current !== null) {
        window.clearTimeout(advanceTimerRef.current);
      }
      advanceTimerRef.current = window.setTimeout(() => {
        advanceTimerRef.current = null;
        setPickingKey(null);
        setLocalBracket((prev) => advanceKnockoutBracket(prev, winnerKey));
      }, 190);
    },
    [activeMatch, isSynced, onSyncedVote, pickingKey]
  );

  useEffect(() => {
    if (!activeMatch) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        handlePick(activeMatch.left.ratingKey);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        handlePick(activeMatch.right.ratingKey);
      } else if (e.key === 'Escape' && synopsisSide) {
        e.preventDefault();
        e.stopPropagation();
        setSynopsisSide(null);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [activeMatch, handlePick, synopsisSide]);

  if (bracket.champion) {
    const champ = bracket.champion;
    const champThumb = resolveCardArtworkUrl(champ.thumb, roomCode, 500, 750);
    const isMobile = isMobileClient();
    const mediaWebUrl = serverMachineId
      ? getPlexWebUrl(serverMachineId, champ.ratingKey)
      : null;
    const mediaNativeUrl = serverMachineId
      ? getPlexNativeAppUrl(serverMachineId, champ.ratingKey)
      : null;
    const mediaPrimaryLink = isMobile ? mediaNativeUrl : mediaWebUrl;

    const podiumRest = [
      ...(bracket.runnerUp ? [{ label: 'Runner-Up', item: bracket.runnerUp }] : []),
      ...bracket.eliminatedInSemis.map((item) => ({ label: 'Semifinalist', item }))
    ];

    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-5">
        <div className="rounded-2xl bg-[#101216] border border-white/15 p-4 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#22C55E]/15 border border-[#22C55E]/40 text-xs font-semibold uppercase tracking-wider text-[#22C55E]">
              <Crown className="w-3.5 h-3.5" />
              Tonight&apos;s Winner
            </span>
            {subtitle && <span className="text-xs text-[#98A0B0]">{subtitle}</span>}
          </div>

          {isSynced && syncedKnockout?.lastTieBreakMessage && (
            <div className="px-3 py-1.5 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/30 text-xs font-medium text-[#22C55E] text-center">
              {syncedKnockout.lastTieBreakMessage}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start">
            {champThumb ? (
              <img
                src={champThumb}
                alt={champ.title}
                className="w-40 sm:w-44 aspect-[2/3] object-cover rounded-xl border border-white/10 shrink-0 bg-[#07080A]"
              />
            ) : (
              <div className="w-40 sm:w-44 aspect-[2/3] rounded-xl bg-[#07080A] border border-white/10 flex items-center justify-center text-[#98A0B0] shrink-0">
                <Film className="w-12 h-12" />
              </div>
            )}

            <div className="flex-1 min-w-0 space-y-2.5 text-center sm:text-left">
              <h3 className="font-display text-2xl sm:text-3xl font-bold text-[#F5F7FA] tracking-tight leading-tight">
                {champ.title}
              </h3>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs text-[#98A0B0]">
                <span>{formatMediaSubtitle(champ)}</span>
                {champ.durationMs > 0 && champ.type === 'movie' && (
                  <span>• {formatTimeMs(champ.durationMs)}</span>
                )}
                {champ.rating && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#07080A] border border-white/12 font-mono tabular-nums text-[#F5F7FA]">
                    <Star className="w-3 h-3 fill-current" />
                    {champ.rating.toFixed(1)}
                  </span>
                )}
              </div>

              {champ.genres && champ.genres.length > 0 && (
                <div className="flex flex-wrap justify-center sm:justify-start gap-1.5">
                  {champ.genres.slice(0, 4).map((g) => (
                    <span
                      key={g}
                      className="text-[11px] px-2.5 py-0.5 rounded-full bg-[#07080A] border border-white/10 text-[#C6CCD8]"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}

              {champ.summary && (
                <p className="text-xs text-[#98A0B0] leading-relaxed line-clamp-5">
                  {champ.summary}
                </p>
              )}

              {mediaPrimaryLink && (
                <p className="text-[11px] text-[#22C55E] pt-1">
                  Watching on TV? Open your media app
                  {serverName ? ` (${serverName})` : ''} —{' '}
                  <span className="font-semibold text-[#F5F7FA]">{champ.title}</span> is ready to
                  play.
                </p>
              )}
            </div>
          </div>

          {/* Winner Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            {mediaPrimaryLink && !onWatchNow && (
              <a
                href={mediaPrimaryLink}
                target={isMobile ? undefined : '_blank'}
                rel={isMobile ? undefined : 'noreferrer'}
                className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#F5F7FA] text-[#07080A] text-xs font-bold hover:bg-white transition ${
                  !onStartWatchParty && !onQueueItem ? 'sm:col-span-2' : ''
                }`}
              >
                <ExternalLink className="w-4 h-4" />
                <span>Open in Media App</span>
              </a>
            )}

            {onWatchNow && (
              <button
                type="button"
                onClick={() => onWatchNow(champ)}
                className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#F5F7FA] text-[#07080A] text-xs font-bold hover:bg-white transition"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Watch Here in SyncReel</span>
              </button>
            )}

            {onStartWatchParty && (
              <button
                type="button"
                onClick={() => onStartWatchParty(champ)}
                className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#181B22] border border-white/10 text-xs font-semibold text-[#F5F7FA] hover:border-white/30 transition"
              >
                <Share2 className="w-4 h-4" />
                <span>Start Watch Party &amp; Invite</span>
              </button>
            )}

            {onQueueItem && (
              <button
                type="button"
                onClick={() => onQueueItem(champ)}
                className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#181B22] border border-white/10 text-xs font-semibold text-[#F5F7FA] hover:border-white/30 transition"
              >
                <Plus className="w-4 h-4" />
                <span>Add Winner to Queue</span>
              </button>
            )}

            {mediaPrimaryLink && onWatchNow && (
              <a
                href={mediaPrimaryLink}
                target={isMobile ? undefined : '_blank'}
                rel={isMobile ? undefined : 'noreferrer'}
                className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#07080A] border border-white/10 text-xs font-semibold text-[#F5F7FA] hover:border-white/30 transition"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Open in Media App</span>
              </a>
            )}
          </div>

          {isMobile && mediaWebUrl && (
            <div className="text-center">
              <a
                href={mediaWebUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-[#98A0B0] hover:text-[#F5F7FA] underline underline-offset-2"
              >
                Open Web Player instead
              </a>
            </div>
          )}
        </div>

        {podiumRest.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#98A0B0] flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5" />
              Runner-Up &amp; Semifinalists
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {podiumRest.map(({ label, item }) => {
                const t = resolveCardArtworkUrl(item.thumb, roomCode, 140, 210);
                return (
                  <div
                    key={item.ratingKey}
                    className="flex items-center gap-3 p-2.5 rounded-xl bg-[#101216] border border-white/10"
                  >
                    {t && (
                      <img
                        src={t}
                        alt={item.title}
                        className="w-10 h-14 object-cover rounded shrink-0 bg-[#07080A]"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5C6475]">
                        {label}
                      </p>
                      <p className="text-xs font-semibold text-[#F5F7FA] truncate">{item.title}</p>
                      <p className="text-[11px] text-[#98A0B0] truncate">
                        {formatMediaSubtitle(item)}
                      </p>
                    </div>
                    {onWatchNow ? (
                      <button
                        type="button"
                        onClick={() => onWatchNow(item)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/10 text-[11px] font-semibold text-[#F5F7FA] hover:border-white/30 shrink-0"
                      >
                        Play
                      </button>
                    ) : serverMachineId ? (
                      <a
                        href={
                          isMobile
                            ? getPlexNativeAppUrl(serverMachineId, item.ratingKey)
                            : getPlexWebUrl(serverMachineId, item.ratingKey)
                        }
                        target={isMobile ? undefined : '_blank'}
                        rel={isMobile ? undefined : 'noreferrer'}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/10 text-[11px] font-semibold text-[#F5F7FA] hover:border-white/30 shrink-0"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Open</span>
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {onRestart && (
          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={onRestart}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#181B22] border border-white/10 text-xs font-semibold text-[#F5F7FA] hover:border-white/30"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{restartLabel}</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!activeMatch) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
        <p className="text-sm text-[#98A0B0]">No contenders available for Knockout.</p>
        {onRestart && (
          <button
            type="button"
            onClick={onRestart}
            className="px-4 py-2 rounded-lg bg-[#F5F7FA] text-[#07080A] text-xs font-semibold"
          >
            {restartLabel}
          </button>
        )}
      </div>
    );
  }

  const myVotedKey =
    isSynced && syncedKnockout && selfParticipantId
      ? syncedKnockout.votesByParticipantId[selfParticipantId]
      : undefined;

  let leftVotes = 0;
  let rightVotes = 0;
  if (isSynced && syncedKnockout && activeMatch) {
    const activeIds = new Set(
      (participants ?? []).filter((p) => p.isConnected).map((p) => p.id)
    );
    for (const [pid, voteKey] of Object.entries(syncedKnockout.votesByParticipantId)) {
      if (activeIds.size > 0 && !activeIds.has(pid)) continue;
      if (voteKey === activeMatch.left.ratingKey) leftVotes += 1;
      else if (voteKey === activeMatch.right.ratingKey) rightVotes += 1;
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col p-3 sm:p-4 gap-3 overflow-y-auto">
      {/* Tournament Round Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap shrink-0">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#101216] border border-white/15 text-xs font-bold text-[#F5F7FA]">
            <Swords className="w-3.5 h-3.5" />
            {bracket.roundTitle}
          </span>
          <span className="text-xs text-[#98A0B0]">
            Match {bracket.currentMatchIndex + 1} of {bracket.matchups.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {bracket.byeItem && (
            <span className="hidden sm:inline text-[11px] px-2 py-0.5 rounded bg-[#101216] border border-white/10 text-[#98A0B0] truncate max-w-[180px]">
              Bye: {bracket.byeItem.title}
            </span>
          )}
          <span className="font-mono tabular-nums text-[11px] px-2 py-0.5 rounded bg-[#101216] border border-white/10 text-[#F5F7FA]">
            Pick {Math.min(bracket.totalChoicesMade + 1, bracket.totalChoicesRequired)} /{' '}
            {bracket.totalChoicesRequired}
          </span>
        </div>
      </div>

      {/* Synced Live Tie-Break Notice & Voter Status Strip */}
      {isSynced && syncedKnockout && (
        <div className="space-y-2 shrink-0">
          {syncedKnockout.lastTieBreakMessage && (
            <div className="px-3 py-1.5 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/30 text-xs font-medium text-[#22C55E] text-center">
              {syncedKnockout.lastTieBreakMessage}
            </div>
          )}

          {participants && participants.length > 0 && (
            <div className="flex items-center justify-center gap-1.5 flex-wrap">
              {participants.map((p) => {
                const hasVoted = Boolean(syncedKnockout.votesByParticipantId[p.id]);
                return (
                  <span
                    key={p.id}
                    className={`text-[11px] px-2.5 py-0.5 rounded-full border font-medium whitespace-nowrap ${
                      hasVoted
                        ? 'bg-[#22C55E]/15 border-[#22C55E]/40 text-[#22C55E]'
                        : 'bg-[#101216] border-white/10 text-[#98A0B0]'
                    }`}
                  >
                    {p.name} {hasVoted ? '✓' : 'waiting…'}
                  </span>
                );
              })}
            </div>
          )}

          {syncedKnockout.tied && (
            <div className="p-3 rounded-xl bg-[#101216] border border-white/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="text-xs font-semibold text-[#F5F7FA]">
                It&apos;s a tie on this 1v1 showdown.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSyncedTieBreak?.('coinflip')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F5F7FA] text-[#07080A] text-xs font-bold hover:bg-white transition"
                >
                  <Dices className="w-3.5 h-3.5" />
                  <span>Flip a Coin (50/50)</span>
                </button>
                {selfRole === 'host' && (
                  <>
                    <button
                      type="button"
                      onClick={() => onSyncedTieBreak?.('pick', activeMatch.left.ratingKey)}
                      className="px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/10 text-xs font-semibold text-[#F5F7FA] hover:border-white/30"
                    >
                      Pick Option A
                    </button>
                    <button
                      type="button"
                      onClick={() => onSyncedTieBreak?.('pick', activeMatch.right.ratingKey)}
                      className="px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/10 text-xs font-semibold text-[#F5F7FA] hover:border-white/30"
                    >
                      Pick Option B
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 1v1 Head-to-Head VS Grid */}
      <div className="relative flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <ContenderCard
          item={activeMatch.left}
          roomCode={roomCode}
          sideLabel="← Option A"
          selected={
            isSynced
              ? myVotedKey === activeMatch.left.ratingKey
              : pickingKey === activeMatch.left.ratingKey
          }
          selectedLabel={isSynced ? 'YOUR VOTE' : 'WINNER'}
          voteCount={leftVotes}
          ctaLabel={
            isSynced
              ? myVotedKey === activeMatch.left.ratingKey
                ? 'Your Pick ✓'
                : 'Vote Option A'
              : 'Choose Option A'
          }
          disabled={!isSynced && Boolean(pickingKey)}
          showSynopsis={synopsisSide === 'left'}
          onToggleSynopsis={() => setSynopsisSide((s) => (s === 'left' ? null : 'left'))}
          onPick={() => handlePick(activeMatch.left.ratingKey)}
        />

        {/* Floating VS Badge */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-[#07080A] border border-white/25 text-[#F5F7FA] font-display font-bold text-xs tracking-wider flex items-center justify-center"
        >
          VS
        </div>

        <ContenderCard
          item={activeMatch.right}
          roomCode={roomCode}
          sideLabel="Option B →"
          selected={
            isSynced
              ? myVotedKey === activeMatch.right.ratingKey
              : pickingKey === activeMatch.right.ratingKey
          }
          selectedLabel={isSynced ? 'YOUR VOTE' : 'WINNER'}
          voteCount={rightVotes}
          ctaLabel={
            isSynced
              ? myVotedKey === activeMatch.right.ratingKey
                ? 'Your Pick ✓'
                : 'Vote Option B'
              : 'Choose Option B'
          }
          disabled={!isSynced && Boolean(pickingKey)}
          showSynopsis={synopsisSide === 'right'}
          onToggleSynopsis={() => setSynopsisSide((s) => (s === 'right' ? null : 'right'))}
          onPick={() => handlePick(activeMatch.right.ratingKey)}
        />
      </div>

      <p className="text-center text-[11px] text-[#5C6475] shrink-0">
        {isSynced ? (
          <>
            Tap a poster (or press <span className="font-mono text-[#98A0B0]">←</span> /{' '}
            <span className="font-mono text-[#98A0B0]">→</span>) to vote live — advances
            automatically on majority
          </>
        ) : (
          <>
            Tap a poster (or press <span className="font-mono text-[#98A0B0]">←</span> /{' '}
            <span className="font-mono text-[#98A0B0]">→</span>) to advance your favorite
          </>
        )}
      </p>
    </div>
  );
}
