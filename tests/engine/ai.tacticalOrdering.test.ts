import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

test('a quiet killer stays below a tactical capture in move ordering', () => {
  const position = GogoPosition.fromAscii(['OX.......', '.X.......', ...Array(7).fill('.........')], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  ai.killerMoves[0] = 80;
  expect(ai.scoreMove(position, 9, -1, false)).toBeGreaterThan(ai.scoreMove(position, 80, -1, false));
});
