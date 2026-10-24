import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoAI, GogoPosition } from '../../src/engine';

test.each([BLACK, WHITE])('winning continuations teach shared proof attack ordering (%s)', player => {
  const stone = player === BLACK ? 'X' : 'O';
  const position = GogoPosition.fromAscii(['.' + stone.repeat(3) + '.....', ...Array(8).fill('.........')], player);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.reuseProofCache = true;
  expect(ai.proofAttack(position, 5, 0)).toBe(true);
  expect(ai.history[(player - 1) * position.area + 4]).toBeGreaterThan(0);
  expect(position.ply).toBe(0);
});

test('repeated and deep proof rewards stay bounded in the integer history table', () => {
  const position = new GogoPosition(9);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  ai.reuseProofCache = true;
  for (let index = 0; index < 1000; index++) ai.rewardProofAttack(position, 40, 12);
  expect(ai.history[40]).toBeGreaterThan(0);
  expect(ai.history[40]).toBeLessThanOrEqual(16384);
  ai.rewardProofAttack(position, 40, 1000);
  expect(ai.history[40]).toBe(16384);
});

test('broadening proof rules resets ordering rewards from the restricted forcing search', () => {
  const position = new GogoPosition(9);
  const ai = new GogoAI({ now: () => 0, maxDepth: 3 }) as any;
  const defend = ai.proofDefend.bind(ai);
  const broadHistory: number[] = [];
  ai.proofDefend = (...args: any[]) => {
    if (ai.forcingProofMode) ai.history[0] = 7;
    else broadHistory.push(ai.history[0]);
    return defend(...args);
  };
  expect(ai.verifyWinningMove(position, 40, 1000, 3)).toBe(false);
  expect(broadHistory[0]).toBe(0);
  expect(position.ply).toBe(0);
});

test('independent proofs preserve discovery history rather than learning across candidates', () => {
  const position = GogoPosition.fromAscii(['.XXX.....', ...Array(8).fill('.........')], BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  expect(ai.proofAttack(position, 5, 0)).toBe(true);
  expect(ai.history.every((value: number) => value === 0)).toBe(true);
});
