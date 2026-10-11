import { expect, test } from 'vitest';
import { BLACK, decodeGame, decodeMove, GogoAI, GogoPosition, WHITE } from '../../src/engine';

test('returns i1 immediately for B9 e5 f6 f4 d6 g3 e6 h2 without searching or changing the position', () => {
  const position = decodeGame('B9 e5 f6 f4 d6 g3 e6 h2');
  const snapshot = {
    board: position.toAscii(), record: position.encodeGame(), hash: position.hash,
    toMove: position.toMove, winner: position.winner, koPoint: position.koPoint,
    ply: position.ply, stoneCount: position.stoneCount,
    lastMove: position.lastMove, lastCapturedCount: position.lastCapturedCount,
  };
  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 0, now: () => 0 });
  const result = ai.findBestMove(position, 5_000);

  expect(result.move).toBe(decodeMove('i1', 9));
  expect(result.depth).toBe(0);
  expect(result.nodes).toBe(0);
  expect(result.timedOut).toBe(false);
  expect(result.forcedDefensiveMove).toBe(true);
  // A necessary defense is not a proof of the eventual outcome.
  expect(result.forcedWin).toBe(false);
  expect(result.forcedLoss).toBe(false);
  expect(result.heuristicWin).toBe(false);
  expect(result.heuristicLoss).toBe(false);
  expect({
    board: position.toAscii(), record: position.encodeGame(), hash: position.hash,
    toMove: position.toMove, winner: position.winner, koPoint: position.koPoint,
    ply: position.ply, stoneCount: position.stoneCount,
    lastMove: position.lastMove, lastCapturedCount: position.lastCapturedCount,
  }).toEqual(snapshot);
});

test('continues searching when both a block and a capture can stop the threat', () => {
  const position = GogoPosition.fromAscii([
    '.........',
    'OXO......',
    '.OX......',
    '...X.....',
    '....X....',
    '.....O...',
    '.........',
    '.........',
    '.........',
  ], WHITE);
  const ai = new GogoAI({ maxDepth: 2, quiescenceDepth: 0, now: () => 0 });
  const result = ai.findBestMove(position, 5_000);
  expect(result.depth).toBe(2);
  expect(result.forcedDefensiveMove).toBe(false);
  expect([decodeMove('a1', 9), decodeMove('b1', 9)]).toContain(result.move);
});

test('immediate threat detection excludes ko and windows blocked by the opponent', () => {
  const ai = new GogoAI();
  const position = GogoPosition.fromAscii([
    'XXXX.....',
    '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const detector = ai as unknown as { hasImmediateWin(position: GogoPosition): boolean };
  expect(detector.hasImmediateWin(position)).toBe(true);
  position.koPoint = decodeMove('e1', 9);
  expect(detector.hasImmediateWin(position)).toBe(false);
  position.board[decodeMove('e1', 9)] = WHITE;
  expect(detector.hasImmediateWin(position)).toBe(false);
});

test.each([BLACK, WHITE])('detects every location of the missing stone for attacker %s', (attacker) => {
  const defender = attacker === BLACK ? WHITE : BLACK;
  const stone = attacker === BLACK ? 'X' : 'O';
  const blocker = attacker === BLACK ? 'O' : 'X';
  for (let gap = 0; gap < 5; gap += 1) {
    const firstRow = Array.from({ length: 5 }, (_, x) => x === gap ? '.' : stone).join('') + blocker + '...';
    const position = GogoPosition.fromAscii([
      firstRow, '.........', '.........', '.........', '.........',
      '.........', '.........', '.........', '.........',
    ], defender);
    const result = new GogoAI({ maxDepth: 2, now: () => 0 }).findBestMove(position, 5_000);
    expect(result.move).toBe(gap);
    expect(result.depth).toBe(0);
    expect(result.nodes).toBe(0);
    expect(result.forcedDefensiveMove).toBe(true);
  }
});

test('an immediate counter-win takes precedence even when a double-threat block ranks first', () => {
  const position = GogoPosition.fromAscii([
    'X........',
    '.X.......',
    '..X......',
    '...X.....',
    'XXXX.....',
    '.........',
    '.........',
    '.........',
    'OOOO.....',
  ], WHITE);
  const result = new GogoAI({ maxDepth: 2, now: () => 0 }).findBestMove(position, 5_000);
  expect(result.move).toBe(decodeMove('e9', 9));
  expect(result.forcedWin).toBe(true);
  expect(result.forcedDefensiveMove).toBe(false);
  expect(result.depth).toBe(1);
  expect(position.toMove).toBe(WHITE);
  expect(position.ply).toBe(0);
});
