import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoAI, GogoPosition, decodeGame } from '../../src/engine';

test.each([BLACK, WHITE])('short-budget evaluation scores space and initiative symmetrically (%s)', player => {
  const rows = [...Array(4).fill('.........'), '....X....', ...Array(4).fill('.........')];
  const position = GogoPosition.fromAscii(player === BLACK ? rows : rows.map(row => row.replace('X', 'O')), player);
  const ai = new GogoAI({ maxDepth: 1, quiescenceDepth: 1, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  const normal = ai.evaluate(position);
  ai.configureEvaluation(position, 5);
  // Twenty single-stone windows, center bias nine, and four liberties.
  expect(ai.evaluate(position)).toBeCloseTo(20 * -106 + 9 * 214.8 + 232 + 1135, 8);
  ai.configureEvaluation(position, 100);
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
