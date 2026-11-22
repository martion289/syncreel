import type { KnockoutBracketState, KnockoutMatchup, MediaSummary } from './types.js';

export function getRoundTitle(contenderCount: number, roundNumber: number): string {
  if (contenderCount <= 2) return 'Final Showdown';
  if (contenderCount <= 4) return 'Semifinals';
  if (contenderCount <= 8) return 'Quarterfinals';
  return `Round ${roundNumber}`;
}

function buildRoundMatchups(items: MediaSummary[], roundNumber: number): {
  matchups: KnockoutMatchup[];
  byeItem: MediaSummary | null;
} {
  const matchups: KnockoutMatchup[] = [];
  for (let i = 0; i + 1 < items.length; i += 2) {
    matchups.push({
      id: `r${roundNumber}-m${matchups.length}`,
      left: items[i],
      right: items[i + 1]
    });
  }
  const byeItem = items.length % 2 === 1 ? items[items.length - 1] : null;
  return { matchups, byeItem };
}

export function createKnockoutBracket(candidates: MediaSummary[]): KnockoutBracketState {
  const deduped: MediaSummary[] = [];
  const seen = new Set<string>();
  for (const item of candidates) {
    if (!seen.has(item.ratingKey)) {
      seen.add(item.ratingKey);
      deduped.push(item);
    }
  }

  if (deduped.length === 0) {
    return {
      roundNumber: 1,
      roundTitle: 'Final Showdown',
      roundContenderCount: 0,
      matchups: [],
      currentMatchIndex: 0,
      byeItem: null,
      nextRoundPool: [],
      eliminatedInSemis: [],
      runnerUp: null,
      champion: null,
      totalChoicesMade: 0,
      totalChoicesRequired: 0
    };
  }

  if (deduped.length === 1) {
    return {
      roundNumber: 1,
      roundTitle: 'Champion',
      roundContenderCount: 1,
      matchups: [],
      currentMatchIndex: 0,
      byeItem: null,
      nextRoundPool: [],
      eliminatedInSemis: [],
      runnerUp: null,
      champion: deduped[0],
      totalChoicesMade: 0,
      totalChoicesRequired: 0
    };
  }

  const { matchups, byeItem } = buildRoundMatchups(deduped, 1);
  return {
    roundNumber: 1,
    roundTitle: getRoundTitle(deduped.length, 1),
    roundContenderCount: deduped.length,
    matchups,
    currentMatchIndex: 0,
    byeItem,
    nextRoundPool: [],
    eliminatedInSemis: [],
    runnerUp: null,
    champion: null,
    totalChoicesMade: 0,
    totalChoicesRequired: deduped.length - 1
  };
}

export function advanceKnockoutBracket(
  state: KnockoutBracketState,
  winnerRatingKey: string
): KnockoutBracketState {
  if (state.champion || state.currentMatchIndex >= state.matchups.length) {
    return state;
  }

  const active = state.matchups[state.currentMatchIndex];
  const winner = active.left.ratingKey === winnerRatingKey ? active.left : active.right;
  const loser = winner.ratingKey === active.left.ratingKey ? active.right : active.left;

  const updatedMatchups = state.matchups.map((m, idx) =>
    idx === state.currentMatchIndex ? { ...m, winnerKey: winner.ratingKey } : m
  );

  const nextRoundPool = [...state.nextRoundPool, winner];
  const isSemifinalRound =
    state.roundContenderCount === 3 || state.roundContenderCount === 4;
  const eliminatedInSemis = isSemifinalRound
    ? [...state.eliminatedInSemis, loser]
    : state.eliminatedInSemis;
  const totalChoicesMade = state.totalChoicesMade + 1;

  if (state.currentMatchIndex + 1 < state.matchups.length) {
    return {
      ...state,
      matchups: updatedMatchups,
      currentMatchIndex: state.currentMatchIndex + 1,
      nextRoundPool,
      eliminatedInSemis,
      totalChoicesMade
    };
  }

  const entrants = state.byeItem ? [...nextRoundPool, state.byeItem] : nextRoundPool;
  if (entrants.length <= 1) {
    return {
      ...state,
      matchups: updatedMatchups,
      nextRoundPool,
      eliminatedInSemis,
      runnerUp: loser,
      champion: entrants[0] ?? winner,
      totalChoicesMade
    };
  }

  const nextRoundNumber = state.roundNumber + 1;
  const { matchups, byeItem } = buildRoundMatchups(entrants, nextRoundNumber);
  return {
    roundNumber: nextRoundNumber,
    roundTitle: getRoundTitle(entrants.length, nextRoundNumber),
    roundContenderCount: entrants.length,
    matchups,
    currentMatchIndex: 0,
    byeItem,
    nextRoundPool: [],
    eliminatedInSemis,
    runnerUp: state.runnerUp,
    champion: null,
    totalChoicesMade,
    totalChoicesRequired: state.totalChoicesRequired
  };
}
