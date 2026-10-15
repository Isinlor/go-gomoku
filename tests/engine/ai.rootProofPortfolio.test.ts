import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

function makePortfolioSearch(now: () => number = () => 0) {
  const position = GogoPosition.fromAscii(['.........', ...Array(8).fill('.........')], BLACK);
  const ai = new GogoAI({ now, maxDepth: 13 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = 10_000;
  ai.searchRoot = (_position: unknown, depth: number) => ({ move: 0, score: 0, depth, nodes: 1 });
  ai.rootProofCount = 2;
  ai.rootProofMoves.set([10, 11]);
  return { ai, position };
}

test('deep discovery verifies ranked root candidates and accepts a proof', () => {
  const { ai, position } = makePortfolioSearch();
  const attempted: number[] = [];
  ai.tryEarlyWinProof = (_position: unknown, state: { bestMove: number; hintMove: number; provenWin?: boolean }, limit: number) => {
    attempted.push(state.bestMove);
    expect(limit).toBe(8_000_000);
    if (state.bestMove !== 11) return false;
    state.provenWin = true;
    return true;
  };
  const state = { bestMove: -1, bestScore: 0, completedDepth: 0, hintMove: -1 };
  ai.searchDepths(position, 1, state, 13, true);
  expect(attempted).toEqual([10, 11]);
  expect(state.provenWin).toBe(true);
  expect(state.bestMove).toBe(11);
});

test('deep discovery preserves its result when candidate proofs fail', () => {
  const { ai, position } = makePortfolioSearch();
  let attempts = 0;
  ai.tryEarlyWinProof = () => { attempts += 1; return false; };
  const state = { bestMove: -1, bestScore: 0, completedDepth: 0, hintMove: -1 };
  ai.searchDepths(position, 1, state, 13, true);
  expect(attempts).toBe(2);
  expect(state.provenWin).toBeUndefined();
  expect(state.completedDepth).toBe(13);
});

test('candidate proof portfolio stops when less than its time reserve remains', () => {
  let calls = 0;
  const { ai, position } = makePortfolioSearch(() => calls++ === 0 ? 0 : 1);
  let attempts = 0;
  ai.tryEarlyWinProof = () => { attempts += 1; return false; };
  const state = { bestMove: -1, bestScore: 0, completedDepth: 0, hintMove: -1 };
  ai.searchDepths(position, 1, state, 13, true);
  expect(attempts).toBe(0);
  expect(state.completedDepth).toBe(13);
});
