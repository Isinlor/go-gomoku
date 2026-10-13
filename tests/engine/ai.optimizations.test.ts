import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition, WHITE } from '../../src/engine';

test.each([9, 11, 13] as const)('AI window counts follow moves, captures, undo, and reused positions on size %s', (size) => {
  const ai = new GogoAI() as any;
  // Exercise buffer resizing as well as same-size position reuse in each case.
  ai.ensureBuffers((size === 9 ? 13 : 9) ** 2);
  const check = (position: GogoPosition) => {
    ai.ensureBuffers(position.area);
    ai.beginWindowPass(position);
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
    expect(Array.from(ai.windowBlack.slice(0, position.meta.windowCount))).toEqual(expectedBlack);
    expect(Array.from(ai.windowWhite.slice(0, position.meta.windowCount))).toEqual(expectedWhite);
    ai.beginPatternPass(position);
    expect(ai.windowEvaluation).toBe(expectedEvaluation);
    expect(ai.blackFours).toBe(expectedBlack.filter((count, i) => count === 4 && expectedWhite[i] === 0).length);
    expect(ai.whiteFours).toBe(expectedWhite.filter((count, i) => count === 4 && expectedBlack[i] === 0).length);
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
  for (const row of ['.XXXX....', '.OOOO....', 'XOOO.....', 'XXXXO....']) {
    check(GogoPosition.fromAscii(Array.from({ length: size }, (_, y) => y === 0 ? row + '.'.repeat(size - 9) : '.'.repeat(size)), BLACK));
  }
});

test('quiescence reuses an identical tactical search without changing its score', () => {
  const position = GogoPosition.fromAscii([
    '.........', '.OOOO....', '.........', '.........', '.........',
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
  ai.proofTTGeneration[index] = ai.proofGeneration;
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

test.each([2, 3, 4])('root scouts at depth %s preserve an exhaustive score and re-search improvements', depth => {
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
    best = Math.max(best, -oracle.search(position, depth - 1, -1_000_000_000, 1_000_000_000, 1));
    position.undo();
  }
  const search = ai.search.bind(ai);
  const widths: number[] = [];
  ai.search = (...args: any[]) => {
    if (args[4] === 1) widths.push(args[3] - args[2]);
    return search(...args);
  };
  expect(ai.searchRoot(position, depth, hint).score).toBeCloseTo(best, 10);
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
