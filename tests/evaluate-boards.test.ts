import { expect, test } from 'vitest';
import { evaluateBoard, rankBoards, collectBoards, playOut, screenBoards } from '../src/evaluate-boards';
import { GogoAI, type SearchResult } from '../src/engine/ai';
import { BLACK, WHITE, decodeGame } from '../src/engine/gogomoku';

const result = (score = 0, flags: Partial<SearchResult> = {}): SearchResult => ({
  move: 0, score, depth: 1, nodes: 1, timedOut: false, forcedDefensiveMove: false,
  forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false, ...flags,
});
const row = (encoded: string, score = 0, flags: Partial<SearchResult> = {}) =>
  evaluateBoard(encoded, (_board, ms) => result(ms === 100 ? score : 10, flags));

test('saves independent scores and only true flags from the strongest evaluation', () => {
  const budgets: number[] = [];
  const evaluated = evaluateBoard('B9 a1 b2 c3', (_encoded, ms) => {
    budgets.push(ms);
    return result(ms, ms === 100 ? { forcedDefensiveMove: true, heuristicLoss: true, timedOut: true } : { forcedWin: true });
  });
  expect(budgets).toEqual([5, 25, 100]);
  expect(evaluated).toEqual({ encoded: 'B9 a1 b2 c3', scores: { 5: 5, 25: 25, 100: 100 },
    strongest: { move: 0, depth: 1, nodes: 1, forcedDefensiveMove: true, heuristicLoss: true, timedOut: true } });
});

test('ranks by distance from equality at 100ms with stable encoded ties', () => {
  const rows = [row('z', -4), row('b', 1), row('a', -1), row('c', 0)];
  expect(rankBoards(rows).map(r => r.encoded)).toEqual(['c', 'a', 'b', 'z']);
  expect(rows[0].encoded).toBe('z');
});

test('rejects outcome claims, saves played winners and stops at both quotas', () => {
  const rows = [row('forcedWin', 0, { forcedWin: true }), row('forcedLoss', 0, { forcedLoss: true }),
    row('heuristicWin', 0, { heuristicWin: true }), row('heuristicLoss', 0, { heuristicLoss: true }),
    row('draw'), row('white'), row('extraWhite'), row('black', 0, { forcedDefensiveMove: true }), row('unused')];
  const played: string[] = [];
  const collection = collectBoards(rows, encoded => {
    played.push(encoded);
    return { winner: encoded === 'draw' ? 0 : encoded.includes('White') || encoded === 'white' ? WHITE : BLACK,
      final: encoded, plies: 2, termination: 'winner' };
  }, 1);
  expect(played).toEqual(['draw', 'white', 'extraWhite', 'black']);
  expect(rows[4].playout?.winner).toBe(0);
  expect(collection.map(r => r.encoded)).toEqual(['white', 'black']);
});

test('reports insufficient winners and rejects invalid quotas', () => {
  expect(() => collectBoards([], () => { throw Error('unused'); }, 1)).toThrow('Only collected 0 white and 0 black');
  for (const quota of [0, -1, 1.5]) expect(() => collectBoards([], () => { throw Error('unused'); }, quota)).toThrow('Invalid quota');
});

test('playout uses 75ms, records a real terminal winner and validates moves', () => {
  const encoded = 'B9 a1 a9 b1 b9 c1 c9 d1 d9';
  const budgets: number[] = [];
  const played = playOut(decodeGame(encoded), { findBestMove(_position, ms) { budgets.push(ms); return result(0, { move: 4 }); } });
  expect(budgets).toEqual([75]);
  expect(played).toEqual({ winner: BLACK, final: `${encoded} e1`, plies: 1, termination: 'winner' });
  expect(() => playOut(decodeGame('B9 a1'), { findBestMove() { return result(); } })).toThrow('Illegal playout move');
});

test('caps capture cycles, stops on no legal moves and handles already won boards', () => {
  expect(playOut(decodeGame('B9'), new GogoAI(), 0).termination).toBe('ply-limit');
  const position = decodeGame('B9');
  position.hasAnyLegalMove = () => false;
  expect(playOut(position, new GogoAI()).termination).toBe('no-legal-moves');
  expect(playOut(decodeGame('B9 a1 a9 b1 b9 c1 c9 d1 d9 e1'), new GogoAI()).winner).toBe(BLACK);
});

test('reuses saved playouts when resuming', () => {
  const white = row('white');
  white.playout = { winner: WHITE, final: 'white', plies: 1, termination: 'winner' };
  const black = row('black');
  black.playout = { winner: BLACK, final: 'black', plies: 1, termination: 'winner' };
  expect(collectBoards([white, black], () => { throw Error('must reuse cache'); }, 1)).toEqual([white, black]);
});


test('screens in input order at 10 seconds, rejecting all outcome claims until the pool is full', () => {
  const rows = ['forcedWin', 'forcedLoss', 'heuristicWin', 'heuristicLoss', 'a', 'b', 'unused'].map(encoded => row(encoded));
  const seen: string[] = [];
  const selected = screenBoards(rows, (encoded, ms) => {
    expect(ms).toBe(10_000);
    seen.push(encoded);
    return result(encoded === 'a' ? 20 : -2, { [encoded]: true });
  }, 2);
  expect(seen).toEqual(['forcedWin', 'forcedLoss', 'heuristicWin', 'heuristicLoss', 'a', 'b']);
  expect(selected.map(r => r.encoded)).toEqual(['a', 'b']);
  expect(selected[0].screening).toEqual({ score: 20, strongest: { move: 0, depth: 1, nodes: 1 } });
  expect(rankBoards(selected, 10_000).map(r => r.encoded)).toEqual(['b', 'a']);
  expect(rows[0].screening?.strongest.forcedWin).toBe(true);
});

test('resumes cached screening and uses its flags for playout eligibility', () => {
  const rows = [row('white', 0, { forcedLoss: true }), row('black')];
  rows[0].screening = { score: 1, strongest: { move: 0, depth: 2, nodes: 2 } };
  rows[1].screening = { score: -1, strongest: { move: 0, depth: 2, nodes: 2, forcedDefensiveMove: true } };
  expect(screenBoards(rows, () => { throw Error('must reuse cache'); }, 2)).toEqual(rows);
  expect(collectBoards(rows, encoded => ({ winner: encoded === 'white' ? WHITE : BLACK,
    final: encoded, plies: 1, termination: 'winner' }), 1)).toEqual(rows);
  expect(rankBoards(rows, 10_000).map(r => r.encoded)).toEqual(['black', 'white']);
  rows[0].screening.strongest.heuristicWin = true;
  expect(() => collectBoards(rows, () => { throw Error('must reuse cache'); }, 1)).toThrow('Only collected 0 white and 1 black');
});

test('screening reports exhaustion, validates pool sizes and requires a 10-second score for ranking', () => {
  for (const target of [0, -1, 1.5]) expect(() => screenBoards([], () => result(), target)).toThrow('Invalid screening target');
  expect(() => screenBoards([], () => result(), 1)).toThrow('Only screened 0 eligible boards; need 1');
  expect(() => rankBoards([row('a'), row('b')], 10_000)).toThrow('Missing 10-second evaluation');
});

test('screening defaults to a 300-board pool and stops before evaluating the next board', () => {
  const rows = Array.from({ length: 301 }, (_, i) => row(String(i)));
  let searched = 0;
  expect(screenBoards(rows, () => { searched += 1; return result(); })).toHaveLength(300);
  expect(searched).toBe(300);
  expect(rows[300].screening).toBeUndefined();
});
