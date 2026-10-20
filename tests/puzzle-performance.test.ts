// @vitest-environment node
import { expect, test } from 'vitest';
import * as engine from '../src/engine';
import { comparePuzzleRuns, measurePuzzle } from '../scripts/puzzle-performance.mjs';

const puzzle = engine.PUZZLES[0];

test('compares the fastest new run with the slowest master run, including equality', () => {
  expect(comparePuzzleRuns([10, 20, 30], [40, 30, 50])).toEqual({ masterMs: 30, newMs: 30, passed: true });
  expect(comparePuzzleRuns([10, 20, 30], [31.301, 40, 50]).passed).toBe(false);
});

test.each([
  [101.001, true], [101.999, true], [102, true], [102.001, false],
])('allows up to one percent plus one millisecond above the slowest master run (%s ms)', (duration, passed) => {
  expect(comparePuzzleRuns([99, 100, 98], [103, duration, 104])).toEqual({
    masterMs: 100, newMs: duration, passed,
  });
});

test.each([[0, true], [0.999, true], [1, true], [1.001, false]])('allows up to one millisecond above a zero baseline (%s ms)', (duration, passed) => {
  expect(comparePuzzleRuns([0, 0, 0], [2, duration, 3]).passed).toBe(passed);
});

test('requires exactly three measurements per version', () => {
  expect(() => comparePuzzleRuns([1, 2], [1, 2, 3])).toThrow('three');
  expect(() => comparePuzzleRuns([1, 2, 3], [1, 2])).toThrow('three');
});

test.each([undefined, -1, NaN, Infinity, '1'])('rejects invalid timing: %s', (duration) => {
  expect(() => comparePuzzleRuns([duration, 1, 1], [1, 1, 1])).toThrow('timing');
  expect(() => comparePuzzleRuns([1, 1, 1], [duration, 1, 1])).toThrow('timing');
});

test('directly solves a real puzzle and brackets only findBestMove with the clock', () => {
  let clockCalls = 0;
  const elapsed = measurePuzzle(engine, puzzle, () => ++clockCalls * 10);
  expect(elapsed).toBe(10);
  expect(clockCalls).toBe(2);
  expect(measurePuzzle(engine, puzzle)).toBeGreaterThanOrEqual(0);
});

test('rejects an invalid position, solution, or incorrect solver result', () => {
  expect(() => measurePuzzle(engine, { ...puzzle, toMove: 2 })).toThrow('player');
  expect(() => measurePuzzle(engine, { ...puzzle, solution: 'invalid' })).toThrow('solution');
  expect(() => measurePuzzle(engine, { ...puzzle, solution: 'e9' })).toThrow('solve');
});

test('uses identical search options, the default puzzle time limit, and puzzle overrides', () => {
  const budgets: number[] = [];
  const options: unknown[] = [];
  class RecordingAI extends engine.GogoAI {
    constructor(value: unknown) { super(value); options.push(value); }
    findBestMove(position: unknown, timeMs: number) {
      budgets.push(timeMs);
      return super.findBestMove(position, timeMs);
    }
  }
  const recordingEngine = { ...engine, GogoAI: RecordingAI };
  for (const [id, depth] of [['original', 3], ['original', 5], ['original', 7], ['original', 99], ['gen-example', 3], ['gen-example', 5], ['gen-example', 7], ['gen-example', 99]] as const) {
    measurePuzzle(recordingEngine, { ...puzzle, id, depth });
  }
  measurePuzzle(recordingEngine, { ...puzzle, id: 'custom', timeLimitMs: 321 });
  expect(budgets).toEqual([75, 75, 75, 75, 75, 75, 75, 75, 321]);
  expect(options).toEqual(Array(9).fill({ maxDepth: 10, quiescenceDepth: 4 }));
});

// A shallow real search keeps framework checks fast in the coverage suite.
const gamePosition = {
  id: 'search-contract', encoded: puzzle.encoded, toMove: puzzle.toMove,
  searchOptions: { maxDepth: 10, quiescenceDepth: 4 }, timeLimitMs: 500,
  expectedResult: { forcedWin: true, timedOut: false },
};

test.each([
  [true, false, true],
  [false, true, true],
  [true, true, true],
  [false, false, false],
])('requires a forced or heuristic win with an allowed move (%s, %s)', (forcedWin, heuristicWin, solved) => {
  const move = engine.decodeMove(puzzle.solution, engine.decodeGame(puzzle.encoded).size);
  // Control the solver result to cover proof and heuristic regressions independently.
  class ResultAI {
    findBestMove() { return { move, forcedWin, heuristicWin }; }
  }
  const controlledEngine = { ...engine, GogoAI: ResultAI };
  const fixture = { ...gamePosition, expectedResult: { allowedMoves: [move], requireWin: true } };
  expect(measurePuzzle(controlledEngine, fixture, undefined, false)).toMatchObject({ solved });
  if (solved) {
    expect(measurePuzzle(controlledEngine, fixture)).toBeGreaterThanOrEqual(0);
  } else {
    expect(() => measurePuzzle(controlledEngine, fixture)).toThrow('expected a forced or heuristic win');
  }
  const wrongMove = { ...fixture, expectedResult: { ...fixture.expectedResult, allowedMoves: [79, 80] } };
  expect(measurePuzzle(controlledEngine, wrongMove, undefined, false)).toMatchObject({ solved: false });
  expect(() => measurePuzzle(controlledEngine, wrongMove)).toThrow('was selected but allowed are');
});

test('measures game positions with their own search settings and SearchResult assertions', () => {
  const budgets: number[] = [];
  const options: unknown[] = [];
  class RecordingAI extends engine.GogoAI {
    constructor(value: unknown) { super(value); options.push(value); }
    findBestMove(position: unknown, timeMs: number) {
      budgets.push(timeMs);
      return super.findBestMove(position, timeMs);
    }
  }
  let clockCalls = 0;
  expect(measurePuzzle({ ...engine, GogoAI: RecordingAI }, gamePosition, () => ++clockCalls * 10)).toBe(10);
  expect(clockCalls).toBe(2);
  expect(budgets).toEqual([500]);
  expect(options).toEqual([gamePosition.searchOptions]);
  expect(measurePuzzle(engine, gamePosition)).toBeGreaterThanOrEqual(0);
});

test('rejects incorrect game-position SearchResult assertions', () => {
  expect(() => measurePuzzle(engine, { ...gamePosition, toMove: 2 })).toThrow('player');
  expect(() => measurePuzzle(engine, { ...gamePosition, expectedResult: { forcedLoss: true } })).toThrow('forcedLoss');
  expect(() => measurePuzzle(engine, { ...gamePosition, expectedResult: { move: -1 } })).toThrow('move');
});

test('baseline timings allow incorrect moves and proof results while candidate checks remain strict', () => {
  const wrongSolution = { ...puzzle, solution: 'e9' };
  expect(measurePuzzle(engine, wrongSolution, undefined, false)).toMatchObject({ elapsedMs: expect.any(Number), solved: false });
  const wrongProof = { ...gamePosition, expectedResult: { forcedLoss: true } };
  expect(measurePuzzle(engine, wrongProof, undefined, false)).toMatchObject({ elapsedMs: expect.any(Number), solved: false });
  expect(measurePuzzle(engine, gamePosition, undefined, false)).toMatchObject({ solved: true });
  expect(() => measurePuzzle(engine, wrongSolution)).toThrow('solve');
  expect(() => measurePuzzle(engine, wrongProof)).toThrow('forcedLoss');
});

test('explicit allowed moves combine with other result conditions and explain failures', () => {
  const move = engine.decodeMove(puzzle.solution, engine.decodeGame(puzzle.encoded).size);
  const valid = { ...gamePosition, expectedResult: { allowedMoves: [move, 0], forcedWin: true } };
  const invalid = { ...gamePosition, expectedResult: { allowedMoves: [79, 80] } };
  expect(measurePuzzle(engine, valid)).toBeGreaterThanOrEqual(0);
  expect(measurePuzzle(engine, valid, undefined, false)).toMatchObject({ solved: true });
  expect(() => measurePuzzle(engine, invalid)).toThrow(`move ${puzzle.solution} was selected but allowed are h9, i9`);
  expect(measurePuzzle(engine, invalid, undefined, false)).toMatchObject({ solved: false });
  const wrongProof = { ...valid, expectedResult: { ...valid.expectedResult, forcedLoss: true } };
  expect(() => measurePuzzle(engine, wrongProof)).toThrow('forcedLoss');
  expect(measurePuzzle(engine, wrongProof, undefined, false)).toMatchObject({ solved: false });
});
