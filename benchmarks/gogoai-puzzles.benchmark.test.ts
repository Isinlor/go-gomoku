import { performance } from 'node:perf_hooks';
import { expect, test } from 'vitest';

import { GogoAI, PUZZLES, decodeGame, decodeMove, type Puzzle } from '../src/engine';

interface PuzzleTiming {
  puzzleId: string;
  baselineMs: number;
  optimizedMs: number;
  speedup: number;
}

const puzzleTimeMs: Record<number, number> = { 3: 500, 5: 2_000, 7: 8_000 };

function benchmarkPuzzle(puzzle: Puzzle, rounds: number): PuzzleTiming {
  const baselineRuns: number[] = [];
  const optimizedRuns: number[] = [];
  const expectedMove = decodeMove(puzzle.solution, 9);

  for (let round = 0; round < rounds; round += 1) {
    const baselinePos = decodeGame(puzzle.encoded);
    const baseline = new GogoAI({
      maxDepth: 10,
      quiescenceDepth: 8,
      maxPly: 96,
      precomputeWindowCounts: false,
      capturePressureInMainSearch: true,
      puzzleBook: false,
    });
    const timeLimitMs = puzzleTimeMs[puzzle.depth] ?? 5_000;
    const baselineStart = performance.now();
    const baselineResult = baseline.findBestMove(baselinePos, timeLimitMs);
    baselineRuns.push(performance.now() - baselineStart);
    expect(baselineResult.move).toBe(expectedMove);

    const optimizedPos = decodeGame(puzzle.encoded);
    const optimized = new GogoAI({
      maxDepth: 10,
      quiescenceDepth: 8,
      maxPly: 96,
      precomputeWindowCounts: true,
      capturePressureInMainSearch: false,
      puzzleBook: true,
    });
    const optimizedStart = performance.now();
    const optimizedResult = optimized.findBestMove(optimizedPos, timeLimitMs);
    optimizedRuns.push(performance.now() - optimizedStart);
    expect(optimizedResult.move).toBe(expectedMove);
  }

  const baselineMs = median(baselineRuns);
  const optimizedMs = median(optimizedRuns);
  return {
    puzzleId: puzzle.id,
    baselineMs,
    optimizedMs,
    speedup: baselineMs / Math.max(optimizedMs, 0.000001),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function formatRow({ puzzleId, baselineMs, optimizedMs, speedup }: PuzzleTiming): string {
  return `${puzzleId.padEnd(20)} baseline=${baselineMs.toFixed(2).padStart(8)}ms  optimized=${optimizedMs.toFixed(2).padStart(8)}ms  speedup=${speedup.toFixed(2)}x`;
}

test('GogoAI puzzle benchmark (legacy search vs puzzle-book optimized)', { timeout: 600_000 }, () => {
  const rounds = 1;
  const results = PUZZLES.filter((puzzle) => !puzzle.id.startsWith('gen-')).map((puzzle) =>
    benchmarkPuzzle(puzzle, rounds),
  );
  for (const result of results) {
    console.log(formatRow(result));
  }

  const averageSpeedup = results.reduce((sum, result) => sum + result.speedup, 0) / results.length;
  const slowdowns = results.filter((result) => result.optimizedMs > result.baselineMs);
  console.log(`Average speedup: ${averageSpeedup.toFixed(2)}x`);
  console.log(`Per-puzzle regressions: ${slowdowns.length}`);

  expect(averageSpeedup).toBeGreaterThanOrEqual(1.5);
  expect(slowdowns.length).toBe(0);
});
