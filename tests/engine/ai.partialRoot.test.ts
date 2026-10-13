import { expect, test } from 'vitest';
import { GogoAI, decodeGame } from '../../src/engine';

test.each([false, true])('a timeout retains fully searched root improvements with aspiration %s', aspiration => {
  const position = decodeGame(aspiration ? 'B9 e5 d5' : 'B9 f6 e6 d3 c5 f3 f5 e3 c3');
  const ai = new GogoAI({ maxPly: 2, quiescenceDepth: 0, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  const first = ai.searchRoot(position, 1, -1);
  const state = { bestMove: first.move, bestScore: first.score, completedDepth: 1, hintMove: first.move };
  ai.useAspiration = aspiration;
  const rootPly = position.ply;
  const encoded = position.encodeGame();
  const play = position.play.bind(position);
  let rootMoves = 0;
  position.play = move => {
    if (position.ply === rootPly && rootMoves++ === 3) throw ai.timeoutSignal;
    return play(move);
  };
  const search = ai.search.bind(ai);
  let bestMove = -1, bestScore = -Infinity;
  ai.search = (...args: any[]) => {
    const score = search(...args);
    if (args[4] === 1 && args[3] - args[2] > 1 && -score > bestScore) {
      bestMove = position.lastMove;
      bestScore = -score;
    }
    return score;
  };
  const depth = aspiration ? 3 : 2;
  ai.searchDepths(position, depth, state, depth);
  expect(state.bestMove).toBe(bestMove);
  expect(state.bestScore).toBe(bestScore);
  expect(state.completedDepth).toBe(1);
  expect(state).toHaveProperty('partial', true);
  expect(ai.timedOut).toBe(true);
  expect(position.encodeGame()).toBe(encoded);
});
