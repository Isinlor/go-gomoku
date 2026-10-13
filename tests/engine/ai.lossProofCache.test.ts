import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

test('loss verification clears its proof table once while checking every legal defense', () => {
  const position = GogoPosition.fromAscii([
    '.........', '.........', '.........', '.........', '.OOOO....',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const encoded = position.encodeGame();
  const ai = new GogoAI({ quiescenceDepth: 0, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  const reset = ai.resetProofSearch.bind(ai);
  let resets = 0;
  ai.resetProofSearch = () => { resets++; reset(); };
  const searchRoot = ai.searchRoot.bind(ai);
  const hints: number[] = [];
  ai.searchRoot = (...args: any[]) => { hints.push(args[2]); return searchRoot(...args); };
  const play = position.play.bind(position);
  const defenses = new Set<number>();
  position.play = move => {
    if (position.ply === 0) defenses.add(move);
    return play(move);
  };
  expect(ai.proofSearchRoot(position, 2, -1)).toBe(-1_000_000_000 + 2);
  expect(defenses.size).toBe(77);
  expect(resets).toBe(1);
  expect(hints).toHaveLength(2);
  expect(hints[0]).toBe(-1);
  expect(hints.slice(1).every(hint => hint >= 0)).toBe(true);
  expect(position.encodeGame()).toBe(encoded);
  expect(ai.lossProofMode).toBe(false);
});

test('a legal previous reply that is not an immediate win falls back to independent discovery', () => {
  const position = GogoPosition.fromAscii([
    '.........', '.........', '.OOO.....', '.........', '.........',
    '.........', '.OOO.....', '.........', '.........',
  ], BLACK);
  const board = position.toAscii(), hash = position.hash;
  const ai = new GogoAI({ quiescenceDepth: 4, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  expect(ai.proofSearchRoot(position, 4, -1)).toBe(-1_000_000_000 + 4);
  expect(position.toAscii()).toEqual(board);
  expect(position.hash).toBe(hash);
  expect(position.ply).toBe(0);
});
