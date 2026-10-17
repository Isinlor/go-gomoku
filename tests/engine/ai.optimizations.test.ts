import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition, WHITE, decodeGame } from '../../src/engine';

test.each([9, 11, 13] as const)('AI window counts follow moves, captures, undo, and reused positions on size %s', (size) => {
  const ai = new GogoAI() as any;
  // Exercise buffer resizing as well as same-size position reuse in each case.
  ai.ensureBuffers((size === 9 ? 13 : 9) ** 2);
  const check = (position: GogoPosition) => {
    ai.ensureBuffers(position.area);
    ai.beginWindowPass(position);
    expect(Array.from({ length: position.area }, (_, point) =>
      !!(ai.occupiedPoints[point >>> 5] & (1 << (point & 31)))))
      .toEqual(Array.from(position.board, cell => cell !== 0));
    let expectedEvaluation = 0;
    const expectedBlack: number[] = [];
    const expectedWhite: number[] = [];
    const evaluation = [0, 6, 32, 240, 500_000, 250_000_000];
    for (let wi = 0; wi < position.meta.windowCount; wi++) {
      const cells = Array.from(position.meta.windows.slice(wi * 5, wi * 5 + 5), point => position.board[point]);
      const black = cells.filter(cell => cell === BLACK).length;
      const white = cells.filter(cell => cell === WHITE).length;
      expectedBlack.push(black);
      expectedWhite.push(white);
      if (white === 0) expectedEvaluation += evaluation[black];
      if (black === 0) expectedEvaluation -= evaluation[white];
    }
    expect(Array.from(ai.windowCounts.slice(0, position.meta.windowCount), (code: any) => Math.floor(code / 6))).toEqual(expectedBlack);
    expect(Array.from(ai.windowCounts.slice(0, position.meta.windowCount), (code: any) => code % 6)).toEqual(expectedWhite);
    const active = Array.from({ length: position.meta.windowCount }, (_, wi) =>
      (ai.activeWindows[wi >>> 5] & (1 << (wi & 31))) !== 0);
    expect(active).toEqual(expectedBlack.map((black, wi) =>
      (black >= 2 && expectedWhite[wi] === 0) || (expectedWhite[wi] >= 2 && black === 0)));
    ai.beginPatternPass(position);
    expect(ai.windowEvaluation).toBe(expectedEvaluation);
    let local = 0;
    for (let point = 0; point < position.area; point++) {
      const cell = position.board[point];
      if (cell === 0) continue;
      const neighbors = Array.from(position.meta.neighbors4.slice(point * 4, point * 4 + 4));
      const liberties = neighbors.filter(n => n !== -1 && position.board[n] === 0).length;
      const score = position.meta.centerBias[point] * 0.9 + [-200, -80, 20, 60, 80][liberties];
      local += cell === BLACK ? score : -score;
    }
    const evaluationScore = (expectedEvaluation + local) * (position.toMove === BLACK ? 1 : -1);
    expect(ai.evaluate(position)).toBeCloseTo(evaluationScore, 8);

    const attack = [0, 12, 72, 540, 100_000, 500_000];
    const defense = [0, 16, 96, 720, 100_000, 500_000];
    const actualPatterns: number[][] = [];
    const expectedPatterns: number[][] = [];
    for (let point = 0; point < position.area; point++) {
      if (position.board[point] !== 0) continue;
      let blackScore = 0;
      let whiteScore = 0;
      for (let cursor = position.meta.windowsByPointOffsets[point]; cursor < position.meta.windowsByPointOffsets[point + 1]; cursor++) {
        const wi = position.meta.windowsByPoint[cursor];
        // Reuse the independent board-derived oracle, not the AI's cached counts.
        const black = expectedBlack[wi];
        const white = expectedWhite[wi];
        if (white === 0) { blackScore += attack[black + 1]; whiteScore += defense[black + 1]; }
        if (black === 0) { blackScore += defense[white + 1]; whiteScore += attack[white + 1]; }
      }
      actualPatterns.push([ai.pointPatternBlack[point], ai.pointPatternWhite[point]]);
      expectedPatterns.push([blackScore, whiteScore]);
    }
    expect(actualPatterns).toEqual(expectedPatterns);
    ai.beginWindowPass(position);
  };
  const position = new GogoPosition(size);
  check(position);
  for (const [x, y] of [[1, 0], [0, 0], [0, 1]]) {
    expect(position.playXY(x, y)).toBe(true);
    check(position);
  }
  expect(position.lastCapturedCount).toBe(1);
  for (let i = 0; i < 3; i++) {
    expect(position.undo()).toBe(true);
    check(position);
  }
  check(GogoPosition.fromAscii(Array.from({ length: size }, (_, y) => y === 0 ? 'O'.repeat(size) : '.'.repeat(size)), BLACK));
  check(position);
});

test('quiescence reuses an identical tactical search without changing its score', () => {
  const position = GogoPosition.fromAscii([
    'XXXX.....', 'OOOO.....', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  const score = ai.quiescence(position, -1_000_000_000, 1_000_000_000, 0, 4);
  const nodes = ai.nodesVisited;
  expect(nodes).toBeGreaterThan(1);
  expect(ai.quiescence(position, -1_000_000_000, 1_000_000_000, 0, 4)).toBe(score);
  expect(ai.nodesVisited - nodes).toBe(1);
});

test('the proof recognizes a legal immediate five without generating other attacks', () => {
  const position = GogoPosition.fromAscii([
    'XXXX.....', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.resetProofSearch();
  ai.deadline = Infinity;
  const generate = ai.generateOrderedMoves.bind(ai);
  let generations = 0;
  ai.generateOrderedMoves = (...args: unknown[]) => {
    generations++;
    return generate(...args);
  };
  const encoded = position.encodeGame();
  expect(ai.proofAttack(position, 1, 0)).toBe(true);
  expect(generations).toBe(0);
  expect(ai.patternsReady).toBe(false);
  expect(position.encodeGame()).toBe(encoded);
});

test('the proof explores non-immediate attacks and skips a previously tried hash move', () => {
  const position = GogoPosition.fromAscii([
    '.XXX.....', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.resetProofSearch();
  ai.deadline = Infinity;
  expect(ai.proofAttack(position, 3, 0)).toBe(true);
  const capture = GogoPosition.fromAscii([
    '.XX....XO', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  ai.resetProofSearch();
  const index = Number(capture.hash & ((1n << 18n) - 1n));
  ai.proofTTHash[index] = capture.hash;
  ai.proofTTBestMove[index] = 17;
  const play = capture.play.bind(capture);
  let captures = 0;
  capture.play = (move: number) => {
    if (move === 17 && capture.ply === 0) captures++;
    return play(move);
  };
  expect(ai.proofAttack(capture, 3, 0)).toBe(false);
  expect(captures).toBe(1);
});

test('root search stops once an immediate win reaches the best possible score', () => {
  const position = GogoPosition.fromAscii([
    'XXXX.....', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const play = position.play.bind(position);
  const moves: number[] = [];
  position.play = (move: number) => {
    moves.push(move);
    return play(move);
  };
  const result = new GogoAI({ maxDepth: 10, quiescenceDepth: 4 }).findBestMove(position, 5000);
  expect(result.move).toBe(4);
  expect(result.forcedWin).toBe(true);
  expect(moves.every(move => move === 4)).toBe(true);
});

test('a win proved at a shallow depth is reused at a deeper limit', () => {
  const position = GogoPosition.fromAscii([
    '.XXX.....', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.resetProofSearch();
  ai.deadline = Infinity;
  expect(ai.proofAttack(position, 3, 0)).toBe(true);
  const nodes = ai.nodesVisited;
  expect(ai.proofAttack(position, 5, 0)).toBe(true);
  expect(ai.nodesVisited - nodes).toBe(1);
  // The exact fact remains valid even in a shallower iteration.
  expect(ai.proofAttack(position, 1, 0)).toBe(true);
});

test('root scout searches preserve an exhaustive score and re-search improvements', { timeout: 1_000 }, () => {
  // Preserve both search policies while refactoring the surrounding engine.
  // Node counts also catch changes in caps, ordering, and PVS re-searches.
  const cases = [
    ['B9 e5 d4 f5 d5', [[48, 368.1, 73], [48, 18.9, 61], [48, 381.2, 768], [48, -104, 1542], [48, 368.1, 73], [48, 18.9, 189], [48, 804.1, 3436], [48, -23.1, 8692]]],
    ['B9 a1 a3 b1 b3 c1 c3', [[4, 500263.1, 39], [21, -267.6, 85], [4, 500415.6, 604], [4, 243.3, 578], [4, 500263.1, 39], [21, -494.5, 170], [4, 500415.6, 1318], [4, 243.3, 2452]]],
    ['B9 e9 e8 f9', [[75, 296.9, 41], [75, -464.9, 85], [75, 329.8, 881], [78, -409.2, 1325], [75, 296.9, 41], [75, -464.9, 133], [75, 329.8, 1985], [78, -610.5, 4603]]],
  ] as const;
  for (const [encoded, expected] of cases) {
    for (let index = 0; index < expected.length; index++) {
      const board = decodeGame(encoded);
      const engine = new GogoAI({ now: () => 0, quiescenceDepth: 0, maxPly: 4 }) as any;
      engine.ensureBuffers(board.area);
      engine.deadline = Infinity;
      engine.proofMode = index >= 4;
      const hash = board.hash;
      const result = engine.searchRoot(board, index % 4 + 1, -1);
      expect(result.move).toBe(expected[index][0]);
      expect(result.score).toBeCloseTo(expected[index][1], 10);
      expect(result.nodes).toBeGreaterThan(0);
      expect(board.hash).toBe(hash);
      expect(board.encodeGame()).toBe(encoded);
    }
  }
  const position = new GogoPosition(9);
  position.playXY(4, 4);
  const ai = new GogoAI({ quiescenceDepth: 0, maxPly: 2, now: () => 0 }) as any;
  const oracle = new GogoAI({ quiescenceDepth: 0, maxPly: 2, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  oracle.ensureBuffers(position.area);
  ai.deadline = oracle.deadline = Infinity;
  ai.proofMode = oracle.proofMode = true;
  const hint = position.index(2, 2);
  const count = ai.generateOrderedMoves(position, ai.moveBuffers[0], ai.scoreBuffers[0], hint, false);
  const candidates = Array.from((ai.moveBuffers[0] as Int16Array).slice(0, count));
  let best = -Infinity;
  for (const move of candidates) {
    expect(position.play(move)).toBe(true);
    best = Math.max(best, -oracle.search(position, 3, -1_000_000_000, 1_000_000_000, 1));
    position.undo();
  }
  const search = ai.search.bind(ai);
  const widths: number[] = [];
  ai.search = (...args: any[]) => {
    if (args[4] === 1) widths.push(args[3] - args[2]);
    return search(...args);
  };
  expect(ai.searchRoot(position, 4, hint).score).toBeCloseTo(best, 10);
  expect(widths).toContain(1);
  expect(widths.filter(width => width > 1).length).toBeGreaterThan(1);
});

test('proof search independently verifies a heuristic hash move before generating alternatives', () => {
  const position = GogoPosition.fromAscii([
    '.XXX.....', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.resetProofSearch();
  ai.deadline = Infinity;
  const hash = position.hash;
  const index = Number(hash & ((1n << 18n) - 1n));
  ai.ttHash[index] = hash;
  ai.ttBestMove[index] = 4;
  const generate = ai.generateOrderedMoves.bind(ai);
  let rootGenerations = 0;
  ai.generateOrderedMoves = (...args: any[]) => {
    if (args[0].hash === hash) rootGenerations++;
    return generate(...args);
  };
  expect(ai.proofAttack(position, 3, 0)).toBe(true);
  expect(rootGenerations).toBe(0);
  expect(position.hash).toBe(hash);
});

test('a heuristic score is never accepted as an exact proof', () => {
  const position = GogoPosition.fromAscii([
    '.XX......', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.resetProofSearch();
  ai.deadline = Infinity;
  const hash = position.hash;
  const index = Number(hash & ((1n << 18n) - 1n));
  ai.ttHash[index] = hash;
  ai.ttBestMove[index] = 3;
  ai.ttScore[index] = 1_000_000_000;
  ai.ttDepth[index] = 30;
  ai.ttFlag[index] = 1;
  expect(ai.proofAttack(position, 1, 0)).toBe(false);
  expect(position.hash).toBe(hash);
});

test('a nonterminal defense with no remaining attacker turn fails without generating or playing moves', () => {
  const position = GogoPosition.fromAscii([
    '.XXXX....', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], WHITE);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  const play = position.play.bind(position);
  let plays = 0;
  position.play = (move: number) => { plays++; return play(move); };
  expect(ai.proofDefend(position, 1, 0)).toBe(false);
  expect(plays).toBe(0);
});

test('short attacking proofs generate own threats and captures without defensive three extensions', () => {
  const position = GogoPosition.fromAscii([
    '.XXX.....', '.........', '.........', '.........', '.........',
    '.........', '.OOO.....', '.........', '.......XO',
  ], BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  const count = ai.generateTacticalMoves(position, ai.moveBuffers[0], ai.scoreBuffers[0], -1, 0, true);
  const moves = Array.from(ai.moveBuffers[0].slice(0, count));
  expect(moves).toContain(0);
  expect(moves).toContain(4);
  expect(moves).toContain(71); // capture the corner white stone
  expect(moves).not.toContain(54);
  expect(moves).not.toContain(58);
});

test('static evaluation updates only stones affected by a board change', () => {
  const position = GogoPosition.fromAscii([
    'X.X.X.X.X', '.........', '.........', '.........', '....O....',
    '.........', '.........', '.........', 'O.O.O.O.O',
  ], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  ai.evaluate(position);
  let reads = 0;
  const original = position.meta.centerBias;
  const meta = Object.create(position.meta);
  meta.centerBias = new Proxy(original, { get(target, key) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
    return Reflect.get(target, key, target);
  } });
  Object.defineProperty(position, 'meta', { value: meta });
  position.playXY(4, 3);
  ai.evaluate(position);
  expect(reads).toBeLessThan(5);
});

test('proof defenses reuse a refutation from another position at the same ply', () => {
  const ai = new GogoAI({ now: () => 0 }) as any;
  const rows = ['.XX......', ...Array(8).fill('.........')];
  const first = GogoPosition.fromAscii(rows, WHITE);
  ai.ensureBuffers(first.area);
  ai.deadline = Infinity;
  ai.resetProofSearch();
  expect(ai.proofDefend(first, 3, 1)).toBe(false);
  const second = GogoPosition.fromAscii([...rows.slice(0, 8), '........X'], WHITE);
  const gen = ai.generateOrderedMoves.bind(ai);
  let generations = 0;
  ai.generateOrderedMoves = (...args: any[]) => { generations++; return gen(...args); };
  expect(ai.proofDefend(second, 3, 1)).toBe(false);
  expect(generations).toBe(0);
  expect(second.ply).toBe(0);
});

test('setup attack generation includes own two-stone extensions without unrelated defensive extensions', () => {
  const position = GogoPosition.fromAscii([
    '.XX......', '.........', '.........', '.........', '.........',
    '.........', '.OOO.....', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const count = ai.generateTacticalMoves(position, ai.moveBuffers[0], ai.scoreBuffers[0], -1, 0, true, 2);
  const moves = Array.from(ai.moveBuffers[0].slice(0, count));
  expect(moves).toContain(0);
  expect(moves).toContain(3);
  expect(moves).not.toContain(54);
  expect(moves).not.toContain(58);
});

test('broad attacking proofs retain quiet candidates when preferred setups do not win', () => {
  const position = new GogoPosition(9);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  ai.resetProofSearch();
  const gen = ai.generateOrderedMoves.bind(ai);
  let generations = 0;
  ai.generateOrderedMoves = (...args: any[]) => { generations++; return gen(...args); };
  expect(ai.proofAttack(position, 5, 0)).toBe(false);
  expect(generations).toBeGreaterThan(0);
  expect(position.ply).toBe(0);
});

test('broad attacking proofs do not retry preferred setup moves during quiet fallback', () => {
  const position = GogoPosition.fromAscii(['.XX......', ...Array(8).fill('.........')], BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.resetProofSearch();
  ai.deadline = Infinity;
  const play = position.play.bind(position);
  const attempts = new Map<number, number>();
  position.play = (move: number) => {
    if (position.ply === 0) attempts.set(move, (attempts.get(move) ?? 0) + 1);
    return play(move);
  };
  expect(ai.proofAttack(position, 5, 0)).toBe(false);
  expect(Math.max(...attempts.values())).toBe(1);
  expect(position.ply).toBe(0);
});

test('proof defenses can use the second refutation when the first is occupied', () => {
  const ai = new GogoAI({ now: () => 0 }) as any;
  const rows = ['.XX......', ...Array(8).fill('.........')];
  const first = GogoPosition.fromAscii(rows, WHITE);
  ai.ensureBuffers(first.area);
  ai.deadline = Infinity;
  ai.resetProofSearch();
  expect(ai.proofDefend(first, 3, 1)).toBe(false);
  const refutation = ai.killerMoves[2];
  ai.killerMoves[2] = 1;
  ai.killerMoves[3] = refutation;
  const second = GogoPosition.fromAscii([...rows.slice(0, 8), '........X'], WHITE);
  const gen = ai.generateOrderedMoves.bind(ai);
  let generations = 0;
  ai.generateOrderedMoves = (...args: any[]) => { generations++; return gen(...args); };
  expect(ai.proofDefend(second, 3, 1)).toBe(false);
  expect(generations).toBe(0);
  expect(second.ply).toBe(0);
});

test('quiescence cannot stand pat instead of answering an immediate threat', () => {
  const position = GogoPosition.fromAscii(['.........', '.OOOO....', ...Array(7).fill('.........')], BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  const encoded = position.toAscii();
  expect(ai.quiescence(position, -1_000_000_000, -999_000_000, 0, 4)).toBe(-999_999_998);
  expect(position.toAscii()).toEqual(encoded);
});

test('loss proofs check forcing replies before heuristic discovery', () => {
  const position = GogoPosition.fromAscii(['.........', '.OOOO....', ...Array(7).fill('.........')], BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  const search = ai.searchDepths.bind(ai);
  let discoveries = 0;
  ai.searchDepths = (...args: any[]) => { discoveries++; return search(...args); };
  expect(ai.proofSearchRoot(position, 3, -1)).toBe(-999_999_997);
  expect(discoveries).toBe(0);
  expect(position.ply).toBe(0);
});

test.each([
  ['B9 e5', [24, 12, 24, 24]],
  ['B9 c1 f6', [38, 12, 24, 38]],
] as const)('root discovery widens with depth while exact search stays complete (%s)', (encoded, expected) => {
  const position = decodeGame(encoded);
  const rootPly = position.ply;
  const ai = new GogoAI({ quiescenceDepth: 0, maxPly: 2, now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  const play = position.play.bind(position);
  let roots = 0;
  position.play = (move: number) => { if (position.ply === rootPly) roots++; return play(move); };
  for (let depth = 1; depth <= 4; depth++) {
    roots = 0;
    ai.resetSearchHeuristics(true);
    ai.searchRoot(position, depth, -1);
    expect(roots).toBe(expected[depth - 1]);
  }
  roots = 0;
  ai.proofMode = true;
  ai.resetSearchHeuristics(true);
  ai.searchRoot(position, 2, -1);
  expect(roots).toBe(expected[0]);
  expect(position.ply).toBe(rootPly);
  expect(position.encodeGame()).toBe(encoded);
});

test('quiescence recognizes an immediate win even in a narrow fail-high window', () => {
  const position = GogoPosition.fromAscii(['XXXX.....', ...Array(8).fill('.........')], BLACK);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  expect(ai.quiescence(position, -1, 1, 0, 4)).toBe(999_999_999);
});
