import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoAI, GogoPosition } from '../../src/engine';

function setup(rows: string[], player: typeof BLACK | typeof WHITE) {
  const position = GogoPosition.fromAscii(rows, player);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.resetProofSearch();
  const play = position.play.bind(position);
  const attempts: number[] = [];
  position.play = (move: number) => { attempts.push(move); return play(move); };
  return { ai, position, attempts };
}

test('an immediate attacking win precedes a quiet transposition hint', () => {
  const { ai, position, attempts } = setup(['XXXX.....', ...Array(8).fill('.........')], BLACK);
  const index = Number(position.hash & 262143n);
  ai.ttHash[index] = position.hash;
  ai.ttBestMove[index] = 80;
  expect(ai.proofAttack(position, 3, 0)).toBe(true);
  expect(attempts).toEqual([]);
  expect(ai.proofTTBestMove[index]).toBe(4);
  expect(position.ply).toBe(0);
});

