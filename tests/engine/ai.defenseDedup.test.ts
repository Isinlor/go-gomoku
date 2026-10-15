import { expect, test } from 'vitest';
import { GogoAI, decodeGame } from '../../src/engine';

test('nested proofs do not erase the parent defense marks', { tags: ['slow'] }, () => {
  const position = decodeGame('B9 e9 e8 f9 g9');
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.resetProofSearch();
  const play = position.play.bind(position);
  const attempts = new Map<string, Set<number>>();
  let duplicates = 0;
  position.play = (move: number) => {
    if (position.toMove === 2 && position.board[move] === 0 && move !== position.koPoint) {
      const key = `${position.hash}:${position.ply}`;
      let seen = attempts.get(key);
      if (!seen) attempts.set(key, seen = new Set());
      if (seen.has(move)) duplicates++;
      seen.add(move);
    }
    return play(move);
  };
  // Each node is visited once at a single depth; transpositions may revisit a
  // position, so reset its observation at the defense recursion boundary.
  const defend = ai.proofDefend.bind(ai);
  ai.proofDefend = (...args: any[]) => {
    attempts.delete(`${args[0].hash}:${args[0].ply}`);
    return defend(...args);
  };
  ai.forcingProofMode = false;
  position.play(69);
  ai.proofDefend(position, 11, 0);
  position.undo();
  expect(duplicates).toBe(0);
  expect(position.encodeGame()).toBe('B9 e9 e8 f9 g9');
});
