import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition, WHITE } from '../../src/engine';

test('AI window counts follow moves, captures, undo, board sizes, and reused positions', () => {
  const ai = new GogoAI() as any;
  const check = (position: GogoPosition) => {
    ai.ensureBuffers(position.area);
    ai.beginWindowPass(position);
    let expectedEvaluation = 0;
    const evaluation = [0, 6, 32, 240, 500_000, 250_000_000];
    for (let wi = 0; wi < position.meta.windowCount; wi++) {
      const cells = Array.from(position.meta.windows.slice(wi * 5, wi * 5 + 5), point => position.board[point]);
      expect(ai.windowBlack[wi]).toBe(cells.filter(cell => cell === BLACK).length);
      expect(ai.windowWhite[wi]).toBe(cells.filter(cell => cell === WHITE).length);
      const black = cells.filter(cell => cell === BLACK).length;
      const white = cells.filter(cell => cell === WHITE).length;
      if (white === 0) expectedEvaluation += evaluation[black];
      if (black === 0) expectedEvaluation -= evaluation[white];
    }
    ai.beginPatternPass(position);
    expect(ai.windowEvaluation).toBe(expectedEvaluation);
    const attack = [0, 12, 72, 540, 100_000, 500_000];
    const defense = [0, 16, 96, 720, 100_000, 500_000];
    for (let point = 0; point < position.area; point++) {
      if (position.board[point] !== 0) continue;
      let blackScore = 0;
      let whiteScore = 0;
      for (let cursor = position.meta.windowsByPointOffsets[point]; cursor < position.meta.windowsByPointOffsets[point + 1]; cursor++) {
        const wi = position.meta.windowsByPoint[cursor];
        const cells = Array.from(position.meta.windows.slice(wi * 5, wi * 5 + 5), p => position.board[p]);
        const black = cells.filter(cell => cell === BLACK).length;
        const white = cells.filter(cell => cell === WHITE).length;
        if (white === 0) { blackScore += attack[black + 1]; whiteScore += defense[black + 1]; }
        if (black === 0) { blackScore += defense[white + 1]; whiteScore += attack[white + 1]; }
      }
      expect(ai.pointPatternBlack[point]).toBe(blackScore);
      expect(ai.pointPatternWhite[point]).toBe(whiteScore);
    }
    ai.beginWindowPass(position);
  };
  for (const size of [9, 11, 13] as const) {
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
  }
});

test('quiescence reuses an identical tactical search without changing its score', () => {
  const position = GogoPosition.fromAscii([
    'XXXX.....', '.........', '.........', '.........', '.........',
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
  ai.resetProofSearch();
  const index = Number(position.hash & ((1n << 18n) - 1n));
  ai.proofTTHash[index] = position.hash;
  ai.proofTTBestMove[index] = 4;
  expect(ai.proofAttack(position, 1, 0)).toBe(false);
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

test('root scout searches preserve an exhaustive score and re-search improvements', () => {
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
  const candidates = Array.from(ai.moveBuffers[0].slice(0, count));
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
  expect(ai.searchRoot(position, 4, hint).score).toBe(best);
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
