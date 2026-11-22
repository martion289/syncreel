import { useEffect, useMemo, useState } from 'react';
import type { PlexGenre, PlexLibrarySection, SoloDeckCategory } from '@syncreel/shared';
import { SOLO_DECK_CATEGORIES } from '@syncreel/shared';
import { ChevronDown, Loader2, Sparkles, Tag } from 'lucide-react';

interface DeckBuilderControlsProps {
  category: SoloDeckCategory;
  onCategoryChange: (cat: SoloDeckCategory) => void;
  libraryFilter: string;
  onLibraryFilterChange: (val: string) => void;
  selectedGenre: string;
  onSelectedGenreChange: (val: string) => void;
  unwatchedOnly: boolean;
  onUnwatchedOnlyChange: (val: boolean) => void;
  deckSize: number;
  onDeckSizeChange: (size: number) => void;
  sections: PlexLibrarySection[];
  genres: PlexGenre[];
  loadingGenres: boolean;
}

export function DeckBuilderControls({
  category,
  onCategoryChange,
  libraryFilter,
  onLibraryFilterChange,
  selectedGenre,
  onSelectedGenreChange,
  unwatchedOnly,
  onUnwatchedOnlyChange,
  deckSize,
  onDeckSizeChange,
  sections,
  genres,
  loadingGenres
}: DeckBuilderControlsProps) {
  const [filterType, setFilterType] = useState<'category' | 'genre'>(() =>
    selectedGenre ? 'genre' : 'category'
  );
  const [genreQuery, setGenreQuery] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (filterType === 'genre' && !selectedGenre && genres.length > 0) {
      onSelectedGenreChange(genres[0].title);
    }
  }, [filterType, selectedGenre, genres, onSelectedGenreChange]);

  const visibleGenres = useMemo(() => {
    const q = genreQuery.trim().toLowerCase();
    if (!q) return genres;
    return genres.filter((g) => g.title.toLowerCase().includes(q));
  }, [genres, genreQuery]);

  const handleSelectMode = (nextMode: 'category' | 'genre') => {
    setFilterType(nextMode);
    if (nextMode === 'category') {
      onSelectedGenreChange('');
      setGenreQuery('');
    } else {
      if (category === 'comfort-rewatch') {
        onUnwatchedOnlyChange(true);
      }
      onCategoryChange('wildcard');
      if (!selectedGenre && genres.length > 0) {
        onSelectedGenreChange(genres[0].title);
      }
    }
  };

  const librarySummary =
    libraryFilter === 'all'
      ? 'All Libraries'
      : libraryFilter === 'movie'
        ? 'Movies'
        : libraryFilter === 'show'
          ? 'TV Shows'
          : sections.find((s) => s.key === libraryFilter)?.title ?? 'Library';

  return (
    <div className="space-y-4">
      {/* Mutually Exclusive Filter Mode: Category OR Genre */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[#98A0B0]">
            Pick By
          </span>
          {filterType === 'genre' && loadingGenres && (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#F5F7FA]" />
          )}
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#07080A] border border-white/10 mb-3">
          <button
            type="button"
            onClick={() => handleSelectMode('category')}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition ${
              filterType === 'category'
                ? 'bg-[#F5F7FA] text-[#07080A]'
                : 'text-[#98A0B0] hover:text-[#F5F7FA]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Category</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectMode('genre')}
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition ${
              filterType === 'genre'
                ? 'bg-[#F5F7FA] text-[#07080A]'
                : 'text-[#98A0B0] hover:text-[#F5F7FA]'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            <span>Genre</span>
          </button>
        </div>

        {filterType === 'category' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {SOLO_DECK_CATEGORIES.map((cat) => {
              const active = category === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    onCategoryChange(cat.id);
                    if (cat.id === 'unwatched') onUnwatchedOnlyChange(true);
                    if (cat.id === 'comfort-rewatch') onUnwatchedOnlyChange(false);
                  }}
                  className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left transition ${
                    active
                      ? 'bg-[#F5F7FA] border-[#F5F7FA] text-[#07080A]'
                      : 'bg-[#07080A] border-white/10 text-[#F5F7FA] hover:border-white/25'
                  }`}
                >
                  <span className="text-xs font-semibold truncate">{cat.label}</span>
                  <span
                    className={`text-[10px] font-mono shrink-0 ${
                      active ? 'text-[#07080A]/70' : 'text-[#5C6475]'
                    }`}
                  >
                    {cat.badge}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2.5">
            {genres.length > 12 && (
              <input
                type="search"
                value={genreQuery}
                onChange={(e) => setGenreQuery(e.target.value)}
                placeholder="Filter genres…"
                className="w-full px-3 py-2 rounded-xl bg-[#07080A] border border-white/10 text-xs text-[#F5F7FA] placeholder:text-[#5C6475] focus:outline-none focus:border-white/30"
              />
            )}
            {loadingGenres && genres.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#98A0B0]">Loading genres…</div>
            ) : visibleGenres.length === 0 ? (
              <div className="py-5 text-center text-xs text-[#98A0B0]">
                No genres available for this library filter.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto pr-1 flex flex-wrap gap-1.5">
                {visibleGenres.map((g) => {
                  const active = selectedGenre === g.title;
                  return (
                    <button
                      key={g.title}
                      type="button"
                      onClick={() => onSelectedGenreChange(g.title)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition ${
                        active
                          ? 'bg-[#F5F7FA] border-[#F5F7FA] text-[#07080A] font-semibold'
                          : 'bg-[#07080A] border-white/10 text-[#98A0B0] hover:text-[#F5F7FA] hover:border-white/25'
                      }`}
                    >
                      {g.title}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Collapsible More Options (Library, Unwatched, Deck Size) */}
      <div className="rounded-xl border border-white/10 bg-[#07080A] overflow-hidden">
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-white/[0.03] transition"
        >
          <span className="text-xs font-medium text-[#F5F7FA]">More options</span>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-mono text-[#98A0B0] truncate">
              {librarySummary} • {unwatchedOnly ? 'Unwatched' : 'All'} • {deckSize}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-[#98A0B0] transition-transform shrink-0 ${
                moreOpen ? 'rotate-180' : ''
              }`}
            />
          </div>
        </button>

        {moreOpen && (
          <div className="px-3.5 pb-3.5 pt-2 border-t border-white/8 space-y-3">
            {/* Library Format */}
            <div>
              <span className="block text-[11px] font-medium text-[#98A0B0] mb-1.5">Library</span>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'movie', label: 'Movies' },
                  { id: 'show', label: 'TV Shows' }
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onLibraryFilterChange(opt.id)}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium border transition ${
                      libraryFilter === opt.id
                        ? 'bg-[#F5F7FA] text-[#07080A] border-[#F5F7FA] font-semibold'
                        : 'bg-[#101216] text-[#98A0B0] border-white/10 hover:text-[#F5F7FA]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {sections.length > 1 && (
                <select
                  value={libraryFilter}
                  onChange={(e) => onLibraryFilterChange(e.target.value)}
                  className="mt-2 w-full px-3 py-1.5 rounded-lg bg-[#101216] border border-white/10 text-xs text-[#F5F7FA] focus:outline-none focus:border-white/30"
                >
                  <option value="all">All Libraries</option>
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

            {/* Unwatched & Deck Size */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <label
                className={`flex items-center gap-2 text-xs cursor-pointer ${
                  filterType === 'category' && category === 'comfort-rewatch'
                    ? 'text-[#5C6475]'
                    : 'text-[#98A0B0]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={unwatchedOnly}
                  disabled={filterType === 'category' && category === 'comfort-rewatch'}
                  onChange={(e) => onUnwatchedOnlyChange(e.target.checked)}
                  className="w-3.5 h-3.5 accent-[#F5F7FA]"
                />
                <span>Unwatched only</span>
              </label>

              <div className="flex items-center gap-1">
                <span className="text-[11px] text-[#98A0B0] mr-1">Deck</span>
                {[15, 20, 25, 40].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => onDeckSizeChange(size)}
                    className={`px-2 py-1 rounded-md text-[11px] font-mono tabular-nums ${
                      deckSize === size
                        ? 'bg-[#F5F7FA] text-[#07080A] font-semibold'
                        : 'bg-[#101216] text-[#98A0B0] border border-white/10 hover:text-[#F5F7FA]'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
