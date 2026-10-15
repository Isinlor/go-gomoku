import { expect, test } from 'vitest';

import { insertMoveDescending, sortMovesDescending } from '../../src/engine/moveOrdering';

test('insertMoveDescending keeps moves and scores sorted together', () => {
  const moves = new Int16Array([11, 22, 33, 0]);
  const scores = new Int32Array([90, 70, 10, 0]);

  insertMoveDescending(moves, scores, 3, 44, 50);

  expect(Array.from(moves.slice(0, 4))).toEqual([11, 22, 44, 33]);
  expect(Array.from(scores.slice(0, 4))).toEqual([90, 70, 50, 10]);

  // Extremes and ties still use stable insertion and leave unused slots alone.
  const extremes = new Float64Array([Infinity, 0, -Infinity, 123]);
  insertMoveDescending(moves, extremes, 3, 55, Infinity);
  expect(Array.from(moves)).toEqual([11, 55, 22, 44]);
  expect(Array.from(extremes)).toEqual([Infinity, Infinity, 0, -Infinity]);
});

test('sortMovesDescending reorders an unsorted score buffer in place', () => {
  const moves = new Int16Array([11, 22, 33, 44]);
  const scores = new Int32Array([10, 90, 50, 70]);

  sortMovesDescending(moves, scores, 4);

  expect(Array.from(moves)).toEqual([22, 44, 33, 11]);
  expect(Array.from(scores)).toEqual([90, 70, 50, 10]);

  scores.set([10, 10, -10, -10]);
  const before = moves.slice();
  sortMovesDescending(moves, scores, 4);
  expect(moves).toEqual(before);
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

test('sorting a bounded prefix keeps the same best moves and stable ties as a full sort', () => {
  const values = [2, -1, 7, 7, 0, Infinity, 1, 7];
  for (const limit of [0, 1, 3, 8, 10]) {
    const moves = new Int16Array(values.map((_, index) => index));
    const scores = new Float64Array(values);
    const expected = values.map((score, move) => ({ score, move })).sort((a, b) => b.score - a.score);
    sortMovesDescending(moves, scores, values.length, limit);
    expect(Array.from(moves.slice(0, Math.min(limit, values.length)))).toEqual(expected.slice(0, limit).map(value => value.move));
    expect(Array.from(scores.slice(0, Math.min(limit, values.length)))).toEqual(expected.slice(0, limit).map(value => value.score));
  }
});

test('bounded sorting avoids ordering the unused tail', () => {
  const moves = Int16Array.from({ length: 128 }, (_, index) => index);
  const values = Float64Array.from(moves);
  let reads = 0;
  const scores = new Proxy(values, { get(target, key) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
    return Reflect.get(target, key, target);
  } });
  sortMovesDescending(moves, scores, moves.length, 6);
  expect(Array.from(moves.slice(0, 6))).toEqual([127, 126, 125, 124, 123, 122]);
  expect(reads).toBeLessThan(4000);
});
