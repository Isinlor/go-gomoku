import { expect, test } from 'vitest';
import { GAME_POSITIONS, PLY2_FORCED_WINS, decodeGame } from '../../src/engine';

test('game positions have unique IDs and consistent search inputs', () => {
  expect(new Set(GAME_POSITIONS.map(position => position.id)).size).toBe(GAME_POSITIONS.length);
  for (const entry of GAME_POSITIONS) {
    const position = decodeGame(entry.encoded);
    expect(position.toMove).toBe(entry.toMove);
    expect(position.winner).toBe(0);
    expect(entry.timeMs).toBeGreaterThan(0);
  }
});

test('the ply2 win group retains 100 distinct boards across 24 openings and all thirteen regressions', () => {
  expect(PLY2_FORCED_WINS).toHaveLength(100);
  expect(new Set(PLY2_FORCED_WINS.map(entry => entry.encoded)).size).toBe(100);
  expect(new Set(PLY2_FORCED_WINS.map(entry => entry.encoded.split(' ')[1])).size).toBe(24);
  for (const entry of PLY2_FORCED_WINS) {
    expect(GAME_POSITIONS).toContain(entry);
    expect(decodeGame(entry.encoded).ply).toBe(2);
    expect(entry.timeMs).toBe(1_000);
    expect(entry.searchOptions).toEqual({ maxDepth: 30, quiescenceDepth: 4, maxPly: 64 });
    expect(entry.expectedResult).toEqual({ forcedWin: true });
  }
  const boards = PLY2_FORCED_WINS.map(entry => entry.encoded);
  for (const encoded of [
    'B9 a3 c4', 'B9 c1 c4', 'B9 i3 f4', 'B9 c1 e4', 'B9 g1 d4',
    'B9 i7 f3', 'B9 c1 b5', 'B9 g9 g5', 'B9 g1 f5', 'B9 i7 e5',
    'B9 a7 e4', 'B9 g9 c5', 'B9 g1 g6',
  ]) expect(boards).toContain(encoded);
});
