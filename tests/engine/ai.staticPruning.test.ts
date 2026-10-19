import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

function setup(rows: string[], player = BLACK) {
  const position = GogoPosition.fromAscii(rows, player);
  const ai = new GogoAI({ now: () => 0, quiescenceDepth: 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.selectiveSearch = true;
  return { ai, position };
}

test.each([1, 2000])('a large quiet static advantage avoids a shallow subtree with window width %s', width => {
  const { ai, position } = setup(['XX.......', ...Array(8).fill('.........')]);
  expect(ai.search(position, 2, -1000 - width, -1000, 0)).toBe(-1000);
  expect(ai.nodesVisited).toBe(1);
  expect(ai.ttFlag[Number(position.hash & 262143n)]).toBe(2);
  expect(position.ply).toBe(0);
});

test.each(['proof', 'mate window', 'own win', 'opponent threat', 'early iteration'])('static pruning is excluded for %s', mode => {
  const row = mode === 'own win' ? 'XXXX.....' : mode === 'opponent threat' ? 'OOOO.....' : 'XX.......';
  const { ai, position } = setup([row, ...Array(8).fill('.........')]);
  ai.proofMode = mode === 'proof';
  if (mode === 'early iteration') ai.selectiveSearch = false;
  const beta = mode === 'mate window' ? -999_999_999 : mode === 'opponent threat' ? -600_000 : -1000;
  ai.search(position, 2, beta - 1, beta, 0);
  expect(ai.nodesVisited).toBeGreaterThan(1);
  expect(position.ply).toBe(0);
});
