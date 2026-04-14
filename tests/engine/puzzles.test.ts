import { test, expect } from 'vitest';

import {
  GogoAI,
  decodeGame,
  decodeMove,
  encodeMove,
  PUZZLES,
  getPuzzleById,
  type Puzzle,
} from '../../src/engine';

interface TopMoveScore {
  move: string;
  score: number;
}

const WIN_SCORE = 1_000_000_000;
const expectedTop3Scores: Record<string, readonly TopMoveScore[]> = {
  'black-3-3': [
    { move: 'e5', score: 999999997 },
    { move: 'e7', score: 532 },
    { move: 'e2', score: 197 },
  ],
  'black-5-3': [
    { move: 'e5', score: 999999995 },
    { move: 'c7', score: 389 },
    { move: 'h2', score: -509 },
  ],
  'black-7-5': [
    { move: 'e5', score: 999999993 },
    { move: 'a1', score: -999999994 },
    { move: 'b1', score: -999999994 },
  ],
  'white-3-3': [
    { move: 'e5', score: 999999997 },
    { move: 'e7', score: 471 },
    { move: 'e2', score: 136 },
  ],
  'white-5-3': [
    { move: 'e5', score: 999999995 },
    { move: 'c7', score: 239 },
    { move: 'h2', score: -659 },
  ],
  'white-7-5': [
    { move: 'e5', score: 999999993 },
    { move: 'a1', score: -999999994 },
    { move: 'b1', score: -999999994 },
  ],
};

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

function getTopScoredMoves(puzzle: Puzzle, ai: GogoAI, topN = 3): TopMoveScore[] {
  const position = decodeGame(puzzle.encoded);
  const anyAI = ai as any;

  anyAI.ensureBuffers(position.area);
  anyAI.history.fill(0);
  anyAI.killerMoves.fill(-1);
  anyAI.deadline = Number.POSITIVE_INFINITY;
  anyAI.nodesVisited = 0;
  anyAI.timedOut = false;

  const moves: Int16Array = anyAI.moveBuffers[0];
  const scores: Int32Array = anyAI.scoreBuffers[0];
  let count = anyAI.generateOrderedMoves(position, moves, scores, -1, false, 0);
  let usedFullBoard = false;
  const scoredMoves: Array<{ index: number; score: number }> = [];

  for (;;) {
    for (let i = 0; i < count; i += 1) {
      const move = moves[i];
      if (!position.play(move)) {
        continue;
      }
      let score = 0;
      try {
        score = -anyAI.search(position, puzzle.depth - 1, -WIN_SCORE, WIN_SCORE, 1, true);
      } finally {
        position.undo();
      }
      scoredMoves.push({ index: move, score });
    }
    if (scoredMoves.length !== 0 || usedFullBoard) {
      break;
    }
    count = anyAI.generateFullBoardMoves(position, moves, scores, -1, false, 0);
    usedFullBoard = true;
  }

  scoredMoves.sort((a, b) => b.score - a.score || a.index - b.index);
  return scoredMoves.slice(0, topN).map((entry) => ({
    move: encodeMove(entry.index, position.meta),
    score: entry.score,
  }));
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

test.each(
  originalPuzzles.map((p) => [p.id, p] as const),
)('Classic AI top 3 scored moves stay stable for puzzle %s', { timeout: 90_000 }, (id, puzzle) => {
  const ai = new GogoAI({ maxDepth: puzzle.depth, quiescenceDepth: 4 });
  expect(getTopScoredMoves(puzzle, ai)).toEqual(expectedTop3Scores[id]);
});

// Smoke test: Classic AI solves ALL generated puzzles.
// This confirms the puzzle generator's correctness independently.
const generatedPuzzles = PUZZLES.filter((p) => p.id.startsWith('gen-'));
const genClassicTimeMs: Record<number, number> = { 3: 15_000, 5: 15_000, 7: 20_000 };

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
