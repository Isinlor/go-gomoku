import { expect, test } from 'vitest';
import { AI_CONFIG, GogoAI } from '../../src/engine';

test('the public AI config preserves the deployed search limits outside the UI', () => {
  expect(AI_CONFIG).toEqual({ maxDepth: 30, quiescenceDepth: 4, maxPly: 96 });
  const ai = new GogoAI(AI_CONFIG);
  for (const key of ['maxDepth', 'quiescenceDepth', 'maxPly'] as const) expect(ai[key]).toBe(AI_CONFIG[key]);
  expect(Object.isFrozen(AI_CONFIG)).toBe(true);
});
