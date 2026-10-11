import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoAI, GogoPosition } from '../../src/engine';

test.each([BLACK, WHITE])('proof attacker answers an immediate counter-threat for player %i', player => {
  const rows = ['.XXX.....', '.........', 'OOOO.....', ...Array(6).fill('.........')];
  const position = GogoPosition.fromAscii(player === BLACK ? rows : rows.map(row => row.replace(/[XO]/g, cell => cell === 'X' ? 'O' : 'X')), player);
  const before = position.encodeGame();
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.resetProofSearch();
  const generate = ai.generateOrderedMoves.bind(ai);
  let rootGenerations = 0;
  ai.generateOrderedMoves = (...args: any[]) => {
    if (args[0].hash === position.hash && args[5] === 0) rootGenerations++;
    return generate(...args);
  };
  expect(ai.proofAttack(position, 3, 0)).toBe(false);
  expect(rootGenerations).toBe(0);
  expect(position.encodeGame()).toBe(before);
});

test('proof attacker keeps an immediate counter-win ahead of blocking a threat', () => {
  const position = GogoPosition.fromAscii(['XXXX.....', '.........', 'OOOO.....', ...Array(6).fill('.........')]);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.resetProofSearch();
  const before = position.encodeGame();
  expect(ai.proofAttack(position, 1, 0)).toBe(true);
  expect(position.encodeGame()).toBe(before);
});

test('proof defense tries forcing refutations before scoring every nearby move', () => {
  const position = GogoPosition.fromAscii(['.XX......', '.........', '.OOO.....', ...Array(6).fill('.........')], WHITE);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.resetProofSearch();
  const generate = ai.generateOrderedMoves.bind(ai);
  const rootStages: boolean[] = [];
  ai.generateOrderedMoves = (...args: any[]) => {
    if (args[5] === 0) rootStages.push(args[4]);
    return generate(...args);
  };
  const before = position.encodeGame();
  expect(ai.proofDefend(position, 4, 0)).toBe(false);
  expect(rootStages).toEqual([true]);
  expect(position.encodeGame()).toBe(before);
});
