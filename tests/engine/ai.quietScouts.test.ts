import { expect, test } from 'vitest';
import { GogoAI, decodeGame } from '../../src/engine';

test.each(['scout', 'full window', 'proof', 'early iteration'])('shallow %s searches preserve tactical work while limiting quiet scout tails', mode => {
  const position = decodeGame('B9 a7 i8 b6');
  const ai = new GogoAI({ now: () => 0, quiescenceDepth: 0, maxPly: 2 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.proofMode = mode === 'proof';
  ai.selectiveSearch = mode !== 'early iteration';
  const hash = position.hash;
  const play = position.play.bind(position);
  let rootMoves = 0;
  position.play = (move: number) => { if (position.hash === hash) rootMoves++; return play(move); };
  const beta = mode === 'full window' ? 2_000_000 : 1_000_001;
  expect(ai.search(position, 1, 1_000_000, beta, 0)).toBeLessThan(1_000_000);
  if (mode === 'scout') expect(rootMoves).toBe(4);
  else expect(rootMoves).toBeGreaterThan(4);
  expect(position.encodeGame()).toBe('B9 a7 i8 b6');
  expect(ai.ttFlag[Number(hash & 262143n)]).toBe(mode === 'proof' ? 3 : 0);
});
