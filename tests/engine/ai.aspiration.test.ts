import { expect, test } from 'vitest';
import { GogoAI, decodeGame } from '../../src/engine';

test.each([0, 10000, -10000])('bounded root windows preserve full search results and retry failed bounds (%s)', previousScore => {
  const position = decodeGame('B9 e5 d5');
  const ai = new GogoAI({ maxDepth: 3, maxPly: 2, quiescenceDepth: 0, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.useAspiration = true;
  const oracle = new GogoAI({ maxPly: 2, quiescenceDepth: 0, now: () => 0 }) as any;
  oracle.ensureBuffers(position.area);
  oracle.deadline = Infinity;
  const expected = oracle.searchRoot(position, 3, -1);
  const root = ai.searchRoot.bind(ai);
  const windows: number[][] = [];
  ai.searchRoot = (...args: any[]) => { windows.push(args.slice(3)); return root(...args); };
  const state = { bestMove: 40, bestScore: previousScore, completedDepth: 2, hintMove: -1 };
  ai.searchDepths(position, 3, state, 3);
  expect(state.bestScore).toBeCloseTo(expected.score, 10);
  expect(windows[0]).toEqual([previousScore - 2000, previousScore + 2000]);
  expect(windows).toHaveLength(previousScore === 0 ? 1 : 2);
  if (previousScore !== 0) expect(windows[1]).toEqual([]);
  expect(position.encodeGame()).toBe('B9 e5 d5');
});
