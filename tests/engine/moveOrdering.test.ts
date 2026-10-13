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

test.each([69, 70, 71])('insertion compares against the neighboring score without reversing ties: %s', score => {
  const moves = new Int16Array([11, 22, 33, -1, -1]);
  const scores = new Float64Array([90, 70, 10, -999, -999]);
  insertMoveDescending(moves, scores, 3, 44, score);
  expect(Array.from(moves)).toEqual(score > 70 ? [11, 44, 22, 33, -1] : [11, 22, 44, 33, -1]);
  expect(Array.from(scores)).toEqual(score > 70 ? [90, score, 70, 10, -999] : [90, 70, score, 10, -999]);
});

test.each([0, 1, 4])('sorting preserves stable ties and does not touch the tail (count=%s)', count => {
  const moves = new Int16Array([11, 22, 33, 44, -1]);
  const scores = new Float64Array([70, 90, 70, 69, -999]);
  sortMovesDescending(moves, scores, count);
  expect(Array.from(moves)).toEqual(count === 4 ? [22, 11, 33, 44, -1] : [11, 22, 33, 44, -1]);
  expect(Array.from(scores)).toEqual(count === 4 ? [90, 70, 70, 69, -999] : [70, 90, 70, 69, -999]);
});
