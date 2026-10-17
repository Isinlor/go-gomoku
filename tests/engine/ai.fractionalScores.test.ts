import { expect, test } from 'vitest';
import { BLACK, WHITE, EMPTY, GogoAI, GogoPosition } from '../../src/engine';
import { insertMoveDescending, sortMovesDescending } from '../../src/engine/moveOrdering';

function setup(player: typeof BLACK | typeof WHITE) {
  const position = GogoPosition.fromAscii([
    'O........', '.........', '.........', '.........', '..XXX....',
    '.........', '.........', '.........', '.........',
  ], player);
  const ai = new GogoAI({ quiescenceDepth: 0, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.proofMode = true; // Disable selective pruning and candidate limits.
  return { position, ai };
}

// Exhaust all legal moves, without move generation, alpha-beta, or caches.
function exhaustiveOnePly(ai: any, position: GogoPosition): number {
  let best = -Infinity;
  for (let move = 0; move < position.area; move++) {
    if (!position.play(move)) continue;
    const score = position.winner === EMPTY ? -ai.evaluate(position) : 1_000_000_000 - 1;
    position.undo();
    best = Math.max(best, score);
  }
  return best;
}

test.each([BLACK, WHITE])('TT preserves a fractional exact score for player %i', player => {
  const { position, ai } = setup(player);
  const expected = exhaustiveOnePly(ai, position);
  expect(Number.isInteger(expected)).toBe(false);
  expect(Math.sign(expected)).toBe(player === BLACK ? 1 : -1);
  const score = ai.search(position, 1, -Infinity, Infinity, 0);
  expect(score).toBeCloseTo(expected, 10);
  const nodes = ai.nodesVisited;
  expect(ai.search(position, 1, -Infinity, Infinity, 0)).toBe(score);
  expect(ai.nodesVisited - nodes).toBe(1);
});

test.each([BLACK, WHITE])('quiescence preserves a fractional exact score for player %i', player => {
  const { position, ai } = setup(player);
  const expected = ai.evaluate(position);
  expect(Number.isInteger(expected)).toBe(false);
  expect(Math.sign(expected)).toBe(player === BLACK ? 1 : -1);
  expect(ai.quiescence(position, -Infinity, Infinity, 0, 0)).toBe(expected);
  const nodes = ai.nodesVisited;
  expect(ai.quiescence(position, -Infinity, Infinity, 0, 0)).toBe(expected);
  expect(ai.nodesVisited - nodes).toBe(1);
});

test.each([BLACK, WHITE])('TT fractional bounds agree with exhaustive search for player %i', player => {
  const { position, ai } = setup(player);
  const expected = exhaustiveOnePly(ai, position);
  expect(Number.isInteger(expected)).toBe(false);
  const index = Number(position.hash & 0x3ffffn);
  // The exhaustive value is a valid lower and upper bound. A cutoff at a
  // threshold between it and its truncated value would be unsound.
  const threshold = (expected + Math.trunc(expected)) / 2;
  for (const flag of [2, 3]) {
    ai.ttHash[index] = position.hash;
    ai.ttScore[index] = expected;
    ai.ttDepth[index] = 1;
    ai.ttFlag[index] = flag;
    const alpha = flag === 3 ? threshold : -Infinity;
    const beta = flag === 2 ? threshold : Infinity;
    const shouldCut = flag === 2 ? expected >= beta : expected <= alpha;
    const nodes = ai.nodesVisited;
    expect(ai.search(position, 1, alpha, beta, 0)).toBeCloseTo(expected, 10);
    if (shouldCut) expect(ai.nodesVisited - nodes).toBe(1);
    else expect(ai.nodesVisited - nodes).toBeGreaterThan(1);
  }
});

test.each([BLACK, WHITE])('quiescence fractional bounds preserve cutoff thresholds for player %i', player => {
  const { position, ai } = setup(player);
  const expected = ai.evaluate(position);
  const threshold = (expected + Math.trunc(expected)) / 2;
  // First establish a real bound, then try a window where truncation would
  // incorrectly make that bound sufficient for a cached cutoff.
  const lower = expected < 0;
  const alpha = lower ? -Infinity : expected + 1;
  const beta = lower ? expected - 1 : Infinity;
  expect(ai.quiescence(position, alpha, beta, 0, 0)).toBe(expected);
  const index = Number(position.hash & BigInt(ai.qScore.length - 1));
  expect(ai.qFlag[index]).toBe(lower ? 2 : 3);
  expect(ai.qScore[index]).toBe(expected);
  expect(ai.quiescence(position, lower ? -Infinity : threshold, lower ? threshold : Infinity, 0, 0)).toBe(expected);
  expect(ai.qFlag[index]).toBe(1);
});

test('engine move buffers preserve fractional ordering and stable ties', () => {
  const { ai } = setup(BLACK);
  const moves = ai.moveBuffers[0] as Int16Array;
  const scores = ai.scoreBuffers[0] as Float64Array;
  const values = [12.1, 12.9, 12.9, -12.9, -12.1];
  const expected = values.map((score, move) => ({ move, score })).sort((a, b) => b.score - a.score);
  for (let move = 0; move < values.length; move++) {
    insertMoveDescending(moves, scores, move, move, values[move]);
  }
  expect(Array.from(moves.slice(0, values.length))).toEqual(expected.map(candidate => candidate.move));
  expect(Array.from(scores.slice(0, values.length))).toEqual(expected.map(candidate => candidate.score));
  scores.set(values);
  moves.set(values.map((_, move) => move));
  sortMovesDescending(moves, scores, values.length);
  expect(Array.from(moves.slice(0, values.length))).toEqual(expected.map(candidate => candidate.move));
  expect(Array.from(scores.slice(0, values.length))).toEqual(expected.map(candidate => candidate.score));
});
