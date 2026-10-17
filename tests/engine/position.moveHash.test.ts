import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoPosition, computeZobristHashes } from '../../src/engine/gogomoku';

test.each([9, 11, 13] as const)('move hash keys combine stone placement and turn change on %s', size => {
  const position = new GogoPosition(size);
  for (let point = 0; point < position.area; point++) {
    for (const player of [BLACK, WHITE]) {
      const key = point * 2 + player - 1;
      expect(position.meta.zobristMoves64[key]).toBe(
        position.meta.zobristStones64[key] ^ position.meta.zobristBlackToMove64);
    }
  }
  // Includes a capture; every undo must restore the independently computed hash.
  for (const move of [1, 0, size]) {
    expect(position.play(move)).toBe(true);
    expect(position.hash).toBe(computeZobristHashes(position));
  }
  expect(position.lastCapturedCount).toBe(1);
  while (position.undo()) expect(position.hash).toBe(computeZobristHashes(position));
});
