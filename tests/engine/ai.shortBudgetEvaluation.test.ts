import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoAI, GogoPosition, decodeGame } from '../../src/engine';

test.each([BLACK, WHITE])('timed evaluation scores space and initiative symmetrically (%s)', player => {
  const rows = [...Array(4).fill('.........'), '....X....', ...Array(4).fill('.........')];
  const position = GogoPosition.fromAscii(player === BLACK ? rows : rows.map(row => row.replace('X', 'O')), player);
  const ai = new GogoAI({ maxDepth: 1, quiescenceDepth: 1, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  const normal = ai.evaluate(position);
  ai.configureEvaluation(position, 5);
  // Twenty single-stone windows, center bias nine, and four liberties.
  expect(ai.evaluate(position)).toBeCloseTo(20 * -106 + 9 * 214.8 + 232 + 1135, 8);
  ai.configureEvaluation(position, 100);
  expect(ai.evaluate(position)).toBeCloseTo(20 * -106 + 9 * 214.8 + 232 + 1135, 8);
  ai.configureEvaluation(position, 0);
  expect(ai.evaluate(position)).toBe(normal);
});

test('switching evaluation policies invalidates cached scores but retains move hints', () => {
  const position = decodeGame('B9 e5 d5');
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  ai.evaluate(position);
  ai.ttFlag[7] = ai.qFlag[7] = 1;
  ai.ttBestMove[7] = 40;
  ai.configureEvaluation(position, 5);
  expect(ai.ttFlag[7]).toBe(0);
  expect(ai.qFlag[7]).toBe(0);
  expect(ai.ttBestMove[7]).toBe(40);
  ai.ttFlag[7] = ai.qFlag[7] = 1;
  ai.configureEvaluation(position, 5);
  expect(ai.ttFlag[7]).toBe(1);
  expect(ai.qFlag[7]).toBe(1);
  ai.configureEvaluation(position, 0);
  expect(ai.ttFlag[7]).toBe(0);
  expect(ai.qFlag[7]).toBe(0);
});

test('short-budget incremental evaluation agrees with a fresh board oracle through captures and undo', () => {
  const position = decodeGame('B9 b1 a1');
  const ai = new GogoAI({ maxDepth: 1, quiescenceDepth: 1, now: () => 0 }) as any;
  ai.findBestMove(position, 5);
  const original = ai.evaluate(position);
  expect(position.playXY(0, 1)).toBe(true);
  expect(position.lastCapturedCount).toBe(1);
  let expected = 0;
  for (let wi = 0; wi < position.meta.windowCount; wi++) {
    const cells = Array.from(position.meta.windows.slice(wi * 5, wi * 5 + 5), point => position.board[point]);
    const black = cells.filter(cell => cell === BLACK).length;
    const white = cells.filter(cell => cell === WHITE).length;
    const weights = [0, -106, 48, 624, 500_000, 250_000_000];
    if (white === 0) expected += weights[black];
    if (black === 0) expected -= weights[white];
  }
  // This fixture has two isolated black stones, with no supported gap.
  expected += (position.meta.centerBias[position.index(1, 0)] + position.meta.centerBias[position.index(0, 1)]) * 214.8 + 2 * 335;
  expect(ai.evaluate(position)).toBeCloseTo(-expected + 1135, 8);
  position.undo();
  expect(ai.evaluate(position)).toBe(original);
  expect(position.encodeGame()).toBe('B9 b1 a1');
});

test('short-budget capture-gap scoring retains its positional contribution', () => {
  const position = GogoPosition.fromAscii([
    '.........', '.........', '.........', '....X....', '...X.X...',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  ai.configureEvaluation(position, 5);
  ai.evaluate(position);
  expect(ai.localScores[position.index(4, 4)]).toBe(3050);
});

test('an explicitly disabled tactical extension retains the numeric evaluation policy', () => {
  const position = decodeGame('B9 e5 d5');
  const ai = new GogoAI({ maxDepth: 1, quiescenceDepth: 0, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  const expected = ai.evaluate(position);
  ai.findBestMove(position, 5);
  expect(ai.evaluate(position)).toBe(expected);
});

test.each(['B9 g2 c5 f5', 'B9 b3 g5 f6'])('extra time retains the same completed-depth objective: %s', { tags: ['slow'] }, encoded => {
  // A fixed clock and depth isolate evaluation from timeouts and extra search.
  const results = [25, 99, 100, 125, 625, 2000].map(budget => {
    const position = decodeGame(encoded);
    const result = new GogoAI({ maxDepth: 1, quiescenceDepth: 1, now: () => 0 }).findBestMove(position, budget);
    expect(result.timedOut).toBe(false);
    expect(position.encodeGame()).toBe(encoded);
    return { move: result.move, score: result.score, depth: result.depth };
  });
  for (const result of results) expect(result).toEqual(results[0]);
});

test('increasing the budget on a reused AI preserves evaluation scores and cache validity', () => {
  const position = decodeGame('B9 e5 d5');
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  ai.configureEvaluation(position, 25);
  const expected = ai.evaluate(position);
  ai.ttFlag[7] = ai.qFlag[7] = 1;
  ai.ttBestMove[7] = 40;
  for (const budget of [100, 125, 625, 2000]) {
    ai.configureEvaluation(position, budget);
    expect(ai.evaluate(position)).toBe(expected);
    expect(ai.ttFlag[7]).toBe(1);
    expect(ai.qFlag[7]).toBe(1);
    expect(ai.ttBestMove[7]).toBe(40);
  }
});

test('an inconclusive classic proof scout preserves the calibrated move and scores', () => {
  const position = decodeGame('B9 e5 d5');
  const ai = new GogoAI({ maxDepth: 2, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.configureEvaluation(position, 125);
  const expected = ai.evaluate(position);
  const state = { bestMove: 0, bestScore: -7, completedDepth: 1, hintMove: 0 };
  const original = { ...state };
  ai.deadline = 1000;
  expect(ai.tryEarlyWinProof(position, state, 100, 2, true)).toBe(false);
  expect(state).toEqual(original);
  expect(ai.forcingQuiescence).toBe(true);
  expect(ai.evaluate(position)).toBe(expected);
  expect(ai.deadline).toBe(1000);
  expect(position.encodeGame()).toBe('B9 e5 d5');
});

test.each([4096, undefined])('an inconclusive classic scout shares its node allowance across discovery and proofs (%s)', { tags: ['slow'] }, allowance => {
  const position = decodeGame('B9 a8 b2 c9');
  const ai = new GogoAI({ maxDepth: 5, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.configureEvaluation(position, 1000);
  ai.deadline = 1000;
  const state = { bestMove: 20, bestScore: 891.8, completedDepth: 2, hintMove: 20 };
  const original = { ...state };
  ai.nodesVisited = 37;
  expect(ai.tryClassicProofScout(position, state, allowance, 5)).toBe(false);
  expect(ai.nodesVisited - 37).toBeLessThan(3 * (allowance ?? 20_480) + 4);
  expect(ai.timedOut).toBe(false);
  expect(state).toEqual(original);
  expect(position.encodeGame()).toBe('B9 a8 b2 c9');
});

test('sparse-opening scouts obey the same shared work allowance', () => {
  const position = decodeGame('B9 e5 d5');
  const ai = new GogoAI({ maxDepth: 3, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.configureEvaluation(position, 1000);
  ai.deadline = 1000;
  ai.nodesVisited = 37;
  const state = { bestMove: 0, bestScore: -7, completedDepth: 1, hintMove: 0 };
  const original = { ...state };
  expect(ai.tryClassicProofScout(position, state, 128, 3)).toBe(false);
  expect(ai.nodesVisited - 37).toBeLessThan(388);
  expect(ai.timedOut).toBe(false);
  expect(state).toEqual(original);
  expect(position.encodeGame()).toBe('B9 e5 d5');
});

test.each([false, true])('an inconclusive scout preserves usable playing caches, including on slice timeout (%s)', sliceTimeout => {
  const position = decodeGame('B9 e5 d5');
  let scouting = false, calls = 0;
  const ai = new GogoAI({ maxDepth: 2, now: () => scouting && sliceTimeout && ++calls > 1 ? 600 : 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.configureEvaluation(position, 125);
  ai.deadline = 1000;
  const bound = ai.search(position, 1, -1_000_000, -999_999, 1);
  const quiet = ai.quiescence(position, -Infinity, Infinity, 0, 0);
  const ttIndex = Number(BigInt.asUintN(18, position.hash));
  const qIndex = Number(BigInt.asUintN(12, position.hash));
  expect(ai.ttFlag[ttIndex]).toBe(2);
  expect(ai.qFlag[qIndex]).toBe(1);
  ai.history[3] = 73;
  ai.killerMoves[0] = 4;
  const fields = ['ttHash', 'ttScore', 'ttDepth', 'ttFlag', 'ttBestMove', 'qHash', 'qScore', 'qDepth', 'qFlag', 'history', 'killerMoves'];
  const buffers = fields.map(field => ai[field]);
  const entries = fields.map((field, i) => ai[field][i < 5 ? ttIndex : i < 9 ? qIndex : i === 9 ? 3 : 0]);
  const state = { bestMove: 0, bestScore: -7, completedDepth: 1, hintMove: 0 };
  scouting = true;
  expect(ai.tryClassicProofScout(position, state, 100, 2)).toBe(false);
  scouting = false;
  fields.forEach((field, i) => expect(ai[field]).toBe(buffers[i]));
  expect(fields.map((field, i) => ai[field][i < 5 ? ttIndex : i < 9 ? qIndex : i === 9 ? 3 : 0])).toEqual(entries);
  const before = ai.nodesVisited;
  expect(ai.search(position, 1, -1_000_000, -999_999, 1)).toBe(bound);
  expect(ai.quiescence(position, -Infinity, Infinity, 0, 0)).toBe(quiet);
  expect(ai.nodesVisited - before).toBe(2); // Both values came directly from their caches.
  expect(ai.timedOut).toBe(false);
  expect(position.encodeGame()).toBe('B9 e5 d5');
});

test('a classic scout restores the playing policy after a search error', () => {
  const position = decodeGame('B9 e5 d5');
  const ai = new GogoAI({ maxDepth: 2, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.configureEvaluation(position, 125);
  const expected = ai.evaluate(position);
  ai.deadline = 1000;
  const prototype = GogoAI.prototype as any;
  const root = prototype.searchRoot;
  prototype.searchRoot = function (...args: any[]) {
    if (!this.shortEvaluation) throw new Error('scout error');
    return root.apply(this, args);
  };
  const state = { bestMove: 0, bestScore: -7, completedDepth: 1, hintMove: 0 };
  ai.ttFlag[7] = ai.qFlag[7] = 1;
  ai.ttBestMove[7] = 40;
  try {
    expect(() => ai.tryEarlyWinProof(position, state, 100, 2, true)).toThrow('scout error');
  } finally { prototype.searchRoot = root; }
  expect(ai.ttFlag[7]).toBe(1);
  expect(ai.qFlag[7]).toBe(1);
  expect(ai.ttBestMove[7]).toBe(40);
  expect(ai.forcingQuiescence).toBe(true);
  expect(ai.evaluate(position)).toBe(expected);
  expect(ai.deadline).toBe(1000);
  expect(position.encodeGame()).toBe('B9 e5 d5');
});

test('a classic scout independently verifies a heuristic mate before replacing the move', () => {
  const position = GogoPosition.fromAscii(['XXXX.....', ...Array(8).fill('.........')], BLACK);
  const before = position.encodeGame();
  const ai = new GogoAI({ maxDepth: 1, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.configureEvaluation(position, 125);
  ai.deadline = 1000;
  const verify = GogoAI.prototype.verifyWinningMove;
  const verified: number[] = [];
  GogoAI.prototype.verifyWinningMove = function (...args: Parameters<typeof verify>) {
    verified.push(args[1]); return verify.apply(this, args);
  };
  const state = { bestMove: 80, bestScore: -7, completedDepth: 0, hintMove: 80 };
  try {
    expect(ai.tryEarlyWinProof(position, state, 100, 1, true)).toBe(true);
  } finally { GogoAI.prototype.verifyWinningMove = verify; }
  expect(state).toMatchObject({ bestMove: 4, provenWin: true });
  expect(verified).toContain(4);
  expect(ai.forcingQuiescence).toBe(true);
  expect(position.encodeGame()).toBe(before);
});
