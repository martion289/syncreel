import { describe, expect, it } from 'vitest';
import type { MediaSummary } from '@syncreel/shared';
import {
  advanceKnockoutBracket,
  aggregatePassThePhoneLikes,
  createKnockoutBracket
} from './knockoutBracket.js';

function movie(id: string, title = `Movie ${id}`): MediaSummary {
  return {
    ratingKey: id,
    type: 'movie',
    title,
    year: 2020,
    durationMs: 6_000_000
  };
}

describe('knockoutBracket', () => {
  it('immediately crowns a single candidate without extra matchups', () => {
    const state = createKnockoutBracket([movie('1', 'Dune')]);
    expect(state.champion?.ratingKey).toBe('1');
    expect(state.totalChoicesRequired).toBe(0);
    expect(state.matchups).toHaveLength(0);
  });

  it('runs a 4-contender even bracket cleanly through Semifinals and Final Showdown', () => {
    const m1 = movie('1', 'Dune');
    const m2 = movie('2', 'Alien');
    const m3 = movie('3', 'Arrival');
    const m4 = movie('4', 'Heat');

    let b = createKnockoutBracket([m1, m2, m3, m4]);
    expect(b.roundTitle).toBe('Semifinals');
    expect(b.matchups).toHaveLength(2);
    expect(b.byeItem).toBeNull();
    expect(b.totalChoicesRequired).toBe(3);

    b = advanceKnockoutBracket(b, '1'); // Dune beats Alien
    expect(b.currentMatchIndex).toBe(1);
    expect(b.eliminatedInSemis.map((i) => i.ratingKey)).toEqual(['2']);

    b = advanceKnockoutBracket(b, '4'); // Heat beats Arrival
    expect(b.roundNumber).toBe(2);
    expect(b.roundTitle).toBe('Final Showdown');
    expect(b.matchups).toHaveLength(1);
    expect(b.eliminatedInSemis.map((i) => i.ratingKey)).toEqual(['2', '3']);

    b = advanceKnockoutBracket(b, '4'); // Heat wins final
    expect(b.champion?.ratingKey).toBe('4');
    expect(b.runnerUp?.ratingKey).toBe('1');
    expect(b.totalChoicesMade).toBe(3);
  });

  it('handles odd contender counts with byes until a single champion emerges', () => {
    const items = [movie('1'), movie('2'), movie('3'), movie('4'), movie('5')];
    let b = createKnockoutBracket(items);
    expect(b.roundTitle).toBe('Quarterfinals');
    expect(b.matchups).toHaveLength(2);
    expect(b.byeItem?.ratingKey).toBe('5');
    expect(b.totalChoicesRequired).toBe(4);

    b = advanceKnockoutBracket(b, '1'); // 1 over 2
    b = advanceKnockoutBracket(b, '3'); // 3 over 4 -> Semis: [1 vs 3], bye 5
    expect(b.roundNumber).toBe(2);
    expect(b.roundTitle).toBe('Semifinals');
    expect(b.matchups).toHaveLength(1);
    expect(b.byeItem?.ratingKey).toBe('5');

    b = advanceKnockoutBracket(b, '1'); // 1 over 3 -> Final: [1 vs 5]
    expect(b.roundNumber).toBe(3);
    expect(b.roundTitle).toBe('Final Showdown');
    expect(b.byeItem).toBeNull();

    b = advanceKnockoutBracket(b, '5'); // Bye underdog 5 wins!
    expect(b.champion?.ratingKey).toBe('5');
    expect(b.runnerUp?.ratingKey).toBe('1');
    expect(b.totalChoicesMade).toBe(4);
  });
});

describe('aggregatePassThePhoneLikes', () => {
  it('prefers unanimous matches when 2+ exist, and falls back to top partial picks otherwise', () => {
    const deck = [movie('1'), movie('2'), movie('3'), movie('4')];

    const withTwoMatches = aggregatePassThePhoneLikes(
      [
        { id: 'p1', name: 'Ryan', likedKeys: ['1', '2', '3'] },
        { id: 'p2', name: 'Sam', likedKeys: ['2', '3', '4'] }
      ],
      deck
    );
    expect(withTwoMatches.unanimous.map((m) => m.ratingKey)).toEqual(['2', '3']);
    expect(withTwoMatches.knockoutPool.map((m) => m.ratingKey)).toEqual(['2', '3']);

    const divergent = aggregatePassThePhoneLikes(
      [
        { id: 'p1', name: 'Ryan', likedKeys: ['1', '2'] },
        { id: 'p2', name: 'Sam', likedKeys: ['3', '4'] }
      ],
      deck
    );
    expect(divergent.unanimous).toHaveLength(0);
    expect(divergent.knockoutPool.map((m) => m.ratingKey)).toEqual(['1', '2', '3', '4']);
  });
});
