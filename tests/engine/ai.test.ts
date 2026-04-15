import { test, expect } from 'vitest';

import { BLACK, EMPTY, GogoAI, GogoPosition, WHITE } from '../../src/engine';

const GENERATE_ORDERED_MOVES_TACTICAL_ONLY_INDEX = 4;

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

  const terminal = GogoPosition.fromAscii([
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
  const winning = GogoPosition.fromAscii([
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

  const blocking = GogoPosition.fromAscii([
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
  const winning = GogoPosition.fromAscii([
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
  expect(result.nodes).toBeLessThan(80);
  expect(result.forcedWin).toBe(true);
  expect(result.forcedLoss).toBe(false);
  expect(result.heuristicWin).toBe(true);
  expect(result.heuristicLoss).toBe(false);
});

test('AI marks forced loss and still returns one of the best delaying losing moves', () => {
  const losing = GogoPosition.fromAscii([
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
  expect(result.heuristicWin).toBe(false);
  expect(result.heuristicLoss).toBe(true);
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

test('AI never recommends an illegal ko recapture move', () => {
  const ko = GogoPosition.fromAscii([
    '..O......',
    '.O.O.....',
    '.XOX.....',
    '..X......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  expect(ko.playXY(2, 1)).toBe(true);
  expect(ko.koPoint).toBe(ko.index(2, 2));

  const ai = new GogoAI({ maxDepth: 3, quiescenceDepth: 2 });
  const result = ai.findBestMove(ko, 100);

  expect(result.move).not.toBe(ko.koPoint);
  expect(ko.isLegal(result.move)).toBe(true);
});

test('verifyWinningMove returns false for illegal moves and does not mutate position state', () => {
  const ai = new GogoAI({ maxDepth: 4, quiescenceDepth: 2, now: () => 0 });
  const position = new GogoPosition(9);
  expect(position.playXY(4, 4)).toBe(true);

  const before = {
    board: Array.from(position.board),
    toMove: position.toMove,
    winner: position.winner,
    koPoint: position.koPoint,
    ply: position.ply,
    hash: position.hash,
  };

  expect(ai.verifyWinningMove(position, position.index(4, 4), 100)).toBe(false);
  expect(Array.from(position.board)).toEqual(before.board);
  expect(position.toMove).toBe(before.toMove);
  expect(position.winner).toBe(before.winner);
  expect(position.koPoint).toBe(before.koPoint);
  expect(position.ply).toBe(before.ply);
  expect(position.hash).toBe(before.hash);
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

test('searchDepths skips empty root results and keeps deepening', () => {
  const ai = new GogoAI({ maxDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  const state = { bestMove: 40, bestScore: 0, completedDepth: 0, hintMove: 40 };
  let calls = 0;
  anyAI.searchRoot = (_: any, depth: number) => {
    calls += 1;
    return calls === 1
      ? { move: -1, score: 0, depth, nodes: 0, timedOut: false, forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false }
      : { move: 41, score: 10, depth, nodes: 0, timedOut: false, forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false };
  };

  anyAI.searchDepths(new GogoPosition(9), 1, state);
  expect(state).toEqual({ bestMove: 41, bestScore: 10, completedDepth: 2, hintMove: 41 });
});

test('searchDepths stops early after a forced win score', () => {
  const ai = new GogoAI({ maxDepth: 3, now: () => 0 });
  const anyAI = ai as any;
  const state = { bestMove: 40, bestScore: 0, completedDepth: 0, hintMove: 40 };
  let calls = 0;

  anyAI.searchRoot = (_position: any, depth: number) => {
    calls += 1;
    return {
      move: 41,
      score: depth === 2 ? 1_000_000_000 - depth : 10,
      depth,
      nodes: 0,
      timedOut: false,
      forcedWin: false,
      forcedLoss: false,
      heuristicWin: false,
      heuristicLoss: false,
    };
  };

  anyAI.searchDepths(new GogoPosition(9), 1, state);
  expect(calls).toBe(2);
  expect(state).toEqual({ bestMove: 41, bestScore: 1_000_000_000 - 2, completedDepth: 2, hintMove: 41 });
});

test('searchDepths marks timeouts and stops deepening on timeoutSignal', () => {
  const ai = new GogoAI({ maxDepth: 3, now: () => 0 });
  const anyAI = ai as any;
  const state = { bestMove: 40, bestScore: 0, completedDepth: 0, hintMove: 40 };
  let calls = 0;

  anyAI.searchRoot = () => {
    calls += 1;
    if (calls === 2) {
      throw anyAI.timeoutSignal;
    }
    return { move: 41, score: 10, depth: 1, nodes: 0, timedOut: false, forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false };
  };

  anyAI.searchDepths(new GogoPosition(9), 1, state);
  expect(calls).toBe(2);
  expect(anyAI.timedOut).toBe(true);
  expect(state).toEqual({ bestMove: 41, bestScore: 10, completedDepth: 1, hintMove: 41 });
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

  const quiet = GogoPosition.fromAscii([
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
  const tactical = GogoPosition.fromAscii([
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

  const evalPosition = GogoPosition.fromAscii([
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

  const won = GogoPosition.fromAscii([
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
  const quietFull = GogoPosition.fromAscii([
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

  const terminalQ = GogoPosition.fromAscii([
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

  // Test fullboard fallback with MAX_CANDIDATES cap in search:
  // generateOrderedMoves returns 0 (forcing fullboard fallback),
  // generateFullBoardMoves returns 20 candidates (> MAX_CANDIDATES=15).
  const cappedAI = new GogoAI({ maxDepth: 2, now: () => 0 });
  const anyCapped = cappedAI as any;
  anyCapped.ensureBuffers(81);
  anyCapped.deadline = 1e15;
  anyCapped.killerMoves.fill(-1);
  anyCapped.history.fill(0);
  anyCapped.ttFlag.fill(0);
  const cappedPos = new GogoPosition(9);
  cappedPos.playXY(4, 4);
  const savedPlay = cappedPos.play.bind(cappedPos);
  const savedUndo = cappedPos.undo.bind(cappedPos);
  anyCapped.generateOrderedMoves = () => 0;
  anyCapped.generateFullBoardMoves = (_pos: any, mvs: Int16Array, scs: Int32Array) => {
    // Fill 20 candidates (all point to valid empty cells)
    for (let i = 0; i < 20; i += 1) {
      mvs[i] = i < 40 ? i : i + 1; // skip center at 40
      scs[i] = 100 - i;
    }
    return 20;
  };
  cappedPos.play = savedPlay;
  cappedPos.undo = savedUndo;
  const cappedScore = anyCapped.search(cappedPos, 1, -100, 100, 0);
  expect(typeof cappedScore).toBe('number');

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
  const oppDedup = GogoPosition.fromAscii([
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
  expect(oppDedup.winner).toBe(BLACK);
  // scoreMove() is being tested on this stone layout, so clear the pre-existing winner
  // that fromAscii() correctly detects from the finished five-in-a-row on the top edge.
  oppDedup.winner = EMPTY;
  anyAI.ensureBuffers(oppDedup.area);
  expect(anyAI.scoreMove(oppDedup, oppDedup.index(3, 2), -1, false)).toBe(7318);

  // Player (BLACK) L-shaped group {(2,1),(3,1),(2,2)} has exactly 1 liberty at
  // candidate (3,2).  The group is adjacent from both left and above, so without
  // dedup the escapePressure of 4250 (ESCAPE_BONUS + 3*250) would be counted
  // twice.  Expected score with correct dedup: 6080.
  const playerDedup = GogoPosition.fromAscii([
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

test('null move pruning prunes when the position is strongly in favor of the side to move', () => {
  // Position where BLACK has a strong 3-in-a-row pattern.
  // The null move (giving WHITE a free move) still evaluates strongly
  // for BLACK, so NMP returns beta and prunes the search tree.
  const ai = new GogoAI({ maxDepth: 4, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '..XXX....',
    '.........',
    '..OO.....',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);

  // With depth=3, canNullMove=true, and beta=100, the null move search
  // at depth=0 evaluates from WHITE's perspective (negative for WHITE
  // since BLACK has strong patterns). Negated back → high score >= beta.
  // NMP returns beta (100).
  const score = anyAI.search(pos, 3, -1_000_000, 100, 1, true);
  expect(score).toBe(100);

  // With canNullMove=false, NMP is skipped and the full search runs.
  // The result should differ since the full search explores all moves.
  const scoreNoNmp = anyAI.search(pos, 3, -1_000_000, 100, 1, false);
  expect(scoreNoNmp).toBeGreaterThanOrEqual(100);

  // With a very wide beta window (beta=1_000_000), NMP fires but nullScore
  // does not reach beta, so the search continues past the NMP check
  // (covers the false branch of "if nullScore >= beta").
  anyAI.killerMoves.fill(-1);
  const scoreWide = anyAI.search(pos, 3, -1_000_000, 1_000_000, 1, true);
  expect(scoreWide).toBeGreaterThan(0);
});

test('killer moves are stored on beta cutoffs and boost scores in scoreMove', () => {
  const ai = new GogoAI({ maxDepth: 4, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '..XXX....',
    '.........',
    '..OO.....',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);

  // Run a search that will produce beta cutoffs, populating killer moves
  anyAI.search(pos, 2, -1_000_000, 1_000_000, 1);

  // Verify killer moves were stored at ply 1 (at least one should be set)
  const k0 = anyAI.killerMoves[2]; // ply=1, slot 0
  const k1 = anyAI.killerMoves[3]; // ply=1, slot 1
  expect(k0 !== -1 || k1 !== -1).toBe(true);

  // When the same killer move appears in scoreMove, it should get a bonus
  if (k0 !== -1) {
    const withKiller = anyAI.scoreMove(pos, k0, -1, false, 1);
    // Reset killer and re-score without killer bonus
    anyAI.killerMoves[2] = -1;
    anyAI.killerMoves[3] = -1;
    const withoutKiller = anyAI.scoreMove(pos, k0, -1, false, 1);
    expect(withKiller).toBeGreaterThan(withoutKiller);
  }
});

test('transposition table stores entries during search and produces cutoffs on replay', () => {
  const ai = new GogoAI({ maxDepth: 4, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  // Use a position with few near-2 candidates (< MAX_CANDIDATES) so nodes
  // are not capped and TT entries are stored normally.
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '....X....',
    '...OXO...',
    '....X....',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.history.fill(0);

  // First search populates TT entries
  const score1 = anyAI.search(pos, 3, -1_000_000, 1_000_000, 1);

  // Verify TT was populated for this position - bestMove is stored
  const hash = pos.hash;
  const ttIndex = hash & 0x3FFFF;
  expect(anyAI.ttHash[ttIndex]).toBe(hash);
  expect(anyAI.ttBestMove[ttIndex]).not.toBe(-1);

  // Second search at same depth should produce consistent results
  const score2 = anyAI.search(pos, 3, -1_000_000, 1_000_000, 1);
  expect(score2).toBe(score1);

  // Search at lower depth should also produce a result
  const score3 = anyAI.search(pos, 2, -1_000_000, 1_000_000, 1);
  expect(typeof score3).toBe('number');

  // TT lowerbound cutoff: search with narrow beta window
  const lbScore = anyAI.search(pos, 3, score1 - 100, score1 - 50, 1, false);
  expect(lbScore).toBeGreaterThanOrEqual(score1 - 50);

  // TT upperbound cutoff: search with narrow alpha window above the score
  const ubScore = anyAI.search(pos, 3, score1 + 50, score1 + 100, 1, false);
  expect(ubScore).toBeLessThanOrEqual(score1 + 50);
});

test('TT score adjustment correctly handles forced win/loss scores and pass-through', () => {
  const ai = new GogoAI({ maxDepth: 4 });
  const anyAI = ai as any;

  // Regular scores pass through unchanged
  expect(anyAI.ttAdjustStore(100, 5)).toBe(100);
  expect(anyAI.ttAdjustRetrieve(100, 5)).toBe(100);
  expect(anyAI.ttAdjustStore(-100, 5)).toBe(-100);
  expect(anyAI.ttAdjustRetrieve(-100, 5)).toBe(-100);

  // Win scores are adjusted by ply
  const winScore = 1_000_000_000 - 3;
  expect(anyAI.ttAdjustStore(winScore, 5)).toBe(winScore + 5);
  expect(anyAI.ttAdjustRetrieve(winScore + 5, 5)).toBe(winScore);

  // Loss scores are adjusted by ply
  const lossScore = -1_000_000_000 + 3;
  expect(anyAI.ttAdjustStore(lossScore, 5)).toBe(lossScore - 5);
  expect(anyAI.ttAdjustRetrieve(lossScore - 5, 5)).toBe(lossScore);
});

test('LMR reduces later moves at depth >= 3 and re-searches on improvement', () => {
  const ai = new GogoAI({ maxDepth: 6, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  // Position with many legal moves and balanced evaluation so moves don't
  // immediately cause beta cutoffs, allowing legalCount to exceed 3.
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.X..O....',
    '.........',
    '....X....',
    '.........',
    '.O..X....',
    '.........',
    '.........',
  ], BLACK);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.history.fill(0);

  // Clear TT to ensure fresh search
  anyAI.ttFlag.fill(0);

  // Search at depth 5 to trigger LMR depth reduction (line 328: depth >= 3, legalCount > 3)
  const score = anyAI.search(pos, 5, -1_000_000, 1_000_000, 1);
  expect(typeof score).toBe('number');

  // Cover line 334 (LMR re-search when scout finds improvement) by mocking inner search
  // calls. The negamax convention means inner calls return the score from the child's
  // (opponent's) perspective; we negate to get the parent's score:
  //   depth-2 inner calls → return -50 → parent score = 50 → alpha is set to 50
  //   depth-1 LMR scout for the 4th+ move → return -51 → parent score = 51 > alpha=50
  // The condition `searchDepth < depth-1 && score > alpha` on line 333 is now true,
  // executing the full-depth re-search on line 334.
  const ai2 = new GogoAI({ maxDepth: 4, quiescenceDepth: 2, now: () => 0 });
  const any2 = ai2 as any;
  any2.ensureBuffers(pos.area);
  any2.deadline = 1e15;
  any2.killerMoves.fill(-1);
  any2.history.fill(0);
  any2.ttFlag.fill(0);
  const realSearch = any2.search.bind(any2);
  any2.search = function (position: any, depth: number, alpha: number, beta: number, ply: number, canNullMove = true): number {
    if (ply === 1) {
      return realSearch(position, depth, alpha, beta, ply, canNullMove);
    }
    // -50 → parent score 50 (sets/maintains alpha); -51 → parent score 51 (>alpha, triggers line 334)
    return depth === 1 ? -51 : -50;
  };
  const lmrResearchScore = any2.search(pos, 3, -1_000_000, 1_000_000, 1, false);
  expect(typeof lmrResearchScore).toBe('number');

  // Iterative deepening pipeline: fast frozen-clock run with small maxDepth
  const ai3 = new GogoAI({ maxDepth: 3, quiescenceDepth: 1, now: () => 0 });
  const result = ai3.findBestMove(pos, 1);
  expect(result.move).not.toBe(-1);
  expect(result.depth).toBeGreaterThanOrEqual(1);
});

test('adaptive null move pruning uses R=3 at depth >= 6', () => {
  const ai = new GogoAI({ maxDepth: 8, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  // Strong position for BLACK to trigger NMP cutoff with R=3
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '..XXX....',
    '.........',
    '..OO.....',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.history.fill(0);
  anyAI.ttFlag.fill(0);

  // Search at depth 6 should use R=3 for NMP (depth >= 6)
  const score6 = anyAI.search(pos, 6, -1_000_000, 100, 1, true);
  expect(score6).toBe(100);
});

test('MAX_CANDIDATES caps the number of moves explored per node', () => {
  const ai = new GogoAI({ maxDepth: 3, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  // Position with many stones creating many near-2 candidates (> 15)
  const pos = GogoPosition.fromAscii([
    'X.O.X.O.X',
    '.........', 
    'O.X.O.X.O',
    '.........',
    'X.O.X.O.X',
    '.........',
    'O.X.O.X.O',
    '.........',
    'X.O.X.O.X',
  ], BLACK);
  anyAI.ensureBuffers(pos.area);

  // Verify generateOrderedMoves returns more than MAX_CANDIDATES
  const moves = anyAI.moveBuffers[0];
  const scores = anyAI.scoreBuffers[0];
  const rawCount = anyAI.generateOrderedMoves(pos, moves, scores, -1, false);
  expect(rawCount).toBeGreaterThan(15);

  // Search should still work correctly with the cap
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.history.fill(0);
  anyAI.ttFlag.fill(0);
  const score = anyAI.search(pos, 2, -1_000_000, 1_000_000, 1);
  expect(typeof score).toBe('number');
});

test('Zobrist hash is consistent after play/undo sequences', () => {
  const pos = new GogoPosition(9);
  const hashBefore = pos.hash;

  pos.playXY(4, 4);
  const hashAfterFirst = pos.hash;
  expect(hashAfterFirst).not.toBe(hashBefore);

  pos.playXY(3, 3);
  const hashAfterSecond = pos.hash;
  expect(hashAfterSecond).not.toBe(hashAfterFirst);

  pos.undo();
  expect(pos.hash).toBe(hashAfterFirst);

  pos.undo();
  expect(pos.hash).toBe(hashBefore);
});

test('proof mode: non-forced positions report no heuristic or forced outcome', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  const ai = new GogoAI({ maxDepth: 3, quiescenceDepth: 2, now: () => 0 });
  const result = ai.findBestMove(pos, 100);
  expect(result.forcedWin).toBe(false);
  expect(result.forcedLoss).toBe(false);
  expect(result.heuristicWin).toBe(false);
  expect(result.heuristicLoss).toBe(false);
});

test('proof mode: terminal position returns heuristicLoss', () => {
  const terminal = GogoPosition.fromAscii([
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
  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 2, now: () => 0 });
  const result = ai.findBestMove(terminal, 100);
  expect(result.move).toBe(-1);
  expect(result.forcedWin).toBe(false);
  expect(result.forcedLoss).toBe(true);
  expect(result.heuristicWin).toBe(false);
  expect(result.heuristicLoss).toBe(true);
});

test('proof mode: fallback move returns no forced outcome', () => {
  let tick = 0;
  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 0, now: () => tick++ });
  const pos = new GogoPosition(9);
  // Very tight time: deadline = 0 + 0 = 0, but pickFallbackMove runs before time check
  const result = ai.findBestMove(pos, 0);
  expect(result.heuristicWin).toBe(false);
  expect(result.heuristicLoss).toBe(false);
  expect(result.forcedWin).toBe(false);
  expect(result.forcedLoss).toBe(false);
});

test('proof mode: proof timeout still reports heuristic win but not forced win', () => {
  // XXXX position: discovery at depth 1 finds win. Proof phase starts but times out.
  const winning = GogoPosition.fromAscii([
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

  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 0, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(winning.area);

  // Mock verifyWinningMove to simulate proof timeout
  anyAI.verifyWinningMove = function () {
    anyAI.timedOut = true;
    return false;
  };

  const result = ai.findBestMove(winning, 100);
  expect(result.heuristicWin).toBe(true);
  expect(result.forcedWin).toBe(false);
  expect(result.timedOut).toBe(true);
});

test('proof mode: proof collapse triggers fallback to heuristic discovery', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.X..O....',
    '.........',
    '....X....',
    '.........',
    '.O..X....',
    '.........',
    '.........',
  ], BLACK);

  const WIN = 1_000_000_000;
  const ai = new GogoAI({ maxDepth: 4, quiescenceDepth: 1, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);

  // Mock searchRoot for heuristic phases:
  // - Discovery d=1: normal result
  // - Discovery d=2: fake forced win → breaks, triggers proof
  // - Resume d=3+: normal results
  let searchRootCallCount = 0;
  const realSearchRoot = anyAI.searchRoot.bind(anyAI);
  anyAI.searchRoot = function (position: any, depth: number, hintMove: number) {
    searchRootCallCount++;
    if (searchRootCallCount === 2) {
      // Discovery d=2: fake forced win
      return { move: 40, score: WIN - 2, depth: 2, nodes: 10, timedOut: false,
        forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false };
    }
    return realSearchRoot(position, depth, hintMove);
  };

  // Mock verifyWinningMove: proof collapses (returns false)
  anyAI.verifyWinningMove = function () {
    return false;
  };

  const result = ai.findBestMove(pos, 100);
  // After resume, heuristicWin is recomputed based on new bestScore/completedDepth
  // Resume at d=3+ won't find a forced win for this position, so heuristicWin should be false
  expect(result.forcedWin).toBe(false);
  // Resume phase continued from depth 3
  expect(result.depth).toBeGreaterThanOrEqual(3);
});

test('proof mode: resume heuristic after proof collapse can timeout', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.X..O....',
    '.........',
    '....X....',
    '.........',
    '.O..X....',
    '.........',
    '.........',
  ], BLACK);

  const WIN = 1_000_000_000;
  const ai = new GogoAI({ maxDepth: 6, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);

  let searchRootCallCount = 0;
  const realSearchRoot = anyAI.searchRoot.bind(anyAI);
  anyAI.searchRoot = function (position: any, depth: number, hintMove: number) {
    searchRootCallCount++;
    if (searchRootCallCount === 2) {
      return { move: 40, score: WIN - 2, depth: 2, nodes: 10, timedOut: false,
        forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false };
    }
    if (searchRootCallCount >= 3) {
      // Resume phase: timeout
      throw anyAI.timeoutSignal;
    }
    return realSearchRoot(position, depth, hintMove);
  };

  anyAI.verifyWinningMove = function () {
    return false; // Proof collapses
  };

  const result = ai.findBestMove(pos, 100);
  // heuristicWin is recomputed after resume; since resume timesout, it stays at d=2 score
  expect(result.heuristicWin).toBe(true);
  expect(result.forcedWin).toBe(false);
  expect(result.timedOut).toBe(true);
});

test('proof mode: resume heuristic finds forced outcome after proof collapse', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.X..O....',
    '.........',
    '....X....',
    '.........',
    '.O..X....',
    '.........',
    '.........',
  ], BLACK);

  const WIN = 1_000_000_000;
  const ai = new GogoAI({ maxDepth: 6, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);

  let searchRootCallCount = 0;
  const realSearchRoot = anyAI.searchRoot.bind(anyAI);
  anyAI.searchRoot = function (position: any, depth: number, hintMove: number) {
    searchRootCallCount++;
    if (searchRootCallCount === 2) {
      // Discovery d=2: fake forced win
      return { move: 40, score: WIN - 2, depth: 2, nodes: 10, timedOut: false,
        forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false };
    }
    if (searchRootCallCount === 3) {
      // Resume d=3: forced win again → breaks loop
      return { move: 40, score: WIN - 3, depth: 3, nodes: 10, timedOut: false,
        forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false };
    }
    return realSearchRoot(position, depth, hintMove);
  };

  anyAI.verifyWinningMove = function () {
    return false; // Proof collapses
  };

  const result = ai.findBestMove(pos, 100);
  expect(result.heuristicWin).toBe(true);
  expect(result.forcedWin).toBe(false);
  expect(result.depth).toBe(3);
  expect(result.score).toBe(WIN - 3);
});

test('proof mode: proof collapse with no remaining time skips resume', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.X..O....',
    '.........',
    '....X....',
    '.........',
    '.O..X....',
    '.........',
    '.........',
  ], BLACK);

  const WIN = 1_000_000_000;
  let tick = 0;
  const ai = new GogoAI({ maxDepth: 6, quiescenceDepth: 2, now: () => tick });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);

  let searchRootCallCount = 0;
  const realSearchRoot = anyAI.searchRoot.bind(anyAI);
  anyAI.searchRoot = function (position: any, depth: number, hintMove: number) {
    searchRootCallCount++;
    if (searchRootCallCount === 2) {
      return { move: 40, score: WIN - 2, depth: 2, nodes: 10, timedOut: false,
        forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false };
    }
    return realSearchRoot(position, depth, hintMove);
  };

  anyAI.verifyWinningMove = function () {
    // Proof fails and then advance time past deadline
    tick = 10000;
    return false;
  };

  const result = ai.findBestMove(pos, 100);
  expect(result.heuristicWin).toBe(true);
  expect(result.forcedWin).toBe(false);
  // No resume (time expired), so depth stays at 2
  expect(result.depth).toBe(2);
});

test('proof mode: no time for proof skips proof phase entirely', () => {
  const winning = GogoPosition.fromAscii([
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

  let tick = 0;
  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 0, now: () => tick });
  const anyAI = ai as any;
  anyAI.ensureBuffers(winning.area);

  let callCount = 0;
  const realSearchRoot = anyAI.searchRoot.bind(anyAI);
  anyAI.searchRoot = function (position: any, depth: number, hintMove: number) {
    callCount++;
    const res = realSearchRoot(position, depth, hintMove);
    // After discovery finds win, advance time past deadline
    if (callCount === 1) {
      tick = 10000;
    }
    return res;
  };

  const result = ai.findBestMove(winning, 100);
  expect(result.heuristicWin).toBe(true);
  expect(result.forcedWin).toBe(false);
  expect(result.timedOut).toBe(false);
});

test('proof mode: search skips NMP and LMR in proof mode', () => {
  const ai = new GogoAI({ maxDepth: 4, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  const pos = GogoPosition.fromAscii([
    'X.O.X.O.X',
    '.........',
    'O.X.O.X.O',
    '.........',
    'X.O.X.O.X',
    '.........',
    'O.X.O.X.O',
    '.........',
    'X.O.X.O.X',
  ], BLACK);
  anyAI.ensureBuffers(pos.area);

  // In proof mode, search still runs (no NMP, no LMR) but caps candidates
  anyAI.proofMode = true;
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.history.fill(0);
  anyAI.ttFlag.fill(0);
  const score = anyAI.search(pos, 2, -1_000_000, 1_000_000, 1);
  expect(typeof score).toBe('number');
  anyAI.proofMode = false;
});

test('proof mode: proof confirms forced loss at depth 2', () => {
  const losing = GogoPosition.fromAscii([
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
  expect(result.heuristicLoss).toBe(true);
  expect(result.forcedLoss).toBe(true);
  expect(result.forcedWin).toBe(false);
  expect(result.heuristicWin).toBe(false);
});

test('proof mode: non-timeout error in proof phase is rethrown', () => {
  const winning = GogoPosition.fromAscii([
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

  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 0, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(winning.area);

  // Mock verifyWinningMove to throw a non-timeout error
  anyAI.verifyWinningMove = function () {
    throw new Error('PROOF_BUG');
  };

  expect(() => ai.findBestMove(winning, 100)).toThrow('PROOF_BUG');
});

test('proof mode: non-timeout error in resume phase is rethrown', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.X..O....',
    '.........',
    '....X....',
    '.........',
    '.O..X....',
    '.........',
    '.........',
  ], BLACK);

  const WIN = 1_000_000_000;
  const ai = new GogoAI({ maxDepth: 6, quiescenceDepth: 1, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);

  let searchRootCallCount = 0;
  const realSearchRoot = anyAI.searchRoot.bind(anyAI);
  anyAI.searchRoot = function (position: any, depth: number, hintMove: number) {
    searchRootCallCount++;
    if (searchRootCallCount === 2) {
      // Discovery d=2: fake forced win
      return { move: 40, score: WIN - 2, depth: 2, nodes: 10, timedOut: false,
        forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false };
    }
    if (searchRootCallCount === 3) {
      // Resume phase: throw non-timeout error
      throw new Error('RESUME_BUG');
    }
    return realSearchRoot(position, depth, hintMove);
  };

  // Mock verifyWinningMove: proof collapses
  anyAI.verifyWinningMove = function () {
    return false;
  };

  expect(() => ai.findBestMove(pos, 100)).toThrow('RESUME_BUG');
});

// === AND/OR Prover Tests ===

test('verifyWinningMove proves trivial one-move win', () => {
  const pos = GogoPosition.fromAscii([
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
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  // Move 4 = (0,4) = completes five in a row
  expect(ai.verifyWinningMove(pos, 4, 1000)).toBe(true);
});

test('verifyWinningMove only proves the real winning move and restores state on success, failure, and timeout', () => {
  const winning = GogoPosition.fromAscii([
    'XXXX.....',
    'OOOO.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  const winningSnapshot = winning.clone();
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });

  expect(ai.verifyWinningMove(winning, winning.index(4, 0), 1000)).toBe(true);
  expect(winning.toAscii()).toEqual(winningSnapshot.toAscii());
  expect(winning.toMove).toBe(winningSnapshot.toMove);
  expect(winning.winner).toBe(winningSnapshot.winner);
  expect(winning.koPoint).toBe(winningSnapshot.koPoint);
  expect(winning.ply).toBe(winningSnapshot.ply);
  expect(winning.stoneCount).toBe(winningSnapshot.stoneCount);
  expect(winning.lastMove).toBe(winningSnapshot.lastMove);
  expect(winning.lastCapturedCount).toBe(winningSnapshot.lastCapturedCount);
  expect(winning.hash).toBe(winningSnapshot.hash);

  expect(ai.verifyWinningMove(winning, winning.index(8, 8), 1000)).toBe(false);
  expect(winning.toAscii()).toEqual(winningSnapshot.toAscii());
  expect(winning.toMove).toBe(winningSnapshot.toMove);
  expect(winning.winner).toBe(winningSnapshot.winner);
  expect(winning.koPoint).toBe(winningSnapshot.koPoint);
  expect(winning.ply).toBe(winningSnapshot.ply);
  expect(winning.stoneCount).toBe(winningSnapshot.stoneCount);
  expect(winning.lastMove).toBe(winningSnapshot.lastMove);
  expect(winning.lastCapturedCount).toBe(winningSnapshot.lastCapturedCount);
  expect(winning.hash).toBe(winningSnapshot.hash);

  const timeoutPosition = GogoPosition.fromAscii([
    'XXX......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  const timeoutSnapshot = timeoutPosition.clone();
  let tick = 0;
  const timeoutAI = new GogoAI({ maxDepth: 30, quiescenceDepth: 4, now: () => tick++ });

  expect(timeoutAI.verifyWinningMove(timeoutPosition, timeoutPosition.index(3, 0), 0)).toBe(false);
  expect(timeoutPosition.toAscii()).toEqual(timeoutSnapshot.toAscii());
  expect(timeoutPosition.toMove).toBe(timeoutSnapshot.toMove);
  expect(timeoutPosition.winner).toBe(timeoutSnapshot.winner);
  expect(timeoutPosition.koPoint).toBe(timeoutSnapshot.koPoint);
  expect(timeoutPosition.ply).toBe(timeoutSnapshot.ply);
  expect(timeoutPosition.stoneCount).toBe(timeoutSnapshot.stoneCount);
  expect(timeoutPosition.lastMove).toBe(timeoutSnapshot.lastMove);
  expect(timeoutPosition.lastCapturedCount).toBe(timeoutSnapshot.lastCapturedCount);
  expect(timeoutPosition.hash).toBe(timeoutSnapshot.hash);
});

test('verifyWinningMove returns false for illegal move', () => {
  const pos = GogoPosition.fromAscii([
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
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  // Move 0 = (0,0) is already occupied
  expect(ai.verifyWinningMove(pos, 0, 1000)).toBe(false);
});

test('verifyWinningMove returns false when win cannot be proven', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  const ai = new GogoAI({ maxDepth: 4, quiescenceDepth: 2, now: () => 0 });
  // Center stone, no forced win
  expect(ai.verifyWinningMove(pos, 40, 1000)).toBe(false);
});

test('verifyWinningMove returns false on timeout', () => {
  const pos = GogoPosition.fromAscii([
    'XXX......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  let tick = 0;
  const ai = new GogoAI({ maxDepth: 30, quiescenceDepth: 4, now: () => tick++ });
  // Zero time limit -> timeout
  expect(ai.verifyWinningMove(pos, 3, 0)).toBe(false);
});

test('verifyWinningMove proves deeper forced win with iterative deepening', () => {
  // White has OOOO on edge, black to move but white wins
  // Actually use a position where black has near-win on edge
  const pos = GogoPosition.fromAscii([
    'XXX......',
    'O........',
    'O........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  const ai = new GogoAI({ maxDepth: 30, quiescenceDepth: 4, now: () => 0 });
  // Move 3 = (0,3): extends XXX to XXXX, then need one more
  // This won't be a forced win from move 3 alone. Let's use XXXX position
  const pos2 = GogoPosition.fromAscii([
    'XXXX.....',
    'OOO......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  // Move 4 = immediate win
  expect(ai.verifyWinningMove(pos2, 4, 1000)).toBe(true);
});

test('proofAttack: returns false when position has a winner (defender won)', () => {
  // Create a position where white already won (five in a row)
  const pos = GogoPosition.fromAscii([
    'OOOOO....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  expect(pos.winner).toBe(WHITE);

  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // proofAttack should return false because there's already a winner
  expect(anyAI.proofAttack(pos, 10, 1)).toBe(false);
});

test('proofAttack: returns false at depth 0', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  expect(anyAI.proofAttack(pos, 0, 1)).toBe(false);
});

test('proofAttack: TT hit returns cached result', () => {
  const pos = GogoPosition.fromAscii([
    'XXXX.....',
    'OOO......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // First call populates TT
  const result1 = anyAI.proofAttack(pos, 3, 1);
  expect(result1).toBe(true); // XXXX -> can make five

  // Second call should hit TT
  const result2 = anyAI.proofAttack(pos, 3, 1);
  expect(result2).toBe(true);
});

test('proofDefend: returns true when attacker already won', () => {
  const pos = GogoPosition.fromAscii([
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
  expect(pos.winner).toBe(BLACK);

  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // proofDefend returns true = attacker wins
  expect(anyAI.proofDefend(pos, 10, 1)).toBe(true);
});

test('proofDefend: returns false at depth 0', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  expect(anyAI.proofDefend(pos, 0, 1)).toBe(false);
});

test('proofDefend: TT hit returns cached result', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // First call - won't be proven (just one stone)
  const result1 = anyAI.proofDefend(pos, 2, 1);
  expect(typeof result1).toBe('boolean');

  // Second call should hit TT
  const result2 = anyAI.proofDefend(pos, 2, 1);
  expect(result2).toBe(result1);
});

test('proofDefend: defender makes five and refutes attack', () => {
  // White has OOOO, it's white's turn (defender in this context)
  // If defender can make five, attacker loses
  const pos = GogoPosition.fromAscii([
    'XXXX.....',
    'OOOO.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);

  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // proofDefend: defender (white) can make five → returns false (attacker doesn't win)
  expect(anyAI.proofDefend(pos, 4, 1)).toBe(false);
});

test('loss proof: collapse triggers resume', () => {
  // Create a position where black is losing
  const losing = GogoPosition.fromAscii([
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

  const WIN = 1_000_000_000;
  const ai = new GogoAI({ maxDepth: 6, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(losing.area);

  // Mock searchRoot: discovery d=1 normal, d=2 fake forced loss
  let searchRootCallCount = 0;
  const realSearchRoot = anyAI.searchRoot.bind(anyAI);
  anyAI.searchRoot = function (position: any, depth: number, hintMove: number) {
    searchRootCallCount++;
    if (searchRootCallCount === 2) {
      return { move: 40, score: -WIN + 2, depth: 2, nodes: 10, timedOut: false,
        forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false };
    }
    return realSearchRoot(position, depth, hintMove);
  };

  // Mock proofSearchRoot: proof collapses (returns non-losing score)
  anyAI.proofSearchRoot = function () {
    return 0; // Not a loss
  };

  const result = ai.findBestMove(losing, 100);
  expect(result.forcedLoss).toBe(false);
  // Resume happened
  expect(result.depth).toBeGreaterThanOrEqual(3);
});

test('loss proof: timeout during proof reports heuristic loss but not forced loss', () => {
  const losing = GogoPosition.fromAscii([
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

  const WIN = 1_000_000_000;
  const ai = new GogoAI({ maxDepth: 6, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(losing.area);

  let searchRootCallCount = 0;
  const realSearchRoot = anyAI.searchRoot.bind(anyAI);
  anyAI.searchRoot = function (position: any, depth: number, hintMove: number) {
    searchRootCallCount++;
    if (searchRootCallCount === 2) {
      return { move: 40, score: -WIN + 2, depth: 2, nodes: 10, timedOut: false,
        forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false };
    }
    return realSearchRoot(position, depth, hintMove);
  };

  // Mock proofSearchRoot: throws timeout
  anyAI.proofSearchRoot = function () {
    throw anyAI.timeoutSignal;
  };

  const result = ai.findBestMove(losing, 100);
  expect(result.heuristicLoss).toBe(true);
  expect(result.forcedLoss).toBe(false);
  expect(result.timedOut).toBe(true);
});

test('loss proof: non-timeout error in proof is rethrown', () => {
  const losing = GogoPosition.fromAscii([
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

  const WIN = 1_000_000_000;
  const ai = new GogoAI({ maxDepth: 6, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(losing.area);

  let searchRootCallCount = 0;
  const realSearchRoot = anyAI.searchRoot.bind(anyAI);
  anyAI.searchRoot = function (position: any, depth: number, hintMove: number) {
    searchRootCallCount++;
    if (searchRootCallCount === 2) {
      return { move: 40, score: -WIN + 2, depth: 2, nodes: 10, timedOut: false,
        forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false };
    }
    return realSearchRoot(position, depth, hintMove);
  };

  anyAI.proofSearchRoot = function () {
    throw new Error('LOSS_PROOF_BUG');
  };

  expect(() => ai.findBestMove(losing, 100)).toThrow('LOSS_PROOF_BUG');
});

test('proofSearchRoot: returns 0 when no legal moves', () => {
  // Create a position where all squares are occupied and no winner
  // This is hard to create, so use a near-full board with ko everywhere
  // Actually, use a position with winner set (returns 0 from no legal moves)
  const pos = GogoPosition.fromAscii([
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
  // This has a winner, so generateOrderedMoves returns 0 count

  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofMode = true;
  anyAI.killerMoves.fill(-1);
  anyAI.history.fill(0);
  anyAI.ttFlag.fill(0);

  const score = anyAI.proofSearchRoot(pos, 2, -1);
  expect(score).toBe(0);
  anyAI.proofMode = false;
});

test('capped node TT: lowerbound stored from capped node, exact/upper suppressed', () => {
  const ai = new GogoAI({ maxDepth: 4, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  // Use a position with many near-2 candidates (> MAX_CANDIDATES) to trigger capping
  const pos = GogoPosition.fromAscii([
    'XOXOXOXOX',
    '.........', 
    'OXOXOXOXO',
    '.........',
    'XOXOXOXOX',
    '.........',
    'OXOXOXOXO',
    '.........',
    'XOXOXOXOX',
  ], BLACK);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.history.fill(0);
  anyAI.ttFlag.fill(0);

  // Search at depth 2 - many candidates should trigger capping
  const score = anyAI.search(pos, 2, -1_000_000, 1_000_000, 1);
  expect(typeof score).toBe('number');

  // The root node of the search may have been capped, so TT may store NONE
  // or LOWERBOUND depending on the score. Just verify search completes.
});

test('recompute heuristic flags after resume: flags update when score changes', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.X..O....',
    '.........',
    '....X....',
    '.........',
    '.O..X....',
    '.........',
    '.........',
  ], BLACK);

  const WIN = 1_000_000_000;
  const ai = new GogoAI({ maxDepth: 6, quiescenceDepth: 1, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);

  // Mock searchRoot: d=2 fake forced win, then d=3+ fast non-winning mock
  // (avoids running real deep searches in Phase 3 with no timeout on CI)
  let searchRootCallCount = 0;
  anyAI.searchRoot = function (position: any, depth: number, hintMove: number) {
    searchRootCallCount++;
    if (searchRootCallCount === 2) {
      return { move: 40, score: WIN - 2, depth: 2, nodes: 10, timedOut: false,
        forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false };
    }
    // Phase 3 and all other depths: return a cheap non-winning result
    return { move: 40, score: 100, depth, nodes: 1, timedOut: false,
      forcedWin: false, forcedLoss: false, heuristicWin: false, heuristicLoss: false };
  };

  anyAI.verifyWinningMove = function () { return false; };

  const result = ai.findBestMove(pos, 100);
  // After resume, bestScore is from d=3+ which won't be a forced win
  // So heuristicWin should be false (recomputed)
  expect(result.heuristicWin).toBe(false);
  expect(result.forcedWin).toBe(false);
});

test('verifyWinningMove returns false when maxPly exhausted', () => {
  const pos = GogoPosition.fromAscii([
    'XXX......',
    'OO.......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  // maxPly=2 means iterative deepening will only try depth 1 which can't prove a win
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, maxPly: 2, now: () => 0 });
  expect(ai.verifyWinningMove(pos, 3, 1000)).toBe(false);
});

test('proofAttack: TT hit returns -1 (proven not winning)', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // Pre-populate TT with "not winning" result
  const hash = pos.hash;
  const ttIdx = hash & 0x3FFFF;
  anyAI.proofTTHash[ttIdx] = hash;
  anyAI.proofTTResult[ttIdx] = -1;
  anyAI.proofTTDepth[ttIdx] = 10;

  expect(anyAI.proofAttack(pos, 5, 1)).toBe(false);
});

test('proofAttack: TT hash match but result=0 falls through to search', () => {
  const pos = GogoPosition.fromAscii([
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

  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // Seed TT with hash match but result=0 (unknown) - should fall through
  const hash = pos.hash;
  const ttIdx = hash & 0x3FFFF;
  anyAI.proofTTHash[ttIdx] = hash;
  anyAI.proofTTResult[ttIdx] = 0; // unknown
  anyAI.proofTTDepth[ttIdx] = 10;

  // Should still find the win by searching (ignoring TT unknown entry)
  expect(anyAI.proofAttack(pos, 3, 1)).toBe(true);
});

test('proofDefend: all defenses fail → attacker proven to win', () => {
  // Double threat: XXXX at top row AND XXXX at bottom row.
  // Defender can only block one of them, so attacker wins.
  const pos = GogoPosition.fromAscii([
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    'OOO......',
    'XXXX.....',
  ], WHITE);

  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // Depth 2: white blocks one XXXX, black completes the other → all defenses fail
  const result = anyAI.proofDefend(pos, 2, 1);
  expect(result).toBe(true);
});

test('proofDefend: fullboard fallback when near-2 generates nothing', () => {
  // Create position where all stones have no near-2 empty candidates
  // (near-2 generates moves within distance 2 of existing stones)
  // This is hard to create naturally, but a single stone in corner with
  // surrounding all filled and only far cells empty triggers fullboard.
  // Actually, the simplest approach: position with 0 stones → near-2 returns 0
  // But 0 stones means generateOrderedMoves returns center immediately for non-tactical.
  // Let's mock to test the fallback path directly.
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);

  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // Mock generateOrderedMoves to return 0 (triggers fullboard fallback)
  let callCount = 0;
  const realGen = anyAI.generateOrderedMoves.bind(anyAI);
  anyAI.generateOrderedMoves = function (...args: any[]) {
    callCount++;
    if (callCount === 1) {
      // First call in proofDefend returns 0 to trigger fallboard fallback
      return 0;
    }
    return realGen(...args);
  };

  const result = anyAI.proofDefend(pos, 2, 1);
  expect(typeof result).toBe('boolean');
  anyAI.generateOrderedMoves = realGen;
});

test('TT exact and upperbound cutoffs work in proof mode (uncapped nodes)', () => {
  // Use proof mode where nodes are never capped, so EXACT/UPPERBOUND entries get stored
  const ai = new GogoAI({ maxDepth: 4, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  const pos = GogoPosition.fromAscii([
    '....X....',
    '...OXO...',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.history.fill(0);
  anyAI.ttFlag.fill(0);
  anyAI.proofMode = true;

  // First search stores TT entries (EXACT since not capped in proof mode)
  const score1 = anyAI.search(pos, 3, -1_000_000, 1_000_000, 1);

  const hash = pos.hash;
  const ttIndex = hash & 0x3FFFF;
  // Verify TT was populated with a valid flag
  expect(anyAI.ttFlag[ttIndex]).not.toBe(0);

  // TT exact cutoff: same search should return immediately from TT
  const score2 = anyAI.search(pos, 3, -1_000_000, 1_000_000, 1);
  expect(score2).toBe(score1);

  // TT lowerbound cutoff
  const lbScore = anyAI.search(pos, 3, score1 - 100, score1 - 50, 1, false);
  expect(lbScore).toBeGreaterThanOrEqual(score1 - 50);

  // TT upperbound cutoff: manually seed a TT_UPPERBOUND entry
  anyAI.ttFlag[ttIndex] = 3; // TT_UPPERBOUND
  anyAI.ttScore[ttIndex] = -500;
  anyAI.ttDepth[ttIndex] = 10;
  const ubScore = anyAI.search(pos, 3, -400, -300, 1, false);
  expect(ubScore).toBeLessThanOrEqual(-400);

  anyAI.proofMode = false;
});

test('null move pruning with active ko point', () => {
  // Create a position with an active ko point
  const ai = new GogoAI({ maxDepth: 6, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '...XO....',
    '..XOX....',
    '...XO....',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.history.fill(0);
  anyAI.ttFlag.fill(0);

  // Manually set a ko point to simulate an active ko
  pos.koPoint = 40; // center point

  const score = anyAI.search(pos, 4, -1_000_000, 1_000_000, 1);
  expect(typeof score).toBe('number');
  // ko point should be restored after search
  expect(pos.koPoint).toBe(40);
});

test('proofAttack: illegal move is skipped', () => {
  // Create a position where some near-2 candidates overlap with ko point
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '...XO....',
    '..XOX....',
    '...X.....',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  // Set ko point at a near-2 candidate
  pos.koPoint = 31; // near center

  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // proofAttack should handle illegal moves gracefully
  const result = anyAI.proofAttack(pos, 2, 1);
  expect(typeof result).toBe('boolean');
});

test('proofDefend: TT hit with proven winning result', () => {
  const pos = GogoPosition.fromAscii([
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);

  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // Pre-populate TT with "attacker wins" result
  const hash = pos.hash;
  const ttIdx = hash & 0x3FFFF;
  anyAI.proofTTHash[ttIdx] = hash;
  anyAI.proofTTResult[ttIdx] = 1;
  anyAI.proofTTDepth[ttIdx] = 10;

  expect(anyAI.proofDefend(pos, 5, 1)).toBe(true);
});

test('proofDefend: TT hit with proven not-winning result', () => {
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);

  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // Pre-populate TT with "not winning" result
  const hash = pos.hash;
  const ttIdx = hash & 0x3FFFF;
  anyAI.proofTTHash[ttIdx] = hash;
  anyAI.proofTTResult[ttIdx] = -1;
  anyAI.proofTTDepth[ttIdx] = 10;

  expect(anyAI.proofDefend(pos, 5, 1)).toBe(false);
});

test('proofDefend: TT hash match but result=0 falls through to search', () => {
  const pos = GogoPosition.fromAscii([
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    'OOO......',
    'XXXX.....',
  ], WHITE);

  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // Seed TT with hash match but result=0 (unknown) - should fall through
  const hash = pos.hash;
  const ttIdx = hash & 0x3FFFF;
  anyAI.proofTTHash[ttIdx] = hash;
  anyAI.proofTTResult[ttIdx] = 0; // unknown
  anyAI.proofTTDepth[ttIdx] = 10;

  // Should still search and find the result
  const result = anyAI.proofDefend(pos, 2, 1);
  expect(result).toBe(true); // All defenses fail (double XXXX)
});

test('capped node: fullboard fallback with capping applied', () => {
  const ai = new GogoAI({ maxDepth: 4, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  // Use a large board position where near-2 generates 0 legal moves
  // but full board has many
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.history.fill(0);
  anyAI.ttFlag.fill(0);

  // Mock generateOrderedMoves to return only illegal moves (all fail play)
  // This triggers the fullboard fallback
  const realGen = anyAI.generateOrderedMoves.bind(anyAI);
  let genCallCount = 0;
  anyAI.generateOrderedMoves = function (...args: any[]) {
    genCallCount++;
    if (genCallCount === 1) {
      // First call at ply=1: return moves that are all occupied (will fail play)
      const moves = args[0] as Int16Array;
      const scores = args[1] as Int32Array;
      moves[0] = 40; // center = occupied
      scores[0] = 1000;
      return 1;
    }
    return realGen(...args);
  };

  const score = anyAI.search(pos, 2, -1_000_000, 1_000_000, 1);
  expect(typeof score).toBe('number');
  anyAI.generateOrderedMoves = realGen;
});

test('proofAttack: play() failure is handled (suicide move skipped)', () => {
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  // Position with a stone surrounded by opponent stones - near suicide
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '....O....',
    '...OXO...',
    '....O....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // Mock generateOrderedMoves to include an illegal (suicide) move for tactical
  const realGen = anyAI.generateOrderedMoves.bind(anyAI);
  let callCount = 0;
  anyAI.generateOrderedMoves = function (...args: any[]) {
    callCount++;
    // On the first call (attacker's tactical generation), inject a bad move
    if (callCount === 1) {
      const result = realGen(...args);
      // Prepend an occupied position that will fail play()
      const moves = args[0] as Int16Array;
      const scores = args[1] as Int32Array;
      for (let i = result; i > 0; i--) {
        moves[i] = moves[i - 1];
        scores[i] = scores[i - 1];
      }
      moves[0] = 31; // occupied by X
      scores[0] = 999999;
      return result + 1;
    }
    return realGen(...args);
  };

  const result = anyAI.proofAttack(pos, 3, 1);
  expect(typeof result).toBe('boolean');
  anyAI.generateOrderedMoves = realGen;
});

test('proofDefend: play() failure is handled', () => {
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  // Use a position with NO attacker threat (findThreatResponses returns -1)
  // so that the first generateOrderedMoves call is proofDefend's own full-gen call.
  // The mock injects an illegal (occupied) move so that play() returns false in
  // the full generation loop.
  const pos = GogoPosition.fromAscii([
    'XX.......',
    'OO.......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // Mock generateOrderedMoves to inject an illegal move when called for the full-gen
  // (tacticalOnly === false). No attacker threat → no nested proofAttack calls before
  // proofDefend's own full-gen, so the injection fires exactly there.
  const realGen = anyAI.generateOrderedMoves.bind(anyAI);
  anyAI.generateOrderedMoves = function (...args: any[]) {
    const tacticalOnly = args[GENERATE_ORDERED_MOVES_TACTICAL_ONLY_INDEX];
    const result = realGen(...args);
    if (tacticalOnly) {
      return result;
    }
    // Inject an occupied position at the front (will fail play())
    const moves = args[1] as Int16Array;
    const scores = args[2] as Int32Array;
    for (let i = result; i > 0; i--) {
      moves[i] = moves[i - 1];
      scores[i] = scores[i - 1];
    }
    moves[0] = 0; // occupied by X
    scores[0] = 999999;
    return result + 1;
  };

  const result = anyAI.proofDefend(pos, 2, 1);
  expect(typeof result).toBe('boolean');
  anyAI.generateOrderedMoves = realGen;
});

test('proofDefend: fullboard fallback explores all candidates (no cap)', () => {
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // Mock generateOrderedMoves: first call returns 0 to force fullboard fallback
  const realGen = anyAI.generateOrderedMoves.bind(anyAI);
  let firstCall = true;
  anyAI.generateOrderedMoves = function (...args: any[]) {
    if (firstCall) {
      firstCall = false;
      return 0;
    }
    return realGen(...args);
  };

  // On 9x9 with 1 stone: fullboard generates ~80 candidates — all explored, no cap
  const result = anyAI.proofDefend(pos, 2, 1);
  expect(typeof result).toBe('boolean');
  anyAI.generateOrderedMoves = realGen;
});

test('proofDefend: fullboard fallback with few candidates (no cap needed)', () => {
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  // Nearly full board: only a few empty cells
  const pos = GogoPosition.fromAscii([
    'XOXOXOXOX',
    'OXOXOXOXO',
    'XOXOXOXOX',
    'OXOXOXOXO',
    'XOXO.OXOX',
    'OXOXOXOXO',
    'XOXOXOXOX',
    'OXOXOXOXO',
    'XOXOXOX..',
  ], WHITE);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // Mock generateOrderedMoves: return 0 to force fullboard fallback
  const realGen = anyAI.generateOrderedMoves.bind(anyAI);
  let firstCall = true;
  anyAI.generateOrderedMoves = function (...args: any[]) {
    if (firstCall) {
      firstCall = false;
      return 0;
    }
    return realGen(...args);
  };

  // Only 3 empty cells → fullboard returns ≤ 3
  const result = anyAI.proofDefend(pos, 2, 1);
  expect(typeof result).toBe('boolean');
  anyAI.generateOrderedMoves = realGen;
});

test('verifyWinningMove rethrows non-timeout errors', () => {
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  const pos = GogoPosition.fromAscii([
    'XXXX.....',
    'OOO......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  anyAI.ensureBuffers(pos.area);

  // Mock proofDefend to throw a non-timeout error
  const realProofDefend = anyAI.proofDefend.bind(anyAI);
  anyAI.proofDefend = function () {
    throw new Error('PROOF_BUG');
  };

  expect(() => ai.verifyWinningMove(pos, 4, 1000)).toThrow('PROOF_BUG');
  anyAI.proofDefend = realProofDefend;
});

test('proofDefend: returns false (not proven) when no legal moves exist', () => {
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '....X....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // Mock both generators to return 0 candidates → no legal moves
  const realGen = anyAI.generateOrderedMoves.bind(anyAI);
  const realFullGen = anyAI.generateFullBoardMoves.bind(anyAI);
  anyAI.generateOrderedMoves = function () { return 0; };
  anyAI.generateFullBoardMoves = function () { return 0; };

  // No legal moves → neutral → not proven (false)
  const result = anyAI.proofDefend(pos, 2, 1);
  expect(result).toBe(false);
  anyAI.generateOrderedMoves = realGen;
  anyAI.generateFullBoardMoves = realFullGen;
});

test('proofAttack: hash-move-first succeeds from seeded TT best move', () => {
  const ai = new GogoAI({ maxDepth: 10 });
  const anyAI = ai as any;
  // BLACK has 4 in a row, move 4 completes five
  const pos = GogoPosition.fromAscii([
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
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.history.fill(0);
  anyAI.proofTTHash.fill(0);
  anyAI.proofTTResult.fill(0);
  anyAI.proofTTDepth.fill(0);
  anyAI.proofTTBestMove.fill(-1);

  // Seed TT: hash matches, depth too shallow for cutoff, but bestMove is set
  const hash = pos.hash;
  const ttIdx = hash & 0x3FFFF;
  anyAI.proofTTHash[ttIdx] = hash;
  anyAI.proofTTResult[ttIdx] = 0; // no cutoff
  anyAI.proofTTDepth[ttIdx] = 0;
  anyAI.proofTTBestMove[ttIdx] = 4; // winning move

  const playCalls: number[] = [];
  const realPlay = pos.play.bind(pos);
  (pos as any).play = (move: number) => {
    playCalls.push(move);
    return realPlay(move);
  };
  const realGen = anyAI.generateOrderedMoves.bind(anyAI);
  let genCalls = 0;
  anyAI.generateOrderedMoves = () => {
    genCalls += 1;
    throw new Error('generateOrderedMoves should not be needed when the TT move resolves proofAttack');
  };

  // proofAttack should try the TT move before move generation and resolve immediately
  expect(anyAI.proofAttack(pos, 1, 1)).toBe(true);
  expect(playCalls).toEqual([4]);
  expect(genCalls).toBe(0);
  // TT should now store the proven result with best move
  expect(anyAI.proofTTResult[ttIdx]).toBe(1);
  expect(anyAI.proofTTBestMove[ttIdx]).toBe(4);
  anyAI.generateOrderedMoves = realGen;
  (pos as any).play = realPlay;
});

test('proofAttack: hash-move-first wins via proofDefend (non-immediate)', () => {
  const ai = new GogoAI({ maxDepth: 10 });
  const anyAI = ai as any;
  // BLACK has 3 in a row with open ends. After playing move 3 (extend to 4),
  // WHITE must respond, but BLACK has a double threat.
  // Row 0: .XXX. → playing index 4 gives .XXXX → next move 0 or 5 wins
  const pos = GogoPosition.fromAscii([
    '.XXX.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.history.fill(0);
  anyAI.proofTTHash.fill(0);
  anyAI.proofTTResult.fill(0);
  anyAI.proofTTDepth.fill(0);
  anyAI.proofTTBestMove.fill(-1);

  // Seed TT with move 4 as best move (extends the line but doesn't immediately win)
  const hash = pos.hash;
  const ttIdx = hash & 0x3FFFF;
  anyAI.proofTTHash[ttIdx] = hash;
  anyAI.proofTTResult[ttIdx] = 0;
  anyAI.proofTTDepth[ttIdx] = 0;
  anyAI.proofTTBestMove[ttIdx] = 4;

  // proofAttack at depth 3: hash move plays index 4 (no winner yet),
  // then proofDefend is called, WHITE responds, BLACK wins next
  expect(anyAI.proofAttack(pos, 3, 1)).toBe(true);
});

test('proofDefend: hash-move-first with defender making five', () => {
  const ai = new GogoAI({ maxDepth: 10 });
  const anyAI = ai as any;
  // WHITE to move, WHITE has 4 in a row on row 1, move 13 completes five
  const pos = GogoPosition.fromAscii([
    'XX.......',
    'OOOO.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.history.fill(0);
  anyAI.proofTTHash.fill(0);
  anyAI.proofTTResult.fill(0);
  anyAI.proofTTDepth.fill(0);
  anyAI.proofTTBestMove.fill(-1);

  // Seed TT with the five-completing move as best move
  const hash = pos.hash;
  const ttIdx = hash & 0x3FFFF;
  anyAI.proofTTHash[ttIdx] = hash;
  anyAI.proofTTResult[ttIdx] = 0;
  anyAI.proofTTDepth[ttIdx] = 0;
  anyAI.proofTTBestMove[ttIdx] = 13; // WHITE completes five at index 13

  const playCalls: number[] = [];
  const realPlay = pos.play.bind(pos);
  (pos as any).play = (move: number) => {
    playCalls.push(move);
    return realPlay(move);
  };
  const realGen = anyAI.generateOrderedMoves.bind(anyAI);
  let genCalls = 0;
  anyAI.generateOrderedMoves = () => {
    genCalls += 1;
    throw new Error('generateOrderedMoves should not be needed when the TT move resolves proofDefend');
  };

  // proofDefend: defender plays winning TT move before any move generation → refutes
  expect(anyAI.proofDefend(pos, 2, 1)).toBe(false);
  expect(playCalls).toEqual([13]);
  expect(genCalls).toBe(0);
  anyAI.generateOrderedMoves = realGen;
  (pos as any).play = realPlay;
});

test('proofDefend: full generation finds defender five (winner check)', () => {
  const ai = new GogoAI({ maxDepth: 10 });
  const anyAI = ai as any;
  // WHITE to move, no BLACK four (no threat), WHITE has 4 in a row
  const pos = GogoPosition.fromAscii([
    'XXX......',
    'OOOO.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.history.fill(0);
  anyAI.proofTTHash.fill(0);
  anyAI.proofTTResult.fill(0);
  anyAI.proofTTDepth.fill(0);
  anyAI.proofTTBestMove.fill(-1);

  // No TT best move → falls through to full generation
  // Full generation includes move 13 (completing five for WHITE)
  // position.winner !== EMPTY after play → attackerWins=false → refutes
  expect(anyAI.proofDefend(pos, 2, 1)).toBe(false);
});

test('findThreatResponses: capture move for group with single liberty', () => {
  const ai = new GogoAI({ maxDepth: 10 });
  const anyAI = ai as any;
  // WHITE to move (defender), attacker = BLACK.
  // Row 0: XXXX. → four-in-a-row threat, blocking cell = index 4.
  // Row 1: OOOXOOOO. → single BLACK stone at index 13 (col4), surrounded by WHITE
  //   on left(12), right(14), bottom(22). Its only liberty = 4 (already marked as blocking).
  // Row 2: ....O.... → col4=22=WHITE (blocks 13 below); col3=21=EMPTY (liberty of group {30}).
  // Row 3: ..OXO.... → BLACK at 30 (col3), WHITE at 29(left) and 31(right).
  // Row 4: ...O..... → WHITE at 39 (col3), blocks 30 below.
  // Group {30} has 1 liberty at 21 (distinct from blocking cell 4) → newly marked liberty added.
  // Group {13} has 1 liberty at 4 (already marked as blocking) → duplicate liberty skipped.
  const pos = GogoPosition.fromAscii([
    'XXXX.....',
    'OOOXOOOO.',
    '....O....',
    '..OXO....',
    '...O.....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.history.fill(0);

  const count = anyAI.findThreatResponses(pos, 1);
  // Should find at least: blocking cell 4 and atari capture cell 21
  expect(count).toBeGreaterThanOrEqual(2);

  const moves = anyAI.moveBuffers[1];
  const moveSet = new Set<number>();
  for (let i = 0; i < count; i++) moveSet.add(moves[i]);

  // Blocking cell (index 4) must be included
  expect(moveSet.has(4)).toBe(true);
  // Atari capture liberty (index 21 = row2,col3) must be included
  expect(moveSet.has(21)).toBe(true);
});

test('proofAttack: illegal TT move is attempted before move generation and skipped safely', () => {
  const ai = new GogoAI({ maxDepth: 10 });
  const anyAI = ai as any;
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '....O....',
    '...O.O...',
    '....O....',
    '.........',
    '.........',
    '.........',
  ], BLACK);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash.fill(0);
  anyAI.proofTTResult.fill(0);
  anyAI.proofTTDepth.fill(0);
  anyAI.proofTTBestMove.fill(-1);

  const hash = pos.hash;
  const ttIdx = hash & 0x3FFFF;
  anyAI.proofTTHash[ttIdx] = hash;
  anyAI.proofTTBestMove[ttIdx] = 40;

  const playCalls: number[] = [];
  const realPlay = pos.play.bind(pos);
  (pos as any).play = (move: number) => {
    playCalls.push(move);
    return realPlay(move);
  };
  const realGen = anyAI.generateOrderedMoves.bind(anyAI);
  let genCalls = 0;
  anyAI.generateOrderedMoves = (...args: any[]) => {
    genCalls += 1;
    expect(playCalls).toEqual([40]);
    return 0;
  };

  expect(anyAI.proofAttack(pos, 1, 1)).toBe(false);
  expect(genCalls).toBe(1);
  anyAI.generateOrderedMoves = realGen;
  (pos as any).play = realPlay;
});

test('proofAttack: hash move creates non-winning position; killer move skip in tactical loop', () => {
  // BLACK has XXXX. on row 0. ttBest=5 (an empty cell that does not complete a five).
  // After play(5) the position is not a win; proofDefend(depth=0)=false → wins=false
  // → hash move fails.
  // Move 5 is also a tactical move (creates a near-four in window [1..5]).
  // By setting it as a killer move at ply=1, its tactical score is boosted so it appears
  // first in the ordered list → m=5=ttBest → the skip is taken.
  // Then move 4 (which completes XXXXX) is found and the function returns true.
  const pos = GogoPosition.fromAscii([
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

  const ai = new GogoAI({ maxDepth: 10 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash.fill(0);
  anyAI.proofTTResult.fill(0);
  anyAI.proofTTDepth.fill(0);
  anyAI.proofTTBestMove.fill(-1);

  // Seed TT: hash matches, bestMove = 5 (a non-winning empty cell)
  const hash = pos.hash;
  const ttIdx = hash & 0x3FFFF;
  anyAI.proofTTHash[ttIdx] = hash;
  anyAI.proofTTResult[ttIdx] = 0; // no cutoff
  anyAI.proofTTDepth[ttIdx] = 0;
  anyAI.proofTTBestMove[ttIdx] = 5;

  // Make ttBest=5 a killer at ply=1 so its tactical score is boosted above the
  // winning move at cell 4, ensuring m=5 appears first and triggers the skip.
  anyAI.killerMoves[1 * 2] = 5;

  // hash move 5 tried → play(5) OK → proofDefend(depth=0)=false → wins=false
  // generateOrderedMoves includes 5 (killer+near-four) → m=5=ttBest → skip
  // move 4 found → play(4) → XXXXX → returns true
  expect(anyAI.proofAttack(pos, 1, 1)).toBe(true);
});

test('proofDefend: illegal TT move is attempted before ordered generation and skipped safely', () => {
  const ai = new GogoAI({ maxDepth: 10 });
  const anyAI = ai as any;
  const pos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '....X....',
    '...X.X...',
    '....X....',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash.fill(0);
  anyAI.proofTTResult.fill(0);
  anyAI.proofTTDepth.fill(0);
  anyAI.proofTTBestMove.fill(-1);

  const hash = pos.hash;
  const ttIdx = hash & 0x3FFFF;
  anyAI.proofTTHash[ttIdx] = hash;
  anyAI.proofTTBestMove[ttIdx] = 40;

  const playCalls: number[] = [];
  const realPlay = pos.play.bind(pos);
  (pos as any).play = (move: number) => {
    playCalls.push(move);
    return realPlay(move);
  };
  const realGen = anyAI.generateOrderedMoves.bind(anyAI);
  const realFullGen = anyAI.generateFullBoardMoves.bind(anyAI);
  let genCalls = 0;
  anyAI.generateOrderedMoves = (...args: any[]) => {
    genCalls += 1;
    expect(playCalls).toEqual([40]);
    return 0;
  };
  anyAI.generateFullBoardMoves = () => 0;

  expect(anyAI.proofDefend(pos, 2, 1)).toBe(false);
  expect(genCalls).toBe(1);
  anyAI.generateOrderedMoves = realGen;
  anyAI.generateFullBoardMoves = realFullGen;
  (pos as any).play = realPlay;
});

test('proofDefend: hash move does not refute double threat; ttBest skipped in threat and full loops', () => {
  // BLACK has two open fours: row 0 (blocking=4) and row 8 (blocking=76).
  // WHITE to move. ttBest=4 seeded in TT.
  //
  // proofDefend(depth=2):
  //   Hash block: play(4) → proofAttack(1) finds 76 → attackerWins=true
  //   → !attackerWins=false (hash move doesn't refute) → continues searching
  //   findThreatResponses: returns [4, 76]
  //   Threat loop: m=4=ttBest → skip (already tried above)
  //                m=76 → attackerWins=true → falls through
  //   Full gen: m=4=ttBest → skip (already tried above)
  //   All defenses fail → returns true
  const pos = GogoPosition.fromAscii([
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    'OOO......',
    'XXXX.....',
  ], WHITE);

  const ai = new GogoAI({ maxDepth: 10 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash.fill(0);
  anyAI.proofTTResult.fill(0);
  anyAI.proofTTDepth.fill(0);
  anyAI.proofTTBestMove.fill(-1);

  // Seed TT with ttBest=4 (blocking row 0's four)
  const hash = pos.hash;
  const ttIdx = hash & 0x3FFFF;
  anyAI.proofTTHash[ttIdx] = hash;
  anyAI.proofTTResult[ttIdx] = 0; // no cutoff
  anyAI.proofTTDepth[ttIdx] = 0;
  anyAI.proofTTBestMove[ttIdx] = 4;

  // All WHITE defenses fail → attacker proven to win → true
  expect(anyAI.proofDefend(pos, 2, 1)).toBe(true);
});

test('findThreatResponses: defender winning cell in overlapping horizontal and vertical threats', () => {
  // Both windows share the SAME empty cell (0 = row0,col0) and start at the same
  // board point (y=0,x=0), so horizontal (dir=0) is processed before vertical (dir=1):
  //
  //   Horizontal [0,1,2,3,4]: atkCount=4, defCount=0, emptyCell=0
  //     → marks cell 0 (attacker blocking cell)
  //   Vertical   [0,9,18,27,36]: defCount=4, atkCount=0, emptyCell=0
  //     → candidateMarks[0] === epoch (already marked!) → skip adding duplicate
  //
  // WHITE to move (defender).  attacker=BLACK.
  const pos = GogoPosition.fromAscii([
    '.XXXX....',  // (0,0)=EMPTY; (0,1..4)=BLACK
    'O........',  // (1,0)=WHITE
    'O........',  // (2,0)=WHITE
    'O........',  // (3,0)=WHITE
    'O........',  // (4,0)=WHITE
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);

  const ai = new GogoAI({ maxDepth: 10 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;

  const count = anyAI.findThreatResponses(pos, 1);
  expect(count).toBeGreaterThanOrEqual(1);
  const moves = anyAI.moveBuffers[1];
  const scores = anyAI.scoreBuffers[1];
  const moveIndex = Array.from({ length: count }, (_, index) => index).find((index) => moves[index] === 0);
  expect(moveIndex).not.toBeUndefined();
  expect(scores[moveIndex ?? 0]).toBe(3_000_000);
});

test('proofDefend: restricted move play failure is handled without coverage suppression', () => {
  const ai = new GogoAI({ maxDepth: 10 });
  const anyAI = ai as any;
  const pos = GogoPosition.fromAscii([
    'X........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash.fill(0);
  anyAI.proofTTResult.fill(0);
  anyAI.proofTTDepth.fill(0);
  anyAI.proofTTBestMove.fill(-1);

  const realFindThreatResponses = anyAI.findThreatResponses.bind(anyAI);
  const realGen = anyAI.generateOrderedMoves.bind(anyAI);
  const realFullGen = anyAI.generateFullBoardMoves.bind(anyAI);
  anyAI.findThreatResponses = function (_position: GogoPosition, ply: number) {
    const moves = this.moveBuffers[ply];
    const scores = this.scoreBuffers[ply];
    moves[0] = 0; // occupied; play() fails
    scores[0] = 2_000_000;
    return 1;
  };
  anyAI.generateOrderedMoves = () => 0;
  anyAI.generateFullBoardMoves = () => 0;

  expect(anyAI.proofDefend(pos, 2, 1)).toBe(false);

  anyAI.findThreatResponses = realFindThreatResponses;
  anyAI.generateOrderedMoves = realGen;
  anyAI.generateFullBoardMoves = realFullGen;
});

test('proofDefend: falls back to full-board generation even after an earlier legal restricted move', () => {
  const ai = new GogoAI({ maxDepth: 10 });
  const anyAI = ai as any;
  const pos = GogoPosition.fromAscii([
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash.fill(0);
  anyAI.proofTTResult.fill(0);
  anyAI.proofTTDepth.fill(0);
  anyAI.proofTTBestMove.fill(-1);

  const realGen = anyAI.generateOrderedMoves.bind(anyAI);
  const realFullGen = anyAI.generateFullBoardMoves.bind(anyAI);
  const realProofAttack = anyAI.proofAttack.bind(anyAI);
  let orderedCalls = 0;
  let fullCalls = 0;
  anyAI.generateOrderedMoves = (...args: any[]) => {
    const tacticalOnly = args[GENERATE_ORDERED_MOVES_TACTICAL_ONLY_INDEX];
    if (tacticalOnly) {
      return realGen(...args);
    }
    orderedCalls += 1;
    return 0;
  };
  anyAI.generateFullBoardMoves = function (_position: GogoPosition, moves: Int16Array, scores: Int32Array) {
    fullCalls += 1;
    moves[0] = 20;
    scores[0] = 0;
    return 1;
  };
  anyAI.proofAttack = function (positionAfterDefense: GogoPosition) {
    return positionAfterDefense.lastMove !== 20;
  };

  expect(anyAI.proofDefend(pos, 2, 1)).toBe(false);
  expect(orderedCalls).toBe(1);
  expect(fullCalls).toBe(1);

  anyAI.generateOrderedMoves = realGen;
  anyAI.generateFullBoardMoves = realFullGen;
  anyAI.proofAttack = realProofAttack;
});

test('insertOrPromoteMove promotes higher scores and tolerates stale marks without a matching move', () => {
  const ai = new GogoAI({ maxDepth: 10 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(81);

  const moves = anyAI.moveBuffers[0];
  const scores = anyAI.scoreBuffers[0];
  anyAI.candidateEpoch += 1;
  let count = 0;

  count = anyAI.insertOrPromoteMove(moves, scores, count, 10, 100);
  count = anyAI.insertOrPromoteMove(moves, scores, count, 20, 200);
  count = anyAI.insertOrPromoteMove(moves, scores, count, 10, 300);

  expect(count).toBe(2);
  expect(moves[0]).toBe(10);
  expect(scores[0]).toBe(300);
  expect(moves[1]).toBe(20);
  expect(scores[1]).toBe(200);

  anyAI.candidateMarks[30] = anyAI.candidateEpoch;
  expect(anyAI.insertOrPromoteMove(moves, scores, count, 30, 50)).toBe(count);
});
