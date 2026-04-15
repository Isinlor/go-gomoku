import { expect, test } from 'vitest';

import { insertMoveDescending, sortMovesDescending } from '../../src/engine/moveOrdering';

test('insertMoveDescending keeps moves and scores sorted together', () => {
  const moves = new Int16Array([11, 22, 33, 0]);
  const scores = new Int32Array([90, 70, 10, 0]);

  insertMoveDescending(moves, scores, 3, 44, 50);

  expect(Array.from(moves.slice(0, 4))).toEqual([11, 22, 44, 33]);
  expect(Array.from(scores.slice(0, 4))).toEqual([90, 70, 50, 10]);
});

test('sortMovesDescending reorders an unsorted score buffer in place', () => {
  const moves = new Int16Array([11, 22, 33, 44]);
  const scores = new Int32Array([10, 90, 50, 70]);

  sortMovesDescending(moves, scores, 4);

  expect(Array.from(moves)).toEqual([22, 44, 33, 11]);
  expect(Array.from(scores)).toEqual([90, 70, 50, 10]);
});
