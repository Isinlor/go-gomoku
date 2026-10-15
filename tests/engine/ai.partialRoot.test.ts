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
