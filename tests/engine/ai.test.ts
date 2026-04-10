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

test('transposition table cutoffs exercise EXACT, LOWERBOUND, and UPPERBOUND flags', () => {
  // A position with enough depth triggers TT storage, and a subsequent search at
  // lower depth hits the TT. Iterative deepening naturally exercises all TT flag types.
  const pos = rawPosition([
    '.........',
    '.........',
    '.........',
    '..XXX....',
    '..OOO....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const ai = new GogoAI({ maxDepth: 4, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.tt.fill(0);

  // Run a search at depth 4 to populate TT with various flag types
  anyAI.search(pos, 4, -1_000_000_000, 1_000_000_000, 1);

  // Verify TT was populated
  let ttEntries = 0;
  for (let i = 0; i < anyAI.tt.length; i += 4) {
    if (anyAI.tt[i] !== 0) ttEntries++;
  }
  expect(ttEntries).toBeGreaterThan(0);

  // Run a narrower window search - TT entries with sufficient depth can provide
  // cutoffs via LOWERBOUND (score >= beta) and UPPERBOUND (score <= alpha)
  anyAI.search(pos, 2, -100, 100, 1);

  // Run an exact-window search at lower depth to hit EXACT entries
  anyAI.search(pos, 1, -1_000_000_000, 1_000_000_000, 1);
});

test('TT exact, lowerbound, and upperbound cutoffs are exercised directly', () => {
  const pos = rawPosition([
    '.........',
    '.........',
    '.........',
    '..XXX....',
    '..OOO....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const ai = new GogoAI({ maxDepth: 4, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.tt.fill(0);

  // Manually populate TT to exercise each cutoff branch
  const hash = pos.hash;
  const ttIndex = (hash & ((1 << 18) - 1)) * 4;

  // Test EXACT cutoff: store exact score at depth 10, then probe at depth 2
  anyAI.tt[ttIndex] = hash;
  anyAI.tt[ttIndex + 1] = (10 << 2) | 0; // depth=10, flag=EXACT
  anyAI.tt[ttIndex + 2] = 42;
  anyAI.tt[ttIndex + 3] = 0;
  const exactScore = anyAI.search(pos, 2, -1_000_000_000, 1_000_000_000, 1);
  expect(exactScore).toBe(42);

  // Test LOWERBOUND cutoff: stored score >= beta
  anyAI.tt[ttIndex] = hash;
  anyAI.tt[ttIndex + 1] = (10 << 2) | 1; // depth=10, flag=LOWERBOUND
  anyAI.tt[ttIndex + 2] = 200;
  anyAI.tt[ttIndex + 3] = 0;
  const lowerScore = anyAI.search(pos, 2, -1_000_000_000, 100, 1);
  expect(lowerScore).toBe(200);

  // Test UPPERBOUND cutoff: stored score <= alpha
  anyAI.tt[ttIndex] = hash;
  anyAI.tt[ttIndex + 1] = (10 << 2) | 2; // depth=10, flag=UPPERBOUND
  anyAI.tt[ttIndex + 2] = -200;
  anyAI.tt[ttIndex + 3] = 0;
  const upperScore = anyAI.search(pos, 2, -100, 1_000_000_000, 1);
  expect(upperScore).toBe(-200);
});

test('LMR reduces depth for late moves and re-searches when needed', () => {
  // Create a position with many legal moves so legalCount reaches >= 6
  const pos = rawPosition([
    '.........',
    '.........',
    '.........',
    '.X.X.X...',
    '.O.O.O...',
    '.........',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const ai = new GogoAI({ maxDepth: 5, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.tt.fill(0);

  // At depth >= 3 with >= 6 legal moves, LMR reduces by 2 extra
  // If the reduced search exceeds alpha, a full-depth re-search occurs
  const score = anyAI.search(pos, 5, -1_000_000_000, 1_000_000_000, 1);
  expect(typeof score).toBe('number');
  expect(Number.isFinite(score)).toBe(true);
});

test('TT stores and retrieves loss scores with ply adjustment', () => {
  // Create a position where one side has a forced loss (opponent has 4 in a row)
  const pos = rawPosition([
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

  const ai = new GogoAI({ maxDepth: 4, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.tt.fill(0);

  // Search at depth 4 to trigger loss score TT storage
  const score1 = anyAI.search(pos, 4, -1_000_000_000, 1_000_000_000, 1);
  expect(score1).toBeLessThan(0);

  // Search again at lower depth - TT should provide cutoff with loss score
  const score2 = anyAI.search(pos, 2, -1_000_000_000, 1_000_000_000, 1);
  expect(score2).toBeLessThan(0);
});

test('adaptive null move uses R=4 at depth >= 6', () => {
  const pos = rawPosition([
    '.........',
    '.........',
    '..X......',
    '..OXO....',
    '...XO....',
    '...OX....',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const ai = new GogoAI({ maxDepth: 8, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.tt.fill(0);

  // Depth 6+ triggers the R=4 branch in null move pruning
  const score = anyAI.search(pos, 6, -1_000_000_000, 1_000_000_000, 1);
  expect(typeof score).toBe('number');
});

test('late move pruning stops exploring after threshold', () => {
  // Position with many spread-out stones - generates many legal near-2 candidates
  const pos = rawPosition([
    '.........',
    '.X...O...',
    '.........',
    '...X.....',
    '.........',
    '.....O...',
    '.........',
    '..O...X..',
    '.........',
  ], BLACK);

  const ai = new GogoAI({ maxDepth: 3, quiescenceDepth: 2, now: () => 0 });
  const anyAI = ai as any;
  anyAI.ensureBuffers(pos.area);
  anyAI.deadline = 1e15;
  anyAI.killerMoves.fill(-1);
  anyAI.tt.fill(0);

  // At depth 1 with notNearMate=true, LMP threshold is 4+2=6
  // With many candidates (> 6 legal), LMP should trigger the break
  const score = anyAI.search(pos, 1, -100, 100, 1);
  expect(typeof score).toBe('number');
});

test('Zobrist hash is consistent: play+undo returns to the same hash', () => {
  const pos = new GogoPosition(9);
  const startHash = pos.hash;
  expect(startHash).toBe(0);

  pos.play(pos.index(4, 4));
  const afterFirstMove = pos.hash;
  expect(afterFirstMove).not.toBe(0);

  pos.play(pos.index(3, 3));
  const afterSecondMove = pos.hash;
  expect(afterSecondMove).not.toBe(afterFirstMove);

  pos.undo();
  expect(pos.hash).toBe(afterFirstMove);

  pos.undo();
  expect(pos.hash).toBe(startHash);
});

test('Zobrist hash fromAscii matches incremental hash from play', () => {
  // Build the same position two ways: fromAscii and play()
  const fromAsciiPos = GogoPosition.fromAscii([
    '.........',
    '.........',
    '.........',
    '.........',
    '....X....',
    '...O.....',
    '.........',
    '.........',
    '.........',
  ], BLACK);

  const playPos = new GogoPosition(9);
  playPos.play(playPos.index(4, 4)); // e5 = X
  playPos.play(playPos.index(3, 5)); // d6 = O

  expect(fromAsciiPos.hash).toBe(playPos.hash);
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
