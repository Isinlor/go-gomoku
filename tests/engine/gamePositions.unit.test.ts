import { expect, test } from 'vitest';
import { GAME_POSITIONS, decodeGame } from '../../src/engine';

test('game positions have unique IDs and consistent search inputs', () => {
  expect(new Set(GAME_POSITIONS.map(position => position.id)).size).toBe(GAME_POSITIONS.length);
  for (const entry of GAME_POSITIONS) {
    const position = decodeGame(entry.encoded);
    expect(position.toMove).toBe(entry.toMove);
    expect(position.winner).toBe(0);
    expect(entry.timeLimitMs).toBeGreaterThan(0);
  }
});
