import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MediaSummary } from '@syncreel/shared';
import { Film, Heart, Info, Sparkles, Star, Tv, X } from 'lucide-react';
import {
  formatMediaSubtitle,
  formatTimeMs,
  getHostArtworkUrl,
  getRoomArtworkUrl
} from '../../lib/format.js';
import {
  computeCardTransform,
  computeUnderCardStyle,
  computeVelocityX,
  resolveSwipeDecision,
  type PointerSample
} from '../../lib/swipePhysics.js';

export function resolveCardArtworkUrl(
  thumb: string | undefined,
  roomCode?: string,
  w = 680,
  h = 1020
): string | undefined {
  return roomCode ? getRoomArtworkUrl(roomCode, thumb, w, h) : getHostArtworkUrl(thumb, w, h);
}

interface SwipeCardSurfaceProps {
  roomCode?: string;
  card: MediaSummary;
  stampDirection: 'yes' | 'no' | null;
  stampOpacity: number;
  showSynopsis?: boolean;
  onCloseSynopsis?: () => void;
}

export function SwipeCardSurface({
  roomCode,
  card,
  stampDirection,
  stampOpacity,
  showSynopsis = false,
  onCloseSynopsis
}: SwipeCardSurfaceProps) {
  const thumbUrl = resolveCardArtworkUrl(card.thumb, roomCode, 680, 1020);

  return (
    <div className="relative w-full h-full bg-[#101216]">
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt={card.title}
          draggable={false}
          loading="eager"
          className="w-full h-full object-cover object-center select-none pointer-events-none"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-[#5C6475] bg-[#101216]">
          {card.type === 'show' ? <Tv className="w-16 h-16" /> : <Film className="w-16 h-16" />}
          <span className="text-xs font-medium text-[#98A0B0] px-6 text-center">{card.title}</span>
        </div>
      )}

      {/* Subtle top vignette for legibility */}
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/55 to-transparent pointer-events-none" />

      {/* Swipe Stamp Overlays */}
      {stampDirection === 'yes' && stampOpacity > 0.02 && (
        <div
          style={{ opacity: stampOpacity }}
          className="absolute top-6 left-5 px-3.5 py-1 rounded-xl border-[2.5px] border-[#22C55E] bg-black/70 text-[#22C55E] font-display font-bold text-xl tracking-widest -rotate-12 pointer-events-none"
        >
          WATCH
        </div>
      )}
      {stampDirection === 'no' && stampOpacity > 0.02 && (
        <div
          style={{ opacity: stampOpacity }}
          className="absolute top-6 right-5 px-3.5 py-1 rounded-xl border-[2.5px] border-[#F43F5E] bg-black/70 text-[#F43F5E] font-display font-bold text-xl tracking-widest rotate-12 pointer-events-none"
        >
          PASS
        </div>
      )}

      {/* Bottom Title & Metadata Overlay */}
      <div className="absolute inset-x-0 bottom-0 pt-24 pb-4 px-4 bg-gradient-to-t from-black/95 via-black/72 to-transparent pointer-events-none">
        <div className="flex items-end justify-between gap-2.5">
          <div className="min-w-0">
            <h3 className="font-display text-xl sm:text-2xl font-bold text-[#F5F7FA] tracking-tight leading-tight">
              {card.title}
            </h3>
            <p className="text-xs text-[#C6CCD8] mt-1">
              {formatMediaSubtitle(card)}
              {card.durationMs > 0 && card.type === 'movie'
                ? ` • ${formatTimeMs(card.durationMs)}`
                : ''}
            </p>
          </div>
          {card.rating && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/75 border border-white/15 text-xs font-mono tabular-nums text-[#F5F7FA] shrink-0">
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
                className="text-[11px] px-2.5 py-0.5 rounded-full bg-white/12 text-[#F5F7FA]"
              >
                {g}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Frosted Slide-Up Synopsis Sheet */}
      {showSynopsis && (
        <div
          data-no-drag="true"
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute inset-x-0 bottom-0 max-h-[60%] bg-[#07080A]/92 backdrop-blur-md border-t border-white/12 p-4 overflow-y-auto touch-pan-y z-20"
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <div>
              <h4 className="font-display text-sm font-bold text-[#F5F7FA]">{card.title}</h4>
              <p className="text-[11px] text-[#98A0B0]">{formatMediaSubtitle(card)}</p>
            </div>
            {onCloseSynopsis && (
              <button
                type="button"
                onClick={onCloseSynopsis}
                aria-label="Hide synopsis"
                className="p-1.5 rounded-lg bg-white/10 text-[#F5F7FA] hover:bg-white/20 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <p className="text-xs text-[#C6CCD8] leading-relaxed">
            {card.summary?.trim() || 'No synopsis available for this title.'}
          </p>
        </div>
      )}
    </div>
  );
}

interface ExitAnimationState {
  cardKey: string;
  direction: 'yes' | 'no';
  startY: number;
}

const EXIT_DURATION_MS = 220;

interface SwipeDeckStageProps {
  active?: boolean;
  sessionKey: string;
  cardsRemaining: MediaSummary[];
  totalCount: number;
  swipedCount: number;
  headerRightLabel?: string;
  roomCode?: string;
  matchBanner?: MediaSummary | null;
  onOpenMatchBanner?: () => void;
  onVote: (ratingKey: string, decision: 'yes' | 'no') => void;
  onEscape?: () => void;
  footerSlot?: ReactNode;
  emptyState: ReactNode;
}

export function SwipeDeckStage({
  active = true,
  sessionKey,
  cardsRemaining,
  totalCount,
  swipedCount,
  headerRightLabel,
  roomCode,
  matchBanner,
  onOpenMatchBanner,
  onVote,
  onEscape,
  footerSlot,
  emptyState
}: SwipeDeckStageProps) {
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
  }, [sessionKey, clearExitTimer]);

  useEffect(() => {
    if (!active) {
      setDragPos({ x: 0, y: 0 });
      setIsDragging(false);
      pointerIdRef.current = null;
      pointerStartRef.current = null;
      samplesRef.current = [];
    }
  }, [active]);

  useEffect(() => () => clearExitTimer(), [clearExitTimer]);

  const pendingSet = new Set(pendingVotedKeys);
  const visibleRemaining = cardsRemaining.filter((c) => !pendingSet.has(c.ratingKey));
  const currentCard = visibleRemaining[0] ?? null;
  const nextCard = visibleRemaining[1] ?? null;
  const effectiveSwipedCount = Math.min(
    totalCount,
    swipedCount + cardsRemaining.filter((c) => pendingSet.has(c.ratingKey)).length
  );

  // Preload upcoming posters for zero-flash advancement
  useEffect(() => {
    if (!active || visibleRemaining.length <= 1) return;
    for (const card of visibleRemaining.slice(1, 5)) {
      const url = resolveCardArtworkUrl(card.thumb, roomCode, 680, 1020);
      if (url) {
        const img = new Image();
        img.src = url;
      }
    }
  }, [active, roomCode, visibleRemaining]);

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
        onVote(cardKey, decision);
      }, EXIT_DURATION_MS);
    },
    [currentCard, dragPos.y, clearExitTimer, onVote]
  );

  useEffect(() => {
    if (!active || !currentCard) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }
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
      } else if (e.key === 'Escape' && onEscape) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onEscape();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [active, currentCard, commitSwipe, onEscape]);

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
      ? 'border-[#22C55E]/75'
      : activeDirection === 'no' && effectiveProgress > 0.25
        ? 'border-[#F43F5E]/75'
        : 'border-white/12';

  const highlightNoButton = activeDirection === 'no' && effectiveProgress > 0.35;
  const highlightYesButton = activeDirection === 'yes' && effectiveProgress > 0.35;

  return (
    <div className="flex-1 min-h-0 flex flex-col px-3 pt-2.5 pb-3 sm:px-4 sm:pb-4 overflow-hidden select-none">
      {currentCard ? (
        <>
          <div className="relative flex-1 min-h-0 w-full">
            {/* Subtle top counter / label overlay inside stage */}
            <div className="absolute top-3 inset-x-3 z-10 flex items-center justify-between gap-2 pointer-events-none">
              <span className="px-2 py-0.5 rounded-md bg-black/65 backdrop-blur-xs border border-white/10 font-mono text-[11px] tabular-nums text-[#F5F7FA]">
                {Math.min(effectiveSwipedCount + 1, totalCount)} / {totalCount}
              </span>
              {headerRightLabel && (
                <span className="px-2.5 py-0.5 rounded-md bg-black/65 backdrop-blur-xs border border-white/10 text-[11px] text-[#C6CCD8] truncate max-w-[65%]">
                  {headerRightLabel}
                </span>
              )}
            </div>

            {matchBanner && (
              <button
                type="button"
                onClick={onOpenMatchBanner}
                className="absolute top-11 inset-x-3 z-30 flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-[#101216]/95 border border-[#22C55E]/70 text-left backdrop-blur-md"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-4 h-4 text-[#22C55E] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#22C55E]">
                      It&apos;s a Match
                    </p>
                    <p className="text-xs font-semibold text-[#F5F7FA] truncate">
                      {matchBanner.title}
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-semibold text-[#F5F7FA] shrink-0">View</span>
              </button>
            )}

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
                className="absolute inset-0 rounded-2xl overflow-hidden bg-[#101216] border border-white/10 pointer-events-none will-change-transform"
              >
                <SwipeCardSurface
                  roomCode={roomCode}
                  card={nextCard}
                  stampDirection={null}
                  stampOpacity={0}
                />
              </div>
            )}

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
                  // Ignore capture edge cases
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
                  // Ignore release edge cases
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
              className={`absolute inset-0 rounded-2xl overflow-hidden bg-[#07080A] border ${cardBorderClass} touch-none select-none cursor-grab active:cursor-grabbing will-change-transform`}
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

          <div className="pt-3 shrink-0 space-y-2.5">
            <div className="flex items-center justify-center gap-5">
              <button
                type="button"
                disabled={isCardExiting}
                onClick={() => commitSwipe('no')}
                aria-label="Pass (Swipe Left)"
                className={`w-13 h-13 rounded-full border flex items-center justify-center transition active:scale-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                  highlightNoButton
                    ? 'scale-110 bg-[#F43F5E] border-[#F43F5E] text-white'
                    : 'bg-[#101216] border-white/15 text-[#F43F5E] hover:bg-[#F43F5E] hover:border-[#F43F5E] hover:text-white'
                }`}
              >
                <X className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => setShowSynopsis((s) => !s)}
                aria-label="Toggle synopsis"
                className={`w-10 h-10 rounded-full border flex items-center justify-center transition active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                  showSynopsis
                    ? 'bg-[#F5F7FA] border-[#F5F7FA] text-[#07080A]'
                    : 'bg-[#101216] border-white/15 text-[#98A0B0] hover:text-[#F5F7FA] hover:border-white/30'
                }`}
              >
                <Info className="w-4 h-4" />
              </button>

              <button
                type="button"
                disabled={isCardExiting}
                onClick={() => commitSwipe('yes')}
                aria-label="Watch (Swipe Right)"
                className={`w-13 h-13 rounded-full border flex items-center justify-center transition active:scale-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                  highlightYesButton
                    ? 'scale-110 bg-[#22C55E] border-[#22C55E] text-[#07080A]'
                    : 'bg-[#101216] border-white/15 text-[#22C55E] hover:bg-[#22C55E] hover:border-[#22C55E] hover:text-[#07080A]'
                }`}
              >
                <Heart className="w-5 h-5 fill-current" />
              </button>
            </div>

            {footerSlot}
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center px-4">
          {emptyState}
        </div>
      )}
    </div>
  );
}
