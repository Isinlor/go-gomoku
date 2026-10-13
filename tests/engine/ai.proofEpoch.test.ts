import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

function setup() {
  const ai = new GogoAI({ now: () => 0 }) as any;
  const position = GogoPosition.fromAscii([
    '.XXX.....', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.resetProofSearch();
  return { ai, position };
}

test('proof reset invalidates entries by generation without clearing large hash arrays', () => {
  const { ai, position } = setup();
  expect(ai.proofAttack(position, 3, 0)).toBe(true);
  const index = Number(position.hash & 0x3ffffn);
  const generation = ai.proofGeneration;
  expect(ai.proofTTGeneration[index]).toBe(generation);
  ai.resetProofSearch();
  expect(ai.proofTTHash[index]).toBe(position.hash);
  expect(ai.proofGeneration).toBe(generation + 1);
  // The same side-to-move position now has the opposite proof role. A stale
  // attacker win must not become a false defender proof after the reset.
  expect(ai.proofDefend(position, 3, 0)).toBe(false);
});

test('generation rollover clears tags and prevents old entries from becoming valid again', () => {
  const { ai } = setup();
  ai.proofTTGeneration.fill(1);
  ai.proofGeneration = 0xffffffff;
  ai.resetProofSearch();
  expect(ai.proofGeneration).toBe(1);
  expect(ai.proofTTGeneration.every(value => value === 0)).toBe(true);
});
