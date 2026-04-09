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
// test suite fast.  Generated puzzles are validated by the generator itself
// (ForcedWinSearcher proves correctness); all generated puzzles are also
// smoke-tested with the Classic AI in the section below.
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

// Smoke test: Classic AI solves ALL generated puzzles.
// This confirms the puzzle generator's correctness independently.
const generatedPuzzles = PUZZLES.filter((p) => p.id.startsWith('gen-'));
const genClassicTimeMs: Record<number, number> = { 3: 15_000, 5: 15_000, 7: 20_000 };

test.each(
  generatedPuzzles.map((p) => [p.id, p] as const),
)('Classic AI solves generated puzzle %s', { timeout: 30_000 }, (_id, puzzle) => {
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 8, maxPly: 96 });
  assertAISolves(puzzle, ai, genClassicTimeMs[puzzle.depth] ?? 5_000);
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

test('all puzzles have valid wonEncoded and winningMoves', () => {
  for (const puzzle of PUZZLES) {
    // wonEncoded should be decodable
    const wonPos = decodeGame(puzzle.wonEncoded);
    // The won position should have a winner
    expect(wonPos.winner).not.toBe(0);
    // The winner should be the puzzle's toMove player
    expect(wonPos.winner).toBe(puzzle.toMove);

    // winningMoves should start with the solution
    expect(puzzle.winningMoves.length).toBeGreaterThanOrEqual(puzzle.depth);
    expect(puzzle.winningMoves[0]).toBe(puzzle.solution);

    // Playing the winning moves from the puzzle position should reach the won state
    const pos = decodeGame(puzzle.encoded);
    for (const moveStr of puzzle.winningMoves) {
      const moveIdx = decodeMove(moveStr, pos.size);
      expect(moveIdx).not.toBe(-1);
      expect(pos.play(moveIdx)).toBe(true);
    }
    // After all winning moves, should have a winner
    expect(pos.winner).toBe(puzzle.toMove);
    // The encoded game should match wonEncoded
    expect(pos.encodeGame()).toBe(puzzle.wonEncoded);
  }
});
