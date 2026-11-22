import { useEffect, useState } from 'react';
import type { MediaSummary, PlexLibrarySection } from '@syncreel/shared';
import {
  BarChart3,
  ChevronLeft,
  Dices,
  Film,
  Loader2,
  Play,
  Plus,
  Search,
  Tv,
  X
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatMediaSubtitle, formatTimeMs, getHostArtworkUrl } from '../../lib/format.js';

interface LibraryBrowserProps {
  open: boolean;
  onClose: () => void;
  onPlayNow: (ratingKey: string) => void;
  onAddToQueue: (ratingKey: string) => void;
  onStartPoll: (ratingKeys: string[]) => void;
}

type ActiveTab = 'continue' | 'recent' | string;

export function LibraryBrowser(props: LibraryBrowserProps) {
  const { open, onClose, onPlayNow, onAddToQueue, onStartPoll } = props;

  const [sections, setSections] = useState<PlexLibrarySection[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('continue');
  const [items, setItems] = useState<MediaSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pollCandidates, setPollCandidates] = useState<MediaSummary[]>([]);
  const [rollingRandom, setRollingRandom] = useState(false);

  const [drillStack, setDrillStack] = useState<Array<{ ratingKey: string; title: string }>>([]);

  useEffect(() => {
    if (!open) return;
    api
      .getLibraries()
      .then((res) => setSections(res.sections))
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const trimmed = searchQuery.trim();
    if (trimmed.length >= 2) {
      const timer = window.setTimeout(() => {
        setLoading(true);
        setError(null);
        api
          .searchPlex(trimmed)
          .then((res) => setItems(res.items))
          .catch((e) => setError(e instanceof Error ? e.message : 'Search failed'))
          .finally(() => setLoading(false));
      }, 280);
      return () => clearTimeout(timer);
    }

    if (drillStack.length > 0) {
      const top = drillStack[drillStack.length - 1];
      setLoading(true);
      setError(null);
      api
        .getChildren(top.ratingKey)
        .then((res) => setItems(res.items))
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load items'))
        .finally(() => setLoading(false));
      return;
    }

    setLoading(true);
    setError(null);
    const req =
      activeTab === 'continue'
        ? api.getContinueWatching().then((r) => r.items)
        : activeTab === 'recent'
          ? api.getRecentlyAdded().then((r) => r.items)
          : api.getSectionItems(activeTab).then((r) => r.items);

    req
      .then((res) => setItems(res))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load media library'))
      .finally(() => setLoading(false));
  }, [open, activeTab, searchQuery, drillStack]);

  if (!open) return null;

  const handleCardAction = (item: MediaSummary, action: 'play' | 'queue' | 'open' | 'poll') => {
    if (action === 'open') {
      setSearchQuery('');
      setDrillStack((prev) => [...prev, { ratingKey: item.ratingKey, title: item.title }]);
      return;
    }
    if (action === 'poll') {
      setPollCandidates((prev) => {
        if (prev.some((p) => p.ratingKey === item.ratingKey)) {
          return prev.filter((p) => p.ratingKey !== item.ratingKey);
        }
        if (prev.length >= 6) return prev;
        return [...prev, item];
      });
      return;
    }
    if (action === 'play') {
      onPlayNow(item.ratingKey);
      onClose();
    } else if (action === 'queue') {
      onAddToQueue(item.ratingKey);
    }
  };

  const handleRollRandomPoll = async () => {
    setRollingRandom(true);
    try {
      const filter =
        activeTab !== 'continue' && activeTab !== 'recent' ? activeTab : 'all';
      const res = await api.getRandomPicks(4, filter);
      if (res.items.length >= 2) {
        setPollCandidates(res.items.slice(0, 6));
      }
    } finally {
      setRollingRandom(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6">
      <div className="w-full max-w-5xl h-[86vh] flex flex-col rounded-2xl bg-[#101216] border border-white/12 overflow-hidden">
        {/* Header + Search */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/8">
          <div className="flex items-center gap-2.5">
            {drillStack.length > 0 && !searchQuery.trim() ? (
              <button
                onClick={() => setDrillStack((prev) => prev.slice(0, -1))}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
            ) : null}
            <h2 className="font-display text-base font-semibold text-[#F5F7FA]">
              {drillStack.length > 0 && !searchQuery.trim()
                ? drillStack[drillStack.length - 1].title
                : 'Media Library'}
            </h2>
          </div>

          <div className="flex items-center gap-2.5 flex-1 sm:flex-initial justify-end">
            <button
              type="button"
              disabled={rollingRandom}
              onClick={() => void handleRollRandomPoll()}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181B22] border border-white/10 text-xs font-medium text-[#F5F7FA] hover:border-white/30"
            >
              <Dices className="w-3.5 h-3.5" />
              <span>{rollingRandom ? 'Rolling…' : 'Roll 4 Random Poll'}</span>
            </button>

            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-[#98A0B0] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search movies or shows…"
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[#07080A] border border-white/10 text-sm text-[#F5F7FA] placeholder-[#5C6475] focus:outline-none focus:border-white/30"
              />
            </div>
            <button
              onClick={onClose}
              aria-label="Close library"
              className="p-2 rounded-lg text-[#98A0B0] hover:text-[#F5F7FA] hover:bg-[#181B22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        {!searchQuery.trim() && (
          <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-white/8 overflow-x-auto">
            {[
              { id: 'continue', label: 'Continue Watching' },
              { id: 'recent', label: 'Recently Added' },
              ...sections.map((s) => ({ id: s.key, label: s.title }))
            ].map((tab) => {
              const active = activeTab === tab.id && drillStack.length === 0;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setDrillStack([]);
                    setActiveTab(tab.id);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    active
                      ? 'bg-[#F5F7FA] text-[#07080A] font-semibold'
                      : 'text-[#98A0B0] hover:text-[#F5F7FA] hover:bg-[#181B22]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Poll Builder Bar */}
        {pollCandidates.length > 0 && (
          <div className="px-5 py-2.5 bg-[#07080A] border-b border-white/12 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-[#F5F7FA] flex items-center gap-1">
                <BarChart3 className="w-3.5 h-3.5" />
                Poll ({pollCandidates.length}/6):
              </span>
              {pollCandidates.map((p) => (
                <span
                  key={p.ratingKey}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#101216] border border-white/10 text-[11px] text-[#F5F7FA]"
                >
                  {p.title}
                  <button
                    onClick={() =>
                      setPollCandidates((prev) => prev.filter((x) => x.ratingKey !== p.ratingKey))
                    }
                    className="text-[#98A0B0] hover:text-[#F43F5E]"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPollCandidates([])}
                className="text-xs text-[#98A0B0] hover:text-[#F5F7FA]"
              >
                Clear
              </button>
              <button
                disabled={pollCandidates.length < 2}
                onClick={() => {
                  onStartPoll(pollCandidates.map((p) => p.ratingKey));
                  setPollCandidates([]);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-lg bg-[#F5F7FA] text-[#07080A] text-xs font-semibold disabled:opacity-40"
              >
                Start Vote
              </button>
            </div>
          </div>
        )}

        {/* Content Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="h-full flex items-center justify-center text-[#98A0B0] gap-2.5 text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-[#F5F7FA]" />
              <span>Loading library…</span>
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center text-center text-sm text-[#F43F5E]">
              {error}
            </div>
          ) : items.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-[#98A0B0]">
              No matching items found.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {items.map((item) => {
                const isFolder = item.type === 'show' || item.type === 'season';
                const inPoll = pollCandidates.some((p) => p.ratingKey === item.ratingKey);
                const poster = getHostArtworkUrl(item.thumb, 340, 510);
                return (
                  <div
                    key={item.ratingKey}
                    className="group rounded-xl bg-[#07080A] border border-white/10 overflow-hidden flex flex-col"
                  >
                    <button
                      onClick={() => handleCardAction(item, isFolder ? 'open' : 'play')}
                      className="relative aspect-[2/3] w-full bg-[#181B22] overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                    >
                      {poster ? (
                        <img
                          src={poster}
                          alt={item.title}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[#5C6475]">
                          {isFolder ? <Tv className="w-8 h-8" /> : <Film className="w-8 h-8" />}
                        </div>
                      )}
                      {item.viewOffsetMs && item.durationMs ? (
                        <div className="absolute bottom-0 inset-x-0 h-1 bg-black/60">
                          <div
                            style={{
                              width: `${Math.min(100, (item.viewOffsetMs / item.durationMs) * 100)}%`
                            }}
                            className="h-full bg-[#F5F7FA]"
                          />
                        </div>
                      ) : null}
                    </button>

                    <div className="p-2.5 flex-1 flex flex-col justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-[#F5F7FA] line-clamp-1">
                          {item.title}
                        </p>
                        <p className="text-[11px] text-[#98A0B0] line-clamp-1">
                          {formatMediaSubtitle(item)}
                          {!isFolder && item.durationMs > 0
                            ? ` • ${formatTimeMs(item.durationMs)}`
                            : ''}
                        </p>
                      </div>

                      {!isFolder ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleCardAction(item, 'play')}
                            className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-md bg-[#F5F7FA] text-[#07080A] text-[11px] font-semibold hover:bg-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>Play</span>
                          </button>
                          <button
                            onClick={() => handleCardAction(item, 'queue')}
                            aria-label={`Add ${item.title} to Up Next`}
                            className="p-1.5 rounded-md bg-[#181B22] border border-white/10 text-[#F5F7FA] hover:border-white/30"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleCardAction(item, 'poll')}
                            aria-label={`Add ${item.title} to Poll`}
                            className={`p-1.5 rounded-md transition ${
                              inPoll
                                ? 'bg-[#F5F7FA] text-[#07080A]'
                                : 'bg-[#181B22] text-[#98A0B0] hover:text-[#F5F7FA]'
                            }`}
                          >
                            <BarChart3 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleCardAction(item, 'open')}
                            className="flex-1 py-1.5 rounded-md bg-[#181B22] border border-white/10 text-[#F5F7FA] text-[11px] font-medium hover:border-white/30"
                          >
                            Browse
                          </button>
                          {item.type === 'show' && (
                            <button
                              onClick={() => handleCardAction(item, 'poll')}
                              aria-label={`Add ${item.title} to Poll`}
                              className={`p-1.5 rounded-md transition ${
                                inPoll
                                  ? 'bg-[#F5F7FA] text-[#07080A]'
                                  : 'bg-[#181B22] text-[#98A0B0] hover:text-[#F5F7FA]'
                              }`}
                            >
                              <BarChart3 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
