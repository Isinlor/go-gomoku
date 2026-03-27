import test from 'node:test';
import assert from 'node:assert/strict';

import { BLACK, EMPTY, GogoAI, GogoPosition, TT_ALPHA, TT_BETA, TT_EXACT, TranspositionTable, WHITE } from '../browser-demo/build/src/index.js';

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

test('TranspositionTable covers all probe branches, and recomputeZobristHash includes the ko-point key', () => {
  // --- TranspositionTable unit tests (size=16 for fast initialisation) ---
  const tt = new TranspositionTable(16);

  // 1. Hash miss: slot is empty.
  assert.equal(tt.probe(1, 2, 1, -100, 100), false);
  assert.equal(tt.probeMove, -1);

  // 2. TT_EXACT hit: score read and returned directly.
  tt.store(1, 2, 3, 500, TT_EXACT, 5);
  assert.equal(tt.probe(1, 2, 3, -100, 100), true);
  assert.equal(tt.probeScore, 500);
  assert.equal(tt.probeMove, 5);

  // 3. Depth miss: stored depth (3) < requested depth (4), but move hint is still set.
  assert.equal(tt.probe(1, 2, 4, -100, 100), false);
  assert.equal(tt.probeMove, 5);

  // 4. TT_ALPHA hit: stored score (-150) <= alpha (-100) => return alpha.
  tt.store(3, 4, 2, -150, TT_ALPHA, 7);
  assert.equal(tt.probe(3, 4, 2, -100, 100), true);
  assert.equal(tt.probeScore, -100);
  assert.equal(tt.probeMove, 7);

  // 5. TT_ALPHA miss: stored score (50) > alpha (-100) => no cutoff, falls through to return false.
  tt.store(5, 6, 2, 50, TT_ALPHA, 8);
  assert.equal(tt.probe(5, 6, 2, -100, 100), false);

  // 6. TT_BETA hit: stored score (200) >= beta (100) => return beta.
  tt.store(7, 8, 2, 200, TT_BETA, 9);
  assert.equal(tt.probe(7, 8, 2, -100, 100), true);
  assert.equal(tt.probeScore, 100);
  assert.equal(tt.probeMove, 9);

  // 7. TT_BETA miss: stored score (50) < beta (100) => no cutoff, falls through to return false.
  tt.store(9, 10, 2, 50, TT_BETA, 10);
  assert.equal(tt.probe(9, 10, 2, -100, 100), false);

  // 8. clear() wipes all entries.
  tt.clear();
  assert.equal(tt.probe(1, 2, 3, -100, 100), false);
  assert.equal(tt.probeMove, -1);

  // --- recomputeZobristHash with an active ko point ---
  const pos = new GogoPosition(9);
  pos.playXY(4, 4);
  const hashHiNoKo = pos.zobristHi;
  const hashLoNoKo = pos.zobristLo;

  // Manually enable ko and recompute: the hash must change.
  pos.koPoint = pos.index(3, 3);
  pos.recomputeZobristHash();
  assert.ok(pos.zobristHi !== hashHiNoKo || pos.zobristLo !== hashLoNoKo);

  // Clearing ko and recomputing must restore the original hash.
  pos.koPoint = -1;
  pos.recomputeZobristHash();
  assert.equal(pos.zobristHi, hashHiNoKo);
  assert.equal(pos.zobristLo, hashLoNoKo);
});

test('search returns a cached TT score on a probe hit, and TT reduces nodes in a mid-game benchmark', () => {
  // --- White-box: direct TT hit inside search() ---
  // Create an AI with a small TT and a frozen clock so it never times out.
  const ttAI = new GogoAI({ maxDepth: 2, useTT: true, ttSize: 1 << 16, now: () => 0 });
  const anyTTAI = /** @type {any} */ (ttAI);
  anyTTAI.ensureBuffers(81);
  anyTTAI.deadline = 1_000_000;
  anyTTAI.nodesVisited = 0;
  anyTTAI.timedOut = false;

  const pos = new GogoPosition(9);
  pos.playXY(4, 4);

  // Pre-load an exact TT entry for the current position at depth 2.
  const cachedScore = 77;
  ttAI.tt.store(pos.zobristHi, pos.zobristLo, 2, cachedScore, TT_EXACT, pos.index(3, 3));
  assert.equal(anyTTAI.search(pos, 2, -1_000, 1_000, 1), cachedScore);

  // --- Benchmark: TT reduces the number of nodes searched ---
  //
  // Potential pitfalls and how we avoid them:
  //   1. JIT cold start: both AI variants are warmed up with a shallow search before measurement.
  //   2. Timer granularity: we compare *node counts*, not wall-clock time, so millisecond
  //      precision is irrelevant and results are fully reproducible.
  //   3. Dead-code elimination: assert on result.move so the compiler cannot elide the search.
  //   4. GC interference: the engine already uses typed arrays throughout the hot path, so
  //      no heap allocations occur during the search itself.
  //   5. Ordering bias: the no-TT variant runs first so the TT variant cannot benefit from
  //      any residual JIT advantage gained by the first run.
  //   6. Incomplete search: both AIs use a frozen clock (now: () => 0) so they always
  //      finish all iterations up to maxDepth, making the comparison fair.
  //   7. Sample size: for deterministic comparison a single run suffices because the node
  //      count is a pure function of the position and depth when time is unlimited.

  const midgameRows = [
    '.........',
    '.........',
    '...X.....',
    '..XOX....',
    '...OXO...',
    '....OX...',
    '.........',
    '.........',
    '.........',
  ];

  const warmupPos = () => GogoPosition.fromAscii(midgameRows, BLACK);

  // Warm-up pass to trigger JIT compilation for both code paths (pitfall 1).
  new GogoAI({ maxDepth: 2, useTT: false, now: () => 0 }).findBestMove(warmupPos(), 1_000_000);
  new GogoAI({ maxDepth: 2, useTT: true,  now: () => 0 }).findBestMove(warmupPos(), 1_000_000);

  // Measured runs at a deeper depth where transpositions are plentiful.
  // quiescenceDepth:1 keeps the node count modest so coverage mode stays fast while
  // still generating the 4-ply transpositions that TT benefits from.
  const searchDepth = 4;
  const aiNoTT = new GogoAI({ maxDepth: searchDepth, quiescenceDepth: 1, useTT: false, now: () => 0 });
  const aiWithTT = new GogoAI({ maxDepth: searchDepth, quiescenceDepth: 1, useTT: true,  now: () => 0 });

  const noTTResult = aiNoTT.findBestMove(warmupPos(), 1_000_000);
  const ttResult  = aiWithTT.findBestMove(warmupPos(), 1_000_000);

  // Ensure the result is used so the search cannot be optimised away (pitfall 3).
  assert.ok(noTTResult.move >= 0);
  assert.ok(ttResult.move >= 0);
  assert.equal(noTTResult.depth, searchDepth);
  assert.equal(ttResult.depth, searchDepth);

  // The TT must produce fewer nodes than the plain search at the same depth.
  assert.ok(
    ttResult.nodes < noTTResult.nodes,
    `TT searched ${ttResult.nodes} nodes but no-TT searched ${noTTResult.nodes}; expected TT < no-TT`,
  );
});
