import { expect, test } from 'vitest';
import { BLACK, WHITE, GAME_POSITIONS, decodeGame } from '../../src/engine';

test('game positions preserve the edge win and loss regression contracts', () => {
  expect(GAME_POSITIONS.map(position => position.encoded)).toEqual([
    'B9 e9 e8 f9 g9', 'B9 e9 e8 f9',
  ]);
  expect(GAME_POSITIONS.map(position => position.expectedResult)).toEqual([
    { forcedWin: true, heuristicWin: false, timedOut: false },
    { forcedLoss: true, heuristicLoss: true, timedOut: false },
  ]);
  expect(GAME_POSITIONS.map(position => position.toMove)).toEqual([BLACK, WHITE]);
  expect(new Set(GAME_POSITIONS.map(position => position.id)).size).toBe(GAME_POSITIONS.length);
  for (const entry of GAME_POSITIONS) {
    const position = decodeGame(entry.encoded);
    expect(position.toMove).toBe(entry.toMove);
    expect(position.winner).toBe(0);
    expect(entry.searchOptions).toEqual({ maxDepth: 30, quiescenceDepth: 4 });
    expect(entry.timeMs).toBeGreaterThan(0);
  }
});
