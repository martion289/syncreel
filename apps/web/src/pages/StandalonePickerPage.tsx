import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AuthUser,
  MediaSummary,
  PlexGenre,
  PlexLibrarySection,
  SoloDeckCategory
} from '@syncreel/shared';
import { SOLO_DECK_CATEGORIES } from '@syncreel/shared';
import {
  ArrowRight,
  ChevronDown,
  ExternalLink,
  Film,
  Loader2,
  LogOut,
  Plus,
  QrCode,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Swords,
  Trash2,
  User,
  Users,
  X
} from 'lucide-react';
import { api } from '../lib/api.js';
import { aggregatePassThePhoneLikes } from '../lib/knockoutBracket.js';
import { DeckBuilderControls } from '../components/Room/DeckBuilderControls.js';
import { KnockoutArena } from '../components/Room/KnockoutArena.js';
import { SwipeDeckStage } from '../components/Room/SwipeDeckStage.js';

type PickerMode = 'solo' | 'pass' | 'multi';
type PickerStage = 'swipe' | 'handoff' | 'knockout';

interface PlayerTurnState {
  id: string;
  name: string;
  orderKeys: string[];
  swipedKeys: string[];
  likedKeys: string[];
}

interface StandalonePickerPageProps {
  onNavigate: (path: string) => void;
  initialUser?: AuthUser | null;
}

function shuffleKeys(keys: string[]): string[] {
  const copy = [...keys];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function StandalonePickerPage({ onNavigate, initialUser }: StandalonePickerPageProps) {
  const [user, setUser] = useState<AuthUser | null>(initialUser ?? null);
  const [authLoading, setAuthLoading] = useState(initialUser === undefined);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingAuthUrl, setPendingAuthUrl] = useState<string | null>(null);
  const [pollingPinId, setPollingPinId] = useState<number | null>(null);

  // Active live session state
  const [activeMode, setActiveMode] = useState<PickerMode>('solo');
  const [activeDeckLabel, setActiveDeckLabel] = useState<string>('Unwatched Gems');
  const [stage, setStage] = useState<PickerStage>('swipe');

  // Slide-up / centered Filter Sheet draft state
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mode, setMode] = useState<PickerMode>('solo');
  const [playerNames, setPlayerNames] = useState<string[]>(['Player 1', 'Player 2']);
  const [sections, setSections] = useState<PlexLibrarySection[]>([]);
  const [genres, setGenres] = useState<PlexGenre[]>([]);
  const [loadingGenres, setLoadingGenres] = useState(false);
  const [category, setCategory] = useState<SoloDeckCategory>('unwatched');
  const [libraryFilter, setLibraryFilter] = useState<string>('all');
  const [selectedGenre, setSelectedGenre] = useState<string>('');
  const [unwatchedOnly, setUnwatchedOnly] = useState<boolean>(true);
  const [deckSize, setDeckSize] = useState<number>(20);

  // Deck & turn state
  const [loadingDeck, setLoadingDeck] = useState(false);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [deckSessionKey, setDeckSessionKey] = useState('solo-init');
  const [deck, setDeck] = useState<MediaSummary[]>([]);
  const [serverMeta, setServerMeta] = useState<{ machineId?: string; name?: string }>({});

  const [playersState, setPlayersState] = useState<PlayerTurnState[]>([]);
  const [activePlayerIndex, setActivePlayerIndex] = useState(0);
  const [knockoutCandidates, setKnockoutCandidates] = useState<MediaSummary[]>([]);
  const [knockoutSubtitle, setKnockoutSubtitle] = useState<string>('');
  const [launchingRoom, setLaunchingRoom] = useState(false);

  const autoDealtRef = useRef(false);

  useEffect(() => {
    if (initialUser !== undefined) return;
    api
      .getAuthMe()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, [initialUser]);

  const dealLocalDeck = useCallback(
    async (opts: {
      nextMode: 'solo' | 'pass';
      nextCategory: SoloDeckCategory;
      nextLibraryFilter: string;
      nextGenre: string | null;
      nextUnwatchedOnly: boolean;
      nextDeckSize: number;
      nextPlayerNames: string[];
      username?: string;
    }) => {
      setDeckError(null);
      setLoadingDeck(true);
      try {
        const res = await api.discoverPlex({
          category: opts.nextCategory,
          libraryFilter: opts.nextLibraryFilter,
          genre: opts.nextGenre,
          unwatchedOnly: opts.nextUnwatchedOnly,
          deckSize: opts.nextDeckSize
        });

        if (res.items.length === 0) {
          setDeckError('No titles matched that filter. Adjust filters to broaden your deck.');
          return;
        }

        const label = opts.nextGenre
          ? opts.nextGenre
          : SOLO_DECK_CATEGORIES.find((c) => c.id === opts.nextCategory)?.label ?? 'Deck';

        setServerMeta({ machineId: res.serverMachineId, name: res.serverName });
        setDeck(res.items);
        setActiveMode(opts.nextMode);
        setActiveDeckLabel(label);
        setKnockoutCandidates([]);

        const keys = res.items.map((i) => i.ratingKey);
        const turnNames =
          opts.nextMode === 'solo'
            ? [opts.username || 'You']
            : opts.nextPlayerNames.map((n, idx) => n.trim() || `Player ${idx + 1}`).slice(0, 4);

        const turns: PlayerTurnState[] = turnNames.map((name, idx) => ({
          id: `p-${idx}`,
          name,
          orderKeys: shuffleKeys(keys),
          swipedKeys: [],
          likedKeys: []
        }));

        setPlayersState(turns);
        setActivePlayerIndex(0);
        setDeckSessionKey(`picker-${Date.now()}`);
        setStage(opts.nextMode === 'pass' ? 'handoff' : 'swipe');
        setFiltersOpen(false);
      } catch (err) {
        setDeckError(err instanceof Error ? err.message : 'Could not load media deck');
      } finally {
        setLoadingDeck(false);
      }
    },
    []
  );

  // Instant Swipe Canvas: auto-deal Unwatched Gems as soon as signed in
  useEffect(() => {
    if (!user) {
      autoDealtRef.current = false;
      return;
    }

    setPlayerNames((prev) =>
      prev[0] === 'Player 1' ? [user.username, ...prev.slice(1)] : prev
    );

    api
      .getLibraries()
      .then((r) => setSections(r.sections))
      .catch(() => undefined);

    if (!autoDealtRef.current) {
      autoDealtRef.current = true;
      void dealLocalDeck({
        nextMode: 'solo',
        nextCategory: 'unwatched',
        nextLibraryFilter: 'all',
        nextGenre: null,
        nextUnwatchedOnly: true,
        nextDeckSize: 20,
        nextPlayerNames: [user.username, 'Player 2'],
        username: user.username
      });
    }
  }, [user, dealLocalDeck]);

  useEffect(() => {
    if (!user) return;
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
  }, [user, libraryFilter]);

  useEffect(() => {
    if (!pollingPinId) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const res = await api.pollPlexPin(pollingPinId);
        if (!cancelled && res.authenticated && res.user) {
          setUser(res.user);
          setPollingPinId(null);
          setPendingAuthUrl(null);
          setAuthError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setAuthError(err instanceof Error ? err.message : 'Sign-in failed');
          setPollingPinId(null);
          setPendingAuthUrl(null);
        }
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollingPinId]);

  const handleMediaSignIn = async () => {
    setAuthError(null);
    try {
      const pin = await api.createPlexPin();
      setPendingAuthUrl(pin.authUrl);
      setPollingPinId(pin.id);
      window.open(pin.authUrl, 'syncreel-auth', 'width=640,height=740,noopener');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to start sign-in');
    }
  };

  const handleApplyFilters = async () => {
    setDeckError(null);
    const effectiveCategory: SoloDeckCategory = selectedGenre ? 'wildcard' : category;
    const effectiveGenre = selectedGenre || null;

    if (mode === 'multi') {
      setLoadingDeck(true);
      try {
        const created = await api.createRoom({
          name: 'IRL Movie Picker',
          purpose: 'picker',
          autoStartSwipe: {
            category: effectiveCategory,
            libraryFilter,
            genre: effectiveGenre,
            unwatchedOnly,
            deckSize
          }
        });
        try {
          sessionStorage.setItem(`syncreel_host_created_${created.code.toLowerCase()}`, '1');
        } catch {
          // Ignore storage issues
        }
        onNavigate(`/room/${created.code}?invite=1`);
      } catch (err) {
        setDeckError(err instanceof Error ? err.message : 'Could not create session');
      } finally {
        setLoadingDeck(false);
      }
      return;
    }

    await dealLocalDeck({
      nextMode: mode,
      nextCategory: effectiveCategory,
      nextLibraryFilter: libraryFilter,
      nextGenre: effectiveGenre,
      nextUnwatchedOnly: unwatchedOnly,
      nextDeckSize: deckSize,
      nextPlayerNames: playerNames,
      username: user?.username
    });
  };

  const activePlayer = playersState[activePlayerIndex] ?? null;

  const finalizeSwipePhase = useCallback(
    (finalPlayers: PlayerTurnState[]) => {
      if (activeMode === 'solo') {
        const likedSet = new Set(finalPlayers[0]?.likedKeys ?? []);
        const picks = deck.filter((d) => likedSet.has(d.ratingKey));
        setKnockoutCandidates(picks);
        setKnockoutSubtitle(`${picks.length} liked pick${picks.length === 1 ? '' : 's'}`);
        setStage('knockout');
        return;
      }

      const agg = aggregatePassThePhoneLikes(finalPlayers, deck);
      setKnockoutCandidates(agg.knockoutPool);
      setKnockoutSubtitle(
        agg.unanimous.length >= 2
          ? `${agg.unanimous.length} unanimous couch matches`
          : agg.unanimous.length === 1
            ? `1 unanimous match + top combined picks`
            : `${agg.knockoutPool.length} combined likes`
      );
      setStage('knockout');
    },
    [activeMode, deck]
  );

  const handleTurnVote = useCallback(
    (ratingKey: string, decision: 'yes' | 'no') => {
      setPlayersState((prev) =>
        prev.map((p, idx) => {
          if (idx !== activePlayerIndex || p.swipedKeys.includes(ratingKey)) return p;
          return {
            ...p,
            swipedKeys: [...p.swipedKeys, ratingKey],
            likedKeys: decision === 'yes' ? [...p.likedKeys, ratingKey] : p.likedKeys
          };
        })
      );
    },
    [activePlayerIndex]
  );

  useEffect(() => {
    if (stage !== 'swipe' || deck.length === 0 || !activePlayer) return;
    if (activePlayer.swipedKeys.length < deck.length) return;

    if (activeMode === 'pass' && activePlayerIndex + 1 < playersState.length) {
      setActivePlayerIndex(activePlayerIndex + 1);
      setDeckSessionKey(`picker-${Date.now()}-${activePlayerIndex + 1}`);
      setStage('handoff');
    } else {
      finalizeSwipePhase(playersState);
    }
  }, [
    stage,
    deck.length,
    activePlayer,
    activeMode,
    activePlayerIndex,
    playersState,
    finalizeSwipePhase
  ]);

  const handleFinishTurnEarly = () => {
    if (activeMode === 'solo') {
      finalizeSwipePhase(playersState);
      return;
    }
    if (activePlayerIndex + 1 < playersState.length) {
      setActivePlayerIndex(activePlayerIndex + 1);
      setDeckSessionKey(`picker-${Date.now()}-${activePlayerIndex + 1}`);
      setStage('handoff');
    } else {
      finalizeSwipePhase(playersState);
    }
  };

  const launchRoomWithWinner = async (item: MediaSummary) => {
    setLaunchingRoom(true);
    try {
      const created = await api.createRoom({
        name: item.title,
        initialRatingKey: item.ratingKey
      });
      try {
        sessionStorage.setItem(`syncreel_host_created_${created.code.toLowerCase()}`, '1');
      } catch {
        // Ignore storage errors
      }
      onNavigate(`/room/${created.code}?invite=1`);
    } catch (err) {
      setDeckError(err instanceof Error ? err.message : 'Unable to launch room');
    } finally {
      setLaunchingRoom(false);
    }
  };

  const remainingForActivePlayer = useMemo(() => {
    if (!activePlayer) return [];
    const byKey = new Map(deck.map((d) => [d.ratingKey, d]));
    const swiped = new Set(activePlayer.swipedKeys);
    return activePlayer.orderKeys
      .filter((k) => !swiped.has(k))
      .map((k) => byKey.get(k))
      .filter((m): m is MediaSummary => Boolean(m));
  }, [activePlayer, deck]);

  const watchTogetherUrl =
    typeof window !== 'undefined' && window.location.hostname.toLowerCase().startsWith('swipe.')
      ? `${window.location.protocol}//watch.${window.location.hostname.slice(6)}`
      : null;

  const activeModeLabel =
    activeMode === 'solo' ? 'Solo' : activeMode === 'pass' ? 'Pass Phone' : 'Multi-Phone';

  return (
    <div className="h-[100dvh] bg-[#07080A] text-[#F5F7FA] flex flex-col overflow-hidden">
      {/* Slim 52px Translucent Top Bar */}
      <header className="h-13 px-3.5 sm:px-5 border-b border-white/8 bg-[#07080A]/90 backdrop-blur-md flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/favicon.svg" alt="SyncReel" className="w-7 h-7 rounded-lg shrink-0" />
          <span className="hidden sm:inline font-display text-sm font-bold tracking-tight text-[#F5F7FA] shrink-0">
            SyncReel
          </span>

          {user && (
            <div className="flex items-center gap-1.5 min-w-0 ml-1">
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#101216] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/25 transition shrink-0"
              >
                <span>{activeModeLabel}</span>
                <ChevronDown className="w-3 h-3 text-[#98A0B0]" />
              </button>
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#101216] border border-white/10 text-xs font-medium text-[#98A0B0] hover:text-[#F5F7FA] hover:border-white/25 transition truncate max-w-[140px] sm:max-w-[200px]"
              >
                <span className="truncate">{activeDeckLabel}</span>
                <SlidersHorizontal className="w-3 h-3 shrink-0" />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {watchTogetherUrl ? (
            <a
              href={watchTogetherUrl}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#101216] border border-white/10 text-xs font-medium text-[#98A0B0] hover:text-[#F5F7FA] hover:border-white/25 transition"
            >
              <Film className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Rooms</span>
            </a>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#101216] border border-white/10 text-xs font-medium text-[#98A0B0] hover:text-[#F5F7FA] hover:border-white/25 transition"
            >
              <Film className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Rooms</span>
            </button>
          )}

          {user && (
            <button
              type="button"
              onClick={async () => {
                await api.logout();
                setUser(null);
                setDeck([]);
                setPlayersState([]);
                setKnockoutCandidates([]);
              }}
              aria-label="Sign out"
              className="p-1.5 rounded-lg text-[#98A0B0] hover:text-[#F5F7FA] hover:bg-[#101216] transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Hairline Progress Bar during swipe */}
      {user && stage === 'swipe' && activePlayer && deck.length > 0 && (
        <div className="h-0.5 w-full bg-[#101216] shrink-0">
          <div
            className="h-full bg-[#F5F7FA] transition-[width] duration-300 ease-out"
            style={{
              width: `${Math.min(100, (activePlayer.swipedKeys.length / deck.length) * 100)}%`
            }}
          />
        </div>
      )}

      {/* Main Content */}
      {authLoading ? (
        <div className="flex-1 flex items-center justify-center text-[#98A0B0] gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-[#F5F7FA]" />
          <span>Checking session…</span>
        </div>
      ) : !user ? (
        <div className="flex-1 overflow-y-auto flex items-center justify-center p-5">
          <div className="w-full max-w-md rounded-2xl bg-[#101216] border border-white/10 p-6 space-y-5">
            <div className="flex items-center gap-3">
              <img src="/favicon.svg" alt="" className="w-9 h-9 rounded-xl" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#98A0B0]">
                  Movie Night Picker
                </p>
                <h2 className="font-display text-xl font-bold text-[#F5F7FA] tracking-tight">
                  What are we watching?
                </h2>
              </div>
            </div>

            <p className="text-sm text-[#98A0B0] leading-relaxed">
              Sign in with your media account to swipe through your library and run a 1v1 knockout
              bracket — solo, passing a phone on the couch, or across multiple phones.
            </p>

            {authError && (
              <div className="p-3 rounded-lg bg-[#F43F5E]/10 border border-[#F43F5E]/30 text-xs text-[#F43F5E]">
                {authError}
              </div>
            )}

            {pollingPinId ? (
              <div className="p-4 rounded-xl bg-[#07080A] border border-white/10 space-y-3">
                <div className="flex items-center gap-2 text-sm text-[#F5F7FA]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Waiting for account sign-in…</span>
                </div>
                {pendingAuthUrl && (
                  <a
                    href={pendingAuthUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-[#F5F7FA] underline underline-offset-2"
                  >
                    <span>Popup blocked? Open sign-in page</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void handleMediaSignIn()}
                className="w-full py-3 px-4 rounded-xl bg-[#F5F7FA] text-[#07080A] font-semibold text-sm hover:bg-white transition"
              >
                Sign in with Media Account
              </button>
            )}
          </div>
        </div>
      ) : loadingDeck && deck.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-[#98A0B0] gap-3 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-[#F5F7FA]" />
          <span>Building your deck…</span>
        </div>
      ) : deckError && deck.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4">
          <p className="text-sm text-[#98A0B0] max-w-sm">{deckError}</p>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="px-4 py-2.5 rounded-xl bg-[#F5F7FA] text-[#07080A] text-xs font-bold"
          >
            Choose Filters
          </button>
        </div>
      ) : stage === 'handoff' && activePlayer ? (
        <div className="flex-1 flex items-center justify-center p-5">
          <div className="w-full max-w-md rounded-2xl bg-[#101216] border border-white/12 p-6 text-center space-y-5">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-[#181B22] border border-white/12 flex items-center justify-center text-[#F5F7FA]">
              <Smartphone className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] font-mono uppercase tracking-wider text-[#98A0B0]">
                Player {activePlayerIndex + 1} of {playersState.length}
              </p>
              <h2 className="font-display text-2xl font-bold text-[#F5F7FA] tracking-tight">
                Pass to {activePlayer.name}
              </h2>
              <p className="text-xs text-[#98A0B0] leading-relaxed">
                {activePlayerIndex === 0
                  ? `Swipe right on anything you'd watch — picks stay hidden until everyone finishes.`
                  : `${playersState[activePlayerIndex - 1].name} finished (${
                      playersState[activePlayerIndex - 1].likedKeys.length
                    } liked).`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStage('swipe')}
              className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#F5F7FA] text-[#07080A] font-bold text-sm hover:bg-white transition"
            >
              <span>I&apos;m {activePlayer.name} — Start</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : stage === 'swipe' && activePlayer ? (
        <div className="flex-1 min-h-0 w-full max-w-[440px] mx-auto flex flex-col">
          <SwipeDeckStage
            active={stage === 'swipe' && !filtersOpen}
            sessionKey={deckSessionKey}
            cardsRemaining={remainingForActivePlayer}
            totalCount={deck.length}
            swipedCount={activePlayer.swipedKeys.length}
            headerRightLabel={activeMode === 'pass' ? activePlayer.name : undefined}
            onVote={handleTurnVote}
            footerSlot={
              <div className="flex flex-col items-center gap-1.5">
                {activeMode === 'solo' && activePlayer.likedKeys.length >= 2 ? (
                  <button
                    type="button"
                    onClick={handleFinishTurnEarly}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#F5F7FA] text-[#07080A] text-xs font-bold hover:bg-white transition"
                  >
                    <Swords className="w-4 h-4" />
                    <span>
                      Start 1v1 Knockout ({activePlayer.likedKeys.length} liked) →
                    </span>
                  </button>
                ) : activeMode === 'pass' && activePlayer.swipedKeys.length >= 4 ? (
                  <button
                    type="button"
                    onClick={handleFinishTurnEarly}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#181B22] border border-white/15 text-xs font-semibold text-[#F5F7FA] hover:border-white/30"
                  >
                    <span>
                      {activePlayerIndex + 1 < playersState.length
                        ? `Done — Pass to ${playersState[activePlayerIndex + 1].name} (${activePlayer.likedKeys.length} liked)`
                        : `Reveal 1v1 Knockout (${activePlayer.likedKeys.length} liked)`}
                    </span>
                  </button>
                ) : (
                  <p className="text-[11px] font-mono tabular-nums text-[#5C6475]">
                    {activeMode === 'solo'
                      ? `${activePlayer.likedKeys.length} liked • like 2+ for 1v1 knockout`
                      : `${activePlayer.likedKeys.length} liked`}
                  </p>
                )}
              </div>
            }
            emptyState={
              <div className="space-y-3">
                <p className="text-sm font-semibold text-[#F5F7FA]">
                  {knockoutCandidates.length === 0
                    ? "No titles liked in this deck."
                    : 'Finishing round…'}
                </p>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(true)}
                  className="px-4 py-2 rounded-xl bg-[#F5F7FA] text-[#07080A] text-xs font-bold"
                >
                  Change Filters
                </button>
              </div>
            }
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 w-full max-w-4xl mx-auto flex flex-col">
          {knockoutCandidates.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
              <p className="text-base font-semibold text-[#F5F7FA]">
                No liked titles made it to the Knockout.
              </p>
              <p className="text-xs text-[#98A0B0] max-w-sm">
                Pick another category or genre and swipe right on at least two titles.
              </p>
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className="px-4 py-2.5 rounded-xl bg-[#F5F7FA] text-[#07080A] text-xs font-bold"
              >
                Adjust Filters &amp; Redeal
              </button>
            </div>
          ) : (
            <KnockoutArena
              candidates={knockoutCandidates}
              serverMachineId={serverMeta.machineId}
              serverName={serverMeta.name}
              subtitle={knockoutSubtitle}
              onStartWatchParty={
                activeMode !== 'solo' && !launchingRoom
                  ? (item) => void launchRoomWithWinner(item)
                  : undefined
              }
              onRestart={() => setFiltersOpen(true)}
              restartLabel="New Deck / Filters"
            />
          )}
        </div>
      )}

      {/* Clean Slide-Up / Centered Filter Sheet */}
      {filtersOpen && user && (
        <div
          onClick={() => setFiltersOpen(false)}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-xs sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md max-h-[88dvh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-[#101216] border border-white/12 overflow-hidden"
          >
            <div className="px-4 py-3.5 border-b border-white/8 flex items-center justify-between shrink-0">
              <div>
                <h2 className="font-display text-sm font-bold text-[#F5F7FA]">Deck &amp; Mode</h2>
                <p className="text-[11px] text-[#98A0B0]">
                  {user.serverName || 'Connected Library'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                aria-label="Close deck filters"
                className="p-1.5 rounded-lg text-[#98A0B0] hover:text-[#F5F7FA] hover:bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              {/* Mode Selector */}
              <div>
                <span className="block text-[11px] font-medium uppercase tracking-wider text-[#98A0B0] mb-2">
                  Mode
                </span>
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#07080A] border border-white/10">
                  {[
                    { id: 'solo' as const, label: 'Solo', icon: User },
                    { id: 'pass' as const, label: 'Pass Phone', icon: Smartphone },
                    { id: 'multi' as const, label: 'Multi-Phone', icon: QrCode }
                  ].map((opt) => {
                    const Icon = opt.icon;
                    const selected = mode === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setMode(opt.id)}
                        className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition ${
                          selected
                            ? 'bg-[#F5F7FA] text-[#07080A]'
                            : 'text-[#98A0B0] hover:text-[#F5F7FA]'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
                {mode === 'multi' && (
                  <p className="text-[11px] text-[#98A0B0] mt-2">
                    Everyone scans the QR code to swipe &amp; vote 1v1 on their own phone — works
                    even if sharing one account.
                  </p>
                )}
              </div>

              {/* Pass-the-Phone Players */}
              {mode === 'pass' && (
                <div className="p-3 rounded-xl bg-[#07080A] border border-white/10 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#F5F7FA] flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-[#98A0B0]" />
                      Players (2–4)
                    </span>
                    {playerNames.length < 4 && (
                      <button
                        type="button"
                        onClick={() =>
                          setPlayerNames((prev) => [...prev, `Player ${prev.length + 1}`])
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#F5F7FA] hover:underline"
                      >
                        <Plus className="w-3 h-3" />
                        Add
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {playerNames.map((pname, idx) => (
                      <div key={idx} className="flex items-center gap-1">
                        <input
                          type="text"
                          value={pname}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPlayerNames((prev) => prev.map((x, i) => (i === idx ? val : x)));
                          }}
                          maxLength={28}
                          placeholder={`Player ${idx + 1}`}
                          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[#101216] border border-white/10 text-xs text-[#F5F7FA] focus:outline-none focus:border-white/30"
                        />
                        {playerNames.length > 2 && (
                          <button
                            type="button"
                            onClick={() =>
                              setPlayerNames((prev) => prev.filter((_, i) => i !== idx))
                            }
                            aria-label={`Remove player ${idx + 1}`}
                            className="p-1.5 rounded-lg text-[#98A0B0] hover:text-[#F43F5E]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

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

              {deckError && (
                <div className="p-2.5 rounded-lg bg-[#F43F5E]/10 border border-[#F43F5E]/30 text-xs text-[#F43F5E]">
                  {deckError}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-white/8 shrink-0 bg-[#101216]">
              <button
                type="button"
                disabled={loadingDeck}
                onClick={() => void handleApplyFilters()}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#F5F7FA] text-[#07080A] font-bold text-sm hover:bg-white disabled:opacity-50 transition"
              >
                {loadingDeck ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Building deck…</span>
                  </>
                ) : mode === 'multi' ? (
                  <>
                    <QrCode className="w-4 h-4" />
                    <span>Create QR Session</span>
                  </>
                ) : mode === 'pass' ? (
                  <>
                    <Smartphone className="w-4 h-4" />
                    <span>Start Pass-the-Phone ({playerNames.length})</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Deal Deck</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
