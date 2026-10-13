import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

test.each([1, 6])('a winning quiescence continuation is verified without extra root iterations (maxDepth %s)', maxDepth => {
  const position = GogoPosition.fromAscii([
    '.XXX.....', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI({ maxDepth, quiescenceDepth: 4, now: () => 0 }) as any;
  const search = ai.searchRoot.bind(ai);
  const depths: number[] = [];
  ai.searchRoot = (...args: any[]) => { depths.push(args[1]); return search(...args); };
  const result = ai.findBestMove(position, 75);
  expect(depths).toEqual([1]);
  expect(result.move).toBe(4);
  expect(result.score).toBe(1_000_000_000 - 3);
  expect(result.depth).toBe(maxDepth === 1 ? 1 : 3);
  expect(result.forcedWin).toBe(true);
  expect(result.heuristicWin).toBe(maxDepth === 1);
});
