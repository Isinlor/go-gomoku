import { expect, test } from 'vitest';
import { GogoAI, PUZZLES, decodeGame, decodeMove } from '../../src/engine';

test('recursive proofs never retry a legal defense in the same defender node', { timeout: 5000 }, () => {
  const puzzle = PUZZLES.find(p => p.id === 'gen-unblockable-gap')!;
  const position = decodeGame(puzzle.encoded);
  const ai = new GogoAI({ now: () => 0 }) as any;
  const defend = ai.proofDefend.bind(ai);
  const play = position.play.bind(position);
  const frames: { hash: bigint; moves: Set<number> }[] = [];
  let repeated = 0;
  ai.proofDefend = (...args: any[]) => {
    frames.push({ hash: position.hash, moves: new Set() });
    try { return defend(...args); } finally { frames.pop(); }
  };
  position.play = (move: number) => {
    const frame = frames.at(-1);
    const defense = frame?.hash === position.hash;
    const legal = play(move);
    if (defense && legal) {
      if (frame!.moves.has(move)) repeated++;
      frame!.moves.add(move);
    }
    return legal;
  };
  expect(ai.verifyWinningMove(position, decodeMove(puzzle.solution, position.size), 20000, 9)).toBe(true);
  expect(repeated).toBe(0);
  expect(position.encodeGame()).toBe(puzzle.encoded);
});
