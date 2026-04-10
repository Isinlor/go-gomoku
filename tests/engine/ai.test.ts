import { test, expect } from 'vitest';

import { BLACK, EMPTY, GogoAI, GogoPosition, WHITE } from '../../src/engine';

function position(rows: string[], toMove = BLACK) {
  return GogoPosition.fromAscii(rows, toMove);
}

function rawPosition(rows: string[], toMove = BLACK) {
  const game = position(rows, toMove);
  game.winner = EMPTY;
  return game;
}

test('AI chooses the center on an empty board, handles immediate timeout, and handles terminal states', () => {
  const empty = new GogoPosition(9);
  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 2 });
  const result = ai.findBestMove(empty, 100);
  expect(result.move).toBe(empty.index(4, 4));
  expect(result.timedOut).toBe(false);
  expect(result.depth >= 1).toBeTruthy();

  let tick = 0;
  const timeoutAI = new GogoAI({ maxDepth: 4, now: () => tick++ });
  const timeoutResult = timeoutAI.findBestMove(new GogoPosition(9), 0);
  expect(timeoutResult.move).toBe(40);
  expect(timeoutResult.depth).toBe(0);
  expect(timeoutResult.timedOut).toBe(true);

  const terminal = position([
    'XXXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  const terminalResult = ai.findBestMove(terminal, 100);
  expect(terminalResult.move).toBe(-1);
  expect(terminalResult.timedOut).toBe(false);
});

test('AI finds immediate wins, blocks forced replies at depth one, and returns best-so-far after a later timeout', () => {
  const winning = rawPosition([
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  const winningAI = new GogoAI({ maxDepth: 3, quiescenceDepth: 2 });
  const win = winningAI.findBestMove(winning, 100);
  expect(win.move).toBe(winning.index(4, 0));
  expect(win.score > 100000).toBeTruthy();

  const blocking = rawPosition([
    '.........',
    '.........',
    '.........',
    '.........',
    'XOOOO....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  const blockingAI = new GogoAI({ maxDepth: 1, quiescenceDepth: 4 });
  const block = blockingAI.findBestMove(blocking, 100);
  expect(block.move).toBe(blocking.index(5, 4));

  let calls = 0;
  const laterTimeoutAI = new GogoAI({
    maxDepth: 5,
    quiescenceDepth: 2,
    now: () => {
      calls += 1;
      return calls < 4 ? 0 : 100;
    },
  });
  const timeout = laterTimeoutAI.findBestMove(new GogoPosition(9), 1);
  expect(timeout.move).toBe(40);
  expect(timeout.timedOut).toBe(true);
  expect(timeout.depth).toBe(1);
});

test('AI iterative deepening exits early once a forced win is proven at the root', () => {
  const winning = rawPosition([
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const ai = new GogoAI({ maxDepth: 6, quiescenceDepth: 4, now: () => 0 });
  const result = ai.findBestMove(winning, 100);
  expect(result.move).toBe(winning.index(4, 0));
  expect(result.depth).toBe(1);
  expect(result.score).toBeGreaterThanOrEqual(1000000000 - 1);
  expect(result.nodes).toBeLessThan(40);
  expect(result.forcedWin).toBe(true);
  expect(result.forcedLoss).toBe(false);
});

test('AI marks forced loss and still returns one of the best delaying losing moves', () => {
  const losing = rawPosition([
    '.........',
    '.........',
    '.........',
    '.........',
    '.OOOO....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const ai = new GogoAI({ maxDepth: 6, quiescenceDepth: 4, now: () => 0 });
  const result = ai.findBestMove(losing, 100);
  const leftBlock = losing.index(0, 4);
  const rightBlock = losing.index(5, 4);
  expect([leftBlock, rightBlock]).toContain(result.move);
  expect(result.depth).toBe(2);
  expect(result.forcedWin).toBe(false);
  expect(result.forcedLoss).toBe(true);
});

test('AI restores position state after a mid-search timeout so the board is not corrupted', () => {
  // One stone gives the search real candidates to explore but keeps depth-1 well under 128 nodes,
  // so the non-forced timeout (fires every 128 nodes) hits inside the depth-2 subtree with
  // multiple outstanding position.play() calls that must be unwound.
  const pos = new GogoPosition(9);
  pos.playXY(4, 4);

  const boardBefore = Array.from(pos.board);
  const toMoveBefore = pos.toMove;
  const plyBefore = pos.ply;

  // now() is called:
  //  1 – deadline computation in findBestMove
  //  2 – early-return guard in findBestMove
  //  3 – forced check at the start of searchRoot(depth=1)  (nodesVisited=1)
  //  4 – forced check at the start of searchRoot(depth=2)  (nodesVisited≈50 after depth-1)
  //  5 – first non-forced check when nodesVisited reaches 128, mid depth-2 subtree
  // Returning 1000 from call 5 onwards triggers the non-forced timeout with outstanding plays.
  let nowCalls = 0;
  const ai = new GogoAI({
    maxDepth: 6,
    quiescenceDepth: 2,
    now: () => {
      nowCalls += 1;
      return nowCalls > 4 ? 1000 : 0;
    },
  });

  const result = ai.findBestMove(pos, 1);
  expect(result.timedOut).toBe(true);
  expect(result.depth >= 1).toBeTruthy();

  // The position must be identical to before the search.
  expect(pos.ply).toBe(plyBefore);
  expect(pos.toMove).toBe(toMoveBefore);
  expect(Array.from(pos.board)).toEqual(boardBefore);
  // And it must still be playable.
  expect(pos.playXY(3, 3)).toBe(true);
});

test('AI rethrows unexpected root errors instead of masking them as timeouts', () => {
  const ai = new GogoAI({ maxDepth: 1 });
  const anyAI = ai as any;
  anyAI.searchRoot = () => {
    throw new Error('boom');
  };
  expect(() => ai.findBestMove(new GogoPosition(9), 100)).toThrow(/boom/);
});

test('AI constructor clamps explicit maxPly values', () => {
  const ai = new GogoAI({ maxPly: 1, maxDepth: 0, quiescenceDepth: -1 });
  expect(ai.maxPly).toBe(2);
  expect(ai.maxDepth).toBe(1);
  expect(ai.quiescenceDepth).toBe(0);
});

test('AI constructor also uses default search parameters when options are omitted', () => {
  const ai = new GogoAI();
  expect(ai.maxDepth).toBe(6);
  expect(ai.quiescenceDepth).toBe(6);
  expect(ai.maxPly).toBe(64);
});

test('white-box AI helpers cover generation, evaluation, quiescence, search fallback, insertion ordering, and timing', () => {
  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  const empty = new GogoPosition(9);
  anyAI.ensureBuffers(empty.area);

  const emptyMoves = anyAI.moveBuffers[0];
  const emptyScores = anyAI.scoreBuffers[0];
  expect(anyAI.generateOrderedMoves(empty, emptyMoves, emptyScores, -1, false)).toBe(1);
  expect(emptyMoves[0]).toBe(empty.index(4, 4));
  expect(anyAI.generateOrderedMoves(empty, emptyMoves, emptyScores, -1, true)).toBe(0);

  const quiet = rawPosition([
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  anyAI.ensureBuffers(quiet.area);
  expect(anyAI.scoreMove(quiet, quiet.index(0, 0), -1, true)).toBe(Number.NEGATIVE_INFINITY);
  const tactical = rawPosition([
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  anyAI.ensureBuffers(tactical.area);
  expect(anyAI.scoreMove(tactical, tactical.index(4, 0), -1, true)).not.toBe(Number.NEGATIVE_INFINITY);

  const evalPosition = rawPosition([
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  const blackEval = anyAI.evaluate(evalPosition);
  evalPosition.toMove = WHITE;
  const whiteEval = anyAI.evaluate(evalPosition);
  expect(blackEval > 0).toBeTruthy();
  expect(whiteEval < 0).toBeTruthy();

  anyAI.deadline = 1;
  const betaCut = anyAI.quiescence(tactical, -1000, 0, 0, 2);
  expect(betaCut >= 0).toBeTruthy();
  expect(anyAI.quiescence(evalPosition, -1000, 1000, 0, 0)).toBe(whiteEval);

  const full = new GogoPosition(9);
  full.board.fill(BLACK);
  full.stoneCount = full.area;
  full.winner = EMPTY;
  full.toMove = WHITE;
  anyAI.ensureBuffers(full.area);
  expect(anyAI.generateOrderedMoves(full, anyAI.moveBuffers[0], anyAI.scoreBuffers[0], -1, false)).toBe(0);
  expect(anyAI.generateFullBoardMoves(full, anyAI.moveBuffers[0], anyAI.scoreBuffers[0], -1, false)).toBe(0);
  const root = anyAI.searchRoot(full, 1, -1);
  expect(root.move).toBe(-1);
  expect(root.score).toBe(0);
  expect(anyAI.search(full, 1, -100, 100, 0)).toBe(0);

  const won = position([
    'XXXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  expect(anyAI.generateOrderedMoves(won, anyAI.moveBuffers[0], anyAI.scoreBuffers[0], -1, false)).toBe(0);
  won.winner = EMPTY;
  expect(anyAI.generateFullBoardMoves(won, anyAI.moveBuffers[0], anyAI.scoreBuffers[0], -1, false) > 0).toBeTruthy();
  const quietFull = rawPosition([
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  quietFull.koPoint = quietFull.index(0, 0);
  expect(anyAI.generateFullBoardMoves(quietFull, anyAI.moveBuffers[0], anyAI.scoreBuffers[0], -1, true)).toBe(0);

  const terminalQ = position([
    'XXXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  expect(anyAI.quiescence(terminalQ, -1000, 1000, 3, 2)).toBe(-1000000000 + 3);

  const fallbackAI = new GogoAI({ maxDepth: 1, now: () => 0 });
  const anyFallback = fallbackAI as any;
  anyFallback.ensureBuffers(81);
  const fake = {
    stoneCount: 1,
    size: 9,
    play(move: number) { return move === 1; },
    undo() { return true; },
  };
  anyFallback.generateOrderedMoves = (_position: any, moves: Int16Array) => { moves[0] = 0; return 1; };
  anyFallback.generateFullBoardMoves = (_position: any, moves: Int16Array) => { moves[0] = 1; return 1; };
  expect(anyFallback.pickFallbackMove(fake)).toBe(1);
  anyFallback.generateFullBoardMoves = () => 0;
  expect(anyFallback.pickFallbackMove(fake)).toBe(-1);

  // Test fullboard fallback with rejected then accepted moves (covers line 145 false branch)
  anyFallback.generateOrderedMoves = () => 0;
  anyFallback.generateFullBoardMoves = (_position: any, moves: Int16Array) => { moves[0] = 0; moves[1] = 1; return 2; };
  expect(anyFallback.pickFallbackMove(fake)).toBe(1);

  const illegalAI = new GogoAI({ maxDepth: 2, now: () => 0 });
  const anyIllegal = illegalAI as any;
  anyIllegal.ensureBuffers(81);
  anyIllegal.deadline = 1;
  const noPlay = new GogoPosition(9);
  noPlay.play = () => false;
  noPlay.undo = () => true;
  anyIllegal.generateOrderedMoves = (_position: any, moves: Int16Array) => { moves[0] = 0; return 1; };
  anyIllegal.generateFullBoardMoves = () => 0;
  const illegalRoot = anyIllegal.searchRoot(noPlay, 1, -1);
  expect(illegalRoot.move).toBe(-1);
  expect(anyIllegal.search(noPlay, 1, -100, 100, 0)).toBe(0);
  anyIllegal.generateOrderedMoves = (_position: any, moves: Int16Array) => { moves[0] = 0; return 1; };
  noPlay.winner = EMPTY;
  expect(anyIllegal.quiescence(noPlay, -100, 100, 0, 2)).toBe(anyIllegal.evaluate(noPlay));

  const moves = new Int16Array(4);
  const scores = new Int32Array(4);
  anyAI.insertMove(moves, scores, 0, 10, 5);
  anyAI.insertMove(moves, scores, 1, 12, 9);
  anyAI.insertMove(moves, scores, 2, 14, 7);
  expect(Array.from(moves.slice(0, 3))).toEqual([12, 14, 10]);
  expect(Array.from(scores.slice(0, 3))).toEqual([9, 7, 5]);

  anyAI.deadline = 0;
  anyAI.nodesVisited = 0;
  expect(() => anyAI.checkTime(true)).toThrow(/SEARCH_TIMEOUT/);
  anyAI.deadline = 1;
  anyAI.nodesVisited = 1;
  expect(() => anyAI.checkTime(false)).not.toThrow();
});

test('scoreMove deduplicates adjacent groups that wrap around the candidate from multiple sides', () => {
  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;

  // Opponent (WHITE) L-shaped group {(2,1),(3,1),(2,2)} has exactly 1 liberty at
  // candidate (3,2).  The group is adjacent from both left and above, so without
  // dedup the capturePressure of 5900 (CAPTURE_BONUS + 3*300) would be counted
  // twice.  Expected score with correct dedup: 7318.
  const oppDedup = rawPosition([
    'XXXXX....',
    'XXOOX....',
    'XXO......',
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  anyAI.ensureBuffers(oppDedup.area);
  expect(anyAI.scoreMove(oppDedup, oppDedup.index(3, 2), -1, false)).toBe(7318);

  // Player (BLACK) L-shaped group {(2,1),(3,1),(2,2)} has exactly 1 liberty at
  // candidate (3,2).  The group is adjacent from both left and above, so without
  // dedup the escapePressure of 4250 (ESCAPE_BONUS + 3*250) would be counted
  // twice.  Expected score with correct dedup: 6080.
  const playerDedup = rawPosition([
    '..OO.....',
    'OOXXO....',
    'OOX......',
    '..O......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  anyAI.ensureBuffers(playerDedup.area);
  expect(anyAI.scoreMove(playerDedup, playerDedup.index(3, 2), -1, false)).toBe(6080);
});
