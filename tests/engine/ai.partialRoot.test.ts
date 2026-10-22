import { expect, test } from 'vitest';
import { GogoAI, decodeGame } from '../../src/engine';

test('a timeout keeps an improved move from completed root children', () => {
  const position = decodeGame('B9 e5 d5');
  const ai = new GogoAI({ now: () => 0 }) as any;
  const searchChild = ai.searchChild.bind(ai);
  const searched: { move: number; score: number }[] = [];
  ai.searchChild = (...args: any[]) => {
    if (args[6] && searched.length === 2) throw ai.timeoutSignal;
    const score = searchChild(...args);
    if (args[6]) searched.push({ move: position.lastMove, score });
    return score;
  };
  const best = () => searched.reduce((best, next) => next.score > best.score ? next : best);
  const result = ai.findBestMove(position, 15);
  expect(result.move).toBe(best().move);
  expect(result.score).toBe(best().score);
  expect(result.timedOut).toBe(true);
  expect(result.forcedLoss).toBe(false);
  expect(position.encodeGame()).toBe('B9 e5 d5');
});

test('a partial deeper iteration compares completed children at the same horizon even when scores fall', () => {
  const position = decodeGame('B9 e5 d5');
  const ai = new GogoAI({ now: () => 0, quiescenceDepth: 0 }) as any;
  const searchChild = ai.searchRootChild.bind(ai);
  const deeper: { move: number; score: number }[] = [];
  ai.searchRootChild = (...args: any[]) => {
    if (args[1] === 2 && deeper.length === 3) throw ai.timeoutSignal;
    const score = searchChild(...args);
    if (args[1] === 2) deeper.push({ move: position.lastMove, score });
    return score;
  };
  const result = ai.findBestMove(position, 5);
  const best = deeper.reduce((best, next) => next.score > best.score ? next : best);
  expect(result).toMatchObject({ move: best.move, score: best.score, depth: 2, timedOut: true });
  expect(result.heuristicLoss).toBe(false);
  expect(position.encodeGame()).toBe('B9 e5 d5');
});

test('the preceding leader is searched first even when history gives another move a larger score', () => {
  const position = decodeGame('B9 e5 d5');
  const ai = new GogoAI({ now: () => 0, quiescenceDepth: 0, maxPly: 2 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.history[31] = 20_000_000;
  const child = ai.searchRootChild.bind(ai);
  const searched: number[] = [];
  ai.searchRootChild = (...args: any[]) => { searched.push(position.lastMove); return child(...args); };
  ai.searchRoot(position, 1, 30);
  expect(searched[0]).toBe(30);
  expect(position.encodeGame()).toBe('B9 e5 d5');
});
