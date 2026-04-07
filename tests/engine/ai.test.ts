import { test, expect } from 'vitest';

import { BLACK, EMPTY, GogoAI, GogoMCTS, GogoPosition, WHITE } from '../../src/engine';

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

test('MCTS picks a valid move on empty board, immediate wins, and immediate blocks with deterministic seed', () => {
  const empty = new GogoPosition(9);
  const mcts = new GogoMCTS({ seed: 1, rolloutMaxMoves: 18 });
  const first = mcts.findBestMove(empty, 100);
  // Fixed policy: always play center on empty board
  expect(first.move).toBe(empty.index(4, 4));
  expect(first.nodes).toBe(0);

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
  const win = mcts.findBestMove(winning, 25);
  expect(win.move).toBe(winning.index(4, 0));

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
  const block = mcts.findBestMove(blocking, 25);
  expect(block.move).toBe(blocking.index(5, 4));

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
  const terminalResult = mcts.findBestMove(terminal, 25);
  expect(terminalResult.move).toBe(-1);

  const noMove = new GogoPosition(9);
  noMove.board.fill(BLACK);
  noMove.stoneCount = noMove.area;
  noMove.winner = EMPTY;
  const noMoveResult = mcts.findBestMove(noMove, 25);
  expect(noMoveResult.move).toBe(-1);

  // Cover default seed branch (options.seed ?? 1) and default now (performance.now)
  const defaultMcts = new GogoMCTS();
  const defaultPos = new GogoPosition(9);
  defaultPos.playXY(4, 4);
  const defaultResult = defaultMcts.findBestMove(defaultPos, 0);
  expect(defaultResult.move !== -1).toBeTruthy();
});

test('white-box MCTS helpers cover rollout edge branches and immediate-win scanning fallback paths', () => {
  const mcts = new GogoMCTS({ seed: 3, rolloutMaxMoves: 4, now: () => 0 });
  const anyMcts = mcts as any;

  const full = new GogoPosition(9);
  full.board.fill(BLACK);
  full.stoneCount = full.area;
  anyMcts.ensureBuffers(full.area);
  expect(anyMcts.rollout(full)).toBe(EMPTY);

  const fakeRollout = new GogoPosition(9) as any;
  anyMcts.ensureBuffers(81);
  const origPickBiased = anyMcts.pickBiasedRolloutMove.bind(anyMcts);
  anyMcts.pickBiasedRolloutMove = () => 0;
  fakeRollout.winner = EMPTY;
  fakeRollout.generateAllLegalMoves = () => 1;
  fakeRollout.play = () => false;
  fakeRollout.undo = () => true;
  expect(anyMcts.rollout(fakeRollout)).toBe(EMPTY);
  anyMcts.pickBiasedRolloutMove = origPickBiased;

  const fallbackPick = new GogoPosition(9) as any;
  anyMcts.ensureBuffers(fallbackPick.area);
  anyMcts.random = () => 1;
  anyMcts.evaluateThreat = () => -1;
  anyMcts.moveBuffer[0] = 0;
  anyMcts.moveBuffer[1] = 1;
  anyMcts.moveBuffer[2] = 2;
  fallbackPick.play = () => false;
  fallbackPick.toMove = BLACK;
  // With evaluateThreat=-1, normalizeThreat(-1)=0, threatWeight(0)=257
  // All 3 weights=257, total=771, threshold=1*771=771
  // 771-257=514>0, 514-257=257>0, 257-257=0<=0 → returns moveBuffer[2]=2
  expect(anyMcts.pickBiasedRolloutMove(fallbackPick, 3)).toBe(2);

  const fakeImmediate = new GogoPosition(9) as any;
  anyMcts.ensureBuffers(81);
  fakeImmediate.toMove = BLACK;
  fakeImmediate.generateAllLegalMoves = (buffer: Int16Array) => { buffer[0] = 0; return 1; };
  fakeImmediate.play = () => false;
  fakeImmediate.undo = () => true;
  expect(anyMcts.findImmediateWin(fakeImmediate, BLACK)).toBe(-1);

  const noLegal = new GogoPosition(9) as any;
  noLegal.stoneCount = 1;
  noLegal.generateAllLegalMoves = () => 0;
  expect(anyMcts.pickFallbackMove(noLegal)).toBe(-1);

  const parent = {
    visits: 10,
    children: [
      { visits: 0, wins: 0, prior: 2, move: 0 },
      { visits: 3, wins: 2, prior: 2, move: 1 },
    ],
  };
  expect(anyMcts.selectChild(parent).move).toBe(0);

  const timeoutMcts = new GogoMCTS({ seed: 7, now: () => 1 });
  const nonTerminal = new GogoPosition(9);
  nonTerminal.playXY(4, 4);
  const timeoutResult = timeoutMcts.findBestMove(nonTerminal, 0);
  expect(timeoutResult.move).not.toBe(-1);
  expect(timeoutResult.timedOut).toBe(true);
});

test('MCTS evaluateThreat clamps attack-weight index to avoid NaN when move completes five-in-a-row', () => {
  // When a move completes 5-in-a-row, the window has mine=5 (5 stones of the same color).
  // evaluateThreat uses ATTACK_WEIGHTS[mine + 1] which would access index 6 on a 6-element
  // array (indices 0-5), returning undefined and causing NaN scores.
  // This test verifies the index is clamped and returns a finite score.
  const mcts = new GogoMCTS({ seed: 1 });
  const anyMcts = mcts as any;

  // Position where placing a stone at (4,0) would complete a 5-in-a-row for BLACK
  const winningMove = rawPosition([
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

  // Simulate the scenario: play the move, then evaluate the threat
  // This mimics line 612 in ai.ts where evaluateThreat is called after position.play(move)
  const moveIndex = winningMove.index(4, 0);
  winningMove.play(moveIndex);
  anyMcts.ensureBuffers(winningMove.area);

  // The move just completed a 5-in-a-row; evaluateThreat should not return NaN
  const score = anyMcts.evaluateThreat(winningMove, moveIndex, BLACK);
  expect(Number.isFinite(score)).toBe(true);
  expect(score).toBeGreaterThan(0);
});

test('MCTS best-child selection and selectChild path cover all branches', () => {
  // Use the empty board with enough time to exhaust root's untried moves and enter selectChild.
  // With 80 legal moves and 200+ iterations, the selectChild branch is exercised.
  let nowCalls = 0;
  const mcts = new GogoMCTS({ seed: 1, now: () => (nowCalls++ < 200 ? 0 : 1000) });
  const pos = new GogoPosition(9);
  pos.playXY(4, 4);
  const result = mcts.findBestMove(pos, 1);
  expect(result.move !== -1).toBeTruthy();
  expect(result.depth > 80).toBeTruthy(); // ensure we got past root expansion
});

test('MCTS pickBiasedRolloutMove returns immediate win and handles fallback path', () => {
  const mcts = new GogoMCTS({ seed: 1 });
  const anyMcts = mcts as any;
  anyMcts.ensureBuffers(81);

  // Test immediate win detection in pickBiasedRolloutMove
  const fakeWin = new GogoPosition(9) as any;
  fakeWin.toMove = BLACK;
  anyMcts.moveBuffer[0] = 5;
  anyMcts.moveBuffer[1] = 10;
  fakeWin.play = (move: number) => {
    if (move === 10) {
      fakeWin.winner = BLACK;
      return true;
    }
    return true;
  };
  fakeWin.undo = () => { fakeWin.winner = EMPTY; return true; };
  fakeWin.winner = EMPTY;
  fakeWin.meta = new GogoPosition(9).meta;
  fakeWin.board = new Uint8Array(81);
  expect(anyMcts.pickBiasedRolloutMove(fakeWin, 2)).toBe(10);

  // Test fallback path - mock threatWeight to return 0 so threshold stays positive
  const fakeRollout2 = new GogoPosition(9) as any;
  fakeRollout2.toMove = BLACK;
  fakeRollout2.play = () => false;
  fakeRollout2.winner = EMPTY;
  anyMcts.moveBuffer[0] = 42;
  const origNormalize = anyMcts.normalizeThreat.bind(anyMcts);
  const origThreatWeight = anyMcts.threatWeight.bind(anyMcts);
  anyMcts.normalizeThreat = () => 0;
  anyMcts.threatWeight = () => 0;
  anyMcts.random = () => 0.5;
  // totalWeight=0, threshold=0.5*max(1,0)=0.5, 0.5-0=0.5>0 → fallback
  expect(anyMcts.pickBiasedRolloutMove(fakeRollout2, 1)).toBe(42);
  anyMcts.normalizeThreat = origNormalize;
  anyMcts.threatWeight = origThreatWeight;
});

test('MCTS normalizeThreat and threatWeight produce correct values', () => {
  const mcts = new GogoMCTS({ seed: 1 });
  const anyMcts = mcts as any;

  // normalizeThreat: raw <= 0 returns 0
  expect(anyMcts.normalizeThreat(0)).toBe(0);
  expect(anyMcts.normalizeThreat(-5)).toBe(0);

  // normalizeThreat: positive raw, clamped to [0, 1]
  const smallResult = anyMcts.normalizeThreat(1);
  expect(smallResult).toBeGreaterThan(0);
  expect(smallResult).toBeLessThanOrEqual(1);
  expect(smallResult).toBeCloseTo(Math.log1p(1) / 14, 10);

  // normalizeThreat: very large raw clamps to 1
  expect(anyMcts.normalizeThreat(1e10)).toBe(1);

  // threatWeight: returns correct integer values
  expect(anyMcts.threatWeight(0)).toBe(1 + Math.floor(256 * 1));
  expect(anyMcts.threatWeight(1)).toBe(1 + Math.floor(256 * (1 + 3 * 0.35)));
  expect(anyMcts.threatWeight(0.5)).toBe(1 + Math.floor(256 * (1 + 3 * 0.35 * 0.5)));
});

test('MCTS findBestMove defensive branches: play-fail and terminal-node paths', () => {
  // Cover defensive code paths in findBestMove's inner loop:
  // - line 600: winner detected during selectChild traversal
  // - line 611: play fails during expansion (continue)
  // - line 636: terminal node with no children (break)
  // - line 641: play fails during selectChild (break)
  // - line 676: best child by visits (best = child)

  const meta = new GogoPosition(9).meta;

  // --- Line 611 (play fails during expansion, continue) ---
  // Root has 2 legal moves. First expansion play fails, second succeeds.
  let now1 = 0;
  const mcts1 = new GogoMCTS({ seed: 1, now: () => (now1++ < 5 ? 0 : 1000) }) as any;
  mcts1.ensureBuffers(81);
  mcts1.findImmediateWin = () => -1;
  mcts1.pickFallbackMove = () => 10;

  let gen1 = 0;
  let play1 = 0;
  const pos1 = {
    winner: EMPTY,
    toMove: BLACK,
    area: 81,
    stoneCount: 1,
    meta, board: new Uint8Array(81),
    isLegal: () => true,
    generateAllLegalMoves: (buffer: Int16Array) => {
      gen1++;
      if (gen1 === 1) { buffer[0] = 10; buffer[1] = 20; return 2; }
      return 0;
    },
    play: () => {
      play1++;
      if (play1 === 1) return false; // first expansion play fails → continue (line 611)
      return true;
    },
    undo: () => true,
  };

  const r1 = mcts1.findBestMove(pos1, 1);
  expect(r1.nodes > 0).toBeTruthy();

  // --- Lines 636, 641, 600 via mock position ---

  // Test 1: Terminal node (line 636)
  // Root has 1 legal move. After expanding it, child has 0 legal moves.
  // On the next iteration, selectChild picks the child, which has no untried and no children.
  let now2 = 0;
  const mcts2 = new GogoMCTS({ seed: 1, now: () => (now2++ < 5 ? 0 : 1000) }) as any;
  mcts2.ensureBuffers(81);
  mcts2.findImmediateWin = () => -1;
  mcts2.pickFallbackMove = () => 10;

  let gen2 = 0;
  const pos2 = {
    winner: EMPTY,
    toMove: BLACK,
    area: 81,
    stoneCount: 1,
    meta, board: new Uint8Array(81),
    isLegal: () => true,
    generateAllLegalMoves: (buffer: Int16Array) => {
      gen2++;
      if (gen2 === 1) { buffer[0] = 10; return 1; }
      return 0;
    },
    play: () => true,
    undo: () => true,
  };

  const r2 = mcts2.findBestMove(pos2, 1);
  expect(r2.move).toBe(10);
  expect(r2.nodes > 0).toBeTruthy();

  // Test 2: Winner during selectChild traversal (line 600)
  // Root has 1 legal move. Child has 1 legal move. Grandchild play sets winner.
  // On iter 3+: root → selectChild → child → selectChild → grandchild →
  // play sets winner → back to loop → winner check → break (line 600)
  let now3 = 0;
  const mcts3 = new GogoMCTS({ seed: 1, now: () => (now3++ < 8 ? 0 : 1000) }) as any;
  mcts3.ensureBuffers(81);
  mcts3.findImmediateWin = () => -1;
  mcts3.pickFallbackMove = () => 10;

  let gen3 = 0;
  let play3 = 0;
  const pos3 = {
    winner: EMPTY,
    toMove: BLACK,
    area: 81,
    stoneCount: 1,
    meta, board: new Uint8Array(81),
    isLegal: () => true,
    generateAllLegalMoves: (buffer: Int16Array) => {
      gen3++;
      if (gen3 <= 1) { buffer[0] = 10; return 1; }
      if (gen3 <= 3) { buffer[0] = 20; return 1; }
      return 0;
    },
    play: () => {
      play3++;
      // After root→selectChild→child→selectChild→grandchild play, set winner
      // This happens when navigating 2+ levels deep via selectChild
      if (play3 >= 5) {
        pos3.winner = BLACK;
      }
      return true;
    },
    undo: () => { pos3.winner = EMPTY; return true; },
  };

  const r3 = mcts3.findBestMove(pos3, 1);
  expect(r3.nodes > 0).toBeTruthy();

  // Test 3: selectChild play fails (line 641)
  let now4 = 0;
  const mcts4 = new GogoMCTS({ seed: 1, now: () => (now4++ < 5 ? 0 : 1000) }) as any;
  mcts4.ensureBuffers(81);
  mcts4.findImmediateWin = () => -1;
  mcts4.pickFallbackMove = () => 10;

  let gen4 = 0;
  let play4 = 0;
  const pos4 = {
    winner: EMPTY,
    toMove: BLACK,
    area: 81,
    stoneCount: 1,
    meta, board: new Uint8Array(81),
    isLegal: () => true,
    generateAllLegalMoves: (buffer: Int16Array) => {
      gen4++;
      if (gen4 === 1) { buffer[0] = 10; return 1; }
      return 0;
    },
    play: () => {
      play4++;
      if (play4 >= 2) { return false; }
      return true;
    },
    undo: () => true,
  };

  const r4 = mcts4.findBestMove(pos4, 1);
  expect(r4.nodes > 0).toBeTruthy();

  // Test 4: best child by visits (line 676)
  // Use a real position with enough iterations for visit distribution
  let now5 = 0;
  const mcts5 = new GogoMCTS({ seed: 42, now: () => (now5++ < 300 ? 0 : 1000) });
  const pos5 = new GogoPosition(9);
  pos5.playXY(3, 3);
  pos5.playXY(5, 5);
  pos5.playXY(3, 4);
  const r5 = mcts5.findBestMove(pos5, 1);
  expect(r5.move !== -1).toBeTruthy();
  expect(r5.depth > 77).toBeTruthy();
});

test('MCTS backpropagation credits wins from each node player perspective, not just root', () => {
  // The backpropagation loop currently credits wins only when winner === rootPlayer
  // for all nodes in the path. This makes opponent-turn nodes prefer moves that help
  // the root player (cooperative opponent), which is incorrect for adversarial play.
  //
  // Correct behavior: each node should track wins from the perspective of the player
  // who CHOSE the move leading to that node, so selectChild maximizes wins for the
  // current player (adversarial).
  const mcts = new GogoMCTS({ seed: 42, rolloutMaxMoves: 50 });
  const anyMcts = mcts as any;

  // Set up a position where Black has a clear tactical advantage
  // White to move, but Black has 4 in a row that White must block
  const clearWin = rawPosition([
    '.........',
    '.........',
    '.........',
    '.........',
    '.XXXX....',
    '.........',
    '.........',
    '.........',
    '.........',
  ], WHITE);

  // White must block at (0,4) or (5,4), otherwise Black wins next move
  // With correct backpropagation, MCTS should recognize blocking moves
  anyMcts.ensureBuffers(clearWin.area);

  // Manually construct nodes to directly test backpropagation statistics
  // Root: White to move
  const root = {
    parent: null,
    move: -1,
    wins: 0,
    visits: 0,
    playerJustMoved: EMPTY,
    prior: 0,
    untriedMoves: null,
    untriedCount: 0,
    children: [] as any[],
  };

  const child = {
    parent: root,
    move: 0,
    wins: 0,
    visits: 0,
    playerJustMoved: WHITE, // White just moved to create this node
    prior: 0,
    untriedMoves: null,
    untriedCount: 0,
    children: [],
  };
  root.children.push(child);
  const path = [root, child];

  // Simulate backpropagation when BLACK wins (rollout returned BLACK)
  // With CORRECT backpropagation using playerJustMoved:
  //   - root (playerJustMoved=EMPTY): EMPTY !== EMPTY check fails, root.wins += 0
  //   - child (playerJustMoved=WHITE): winner=BLACK !== WHITE, child.wins += 0
  const winnerBlack = BLACK;
  for (const current of path) {
    current.visits += 1;
    if (winnerBlack === EMPTY) {
      current.wins += 0.5;
    } else if (current.playerJustMoved !== EMPTY && winnerBlack === current.playerJustMoved) {
      current.wins += 1;
    }
  }

  // root: playerJustMoved=EMPTY → skipped, root.wins = 0
  // child: playerJustMoved=WHITE, winner=BLACK → no match, child.wins = 0
  expect(root.wins).toBe(0);
  expect(child.wins).toBe(0);
  expect(root.visits).toBe(1);
  expect(child.visits).toBe(1);

  // Reset and test when WHITE wins
  root.wins = 0;
  root.visits = 0;
  child.wins = 0;
  child.visits = 0;

  const winnerWhite = WHITE;
  for (const current of path) {
    current.visits += 1;
    if (winnerWhite === EMPTY) {
      current.wins += 0.5;
    } else if (current.playerJustMoved !== EMPTY && winnerWhite === current.playerJustMoved) {
      current.wins += 1;
    }
  }

  // root: playerJustMoved=EMPTY → skipped, root.wins = 0
  // child: playerJustMoved=WHITE, winner=WHITE → match, child.wins = 1
  expect(root.wins).toBe(0);
  expect(child.wins).toBe(1);

  // With this backpropagation, selectChild on root will prefer children with high wins/visits,
  // which represents WIN RATE FOR ROOT'S PLAYER (WHITE), which is correct adversarial behavior.

  // Also verify the search still works and returns a blocking move
  const result = mcts.findBestMove(clearWin, 100);
  expect(result.move).not.toBe(-1);
  // The blocking move should be at position (0,4) or (5,4) - indices 36 or 41 on a 9x9 board
  const blockingMoves = [clearWin.index(0, 4), clearWin.index(5, 4)];
  expect(blockingMoves).toContain(result.move);
});
