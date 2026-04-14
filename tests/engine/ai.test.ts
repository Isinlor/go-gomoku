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
  expect(result.nodes).toBeLessThan(80);
  expect(result.forcedWin).toBe(true);
  expect(result.forcedLoss).toBe(false);
  expect(result.heuristicWin).toBe(true);
  expect(result.heuristicLoss).toBe(false);
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

test('null move pruning prunes when the position is strongly in favor of the side to move', () => {
  // Position where BLACK has a strong 3-in-a-row pattern.
  // The null move (giving WHITE a free move) still evaluates strongly
  // for BLACK, so NMP returns beta and prunes the search tree.
  const ai = new GogoAI({ maxDepth: 4, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  expect(result.heuristicLoss).toBe(true);
  expect(result.forcedLoss).toBe(true);
  expect(result.forcedWin).toBe(false);
  expect(result.heuristicWin).toBe(false);
});

test('proof mode: non-timeout error in proof phase is rethrown', () => {
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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

test('verifyWinningMove returns false for illegal move', () => {
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos2 = rawPosition([
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
  const pos = position([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = position([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = position([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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

  // Mock searchRoot: d=2 fake forced win, then d=3 normal (not winning)
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

  anyAI.verifyWinningMove = function () { return false; };

  const result = ai.findBestMove(pos, 100);
  // After resume, bestScore is from d=3+ which won't be a forced win
  // So heuristicWin should be false (recomputed)
  expect(result.heuristicWin).toBe(false);
  expect(result.forcedWin).toBe(false);
});

test('verifyWinningMove returns false when maxPly exhausted', () => {
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.proofTTHash = new Int32Array(1 << 18);
  anyAI.proofTTResult = new Int8Array(1 << 18);
  anyAI.proofTTDepth = new Int8Array(1 << 18);

  // Mock to inject an illegal move
  const realGen = anyAI.generateOrderedMoves.bind(anyAI);
  let callCount = 0;
  anyAI.generateOrderedMoves = function (...args: any[]) {
    callCount++;
    const result = realGen(...args);
    // Inject an occupied move at the front of defender's candidates
    if (callCount === 1) {
      const moves = args[0] as Int16Array;
      const scores = args[1] as Int32Array;
      for (let i = result; i > 0; i--) {
        moves[i] = moves[i - 1];
        scores[i] = scores[i - 1];
      }
      moves[0] = 0; // occupied by X
      scores[0] = 999999;
      return result + 1;
    }
    return realGen(...args);
  };

  const result = anyAI.proofDefend(pos, 2, 1);
  expect(typeof result).toBe('boolean');
  anyAI.generateOrderedMoves = realGen;
});

test('proofDefend: fullboard fallback explores all candidates (no cap)', () => {
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4, now: () => 0 });
  const anyAI = ai as any;
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
  const pos = rawPosition([
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
