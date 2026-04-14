import { expect, test } from 'vitest';
import { GogoAI, decodeGame, decodeMove, PUZZLES, type Puzzle } from './src/engine';

const originalTimeMs: Record<number, number> = { 3: 500, 5: 2_000, 7: 8_000 };
const generatedTimeMs: Record<number, number> = { 3: 15_000, 5: 15_000, 7: 20_000 };
const repeats = 3;

function solve(puzzle: Puzzle): void {
  const position = decodeGame(puzzle.encoded);
  const expected = decodeMove(puzzle.solution, position.size);
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4 });
  const timeMs = puzzle.id.startsWith('gen-') ? (generatedTimeMs[puzzle.depth] ?? 5_000) : (originalTimeMs[puzzle.depth] ?? 5_000);
  expect(ai.findBestMove(position, timeMs).move).toBe(expected);
}

test.each(PUZZLES.map((p) => [p.id, p] as const))('bench %s', { timeout: 120_000 }, (_id, puzzle) => {
  for (let i = 0; i < repeats; i += 1) solve(puzzle);
});
