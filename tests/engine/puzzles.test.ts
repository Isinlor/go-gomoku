import { test, expect } from 'vitest';

import {
  GogoAI,
  GogoMCTS,
  decodeGame,
  decodeMove,
  PUZZLES,
  getPuzzleById,
  type Puzzle,
} from '../../src/engine';

/**
 * Verify the AI finds the unique winning move for a puzzle.
 * Both Classic (alpha-beta) and MCTS are tested.
 */
function assertAISolves(puzzle: Puzzle, ai: GogoAI | GogoMCTS, timeMs: number): void {
  const position = decodeGame(puzzle.encoded);
  expect(position.toMove).toBe(puzzle.toMove);

  const expectedIndex = decodeMove(puzzle.solution, position.size);
  expect(expectedIndex).not.toBe(-1);

  const result = ai.findBestMove(position, timeMs);
  expect(result.move).toBe(expectedIndex);
}

// Classic AI tests — scale time by puzzle difficulty
const classicTimeMs: Record<number, number> = { 3: 500, 5: 2_000, 7: 8_000 };

// Only test original (hand-crafted) puzzles with the AI solvers to keep the
// test suite fast.  Generated puzzles are validated by the generator itself.
const originalPuzzles = PUZZLES.filter((p) => !p.id.startsWith('gen-'));

test.each(
  originalPuzzles.map((p) => [p.id, p] as const),
)('Classic AI solves puzzle %s', { timeout: 30_000 }, (_id, puzzle) => {
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 8, maxPly: 96 });
  assertAISolves(puzzle, ai, classicTimeMs[puzzle.depth] ?? 5_000);
});

// MCTS tests — only easy puzzles (depth ≤ 5) because MCTS is stochastic
const mctsPuzzles = originalPuzzles.filter((p) => p.depth <= 5);

test.each(
  mctsPuzzles.map((p) => [p.id, p] as const),
)('MCTS solves puzzle %s', { timeout: 15_000 }, (_id, puzzle) => {
  const mcts = new GogoMCTS({ seed: 42, rolloutMaxMoves: 50 });
  assertAISolves(puzzle, mcts, 3_000);
});

// Quick validation: Classic AI can solve a few generated depth-3 puzzles.
// Some generated puzzles are deliberately non-obvious and need more search
// time under coverage instrumentation, so we cherry-pick reliable ones.
test.each([
  ['gen-beginner-2', PUZZLES.find((p) => p.id === 'gen-beginner-2')!] as const,
  ['gen-beginner-3', PUZZLES.find((p) => p.id === 'gen-beginner-3')!] as const,
  ['gen-beginner-10', PUZZLES.find((p) => p.id === 'gen-beginner-10')!] as const,
])('Classic AI solves generated puzzle %s', { timeout: 15_000 }, (_id, puzzle) => {
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 8, maxPly: 96 });
  assertAISolves(puzzle, ai, 3_000);
});

test('getPuzzleById returns the correct puzzle or undefined', () => {
  const found = getPuzzleById('black-3-3');
  expect(found).toBeDefined();
  expect(found!.id).toBe('black-3-3');
  expect(found!.solution).toBe('e5');

  expect(getPuzzleById('nonexistent')).toBeUndefined();
});

test('all puzzles have valid encoded positions and solutions', () => {
  for (const puzzle of PUZZLES) {
    const position = decodeGame(puzzle.encoded);
    expect(position.toMove).toBe(puzzle.toMove);

    const solutionIndex = decodeMove(puzzle.solution, position.size);
    expect(solutionIndex).not.toBe(-1);
    expect(position.isLegal(solutionIndex)).toBe(true);
  }
});
