import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoAI, GogoPosition, computeZobristHashes } from '../../src/engine';

test.each([BLACK, WHITE])('refutes a one-turn attack without playing defenses when no four exists (%s)', attacker => {
  const stone = attacker === BLACK ? 'X' : 'O';
  const position = GogoPosition.fromAscii([`.${stone.repeat(3)}.....`, ...Array(8).fill('.........')], attacker === BLACK ? WHITE : BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.reuseProofCache = true;
  const play = position.play.bind(position);
  let defenses = 0;
  position.play = (move: number) => { defenses++; return play(move); };
  const before = position.toAscii();
  for (const depth of [2, 3]) {
    expect(ai.proofDefend(position, depth, 0)).toBe(false);
  }
  expect(defenses).toBe(0);
  expect(position.toAscii()).toEqual(before);
});

test.each(['longer horizon', 'ko', 'independent proof'])('preserves ordinary defense search for %s', mode => {
  const position = GogoPosition.fromAscii(['.XXX.....', ...Array(8).fill('.........')], WHITE);
  if (mode === 'ko') {
    position.koPoint = 0;
    position.hash = computeZobristHashes(position);
  }
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.reuseProofCache = mode !== 'independent proof';
  const play = position.play.bind(position);
  let defenses = 0;
  position.play = (move: number) => { defenses++; return play(move); };
  expect(ai.proofDefend(position, mode === 'longer horizon' ? 4 : 2, 0)).toBe(false);
  expect(defenses).toBeGreaterThan(0);
  expect(position.ply).toBe(0);
});

test.each([false, true])('an existing four still checks blocks and counter-wins (%s)', counterWin => {
  const position = GogoPosition.fromAscii([
    '.XXXX....', ...Array(7).fill('.........'), counterWin ? 'OOOO.....' : '.........',
  ], WHITE);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.reuseProofCache = true;
  const before = position.toAscii();
  expect(ai.proofDefend(position, 2, 0)).toBe(!counterWin);
  expect(position.toAscii()).toEqual(before);
});
