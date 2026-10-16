import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

test('a quiet-candidate batch reuses full proof facts without changing the position or verdict', () => {
  const position = GogoPosition.fromAscii(['.XXX.....', ...Array(8).fill('.........')], BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.resetProofSearch();
  ai.reuseProofCache = true;
  const before = position.toAscii();
  expect(ai.verifyWinningMove(position, 4, 1000, 3)).toBe(true);
  const firstNodes = ai.nodesVisited;
  expect(ai.verifyWinningMove(position, 4, 1000, 3)).toBe(true);
  expect(ai.nodesVisited).toBeLessThan(firstNodes);
  // Another candidate must not inherit the first candidate's winning verdict.
  expect(ai.verifyWinningMove(position, 0, 1000, 3)).toBe(false);
  expect(ai.forcingProofMode).toBe(false);
  expect(position.toAscii()).toEqual(before);
  expect(position.ply).toBe(0);
});
