import { expect, test } from 'vitest';
import { GogoAI, GogoPosition } from '../../src/engine';

test('deep late scouts save work but verify an improving move at the full horizon', () => {
  const ai = new GogoAI() as any;
  ai.selectiveSearch = true;
  const position = new GogoPosition(9);
  const searches: number[][] = [];
  ai.searchWithNullMove = (_position: GogoPosition, depth: number, alpha: number, beta: number) => {
    searches.push([depth, alpha, beta]);
    return -10;
  };
  expect(ai.searchInteriorChild(position, 9, 0, 20, 1, 12)).toBe(10);
  expect(searches).toEqual([[5, -1, -0], [8, -1, -0], [8, -20, -0]]);
});

test('early discovery iterations retain their conservative scout horizon', () => {
  const ai = new GogoAI() as any;
  ai.selectiveSearch = false;
  const depths: number[] = [];
  ai.searchWithNullMove = (_position: GogoPosition, depth: number) => { depths.push(depth); return 0; };
  ai.searchInteriorChild(new GogoPosition(9), 4, 0, 20, 1, 12);
  expect(depths).toEqual([2]);
});

test.each(['root', 'proof'])('%s searches retain the full horizon for late moves', mode => {
  const ai = new GogoAI() as any;
  ai.proofMode = mode === 'proof';
  const depths: number[] = [];
  ai.searchWithNullMove = (_position: GogoPosition, depth: number) => { depths.push(depth); return 0; };
  const method = mode === 'root' ? 'searchRootChild' : 'searchInteriorChild';
  expect(ai[method](new GogoPosition(9), 9, 0, 20, 1, 12)).toBe(-0);
  expect(depths).toEqual([8]);
});
