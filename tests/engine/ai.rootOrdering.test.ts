import { expect, test } from 'vitest';
import { GogoAI, decodeGame } from '../../src/engine';

test('deeper root iterations use searched scores to order moves, rather than static pattern scores', () => {
  const position = decodeGame('B9 e5 d5');
  const ai = new GogoAI({ maxPly: 2, quiescenceDepth: 0, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  const shallowScores = new Map<number, number>();
  const search = ai.search.bind(ai);
  ai.search = (...args: any[]) => {
    const score = search(...args);
    if (args[4] === 1) shallowScores.set(position.lastMove, -score);
    return score;
  };
  const first = ai.searchRoot(position, 1, -1);
  ai.search = search;
  const play = position.play.bind(position);
  const rootMoves: number[] = [];
  const rootPly = position.ply;
  position.play = move => {
    if (position.ply === rootPly) rootMoves.push(move);
    return play(move);
  };
  ai.searchRoot(position, 2, first.move);
  const scores = rootMoves.map(move => shallowScores.get(move)!);
  expect(scores).toEqual([...scores].sort((a, b) => b - a));
  expect(position.encodeGame()).toBe('B9 e5 d5');
});
