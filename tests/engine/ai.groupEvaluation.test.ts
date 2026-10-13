import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoAI, GogoPosition } from '../../src/engine';

test.each([BLACK, WHITE])('a healthy connected edge group is evaluated using shared liberties (%s)', player => {
  const position = GogoPosition.fromAscii([
    'XXX......', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], player);
  expect(position.scanGroup(0, BLACK)).toBe(4);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const score = ai.evaluate(position);
  expect(player === BLACK ? score : -score).toBeGreaterThan(500);
});
