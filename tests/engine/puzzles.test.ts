// @vitest-environment node
import { test, expect } from 'vitest';

import {
  GogoAI,
  decodeGame,
  decodeMove,
  PUZZLES,
  getPuzzleById,
  type Puzzle,
} from '../../src/engine';

/**
 * Verify the AI finds the unique winning move for a puzzle.
 * Classic (alpha-beta) is tested.
 */
function assertAISolves(puzzle: Puzzle, ai: GogoAI, timeMs: number): void {
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
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4 });
  assertAISolves(puzzle, ai, classicTimeMs[puzzle.depth] ?? 5_000);
});

// Smoke test: Classic AI solves ALL generated puzzles.
// This confirms the puzzle generator's correctness independently.
const generatedPuzzles = PUZZLES.filter((p) => p.id.startsWith('gen-'));
const genClassicTimeMs: Record<number, number> = { 3: 15_000, 5: 15_000, 7: 20_000, 9: 20_000 };

test.each(
  generatedPuzzles.map((p) => [p.id, p] as const),
)('Classic AI solves generated puzzle %s', { timeout: 30_000 }, (_id, puzzle) => {
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4 });
  assertAISolves(puzzle, ai, genClassicTimeMs[puzzle.depth] ?? 5_000);
});

test('getPuzzleById returns the correct puzzle or undefined', () => {
  const found = getPuzzleById('black-3-3');
  expect(found).toBeDefined();
  expect(found!.id).toBe('black-3-3');
  expect(found!.solution).toBe('e5');

  expect(getPuzzleById('nonexistent')).toBeUndefined();
});

test('expert collection includes the verified 11x11 nine-ply puzzle', () => {
  const puzzle = getPuzzleById('gen-expert-1');
  expect(puzzle).toBeDefined();
  expect(decodeGame(puzzle!.encoded).size).toBe(11);
  expect(puzzle!.solution).toBe('f2');
  expect(puzzle!.depth).toBe(9);
  expect(puzzle!.threshold).toBe(4);
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

test('AI proves forced win for edge attack position B9 e9 e8 f9 g9', { timeout: 60_000 }, () => {
  const position = decodeGame('B9 e9 e8 f9 g9');
  const ai = new GogoAI({ maxDepth: 30, quiescenceDepth: 4 });
  const result = ai.findBestMove(position, 60_000);
  expect(result.forcedWin).toBe(true);
  expect(result.heuristicWin).toBe(true);
  expect(result.timedOut).toBe(false);
  expect(position.isLegal(result.move)).toBe(true);
});

test('AI proves forced loss for edge position B9 e9 e8 f9', { timeout: 60_000 }, () => {
  const position = decodeGame('B9 e9 e8 f9');
  const ai = new GogoAI({ maxDepth: 30, quiescenceDepth: 4 });
  const result = ai.findBestMove(position, 59_000);
  expect(result.forcedLoss).toBe(true);
  expect(result.heuristicLoss).toBe(true);
  expect(result.timedOut).toBe(false);
  expect(position.isLegal(result.move)).toBe(true);
});

// Themed experts must pass the same complete validator as generated puzzles.
// Keeping proofs in this suite avoids putting expensive searches in coverage.
test.each(['gen-expert-ko', 'gen-expert-sacrifice', 'gen-expert-endgame'])(
  'new expert %s satisfies every fundamental rule', { timeout: 900_000 }, async (id) => {
    const { EXPERT, ForcedWinSearcher, validatePuzzlePosition } = await import('../../src/engine/puzzleGenerator');
    const puzzle = getPuzzleById(id)!;
    expect(puzzle).toBeDefined();
    const position = decodeGame(puzzle.encoded);
    const validated = validatePuzzlePosition(position, EXPERT, new ForcedWinSearcher(position.area, 15));
    expect(validated).not.toBeNull();
    expect(validated!.solution).toBe(puzzle.solution);
    expect(validated!.winningMoves).toEqual(puzzle.winningMoves);
    expect(validated!.wonEncoded).toBe(puzzle.wonEncoded);
    const solution = decodeMove(puzzle.solution, position.size);
    const shallow = new GogoAI({ maxDepth: 4, quiescenceDepth: 0, maxPly: 6 })
      .findBestMove(position, 5_000);
    expect(shallow.timedOut).toBe(false);
    expect(shallow.depth).toBe(4);
    expect(shallow.move).not.toBe(solution);
    const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4 });
    expect(ai.verifyWinningMove(position, solution, 20_000, 9)).toBe(true);
  },
);
