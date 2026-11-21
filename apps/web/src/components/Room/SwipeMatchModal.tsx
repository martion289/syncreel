import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ClientEvent,
  MediaSummary,
  Participant,
  ParticipantRole,
  PlexGenre,
  PlexLibrarySection,
  SwipeMatchConfig,
  SwipeMatchState
} from '@syncreel/shared';
import {
  Check,
  Dices,
  Film,
  Flame,
  Heart,
  Info,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Star,
  Tv,
  X
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatMediaSubtitle, formatTimeMs, getRoomArtworkUrl } from '../../lib/format.js';
import {
  computeCardTransform,
  computeUnderCardStyle,
  computeVelocityX,
  resolveSwipeDecision,
  type PointerSample
} from '../../lib/swipePhysics.js';

interface SwipeMatchModalProps {
  open: boolean;
  onClose: () => void;
  roomCode: string;
  selfRole: ParticipantRole;
  participants: Participant[];
  swipeMatch: SwipeMatchState | null;
  selfSwipeOrder?: string[];
  selfSwipedKeys?: string[];
  matchBanner?: MediaSummary | null;
  sendEvent: (event: ClientEvent) => void;
}

interface ExitAnimationState {
  cardKey: string;
  direction: 'yes' | 'no';
  startY: number;
}

interface SwipeCardSurfaceProps {
  roomCode: string;
  card: MediaSummary;
  stampDirection: 'yes' | 'no' | null;
  stampOpacity: number;
  showSynopsis?: boolean;
  onCloseSynopsis?: () => void;
}

function SwipeCardSurface({
  roomCode,
  card,
  stampDirection,
  stampOpacity,
  showSynopsis = false,
  onCloseSynopsis
}: SwipeCardSurfaceProps) {
  const thumbUrl = getRoomArtworkUrl(roomCode, card.thumb, 680, 1020);

  return (
    <div className="relative w-full h-full bg-[#16161A]">
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt={card.title}
          draggable={false}
          loading="eager"
          className="w-full h-full object-cover object-center select-none pointer-events-none"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-[#686670] bg-[#16161A]">
          {card.type === 'show' ? <Tv className="w-16 h-16" /> : <Film className="w-16 h-16" />}
          <span className="text-xs font-medium text-[#9C9AA6] px-6 text-center">{card.title}</span>
        </div>
      )}

      {/* Subtle top vignette for legibility of stamps */}
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/55 to-transparent pointer-events-none" />

      {/* Swipe Stamp Overlays */}
      {stampDirection === 'yes' && stampOpacity > 0.02 && (
        <div
          style={{ opacity: stampOpacity }}
          className="absolute top-6 left-5 px-3.5 py-1 rounded-xl border-[3px] border-[#34C77B] bg-black/65 text-[#34C77B] font-extrabold text-2xl tracking-widest -rotate-12 pointer-events-none shadow-lg"
        >
          WATCH
        </div>
      )}
      {stampDirection === 'no' && stampOpacity > 0.02 && (
        <div
          style={{ opacity: stampOpacity }}
          className="absolute top-6 right-5 px-3.5 py-1 rounded-xl border-[3px] border-[#D94848] bg-black/65 text-[#D94848] font-extrabold text-2xl tracking-widest rotate-12 pointer-events-none shadow-lg"
        >
          NOPE
        </div>
      )}

      {/* Bottom Title & Metadata Overlay */}
      <div className="absolute inset-x-0 bottom-0 pt-20 pb-4 px-4 bg-gradient-to-t from-black/95 via-black/70 to-transparent pointer-events-none">
        <div className="flex items-end justify-between gap-2.5">
          <div className="min-w-0">
            <h3 className="text-xl sm:text-2xl font-bold text-[#F4F2EE] leading-tight drop-shadow">
              {card.title}
            </h3>
            <p className="text-xs text-[#C6C4D0] mt-1">
              {formatMediaSubtitle(card)}
              {card.durationMs > 0 && card.type === 'movie'
                ? ` • ${formatTimeMs(card.durationMs)}`
                : ''}
            </p>
          </div>
          {card.rating && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/75 border border-[#E5A00D]/50 text-xs font-mono text-[#E5A00D] shrink-0">
              <Star className="w-3 h-3 fill-current" />
              {card.rating.toFixed(1)}
            </span>
          )}
        </div>

        {card.genres && card.genres.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {card.genres.slice(0, 3).map((g) => (
              <span
                key={g}
                className="text-[11px] px-2.5 py-0.5 rounded-full bg-white/15 backdrop-blur-xs text-[#F4F2EE]"
              >
                {g}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Frosted Slide-Up Synopsis Sheet inside Poster (keeps poster full-height) */}
      {showSynopsis && (
        <div
          data-no-drag="true"
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute inset-x-0 bottom-0 max-h-[60%] bg-black/90 backdrop-blur-md border-t border-white/15 p-4 overflow-y-auto touch-pan-y z-20"
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <div>
              <h4 className="text-sm font-bold text-[#F4F2EE]">{card.title}</h4>
              <p className="text-[11px] text-[#9C9AA6]">{formatMediaSubtitle(card)}</p>
            </div>
            {onCloseSynopsis && (
              <button
                type="button"
                onClick={onCloseSynopsis}
                aria-label="Hide synopsis"
                className="p-1.5 rounded-lg bg-white/10 text-[#F4F2EE] hover:bg-white/20 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <p className="text-xs text-[#E1DFE8] leading-relaxed">
            {card.summary?.trim() || 'No synopsis available for this title.'}
          </p>
        </div>
      )}
    </div>
  );
}

const EXIT_DURATION_MS = 220;

export function SwipeMatchModal(props: SwipeMatchModalProps) {
  const {
    open,
    onClose,
    roomCode,
    selfRole,
    participants,
    swipeMatch,
    selfSwipeOrder,
    selfSwipedKeys,
    matchBanner,
    sendEvent
  } = props;

  const [view, setView] = useState<'deck' | 'matches'>('deck');
  const [sections, setSections] = useState<PlexLibrarySection[]>([]);
  const [genres, setGenres] = useState<PlexGenre[]>([]);
  const [loadingGenres, setLoadingGenres] = useState(false);

  const [libraryFilter, setLibraryFilter] = useState<string>('all');
  const [selectedGenre, setSelectedGenre] = useState<string>(''); // '' = Wildcard
  const [unwatchedOnly, setUnwatchedOnly] = useState<boolean>(true);
  const [deckSize, setDeckSize] = useState<number>(20);
  const [starting, setStarting] = useState(false);

  const [showSynopsis, setShowSynopsis] = useState(false);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [grabUpperHalf, setGrabUpperHalf] = useState(true);
  const [exiting, setExiting] = useState<ExitAnimationState | null>(null);
  const [pendingVotedKeys, setPendingVotedKeys] = useState<string[]>([]);

  const pointerIdRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const samplesRef = useRef<PointerSample[]>([]);
  const exitingRef = useRef<ExitAnimationState | null>(null);
  const exitTimerRef = useRef<number | null>(null);

  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open || selfRole !== 'host') return;
    api
      .getLibraries()
      .then((r) => setSections(r.sections))
      .catch(() => undefined);
  }, [open, selfRole]);

  useEffect(() => {
    if (!open || selfRole !== 'host') return;
    setLoadingGenres(true);
    api
      .getGenres(libraryFilter)
      .then((r) => {
        setGenres(r.genres);
        setSelectedGenre((prev) =>
          prev && !r.genres.some((g) => g.title === prev) ? '' : prev
        );
      })
      .catch(() => setGenres([]))
      .finally(() => setLoadingGenres(false));
  }, [open, selfRole, libraryFilter]);

  // Reset transient card state whenever deck session changes
  useEffect(() => {
    clearExitTimer();
    exitingRef.current = null;
    setExiting(null);
    setPendingVotedKeys([]);
    setDragPos({ x: 0, y: 0 });
    setIsDragging(false);
    setShowSynopsis(false);
    pointerIdRef.current = null;
    pointerStartRef.current = null;
    samplesRef.current = [];

    if (!swipeMatch) {
      setStarting(false);
      setView('deck');
    } else if (swipeMatch.status === 'finished') {
      setView('matches');
    }
  }, [swipeMatch?.id, clearExitTimer]);

  useEffect(() => {
    if (swipeMatch?.status === 'finished') {
      setView('matches');
    }
  }, [swipeMatch?.status]);

  useEffect(() => {
    if (!open) {
      setDragPos({ x: 0, y: 0 });
      setIsDragging(false);
      pointerIdRef.current = null;
      pointerStartRef.current = null;
      samplesRef.current = [];
    }
  }, [open]);

  useEffect(() => () => clearExitTimer(), [clearExitTimer]);

  const orderedDeck = useMemo(() => {
    if (!swipeMatch) return [];
    const byKey = new Map(swipeMatch.deck.map((d) => [d.ratingKey, d]));
    const keys = selfSwipeOrder ?? swipeMatch.deck.map((d) => d.ratingKey);
    return keys.map((k) => byKey.get(k)).filter((m): m is MediaSummary => Boolean(m));
  }, [swipeMatch, selfSwipeOrder]);

  const swipedSet = useMemo(() => {
    const merged = new Set(selfSwipedKeys ?? []);
    for (const k of pendingVotedKeys) {
      merged.add(k);
    }
    return merged;
  }, [selfSwipedKeys, pendingVotedKeys]);

  const remainingCards = useMemo(
    () => orderedDeck.filter((c) => !swipedSet.has(c.ratingKey)),
    [orderedDeck, swipedSet]
  );

  const currentCard = remainingCards[0] ?? null;
  const nextCard = remainingCards[1] ?? null;

  // Preload the next few posters for instant zero-flash card advancement
  useEffect(() => {
    if (!open || remainingCards.length <= 1) return;
    for (const card of remainingCards.slice(1, 5)) {
      const url = getRoomArtworkUrl(roomCode, card.thumb, 680, 1020);
      if (url) {
        const img = new Image();
        img.src = url;
      }
    }
  }, [open, roomCode, remainingCards]);

  const matchedItems = useMemo(() => {
    if (!swipeMatch) return [];
    const byKey = new Map(swipeMatch.deck.map((d) => [d.ratingKey, d]));
    return swipeMatch.matchedRatingKeys
      .map((k) => byKey.get(k))
      .filter((m): m is MediaSummary => Boolean(m));
  }, [swipeMatch]);

  const closeCallItems = useMemo(() => {
    if (!swipeMatch) return [];
    const matchSet = new Set(swipeMatch.matchedRatingKeys);
    return swipeMatch.deck
      .filter((item) => !matchSet.has(item.ratingKey))
      .map((item) => ({
        item,
        likes: swipeMatch.likesByRatingKey[item.ratingKey]?.length ?? 0
      }))
      .filter((entry) => entry.likes > 0)
      .sort((a, b) => b.likes - a.likes)
      .slice(0, 6);
  }, [swipeMatch]);

  const commitSwipe = useCallback(
    (decision: 'yes' | 'no') => {
      if (!currentCard || exitingRef.current) return;
      const cardKey = currentCard.ratingKey;
      const exitState: ExitAnimationState = {
        cardKey,
        direction: decision,
        startY: dragPos.y
      };

      exitingRef.current = exitState;
      setExiting(exitState);
      setIsDragging(false);
      pointerIdRef.current = null;
      pointerStartRef.current = null;
      samplesRef.current = [];

      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(12);
        } catch {
          // Ignore unsupported vibration contexts
        }
      }

      clearExitTimer();
      exitTimerRef.current = window.setTimeout(() => {
        exitTimerRef.current = null;
        exitingRef.current = null;
        setPendingVotedKeys((prev) => (prev.includes(cardKey) ? prev : [...prev, cardKey]));
        setExiting(null);
        setDragPos({ x: 0, y: 0 });
        setIsDragging(false);
        setShowSynopsis(false);
        sendEvent({
          type: 'swipe:vote',
          ratingKey: cardKey,
          decision
        });
      }, EXIT_DURATION_MS);
    },
    [currentCard, dragPos.y, clearExitTimer, sendEvent]
  );

  // Keyboard / TV remote support inside active Swipe Deck (capture prevents background seek)
  useEffect(() => {
    if (!open || !swipeMatch || view !== 'deck' || !currentCard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        commitSwipe('no');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        commitSwipe('yes');
      } else if (e.key === 'i' || e.key === 'Info') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setShowSynopsis((s) => !s);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [open, swipeMatch, view, currentCard, commitSwipe, onClose]);

  if (!open) return null;

  const handleDealDeck = (wildcard: boolean) => {
    setStarting(true);
    const config: SwipeMatchConfig = {
      libraryFilter,
      genre: wildcard ? null : selectedGenre || null,
      unwatchedOnly,
      deckSize
    };
    sendEvent({ type: 'swipe:start', config });
  };

  const handlePickRandomMatch = () => {
    if (matchedItems.length === 0) return;
    const pick = matchedItems[Math.floor(Math.random() * matchedItems.length)];
    sendEvent({ type: 'swipe:playMatch', ratingKey: pick.ratingKey });
    onClose();
  };

  const isDeckActive = Boolean(swipeMatch && view === 'deck');
  const effectiveSwipedCount = swipeMatch ? Math.min(swipeMatch.deck.length, swipedSet.size) : 0;

  const cardTransform = computeCardTransform(dragPos.x, dragPos.y, grabUpperHalf);
  const isCardExiting = Boolean(exiting && currentCard && exiting.cardKey === currentCard.ratingKey);
  const activeDirection: 'yes' | 'no' | null = isCardExiting
    ? exiting!.direction
    : dragPos.x > 16
      ? 'yes'
      : dragPos.x < -16
        ? 'no'
        : null;

  const effectiveProgress = isCardExiting ? 1 : cardTransform.progress;
  const stampOpacity = isCardExiting
    ? 1
    : Math.min(1, Math.max(0, (Math.abs(dragPos.x) - 16) / 70));

  const underCardStyle = computeUnderCardStyle(effectiveProgress);

  let topCardTransformCss = `translate3d(${cardTransform.translateX}px, ${cardTransform.translateY}px, 0) rotate(${cardTransform.rotateDeg}deg)`;
  let topCardOpacity = 1;
  let topCardTransition = isDragging
    ? 'none'
    : 'transform 280ms cubic-bezier(0.175, 0.885, 0.32, 1.18), opacity 180ms ease-out';

  if (isCardExiting && exiting) {
    const dir = exiting.direction === 'yes' ? 1 : -1;
    const exitY = exiting.startY * 0.35 + 32;
    topCardTransformCss = `translate3d(${dir * 135}%, ${exitY}px, 0) rotate(${dir * 26}deg)`;
    topCardOpacity = 0;
    topCardTransition = `transform ${EXIT_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease-out`;
  }

  const cardBorderClass =
    activeDirection === 'yes' && effectiveProgress > 0.25
      ? 'border-[#34C77B]/75'
      : activeDirection === 'no' && effectiveProgress > 0.25
        ? 'border-[#D94848]/75'
        : 'border-[#2B2B33]';

  const highlightNoButton = activeDirection === 'no' && effectiveProgress > 0.35;
  const highlightYesButton = activeDirection === 'yes' && effectiveProgress > 0.35;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/92 sm:p-4">
      <div
        className={
          isDeckActive
            ? 'w-full h-[100dvh] rounded-none sm:rounded-2xl sm:max-w-[440px] sm:h-[min(92dvh,860px)] flex flex-col bg-[#0E0E10] sm:bg-[#16161A] sm:border sm:border-[#2B2B33] shadow-2xl overflow-hidden'
            : 'w-full h-[100dvh] sm:h-auto sm:max-h-[90dvh] rounded-none sm:rounded-2xl sm:max-w-lg flex flex-col bg-[#16161A] sm:border sm:border-[#2B2B33] shadow-2xl overflow-hidden'
        }
      >
        {/* Compact Single-Line Header */}
        <div className="px-3.5 sm:px-4 py-2.5 border-b border-[#2B2B33] flex items-center justify-between gap-2 shrink-0 bg-[#16161A]">
          <div className="flex items-center gap-2 min-w-0">
            <Flame className="w-4 h-4 text-[#E5A00D] shrink-0" />
            <h2 className="text-sm font-bold text-[#F4F2EE] whitespace-nowrap">Swipe Match</h2>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {swipeMatch && (
              <div className="flex bg-[#0E0E10] border border-[#2B2B33] rounded-lg p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setView('deck')}
                  className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition ${
                    view === 'deck' ? 'bg-[#202026] text-[#F4F2EE]' : 'text-[#9C9AA6]'
                  }`}
                >
                  Swipe
                </button>
                <button
                  type="button"
                  onClick={() => setView('matches')}
                  className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition ${
                    view === 'matches' ? 'bg-[#E5A00D] text-[#111113]' : 'text-[#9C9AA6]'
                  }`}
                >
                  Matches ({matchedItems.length})
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close Swipe Match"
              className="p-1.5 rounded-lg text-[#9C9AA6] hover:text-[#F4F2EE] hover:bg-[#202026] shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Slim Amber Progress Bar */}
        {swipeMatch && (
          <div className="h-0.5 w-full bg-[#202026] shrink-0">
            <div
              className="h-full bg-[#E5A00D] transition-[width] duration-300 ease-out"
              style={{
                width: `${
                  swipeMatch.deck.length > 0
                    ? Math.min(100, (effectiveSwipedCount / swipeMatch.deck.length) * 100)
                    : 0
                }%`
              }}
            />
          </div>
        )}

        {/* Active Swipe Deck Mode (Full-Height Poster Stage, Zero Page Scroll) */}
        {swipeMatch && view === 'deck' && (
          <div className="flex-1 min-h-0 flex flex-col px-3 pt-2 pb-3 sm:px-4 sm:pb-4 overflow-hidden select-none">
            <div className="flex items-center justify-between text-[11px] text-[#9C9AA6] mb-1.5 shrink-0">
              <span className="font-mono">
                {Math.min(effectiveSwipedCount + 1, swipeMatch.deck.length)} /{' '}
                {swipeMatch.deck.length}
              </span>
              <span className="truncate">
                {swipeMatch.config.genre ? swipeMatch.config.genre : 'Wildcard'} •{' '}
                {swipeMatch.config.unwatchedOnly ? 'Unwatched' : 'All'}
              </span>
            </div>

            {currentCard ? (
              <>
                {/* Full-Height Card Stack Stage */}
                <div className="relative flex-1 min-h-0 w-full">
                  {matchBanner && (
                    <button
                      type="button"
                      onClick={() => setView('matches')}
                      className="absolute top-3 inset-x-3 z-30 flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-[#16161A]/95 border border-[#34C77B] text-left shadow-xl backdrop-blur-md"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Sparkles className="w-4 h-4 text-[#E5A00D] shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-[#34C77B]">
                            It&apos;s a Match!
                          </p>
                          <p className="text-xs font-semibold text-[#F4F2EE] truncate">
                            {matchBanner.title}
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-[#E5A00D] shrink-0">
                        Tap to view
                      </span>
                    </button>
                  )}

                  {/* Peeking Next Card Underneath */}
                  {nextCard && (
                    <div
                      key={nextCard.ratingKey}
                      aria-hidden="true"
                      style={{
                        transform: `translate3d(0, ${underCardStyle.translateY}px, 0) scale(${underCardStyle.scale})`,
                        opacity: underCardStyle.opacity,
                        transition: isDragging
                          ? 'none'
                          : `transform ${EXIT_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${EXIT_DURATION_MS}ms ease-out`
                      }}
                      className="absolute inset-0 rounded-2xl overflow-hidden bg-[#16161A] border border-[#2B2B33] pointer-events-none shadow-lg will-change-transform"
                    >
                      <SwipeCardSurface
                        roomCode={roomCode}
                        card={nextCard}
                        stampDirection={null}
                        stampOpacity={0}
                      />
                    </div>
                  )}

                  {/* Top Draggable Poster Card */}
                  <div
                    key={currentCard.ratingKey}
                    onPointerDown={(e) => {
                      if (exitingRef.current) return;
                      if (e.pointerType === 'mouse' && e.button !== 0) return;
                      if ((e.target as HTMLElement | null)?.closest('[data-no-drag="true"]')) {
                        return;
                      }

                      const rect = e.currentTarget.getBoundingClientRect();
                      setGrabUpperHalf(e.clientY - rect.top < rect.height / 2);

                      pointerIdRef.current = e.pointerId;
                      pointerStartRef.current = { x: e.clientX, y: e.clientY };
                      samplesRef.current = [{ x: e.clientX, t: performance.now() }];
                      setIsDragging(true);

                      try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                      } catch {
                        // Ignore capture failures on synthetic/touch edge cases
                      }
                    }}
                    onPointerMove={(e) => {
                      if (
                        !isDragging ||
                        exitingRef.current ||
                        pointerIdRef.current !== e.pointerId ||
                        !pointerStartRef.current
                      ) {
                        return;
                      }
                      const dx = e.clientX - pointerStartRef.current.x;
                      const dy = e.clientY - pointerStartRef.current.y;
                      const now = performance.now();
                      samplesRef.current = [
                        ...samplesRef.current.filter((s) => now - s.t <= 120),
                        { x: e.clientX, t: now }
                      ];
                      setDragPos({ x: dx, y: dy });
                    }}
                    onPointerUp={(e) => {
                      if (!isDragging || pointerIdRef.current !== e.pointerId) return;
                      const start = pointerStartRef.current;
                      const dx = start ? e.clientX - start.x : dragPos.x;
                      const now = performance.now();
                      const recent = [
                        ...samplesRef.current.filter((s) => now - s.t <= 120),
                        { x: e.clientX, t: now }
                      ];
                      const velocityX = computeVelocityX(recent);
                      const decision = resolveSwipeDecision(dx, velocityX);

                      try {
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        }
                      } catch {
                        // Ignore release errors
                      }

                      if (decision) {
                        commitSwipe(decision);
                      } else {
                        setIsDragging(false);
                        setDragPos({ x: 0, y: 0 });
                        pointerIdRef.current = null;
                        pointerStartRef.current = null;
                        samplesRef.current = [];
                      }
                    }}
                    onPointerCancel={(e) => {
                      if (pointerIdRef.current !== e.pointerId) return;
                      setIsDragging(false);
                      setDragPos({ x: 0, y: 0 });
                      pointerIdRef.current = null;
                      pointerStartRef.current = null;
                      samplesRef.current = [];
                    }}
                    style={{
                      transform: topCardTransformCss,
                      opacity: topCardOpacity,
                      transition: topCardTransition
                    }}
                    className={`absolute inset-0 rounded-2xl overflow-hidden bg-[#0E0E10] border ${cardBorderClass} shadow-2xl touch-none select-none cursor-grab active:cursor-grabbing will-change-transform`}
                  >
                    <SwipeCardSurface
                      roomCode={roomCode}
                      card={currentCard}
                      stampDirection={activeDirection}
                      stampOpacity={stampOpacity}
                      showSynopsis={showSynopsis}
                      onCloseSynopsis={() => setShowSynopsis(false)}
                    />
                  </div>
                </div>

                {/* Compact Bottom Action Controls & Progress Pills */}
                <div className="pt-3 shrink-0 space-y-2">
                  <div className="flex items-center justify-center gap-5">
                    <button
                      type="button"
                      disabled={isCardExiting}
                      onClick={() => commitSwipe('no')}
                      aria-label="Pass (Swipe Left)"
                      className={`w-14 h-14 rounded-full border flex items-center justify-center transition active:scale-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D] ${
                        highlightNoButton
                          ? 'scale-110 bg-[#D94848] border-[#D94848] text-white shadow-lg'
                          : 'bg-[#16161A] border-[#D94848]/55 text-[#D94848] hover:bg-[#D94848] hover:text-white'
                      }`}
                    >
                      <X className="w-6 h-6" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowSynopsis((s) => !s)}
                      aria-label="Toggle synopsis"
                      className={`w-10 h-10 rounded-full border flex items-center justify-center transition active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D] ${
                        showSynopsis
                          ? 'bg-[#E5A00D] border-[#E5A00D] text-[#111113]'
                          : 'bg-[#202026] border-[#2B2B33] text-[#9C9AA6] hover:text-[#F4F2EE]'
                      }`}
                    >
                      <Info className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      disabled={isCardExiting}
                      onClick={() => commitSwipe('yes')}
                      aria-label="Watch (Swipe Right)"
                      className={`w-14 h-14 rounded-full border flex items-center justify-center transition active:scale-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A00D] ${
                        highlightYesButton
                          ? 'scale-110 bg-[#34C77B] border-[#34C77B] text-[#111113] shadow-lg'
                          : 'bg-[#16161A] border-[#34C77B]/60 text-[#34C77B] hover:bg-[#34C77B] hover:text-[#111113]'
                      }`}
                    >
                      <Heart className="w-6 h-6 fill-current" />
                    </button>
                  </div>

                  {/* Single-Row Scrollable Peer Progress Pills */}
                  <div className="flex items-center justify-center gap-1.5 overflow-x-auto py-0.5">
                    {participants.map((p) => {
                      const count = swipeMatch.progressByParticipantId[p.id] ?? 0;
                      return (
                        <span
                          key={p.id}
                          className="text-[10px] px-2 py-0.5 rounded bg-[#16161A] border border-[#2B2B33] text-[#9C9AA6] font-mono whitespace-nowrap shrink-0"
                        >
                          {p.name}: {count}/{swipeMatch.deck.length}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center px-4 space-y-3">
                <Check className="w-9 h-9 text-[#34C77B]" />
                <p className="text-sm font-semibold text-[#F4F2EE]">
                  You finished swiping this deck!
                </p>
                <p className="text-xs text-[#9C9AA6] max-w-xs">
                  Check the Matches tab to see unanimous picks as everyone else finishes.
                </p>
                <button
                  type="button"
                  onClick={() => setView('matches')}
                  className="px-4 py-2 rounded-lg bg-[#E5A00D] text-[#111113] text-xs font-semibold"
                >
                  View Matches ({matchedItems.length})
                </button>
              </div>
            )}
          </div>
        )}

        {/* Scrollable Body for Deck Setup or Matched Shortlist */}
        {(!swipeMatch || view === 'matches') && (
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
            {/* Setup Screen when no Swipe Match is active */}
            {!swipeMatch && selfRole === 'host' && (
              <div className="space-y-4">
                <p className="text-xs text-[#9C9AA6] leading-relaxed">
                  Pick a category or Wildcard it. Everyone gets the same deck in a private shuffled
                  order — swipe right on anything you&apos;d watch, and unanimous picks land in your
                  room shortlist!
                </p>

                <div>
                  <label className="block text-xs font-medium text-[#9C9AA6] mb-1.5">
                    Library / Format
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'all', label: 'All Libraries' },
                      { id: 'movie', label: 'Movies' },
                      { id: 'show', label: 'TV Shows' }
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setLibraryFilter(opt.id)}
                        className={`py-2 px-2 rounded-lg text-xs font-medium border transition ${
                          libraryFilter === opt.id
                            ? 'bg-[#E5A00D] text-[#111113] border-[#E5A00D] font-semibold'
                            : 'bg-[#0E0E10] text-[#F4F2EE] border-[#2B2B33] hover:border-[#9C9AA6]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {sections.length > 1 && (
                    <select
                      value={libraryFilter}
                      onChange={(e) => setLibraryFilter(e.target.value)}
                      className="mt-2 w-full px-3 py-2 rounded-lg bg-[#0E0E10] border border-[#2B2B33] text-xs text-[#F4F2EE] focus:outline-none focus:border-[#E5A00D]"
                    >
                      <option value="all">All Movie &amp; TV Libraries</option>
                      <option value="movie">All Movies</option>
                      <option value="show">All TV Shows</option>
                      {sections.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.title} ({s.type})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-[#9C9AA6]">Genre</label>
                    {loadingGenres && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E5A00D]" />
                    )}
                  </div>
                  <select
                    value={selectedGenre}
                    onChange={(e) => setSelectedGenre(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-[#0E0E10] border border-[#2B2B33] text-xs text-[#F4F2EE] focus:outline-none focus:border-[#E5A00D]"
                  >
                    <option value="">Wildcard (Any Genre)</option>
                    {genres.map((g) => (
                      <option key={g.title} value={g.title}>
                        {g.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <label className="flex items-center gap-2 text-xs text-[#9C9AA6] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={unwatchedOnly}
                      onChange={(e) => setUnwatchedOnly(e.target.checked)}
                      className="w-4 h-4 accent-[#E5A00D]"
                    />
                    <span>Unwatched only</span>
                  </label>

                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[#9C9AA6]">Deck:</span>
                    {[15, 25, 40].map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setDeckSize(size)}
                        className={`px-2.5 py-1 rounded-md text-xs font-mono ${
                          deckSize === size
                            ? 'bg-[#E5A00D] text-[#111113] font-semibold'
                            : 'bg-[#0E0E10] text-[#9C9AA6] border border-[#2B2B33]'
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 pt-2">
                  <button
                    type="button"
                    disabled={starting}
                    onClick={() => handleDealDeck(true)}
                    className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[#202026] border border-[#2B2B33] text-xs font-semibold text-[#F4F2EE] hover:border-[#E5A00D] disabled:opacity-50"
                  >
                    <Dices className="w-4 h-4 text-[#E5A00D]" />
                    <span>Wildcard Deal</span>
                  </button>
                  <button
                    type="button"
                    disabled={starting}
                    onClick={() => handleDealDeck(false)}
                    className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[#E5A00D] text-[#111113] text-xs font-semibold hover:bg-[#f0ad1c] disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>{starting ? 'Dealing…' : 'Start Swiping'}</span>
                  </button>
                </div>
              </div>
            )}

            {!swipeMatch && selfRole !== 'host' && (
              <div className="py-12 text-center text-sm text-[#9C9AA6]">
                Waiting for the host to deal a Swipe Match deck.
              </div>
            )}

            {/* Matched Shortlist View */}
            {swipeMatch && view === 'matches' && (
              <div className="space-y-4">
                {matchedItems.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#34C77B]">
                        Unanimous Matches ({matchedItems.length})
                      </p>
                      {selfRole === 'host' && matchedItems.length > 1 && (
                        <button
                          type="button"
                          onClick={handlePickRandomMatch}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#E5A00D] text-[#111113] text-[11px] font-semibold"
                        >
                          <Dices className="w-3.5 h-3.5" />
                          <span>Pick Random Match</span>
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      {matchedItems.map((m) => {
                        const thumb = getRoomArtworkUrl(roomCode, m.thumb, 140, 210);
                        return (
                          <div
                            key={m.ratingKey}
                            className="flex items-center gap-3 p-2.5 rounded-xl bg-[#0E0E10] border border-[#34C77B]/35"
                          >
                            {thumb && (
                              <img
                                src={thumb}
                                alt={m.title}
                                className="w-11 h-16 object-cover rounded shrink-0 bg-[#202026]"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-[#F4F2EE] truncate">
                                {m.title}
                              </p>
                              <p className="text-[11px] text-[#9C9AA6] truncate">
                                {formatMediaSubtitle(m)}
                              </p>
                              {m.type === 'show' && (
                                <p className="text-[10px] text-[#E5A00D] mt-0.5">
                                  Plays next unwatched / S01E01
                                </p>
                              )}
                            </div>
                            {selfRole === 'host' && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    sendEvent({ type: 'swipe:playMatch', ratingKey: m.ratingKey });
                                    onClose();
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#E5A00D] text-[#111113] text-xs font-semibold hover:bg-[#f0ad1c]"
                                >
                                  <Play className="w-3 h-3 fill-current" />
                                  <span>Play</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    sendEvent({ type: 'swipe:queueMatch', ratingKey: m.ratingKey })
                                  }
                                  aria-label={`Queue ${m.title}`}
                                  className="p-1.5 rounded-lg bg-[#202026] text-[#F4F2EE] hover:bg-[#2B2B33]"
                                >
                                  <Plus className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="py-6 text-center text-xs text-[#9C9AA6]">
                    No unanimous matches yet — keep swiping or check Close Calls below.
                  </div>
                )}

                {closeCallItems.length > 0 && (
                  <div className="space-y-2 pt-3 border-t border-[#2B2B33]">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#9C9AA6]">
                      Close Calls (Partial Likes)
                    </p>
                    {closeCallItems.map(({ item, likes }) => (
                      <div
                        key={item.ratingKey}
                        className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[#0E0E10] border border-[#2B2B33]"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[#F4F2EE] truncate">
                            {item.title}
                          </p>
                          <p className="text-[11px] text-[#9C9AA6]">
                            {likes} like{likes === 1 ? '' : 's'} • {formatMediaSubtitle(item)}
                          </p>
                        </div>
                        {selfRole === 'host' && (
                          <button
                            type="button"
                            onClick={() => {
                              sendEvent({ type: 'swipe:playMatch', ratingKey: item.ratingKey });
                              onClose();
                            }}
                            className="px-2.5 py-1 rounded-md bg-[#202026] text-xs font-medium text-[#F4F2EE] hover:border-[#E5A00D] border border-[#2B2B33]"
                          >
                            Play
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {selfRole === 'host' && (
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => sendEvent({ type: 'swipe:close' })}
                      className="px-3 py-1.5 rounded-lg bg-[#202026] text-xs font-medium text-[#9C9AA6] hover:text-[#F4F2EE]"
                    >
                      New Deck / Close
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
