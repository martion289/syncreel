import type { MediaSummary } from '@syncreel/shared';
export {
  advanceKnockoutBracket,
  createKnockoutBracket,
  getRoundTitle,
  type KnockoutBracketState,
  type KnockoutMatchup
} from '@syncreel/shared';

export function aggregatePassThePhoneLikes(
  players: Array<{ id: string; name: string; likedKeys: string[] }>,
  deck: MediaSummary[]
): {
  unanimous: MediaSummary[];
  partial: Array<{ item: MediaSummary; count: number }>;
  knockoutPool: MediaSummary[];
} {
  const countByKey = new Map<string, number>();
  for (const player of players) {
    const uniquePlayerLikes = new Set(player.likedKeys);
    for (const key of uniquePlayerLikes) {
      countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
    }
  }

  const playerCount = players.length;
  const unanimous: MediaSummary[] = [];
  const partial: Array<{ item: MediaSummary; count: number }> = [];

  for (const item of deck) {
    const count = countByKey.get(item.ratingKey) ?? 0;
    if (count > 0) {
      partial.push({ item, count });
      if (playerCount > 0 && count === playerCount) {
        unanimous.push(item);
      }
    }
  }

  partial.sort((a, b) => b.count - a.count);

  let knockoutPool: MediaSummary[];
  if (unanimous.length >= 2) {
    knockoutPool = unanimous;
  } else {
    const multiLiked = partial.filter((p) => p.count >= 2).map((p) => p.item);
    if (multiLiked.length >= 2) {
      knockoutPool = multiLiked;
    } else if (unanimous.length === 1) {
      const rest = partial
        .filter((p) => p.item.ratingKey !== unanimous[0].ratingKey)
        .map((p) => p.item);
      knockoutPool = [unanimous[0], ...rest].slice(0, 8);
    } else {
      knockoutPool = partial.map((p) => p.item).slice(0, 8);
    }
  }

  return {
    unanimous,
    partial,
    knockoutPool
  };
}
