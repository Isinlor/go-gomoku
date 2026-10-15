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
    expect(limit).toBe(state.bestMove === 10 ? 8_000_000 : 4_000_000);
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
  expect(attempts).toBe(3);
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

test('the portfolio preserves the leader budget and bounds alternatives before retries', () => {
  const { ai, position } = makePortfolioSearch();
  const attempted: [number, number][] = [];
  ai.tryEarlyWinProof = (_position: unknown, state: { bestMove: number; provenWin?: boolean }, limit: number) => {
    attempted.push([state.bestMove, limit]);
    if (state.bestMove !== 11 || limit !== 8_000_000) return false;
    state.provenWin = true;
    return true;
  };
  const state = { bestMove: -1, bestScore: 0, completedDepth: 0, hintMove: -1 };
  ai.searchDepths(position, 1, state, 13, true);
  expect(attempted).toEqual([[10, 8_000_000], [11, 4_000_000], [11, 8_000_000]]);
  expect(state.provenWin).toBe(true);
  expect(state.bestMove).toBe(11);
});

test('an unstable discovery leader shares the bounded first pass with alternatives', () => {
  const { ai, position } = makePortfolioSearch();
  ai.searchRoot = (_position: unknown, depth: number) => ({ move: depth, score: 0, depth, nodes: 1 });
  const attempted: [number, number][] = [];
  ai.tryEarlyWinProof = (_position: unknown, state: { bestMove: number; provenWin?: boolean }, limit: number) => {
    attempted.push([state.bestMove, limit]);
    if (limit !== 8_000_000) return false;
    state.provenWin = true;
    return true;
  };
  const state = { bestMove: -1, bestScore: 0, completedDepth: 0, hintMove: -1 };
  ai.searchDepths(position, 1, state, 13, true);
  expect(attempted).toEqual([[10, 4_000_000], [11, 4_000_000], [10, 8_000_000]]);
  expect(state.provenWin).toBe(true);
});
