import test from 'node:test';
import assert from 'node:assert/strict';

import { BLACK, EMPTY, GogoAI, GogoPosition, WHITE } from '../browser-demo/build/src/index.js';

function position(rows, toMove = BLACK) {
  return GogoPosition.fromAscii(rows, toMove);
}

function rawPosition(rows, toMove = BLACK) {
  const game = position(rows, toMove);
  game.winner = EMPTY;
  return game;
}

test('AI chooses the center on an empty board, handles immediate timeout, and handles terminal states', () => {
  const empty = new GogoPosition(9);
  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 2 });
  const result = ai.findBestMove(empty, 100);
  assert.equal(result.move, empty.index(4, 4));
  assert.equal(result.timedOut, false);
  assert.ok(result.depth >= 1);

  let tick = 0;
  const timeoutAI = new GogoAI({ maxDepth: 4, now: () => tick++ });
  const timeoutResult = timeoutAI.findBestMove(new GogoPosition(9), 0);
  assert.equal(timeoutResult.move, 40);
  assert.equal(timeoutResult.depth, 0);
  assert.equal(timeoutResult.timedOut, true);

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
  assert.equal(terminalResult.move, -1);
  assert.equal(terminalResult.timedOut, false);
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
  assert.equal(win.move, winning.index(4, 0));
  assert.ok(win.score > 100000);

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
  assert.equal(block.move, blocking.index(5, 4));

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
  assert.equal(timeout.move, 40);
  assert.equal(timeout.timedOut, true);
  assert.equal(timeout.depth, 1);
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
  assert.equal(result.timedOut, true);
  assert.ok(result.depth >= 1);

  // The position must be identical to before the search.
  assert.equal(pos.ply, plyBefore);
  assert.equal(pos.toMove, toMoveBefore);
  assert.deepEqual(Array.from(pos.board), boardBefore);
  // And it must still be playable.
  assert.equal(pos.playXY(3, 3), true);
});

test('AI rethrows unexpected root errors instead of masking them as timeouts', () => {
  const ai = new GogoAI({ maxDepth: 1 });
  const anyAI = /** @type {any} */ (ai);
  anyAI.searchRoot = () => {
    throw new Error('boom');
  };
  assert.throws(() => ai.findBestMove(new GogoPosition(9), 100), /boom/);
});

test('AI constructor clamps explicit maxPly values', () => {
  const ai = new GogoAI({ maxPly: 1, maxDepth: 0, quiescenceDepth: -1 });
  assert.equal(ai.maxPly, 2);
  assert.equal(ai.maxDepth, 1);
  assert.equal(ai.quiescenceDepth, 0);
});

test('AI constructor also uses default search parameters when options are omitted', () => {
  const ai = new GogoAI();
  assert.equal(ai.maxDepth, 6);
  assert.equal(ai.quiescenceDepth, 6);
  assert.equal(ai.maxPly, 64);
});

test('white-box AI helpers cover generation, evaluation, quiescence, search fallback, insertion ordering, and timing', () => {
  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 2, now: () => 0 });
  const anyAI = /** @type {any} */ (ai);
  const empty = new GogoPosition(9);
  anyAI.ensureBuffers(empty.area);

  const emptyMoves = anyAI.moveBuffers[0];
  const emptyScores = anyAI.scoreBuffers[0];
  assert.equal(anyAI.generateOrderedMoves(empty, emptyMoves, emptyScores, -1, false), 1);
  assert.equal(emptyMoves[0], empty.index(4, 4));
  assert.equal(anyAI.generateOrderedMoves(empty, emptyMoves, emptyScores, -1, true), 0);

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
  assert.equal(anyAI.scoreMove(quiet, quiet.index(0, 0), -1, true), Number.NEGATIVE_INFINITY);
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
  assert.notEqual(anyAI.scoreMove(tactical, tactical.index(4, 0), -1, true), Number.NEGATIVE_INFINITY);

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
  assert.ok(blackEval > 0);
  assert.ok(whiteEval < 0);

  anyAI.deadline = 1;
  const betaCut = anyAI.quiescence(tactical, -1000, 0, 0, 2);
  assert.ok(betaCut >= 0);
  assert.equal(anyAI.quiescence(evalPosition, -1000, 1000, 0, 0), whiteEval);

  const full = new GogoPosition(9);
  full.board.fill(BLACK);
  full.stoneCount = full.area;
  full.winner = EMPTY;
  full.toMove = WHITE;
  anyAI.ensureBuffers(full.area);
  assert.equal(anyAI.generateOrderedMoves(full, anyAI.moveBuffers[0], anyAI.scoreBuffers[0], -1, false), 0);
  assert.equal(anyAI.generateFullBoardMoves(full, anyAI.moveBuffers[0], anyAI.scoreBuffers[0], -1, false), 0);
  const root = anyAI.searchRoot(full, 1, -1);
  assert.equal(root.move, -1);
  assert.equal(root.score, 0);
  assert.equal(anyAI.search(full, 1, -100, 100, 0), 0);

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
  assert.equal(anyAI.generateOrderedMoves(won, anyAI.moveBuffers[0], anyAI.scoreBuffers[0], -1, false), 0);
  won.winner = EMPTY;
  assert.ok(anyAI.generateFullBoardMoves(won, anyAI.moveBuffers[0], anyAI.scoreBuffers[0], -1, false) > 0);
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
  assert.equal(anyAI.generateFullBoardMoves(quietFull, anyAI.moveBuffers[0], anyAI.scoreBuffers[0], -1, true), 0);

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
  assert.equal(anyAI.quiescence(terminalQ, -1000, 1000, 3, 2), -1000000000 + 3);

  const fallbackAI = new GogoAI({ maxDepth: 1, now: () => 0 });
  const anyFallback = /** @type {any} */ (fallbackAI);
  anyFallback.ensureBuffers(81);
  const fake = {
    stoneCount: 1,
    size: 9,
    play(move) { return move === 1; },
    undo() { return true; },
  };
  anyFallback.generateOrderedMoves = (_position, moves) => { moves[0] = 0; return 1; };
  anyFallback.generateFullBoardMoves = (_position, moves) => { moves[0] = 1; return 1; };
  assert.equal(anyFallback.pickFallbackMove(fake), 1);
  anyFallback.generateFullBoardMoves = () => 0;
  assert.equal(anyFallback.pickFallbackMove(fake), -1);

  const illegalAI = new GogoAI({ maxDepth: 2, now: () => 0 });
  const anyIllegal = /** @type {any} */ (illegalAI);
  anyIllegal.ensureBuffers(81);
  anyIllegal.deadline = 1;
  const noPlay = new GogoPosition(9);
  noPlay.play = () => false;
  noPlay.undo = () => true;
  anyIllegal.generateOrderedMoves = (_position, moves) => { moves[0] = 0; return 1; };
  anyIllegal.generateFullBoardMoves = () => 0;
  const illegalRoot = anyIllegal.searchRoot(noPlay, 1, -1);
  assert.equal(illegalRoot.move, -1);
  assert.equal(anyIllegal.search(noPlay, 1, -100, 100, 0), 0);
  anyIllegal.generateOrderedMoves = (_position, moves) => { moves[0] = 0; return 1; };
  noPlay.winner = EMPTY;
  assert.equal(anyIllegal.quiescence(noPlay, -100, 100, 0, 2), anyIllegal.evaluate(noPlay));

  const moves = new Int16Array(4);
  const scores = new Int32Array(4);
  anyAI.insertMove(moves, scores, 0, 10, 5);
  anyAI.insertMove(moves, scores, 1, 12, 9);
  anyAI.insertMove(moves, scores, 2, 14, 7);
  assert.deepEqual(Array.from(moves.slice(0, 3)), [12, 14, 10]);
  assert.deepEqual(Array.from(scores.slice(0, 3)), [9, 7, 5]);

  anyAI.deadline = 0;
  anyAI.nodesVisited = 0;
  assert.throws(() => anyAI.checkTime(true), /SEARCH_TIMEOUT/);
  anyAI.deadline = 1;
  anyAI.nodesVisited = 1;
  assert.doesNotThrow(() => anyAI.checkTime(false));
});

test('searchRoot uses PVS: null-window for non-first moves, full re-search on null-window fail-high', () => {
  // Replace the private `search` method with a stub to control return values precisely.
  // call 0: first legal move, full window  → return  100 (score = -100, alpha becomes -100)
  // call 1: second move, null window       → return -200 (score = 200 > -100 = alpha → fail-high!)
  // call 2: second move, full re-search    → return -150 (score = 150 > -100; new best)
  // call 3+: remaining candidates          → return    0
  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 0, now: () => 0 });
  const anyAI = /** @type {any} */ (ai);
  const pos = new GogoPosition(9);
  pos.playXY(4, 4);
  anyAI.ensureBuffers(pos.area);
  anyAI.history.fill(0);
  anyAI.deadline = 1;
  anyAI.nodesVisited = 0;

  const calls = [];
  anyAI.search = function (_p, depth, alpha, beta, _ply) {
    const idx = calls.length;
    calls.push({ depth, alpha, beta });
    if (idx === 0) return 100;
    if (idx === 1) return -200;
    if (idx === 2) return -150;
    return 0;
  };
  try {
    const result = anyAI.searchRoot(pos, 2, -1);
    // At least 3 sub-search calls: full-window, null-window, full re-search.
    assert.ok(calls.length >= 3, 'PVS re-search was not triggered');
    // call 0: full window (-WIN_SCORE … WIN_SCORE)
    assert.equal(calls[0].alpha, -1_000_000_000);
    assert.equal(calls[0].beta,   1_000_000_000);
    // call 1: null window after alpha = -100; child sees (99, 100)
    assert.equal(calls[1].alpha, 99);
    assert.equal(calls[1].beta,  100);
    // call 2: full re-search; child sees (-WIN_SCORE, 100) = (-1e9, -alpha)
    assert.equal(calls[2].alpha, -1_000_000_000);
    assert.equal(calls[2].beta,   100);
    assert.ok(result.move !== -1);
  } finally {
    delete anyAI.search;
  }
});

test('search applies LMR for late quiet moves: covers canReduce=true with both score>alpha and score<=alpha branches', () => {
  // A single quiet stone at the centre guarantees that ALL candidate moves are
  // non-tactical (attack < TACTICAL_PATTERN_THRESHOLD) so LMR fires for legalCount>3.
  //
  // To cover the `if (score > alpha)` TRUE branch (lines 211-212) we intercept the
  // very first LMR reduced-depth call (depth === 1, ply === 1) and return beta-1,
  // which makes  score = -(beta-1) = alpha+1 > alpha  so the full-depth null-window
  // on line 211 is reached.  All subsequent interceptable calls fall through to the
  // real implementation which exercises the FALSE branch (score <= alpha) naturally.
  const ai = new GogoAI({ maxDepth: 4, quiescenceDepth: 0, now: () => 0 });
  const anyAI = /** @type {any} */ (ai);

  const pos = rawPosition([
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
  anyAI.ensureBuffers(pos.area);
  anyAI.history.fill(0);
  anyAI.nodesVisited = 0;
  anyAI.timedOut = false;
  anyAI.deadline = 1;

  let intercepted = false;
  anyAI.search = function (position, depth, alpha, beta, ply) {
    // The LMR reduced-depth call from search(pos, 3, ..., ply=0) is the only
    // call that arrives with depth=1 AND ply=1 (all other depth-1 calls are at ply≥2).
    // Returning beta-1 forces score = -(beta-1) = alpha+1 > alpha → B1=true.
    if (!intercepted && depth === 1 && ply === 1) {
      intercepted = true;
      return beta - 1;
    }
    return Object.getPrototypeOf(this).search.call(this, position, depth, alpha, beta, ply);
  };
  try {
    const score = anyAI.search(pos, 3, -1_000_000_000, 1_000_000_000, 0);
    assert.ok(intercepted, 'LMR reduced-depth call was not intercepted');
    assert.ok(typeof score === 'number');
  } finally {
    delete anyAI.search;
  }

  // A separate direct call (no wrapper) lets the real implementation run at depth=3,
  // exercising the canReduce=true path and the score<=alpha branch (B1=false) naturally.
  anyAI.history.fill(0);
  anyAI.nodesVisited = 0;
  anyAI.timedOut = false;
  const score2 = anyAI.search(pos, 3, -1_000_000_000, 1_000_000_000, 0);
  assert.ok(typeof score2 === 'number');
  assert.ok(score2 > -1_000_000_000);

  // findBestMove at depth 4 also exercises LMR inside the iterative-deepening loop.
  anyAI.nodesVisited = 0;
  anyAI.timedOut = false;
  const result = ai.findBestMove(pos, 1000);
  assert.ok(result.move !== -1);
  assert.ok(result.depth >= 1);
});

test('scoreMove deduplicates adjacent groups that wrap around the candidate from multiple sides', () => {
  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 2, now: () => 0 });
  const anyAI = /** @type {any} */ (ai);

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
  assert.equal(anyAI.scoreMove(oppDedup, oppDedup.index(3, 2), -1, false), 7318);

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
  assert.equal(anyAI.scoreMove(playerDedup, playerDedup.index(3, 2), -1, false), 6080);
});
