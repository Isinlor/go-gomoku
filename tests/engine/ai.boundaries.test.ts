import { expect, test } from 'vitest';
import { GogoAI, GogoPosition, BLACK } from '../../src/engine';

test.each([1, 3, 7])('outcome score cutoffs include equality at depth %s', depth => {
  const ai = new GogoAI() as any;
  const win = 1_000_000_000 - depth;
  const loss = -1_000_000_000 + depth;
  expect([win - 1, win, win + 1].map(score => ai.isForcedWinScore(score, depth))).toEqual([false, true, true]);
  expect([loss - 1, loss, loss + 1].map(score => ai.isForcedLossScore(score, depth))).toEqual([true, true, false]);
});

test.each([-1, 0, 1])('mate score normalization changes exactly at its cutoff (%s)', offset => {
  const ai = new GogoAI({ maxPly: 8 }) as any;
  const win = 1_000_000_000 - 8 + offset;
  const loss = -win;
  expect(ai.adjustMateScore(win, 3)).toBe(offset >= 0 ? win + 3 : win);
  expect(ai.adjustMateScore(loss, 3)).toBe(offset >= 0 ? loss - 3 : loss);
  expect(ai.adjustMateScore(win, -3)).toBe(offset >= 0 ? win - 3 : win);
  expect(ai.adjustMateScore(loss, -3)).toBe(offset >= 0 ? loss + 3 : loss);
});

test.each([0, 1, 2, 3])('constructor clamps only values below each lower bound (%s)', value => {
  const ai = new GogoAI({ maxPly: value, maxDepth: value, quiescenceDepth: value - 1 });
  expect(ai.maxPly).toBe(Math.max(2, value));
  expect(ai.maxDepth).toBe(Math.max(1, value));
  expect(ai.quiescenceDepth).toBe(Math.max(0, value - 1));
});

test.each([11, 12, 13])('heuristic candidate cap suppresses exact TT entries only above twelve moves (%s)', count => {
  const pos = GogoPosition.fromAscii([
    '.........', '.........', '.X..O....', '.........', '....X....',
    '.........', '.O..X....', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI({ maxPly: 2, quiescenceDepth: 0, now: () => 0 }) as any;
  ai.ensureBuffers(pos.area);
  ai.deadline = Infinity;
  const generate = ai.generateOrderedMoves.bind(ai);
  // Restrict only the root candidate list, preserving real scores and legal play.
  ai.generateOrderedMoves = (...args: any[]) => Math.min(count, generate(...args));
  const hash = pos.hash;
  const before = pos.toAscii();
  const index = Number(hash & 0x3ffffn);
  expect(Number.isFinite(ai.search(pos, 2, -Infinity, Infinity, 1))).toBe(true);
  expect(ai.ttFlag[index]).toBe(count > 12 ? 0 : 1);
  expect(pos.hash).toBe(hash);
  expect(pos.toAscii()).toEqual(before);
});
