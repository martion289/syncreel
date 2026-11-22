import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ClientEvent,
  MediaSummary,
  Participant,
  ParticipantRole,
  PlexGenre,
  PlexLibrarySection,
  SoloDeckCategory,
  SwipeMatchConfig,
  SwipeMatchState
} from '@syncreel/shared';
import { SOLO_DECK_CATEGORIES } from '@syncreel/shared';
import { Check, Dices, Flame, Play, Plus, Sparkles, Swords, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatMediaSubtitle, getRoomArtworkUrl } from '../../lib/format.js';
import { DeckBuilderControls } from './DeckBuilderControls.js';
import { KnockoutArena } from './KnockoutArena.js';
import { SwipeDeckStage } from './SwipeDeckStage.js';

interface SwipeMatchModalProps {
  open: boolean;
  onClose: () => void;
  roomCode: string;
  selfParticipantId?: string | null;
  selfRole: ParticipantRole;
  participants: Participant[];
  swipeMatch: SwipeMatchState | null;
  selfSwipeOrder?: string[];
  selfSwipedKeys?: string[];
  matchBanner?: MediaSummary | null;
  sendEvent: (event: ClientEvent) => void;
}

export function SwipeMatchModal(props: SwipeMatchModalProps) {
  const {
    open,
    onClose,
    roomCode,
    selfParticipantId,
    selfRole,
    participants,
    swipeMatch,
    selfSwipeOrder,
    selfSwipedKeys,
    matchBanner,
    sendEvent
  } = props;

  const [view, setView] = useState<'deck' | 'matches' | 'knockout'>('deck');
  const [sections, setSections] = useState<PlexLibrarySection[]>([]);
  const [genres, setGenres] = useState<PlexGenre[]>([]);
  const [loadingGenres, setLoadingGenres] = useState(false);

  const [category, setCategory] = useState<SoloDeckCategory>('unwatched');
  const [libraryFilter, setLibraryFilter] = useState<string>('all');
  const [selectedGenre, setSelectedGenre] = useState<string>('');
  const [unwatchedOnly, setUnwatchedOnly] = useState<boolean>(true);
  const [deckSize, setDeckSize] = useState<number>(20);
  const [starting, setStarting] = useState(false);
  const lastHadKnockoutRef = useRef(false);

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

  useEffect(() => {
    if (!swipeMatch) {
      setStarting(false);
      setView('deck');
      lastHadKnockoutRef.current = false;
      return;
    }

    const hasKnockout = Boolean(swipeMatch.knockout);
    if (hasKnockout && !lastHadKnockoutRef.current) {
      lastHadKnockoutRef.current = true;
      setView('knockout');
    } else if (!hasKnockout) {
      lastHadKnockoutRef.current = false;
      if (swipeMatch.status === 'finished') {
        setView('matches');
      }
    }
  }, [swipeMatch?.id, swipeMatch?.status, Boolean(swipeMatch?.knockout)]);

  const orderedDeck = useMemo(() => {
    if (!swipeMatch) return [];
    const byKey = new Map(swipeMatch.deck.map((d) => [d.ratingKey, d]));
    const keys = selfSwipeOrder ?? swipeMatch.deck.map((d) => d.ratingKey);
    return keys.map((k) => byKey.get(k)).filter((m): m is MediaSummary => Boolean(m));
  }, [swipeMatch, selfSwipeOrder]);

  const swipedSet = useMemo(() => new Set(selfSwipedKeys ?? []), [selfSwipedKeys]);

  const remainingCards = useMemo(
    () => orderedDeck.filter((c) => !swipedSet.has(c.ratingKey)),
    [orderedDeck, swipedSet]
  );

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

  const knockoutCandidates = useMemo(() => {
    if (matchedItems.length >= 2) return matchedItems;
    if (closeCallItems.length >= 2) return closeCallItems.map((c) => c.item);
    return matchedItems;
  }, [matchedItems, closeCallItems]);

  const handleVote = useCallback(
    (ratingKey: string, decision: 'yes' | 'no') => {
      sendEvent({ type: 'swipe:vote', ratingKey, decision });
    },
    [sendEvent]
  );

  const handleOpenKnockout = useCallback(() => {
    if (swipeMatch && !swipeMatch.knockout) {
      sendEvent({ type: 'swipe:knockoutStart' });
    }
    setView('knockout');
  }, [sendEvent, swipeMatch]);

  if (!open) return null;

  const handleDealDeck = (wildcard: boolean) => {
    setStarting(true);
    const hasGenre = !wildcard && Boolean(selectedGenre);
    const config: SwipeMatchConfig = {
      category: wildcard || hasGenre ? 'wildcard' : category,
      libraryFilter,
      genre: hasGenre ? selectedGenre : null,
      unwatchedOnly: wildcard ? false : unwatchedOnly,
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
  const isKnockoutActive = Boolean(swipeMatch && view === 'knockout');
  const effectiveSwipedCount = swipeMatch
    ? Math.min(swipeMatch.deck.length, swipedSet.size)
    : 0;

  const activeCategoryLabel = swipeMatch?.config.category
    ? SOLO_DECK_CATEGORIES.find((c) => c.id === swipeMatch.config.category)?.label
    : null;
  const deckHeaderLabel = swipeMatch?.config.genre
    ? [
        swipeMatch.config.genre,
        swipeMatch.config.unwatchedOnly ? 'Unwatched' : null
      ]
        .filter(Boolean)
        .join(' • ')
    : [
        activeCategoryLabel,
        swipeMatch?.config.unwatchedOnly && swipeMatch?.config.category !== 'unwatched'
          ? 'Unwatched'
          : null
      ]
        .filter(Boolean)
        .join(' • ') || 'Wildcard';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/92 sm:p-4">
      <div
        className={
          isKnockoutActive
            ? 'w-full h-[100dvh] rounded-none sm:rounded-2xl sm:max-w-4xl sm:h-[min(92dvh,860px)] flex flex-col bg-[#07080A] sm:bg-[#101216] sm:border sm:border-white/12 overflow-hidden'
            : isDeckActive
              ? 'w-full h-[100dvh] rounded-none sm:rounded-2xl sm:max-w-[440px] sm:h-[min(92dvh,860px)] flex flex-col bg-[#07080A] sm:bg-[#101216] sm:border sm:border-white/12 overflow-hidden'
              : 'w-full h-[100dvh] sm:h-auto sm:max-h-[90dvh] rounded-none sm:rounded-2xl sm:max-w-lg flex flex-col bg-[#101216] sm:border sm:border-white/12 overflow-hidden'
        }
      >
        {/* Header */}
        <div className="px-3.5 sm:px-4 py-2.5 border-b border-white/8 flex items-center justify-between gap-2 shrink-0 bg-[#101216]">
          <div className="flex items-center gap-2 min-w-0">
            <Flame className="w-4 h-4 text-[#F5F7FA] shrink-0" />
            <h2 className="font-display text-sm font-bold text-[#F5F7FA] whitespace-nowrap">
              {view === 'knockout' ? '1v1 Knockout' : 'Swipe Match'}
            </h2>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {swipeMatch && (
              <div className="flex bg-[#07080A] border border-white/10 rounded-lg p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setView('deck')}
                  className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition ${
                    view === 'deck' ? 'bg-[#181B22] text-[#F5F7FA]' : 'text-[#98A0B0]'
                  }`}
                >
                  Swipe
                </button>
                <button
                  type="button"
                  onClick={() => setView('matches')}
                  className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition ${
                    view === 'matches' ? 'bg-[#F5F7FA] text-[#07080A]' : 'text-[#98A0B0]'
                  }`}
                >
                  Matches ({matchedItems.length})
                </button>
                {(knockoutCandidates.length >= 2 || swipeMatch.knockout) && (
                  <button
                    type="button"
                    onClick={handleOpenKnockout}
                    className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition ${
                      view === 'knockout' ? 'bg-[#22C55E] text-[#07080A]' : 'text-[#98A0B0]'
                    }`}
                  >
                    1v1
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close Swipe Match"
              className="p-1.5 rounded-lg text-[#98A0B0] hover:text-[#F5F7FA] hover:bg-[#181B22] shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Slim Progress Bar */}
        {swipeMatch && view === 'deck' && (
          <div className="h-0.5 w-full bg-[#181B22] shrink-0">
            <div
              className="h-full bg-[#F5F7FA] transition-[width] duration-300 ease-out"
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

        {/* Active Swipe Deck View */}
        {swipeMatch && view === 'deck' && (
          <SwipeDeckStage
            active={open && view === 'deck'}
            sessionKey={swipeMatch.id}
            cardsRemaining={remainingCards}
            totalCount={swipeMatch.deck.length}
            swipedCount={swipedSet.size}
            headerRightLabel={deckHeaderLabel}
            roomCode={roomCode}
            matchBanner={matchBanner}
            onOpenMatchBanner={() => setView('matches')}
            onVote={handleVote}
            onEscape={onClose}
            footerSlot={
              <div className="flex items-center justify-center gap-1.5 overflow-x-auto py-0.5">
                {participants.map((p) => {
                  const count = swipeMatch.progressByParticipantId[p.id] ?? 0;
                  return (
                    <span
                      key={p.id}
                      className="text-[10px] px-2 py-0.5 rounded bg-[#101216] border border-white/10 text-[#98A0B0] font-mono tabular-nums whitespace-nowrap shrink-0"
                    >
                      {p.name}: {count}/{swipeMatch.deck.length}
                    </span>
                  );
                })}
              </div>
            }
            emptyState={
              <div className="space-y-3">
                <Check className="w-9 h-9 text-[#22C55E] mx-auto" />
                <p className="text-sm font-semibold text-[#F5F7FA]">
                  You finished swiping this deck!
                </p>
                <p className="text-xs text-[#98A0B0] max-w-xs">
                  Check the Matches tab to see unanimous picks or launch a 1v1 Knockout bracket.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setView('matches')}
                    className="px-4 py-2 rounded-lg bg-[#F5F7FA] text-[#07080A] text-xs font-semibold"
                  >
                    View Matches ({matchedItems.length})
                  </button>
                  {(knockoutCandidates.length >= 2 || swipeMatch.knockout) && (
                    <button
                      type="button"
                      onClick={handleOpenKnockout}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#22C55E] text-[#07080A] text-xs font-bold"
                    >
                      <Swords className="w-3.5 h-3.5" />
                      <span>
                        1v1 Knockout ({swipeMatch.knockout ? 'Live' : knockoutCandidates.length})
                      </span>
                    </button>
                  )}
                </div>
              </div>
            }
          />
        )}

        {/* 1v1 Knockout Tie-Breaker View */}
        {swipeMatch && view === 'knockout' && (
          <KnockoutArena
            candidates={knockoutCandidates}
            roomCode={roomCode}
            subtitle={
              matchedItems.length >= 2
                ? `${matchedItems.length} unanimous room picks`
                : 'Top combined likes'
            }
            syncedKnockout={swipeMatch.knockout ?? undefined}
            participants={participants}
            selfParticipantId={selfParticipantId}
            selfRole={selfRole}
            onSyncedVote={(ratingKey) => sendEvent({ type: 'swipe:knockoutVote', ratingKey })}
            onSyncedTieBreak={(mode, ratingKey) =>
              sendEvent({ type: 'swipe:knockoutTieBreak', mode, ratingKey })
            }
            onWatchNow={
              selfRole === 'host'
                ? (item) => {
                    sendEvent({ type: 'swipe:playMatch', ratingKey: item.ratingKey });
                    onClose();
                  }
                : undefined
            }
            onQueueItem={
              selfRole === 'host'
                ? (item) => {
                    sendEvent({ type: 'swipe:queueMatch', ratingKey: item.ratingKey });
                  }
                : undefined
            }
            onRestart={() => setView('matches')}
            restartLabel="Back to Matches"
          />
        )}

        {/* Scrollable Body for Deck Setup or Matched Shortlist */}
        {(!swipeMatch || view === 'matches') && (
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
            {!swipeMatch && selfRole === 'host' && (
              <div className="space-y-4">
                <p className="text-xs text-[#98A0B0] leading-relaxed">
                  Choose a category or genre. Everyone gets the same deck in a private shuffled
                  order — swipe right on anything you&apos;d watch, then run a synced 1v1 Knockout.
                </p>

                <DeckBuilderControls
                  category={category}
                  onCategoryChange={setCategory}
                  libraryFilter={libraryFilter}
                  onLibraryFilterChange={setLibraryFilter}
                  selectedGenre={selectedGenre}
                  onSelectedGenreChange={setSelectedGenre}
                  unwatchedOnly={unwatchedOnly}
                  onUnwatchedOnlyChange={setUnwatchedOnly}
                  deckSize={deckSize}
                  onDeckSizeChange={setDeckSize}
                  sections={sections}
                  genres={genres}
                  loadingGenres={loadingGenres}
                />

                <div className="grid grid-cols-2 gap-2.5 pt-2">
                  <button
                    type="button"
                    disabled={starting}
                    onClick={() => handleDealDeck(true)}
                    className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[#181B22] border border-white/10 text-xs font-semibold text-[#F5F7FA] hover:border-white/30 disabled:opacity-50"
                  >
                    <Dices className="w-4 h-4" />
                    <span>Wildcard Deal</span>
                  </button>
                  <button
                    type="button"
                    disabled={starting}
                    onClick={() => handleDealDeck(false)}
                    className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[#F5F7FA] text-[#07080A] text-xs font-semibold hover:bg-white disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>{starting ? 'Dealing…' : 'Start Swiping'}</span>
                  </button>
                </div>
              </div>
            )}

            {!swipeMatch && selfRole !== 'host' && (
              <div className="py-12 text-center text-sm text-[#98A0B0]">
                Waiting for the host to deal a Swipe Match deck.
              </div>
            )}

            {/* Matched Shortlist View */}
            {swipeMatch && view === 'matches' && (
              <div className="space-y-4">
                {(knockoutCandidates.length >= 2 || swipeMatch.knockout) && (
                  <button
                    type="button"
                    onClick={handleOpenKnockout}
                    className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-[#22C55E]/10 border border-[#22C55E]/40 text-left hover:bg-[#22C55E]/15 transition"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Swords className="w-5 h-5 text-[#22C55E] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#F5F7FA]">
                          {swipeMatch.knockout
                            ? 'Join Live 1v1 Knockout Bracket'
                            : `Run 1v1 Knockout Tie-Breaker (${knockoutCandidates.length} contenders)`}
                        </p>
                        <p className="text-[11px] text-[#98A0B0]">
                          Everyone votes head-to-head on their own phone until 1 winner remains.
                        </p>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-[#22C55E] text-[#07080A] text-[11px] font-bold shrink-0">
                      {swipeMatch.knockout ? 'Open 1v1' : 'Start 1v1'}
                    </span>
                  </button>
                )}

                {matchedItems.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#22C55E]">
                        Unanimous Matches ({matchedItems.length})
                      </p>
                      {selfRole === 'host' && matchedItems.length > 1 && (
                        <button
                          type="button"
                          onClick={handlePickRandomMatch}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#F5F7FA] text-[#07080A] text-[11px] font-semibold"
                        >
                          <Dices className="w-3.5 h-3.5" />
                          <span>Pick Random</span>
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      {matchedItems.map((m) => {
                        const thumb = getRoomArtworkUrl(roomCode, m.thumb, 140, 210);
                        return (
                          <div
                            key={m.ratingKey}
                            className="flex items-center gap-3 p-2.5 rounded-xl bg-[#07080A] border border-[#22C55E]/35"
                          >
                            {thumb && (
                              <img
                                src={thumb}
                                alt={m.title}
                                className="w-11 h-16 object-cover rounded shrink-0 bg-[#181B22]"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-[#F5F7FA] truncate">
                                {m.title}
                              </p>
                              <p className="text-[11px] text-[#98A0B0] truncate">
                                {formatMediaSubtitle(m)}
                              </p>
                              {m.type === 'show' && (
                                <p className="text-[10px] text-[#98A0B0] mt-0.5">
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
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#F5F7FA] text-[#07080A] text-xs font-semibold hover:bg-white"
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
                                  className="p-1.5 rounded-lg bg-[#181B22] border border-white/10 text-[#F5F7FA] hover:border-white/30"
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
                  <div className="py-6 text-center text-xs text-[#98A0B0]">
                    No unanimous matches yet — keep swiping or check Close Calls below.
                  </div>
                )}

                {closeCallItems.length > 0 && (
                  <div className="space-y-2 pt-3 border-t border-white/8">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#98A0B0]">
                      Close Calls (Partial Likes)
                    </p>
                    {closeCallItems.map(({ item, likes }) => (
                      <div
                        key={item.ratingKey}
                        className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[#07080A] border border-white/10"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[#F5F7FA] truncate">
                            {item.title}
                          </p>
                          <p className="text-[11px] text-[#98A0B0]">
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
                            className="px-2.5 py-1 rounded-md bg-[#181B22] text-xs font-medium text-[#F5F7FA] hover:border-white/30 border border-white/10"
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
                      className="px-3 py-1.5 rounded-lg bg-[#181B22] border border-white/10 text-xs font-medium text-[#98A0B0] hover:text-[#F5F7FA]"
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
