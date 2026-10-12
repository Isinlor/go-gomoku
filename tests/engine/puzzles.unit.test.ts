import { expect, test } from 'vitest';

import {
  BLACK,
  WHITE,
  decodeGame,
  decodeMove,
  getPuzzleById,
  PUZZLES,
} from '../../src/engine';

test('getPuzzleById returns a puzzle when id exists', () => {
  const puzzle = getPuzzleById('black-3-3');

  expect(puzzle).toBeDefined();
  expect(puzzle?.id).toBe('black-3-3');
  expect(puzzle?.toMove).toBe(BLACK);
});

test('getPuzzleById returns undefined when id does not exist', () => {
  expect(getPuzzleById('missing-id')).toBeUndefined();
});

test('every puzzle entry is internally consistent', () => {
  expect(PUZZLES.length).toBeGreaterThan(0);

  for (const puzzle of PUZZLES) {
    expect(puzzle.id.length).toBeGreaterThan(0);
    expect(puzzle.solution.length).toBeGreaterThan(0);
    expect(puzzle.depth).toBeGreaterThan(0);
    expect(puzzle.threshold).toBeGreaterThan(0);
    expect(puzzle.toMove === BLACK || puzzle.toMove === WHITE).toBe(true);

    const start = decodeGame(puzzle.encoded);
    expect(start.toMove).toBe(puzzle.toMove);

    const solutionIndex = decodeMove(puzzle.solution, start.size);
    expect(solutionIndex).toBeGreaterThanOrEqual(0);
    expect(start.isLegal(solutionIndex)).toBe(true);

    expect(puzzle.winningMoves.length).toBeGreaterThanOrEqual(1);
    expect(puzzle.winningMoves[0]).toBe(puzzle.solution);

    const solved = decodeGame(puzzle.wonEncoded);
    expect(solved.winner).toBe(puzzle.toMove);
  }
});
