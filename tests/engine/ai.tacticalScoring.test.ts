import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoAI, GogoPosition } from '../../src/engine';

test.each([BLACK, WHITE])('attacking generation scores its candidates without preparing every point (%s)', player => {
  const position = GogoPosition.fromAscii(['.XXX.....', '.........', '..OO.....', ...Array(6).fill('.........')], player);
  const ai = new GogoAI() as any;
  const oracle = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  oracle.ensureBuffers(position.area);
  const count = ai.generateTacticalMoves(position, ai.moveBuffers[0], ai.scoreBuffers[0], -1, 0, true, 2);
  expect(count).toBeGreaterThan(0);
  expect(ai.patternsReady).toBe(false);
  for (let index = 0; index < count; index++) {
    expect(ai.scoreBuffers[0][index]).toBe(oracle.scoreMove(position, ai.moveBuffers[0][index], -1, false));
  }
});

test('direct liberties exclude safe isolated groups without a flood fill', () => {
  const position = GogoPosition.fromAscii(['.........', '..X......', '.........', '......O..', ...Array(5).fill('.........')], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const scan = position.scanGroup.bind(position);
  let scans = 0;
  position.scanGroup = (...args) => { scans++; return scan(...args); };
  ai.generateOrderedMoves(position, ai.moveBuffers[0], ai.scoreBuffers[0], -1, false);
  ai.generateOrderedMoves(position, ai.moveBuffers[0], ai.scoreBuffers[0], -1, true);
  expect(scans).toBe(0);
});
