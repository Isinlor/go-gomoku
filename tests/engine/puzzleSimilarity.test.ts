import { expect, test } from 'vitest';
import { jaccardSimilarity, puzzleSimilarities, hasDuplicateSimilarity, PuzzleDuplicateIndex } from '../../src/engine/puzzleSimilarity';

const puzzle = (encoded: string, solution = 'e5', depth = 3, threshold = 2) => ({ encoded, solution, depth, threshold });

test('Jaccard uses sets and treats two empty sets as identical', () => {
  expect(jaccardSimilarity(new Set(), new Set())).toBe(1);
  expect(jaccardSimilarity(new Set(['a']), new Set())).toBe(0);
  expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['b', 'c']))).toBe(1 / 3);
});

test('compares decoded stones with colors, excluding solution and winning sequence', () => {
  const a = { ...puzzle('B9 d5 a1'), wonEncoded: 'B9 d5 a1 e5', winningMoves: ['e5'] };
  expect(puzzleSimilarities(a, puzzle('B9 d5 a1'))).toEqual({ localDirect: 1, localRotated: 1, boardDirect: 1, boardSymmetric: 1 });
  expect(puzzleSimilarities(a, puzzle('B9 a1 d5'))?.localDirect).toBe(0);
  expect(puzzleSimilarities(puzzle('B9'), puzzle('B9'))?.boardDirect).toBe(1);
});

test('only compares matching board size, depth and threshold', () => {
  const a = puzzle('B9 d5');
  expect(puzzleSimilarities(a, puzzle('B11 d5'))).toBeNull();
  expect(puzzleSimilarities(a, puzzle('B9 d5', 'e5', 5))).toBeNull();
  expect(puzzleSimilarities(a, puzzle('B9 d5', 'e5', 3, 4))).toBeNull();
});

test('local coordinates follow solution, include distance two and exclude distance three', () => {
  expect(puzzleSimilarities(puzzle('B9 c3 b2'), puzzle('B9 f6 e5', 'h8'))?.localDirect).toBe(1);
  expect(puzzleSimilarities(puzzle('B9 b5'), puzzle('B9'))?.localDirect).toBe(1);
});

test('local rotations center on solution and do not include reflections', () => {
  const a = puzzle('B9 f5 g6 d7');
  expect(puzzleSimilarities(a, puzzle('B9 e6 d7 c4'))?.localRotated).toBe(1);
  expect(puzzleSimilarities(a, puzzle('B9 d5 c6 f7'))?.localRotated).toBeLessThan(1);
});

test('whole board includes all eight symmetries about the board center', () => {
  const a = puzzle('B9 a2 c4 h6');
  const variants = ['B9 a2 c4 h6', 'B9 h1 f3 d8', 'B9 i8 g6 b4', 'B9 b9 d7 f2', 'B9 i2 g4 b6', 'B9 h9 f7 d2', 'B9 a8 c6 h4', 'B9 b1 d3 f8'];
  for (const encoded of variants) {
    expect(puzzleSimilarities(a, puzzle(encoded))?.boardSymmetric).toBe(1);
  }
});

test('captured stones are absent from comparisons', () => {
  expect(puzzleSimilarities(puzzle('B9 b1 a1 a2'), puzzle('B9 a2 i9 b1'))?.boardDirect).toBe(2 / 3);
});

test.each([
  ['localDirect', 0.4], ['localRotated', 0.72], ['boardDirect', 0.25], ['boardSymmetric', 0.86],
] as const)('%s rejects at the inclusive cutoff %s', (key, cutoff) => {
  const scores = { localDirect: 0, localRotated: 0, boardDirect: 0, boardSymmetric: 0 };
  expect(hasDuplicateSimilarity({ ...scores, [key]: cutoff - 0.000001 })).toBe(false);
  expect(hasDuplicateSimilarity({ ...scores, [key]: cutoff })).toBe(true);
});

test('index rejects duplicates against existing and accepted puzzles in matching groups', () => {
  const index = new PuzzleDuplicateIndex([puzzle('B9 d5')]);
  expect(index.add(puzzle('B9 d5'))).toBe(false);
  expect(index.add(puzzle('B11 d5'))).toBe(true);
  expect(index.add(puzzle('B9 f6', 'e5', 5))).toBe(true);
  expect(index.add(puzzle('B9 f6', 'e5', 5))).toBe(false);
  expect(index.add(puzzle('B9 g7'))).toBe(true);
});

test('invalid solution is rejected', () => {
  expect(() => puzzleSimilarities(puzzle('B9', 'z99'), puzzle('B9'))).toThrow('Invalid solution');
});
