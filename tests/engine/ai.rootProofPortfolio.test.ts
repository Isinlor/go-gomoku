import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

function makePortfolioSearch(now: () => number = () => 0) {
  const position = GogoPosition.fromAscii(['.........', ...Array(8).fill('.........')], BLACK);
  const ai = new GogoAI({ now, maxDepth: 13 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = 10_000;
  ai.searchRoot = (_position: unknown, depth: number) => ({ move: depth, score: 0, depth, nodes: 1 });
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

test('an admitted proof portfolio has its own finite work allowance inside a scout', () => {
  const position = GogoPosition.fromAscii(['.XXXX....', ...Array(8).fill('.........')], BLACK);
  const before = position.toAscii();
  const ai = new GogoAI({ maxDepth: 13, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = 10_000;
  ai.proofNodeLimit = 1;
  ai.rootProofCount = 1;
  ai.rootProofMoves[0] = 0;
  const state = { bestMove: 0, bestScore: 0, completedDepth: 5, hintMove: 0 };
  expect(ai.tryRootProofPortfolio(position, state, true)).toBe(true);
  expect(state).toMatchObject({ provenWin: true });
  expect(ai.proofNodeLimit).toBeGreaterThan(ai.nodesVisited);
  expect(Number.isFinite(ai.proofNodeLimit)).toBe(true);
  expect(position.toAscii()).toEqual(before);
  expect(position.ply).toBe(0);
  expect(position.play(state.bestMove)).toBe(true);
  expect(position.winner).toBe(BLACK);
  position.undo();
});

test('deep discovery preserves its result when candidate proofs fail', () => {
  const { ai, position } = makePortfolioSearch();
  let attempts = 0;
  ai.tryEarlyWinProof = () => { attempts += 1; return false; };
  const state = { bestMove: -1, bestScore: 0, completedDepth: 0, hintMove: -1 };
  ai.searchDepths(position, 1, state, 13, true);
  expect(attempts).toBe(14);
  expect(state.provenWin).toBeUndefined();
  expect(state.completedDepth).toBe(13);
});

test('candidate proof portfolio stops at the overall search deadline', () => {
  let calls = 0;
  const { ai, position } = makePortfolioSearch(() => calls++ === 0 ? 0 : 10_000);
  let attempts = 0;
  ai.tryEarlyWinProof = () => { attempts += 1; return false; };
  const state = { bestMove: -1, bestScore: 0, completedDepth: 0, hintMove: -1 };
  ai.searchDepths(position, 1, state, 13, true);
  expect(attempts).toBe(0);
  expect(state.completedDepth).toBe(13);
});

test('candidate rounds deepen through the configured horizon with bounded work', () => {
  const { ai, position } = makePortfolioSearch();
  const attempted: [number, number][] = [];
  ai.tryEarlyWinProof = (_position: unknown, state: { bestMove: number; provenWin?: boolean }, limit: number, depth: number) => {
    expect(limit).toBe(8_000_000);
    attempted.push([state.bestMove, depth]);
    if (state.bestMove !== 11 || depth !== 13) return false;
    state.provenWin = true;
    return true;
  };
  const state = { bestMove: -1, bestScore: 0, completedDepth: 0, hintMove: -1 };
  ai.searchDepths(position, 1, state, 13, true);
  expect(attempted).toEqual([1, 3, 5, 7, 9, 11, 13].flatMap(depth => [[10, depth], [11, depth]]));
  expect(state.provenWin).toBe(true);
  expect(state.bestMove).toBe(11);
});

test('an even maximum depth is included without exceeding the configured horizon', () => {
  const { position } = makePortfolioSearch();
  const ai = new GogoAI({ now: () => 0, maxDepth: 14 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = 10_000;
  ai.rootProofCount = 1;
  ai.rootProofMoves[0] = 10;
  const depths: number[] = [];
  ai.tryEarlyWinProof = (_position: unknown, _state: unknown, _limit: number, depth: number) => { depths.push(depth); return false; };
  const state = { bestMove: 0, bestScore: 0, completedDepth: 5, hintMove: 0 };
  expect(ai.tryRootProofPortfolio(position, state, false)).toBe(false);
  expect(depths).toEqual([1, 3, 5, 7, 9, 11, 13, 14]);
});

test('the shared proof-cache scope is restored when a candidate raises an unexpected error', () => {
  const { ai, position } = makePortfolioSearch();
  ai.tryEarlyWinProof = () => {
    expect(ai.reuseProofCache).toBe(true);
    throw new Error('candidate error');
  };
  const state = { bestMove: -1, bestScore: 0, completedDepth: 0, hintMove: -1 };
  expect(() => ai.searchDepths(position, 1, state, 13, true)).toThrow('candidate error');
  expect(ai.reuseProofCache).toBe(false);
});

test('starting a shared proof batch preserves discovery history and killer ordering', () => {
  const { ai, position } = makePortfolioSearch();
  ai.history.fill(7);
  ai.killerMoves.fill(40);
  ai.tryEarlyWinProof = () => false;
  const state = { bestMove: -1, bestScore: 0, completedDepth: 0, hintMove: -1 };
  ai.searchDepths(position, 1, state, 13, true);
  expect(Array.from(ai.history)).toEqual(Array(position.area * 2).fill(7));
  expect(Array.from(ai.killerMoves)).toEqual(Array((ai.maxPly + 1) * 2).fill(40));
  expect(ai.reuseProofCache).toBe(false);
});

test('the portfolio checks every candidate at a shallow horizon before deepening', () => {
  const { ai, position } = makePortfolioSearch();
  const attempted: [number, number][] = [];
  ai.tryEarlyWinProof = (_position: unknown, state: { bestMove: number; provenWin?: boolean }, _limit: number, depth: number) => {
    attempted.push([state.bestMove, depth]);
    if (state.bestMove !== 11 || depth !== 3) return false;
    state.provenWin = true;
    return true;
  };
  const state = { bestMove: -1, bestScore: 0, completedDepth: 0, hintMove: -1 };
  ai.searchDepths(position, 1, state, 13, true);
  expect(attempted).toEqual([[10, 1], [11, 1], [10, 3], [11, 3]]);
  expect(state.provenWin).toBe(true);
});

test('deepening prioritizes candidates with cheaper measured proof work', () => {
  const { ai, position } = makePortfolioSearch();
  ai.searchRoot = (_position: unknown, depth: number) => ({ move: depth, score: 0, depth, nodes: 1 });
  const attempted: [number, number][] = [];
  ai.tryEarlyWinProof = (_position: unknown, state: { bestMove: number; provenWin?: boolean }, _limit: number, depth: number) => {
    attempted.push([state.bestMove, depth]);
    ai.nodesVisited += state.bestMove === 10 ? 100 : 10;
    if (depth !== 3) return false;
    state.provenWin = true;
    return true;
  };
  const state = { bestMove: -1, bestScore: 0, completedDepth: 0, hintMove: -1 };
  ai.searchDepths(position, 1, state, 13, true);
  expect(attempted).toEqual([[10, 1], [11, 1], [11, 3]]);
  expect(state.bestMove).toBe(11);
});

test('a stable discovery leader gets a full proof before scheduling alternatives', () => {
  const { ai, position } = makePortfolioSearch();
  ai.searchRoot = (_position: unknown, depth: number) => ({ move: 0, score: 0, depth, nodes: 1 });
  const attempted: [number, number][] = [];
  ai.tryEarlyWinProof = (_position: unknown, state: { bestMove: number }, _limit: number, depth: number) => {
    attempted.push([state.bestMove, depth]);
    ai.nodesVisited += state.bestMove === 10 ? 100 : 10;
    return depth === 13;
  };
  const state = { bestMove: 0, bestScore: 0, completedDepth: 0, hintMove: 0 };
  ai.searchDepths(position, 1, state, 13, true);
  expect(attempted).toEqual([[10, 13]]);
});

test('an admitted proof batch continues after crossing its entry reserve', () => {
  let calls = 0;
  const { ai, position } = makePortfolioSearch(() => calls++ === 0 ? 0 : 1);
  let attempts = 0;
  ai.tryEarlyWinProof = (_position: unknown, state: { provenWin?: boolean }) => {
    attempts++;
    state.provenWin = true;
    return true;
  };
  const state = { bestMove: 0, bestScore: 0, completedDepth: 0, hintMove: 0 };
  ai.searchDepths(position, 1, state, 13, true);
  expect(attempts).toBe(1);
  expect(state.provenWin).toBe(true);
});

test('an unsuccessful stable leader does not exclude alternative proof candidates', () => {
  const { ai, position } = makePortfolioSearch();
  ai.searchRoot = (_position: unknown, depth: number) => ({ move: 0, score: 0, depth, nodes: 1 });
  const attempted: [number, number][] = [];
  ai.tryEarlyWinProof = (_position: unknown, state: { bestMove: number }, _limit: number, depth: number) => {
    attempted.push([state.bestMove, depth]);
    ai.nodesVisited += state.bestMove === 10 ? 100 : 10;
    return state.bestMove === 11 && depth === 3;
  };
  const state = { bestMove: 0, bestScore: 0, completedDepth: 0, hintMove: 0 };
  ai.searchDepths(position, 1, state, 13, true);
  expect(attempted).toEqual([[10, 13], [11, 1], [10, 13], [11, 3]]);
  expect(state.bestMove).toBe(11);
});

test.each([true, false])('a promising previous leader remains eligible without excluding alternatives (wins: %s)', previousWins => {
  const { ai, position } = makePortfolioSearch();
  ai.rootProofCount = 1;
  ai.rootProofMoves[0] = 11;
  ai.searchRoot = (_position: unknown, depth: number) => ({ move: 11, score: 0, depth, nodes: 1 });
  const attempted: [number, number][] = [];
  ai.tryEarlyWinProof = (_position: unknown, state: { bestMove: number; provenWin?: boolean }, _limit: number, depth: number) => {
    attempted.push([state.bestMove, depth]);
    if (!(previousWins && state.bestMove === 10 && depth === 13)
      && !(!previousWins && state.bestMove === 11 && depth === 1)) return false;
    state.provenWin = true;
    return true;
  };
  const state = { bestMove: 10, bestScore: 100, completedDepth: 4, hintMove: 10 };
  ai.searchDepths(position, 5, state, 13, true);
  expect(attempted).toEqual(previousWins ? [[10, 13]] : [[10, 13], [11, 1]]);
  expect(state.bestMove).toBe(previousWins ? 10 : 11);
  expect(state.provenWin).toBe(true);
});
