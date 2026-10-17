import { expect, test } from 'vitest';
import { GogoAI, decodeGame } from '../../src/engine';

test('leaf evaluation leaves move-ordering patterns deferred across make and undo', () => {
  const position = decodeGame('B9 e5 d4 f5 d5');
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const initial = ai.evaluate(position);
  expect(ai.patternsReady).toBe(false);
  expect(position.playXY(6, 4)).toBe(true);
  const child = ai.evaluate(position);
  expect(child).not.toBe(initial);
  expect(ai.patternsReady).toBe(false);
  ai.beginPatternPass(position);
  expect(ai.evaluate(position)).toBe(child);
  position.undo();
  expect(ai.evaluate(position)).toBe(initial);
  ai.beginPatternPass(position);
  expect(ai.evaluate(position)).toBe(initial);
});
