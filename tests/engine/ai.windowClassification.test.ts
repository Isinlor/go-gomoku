import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

test('window activity follows every unopposed count and mixed window through undo', () => {
  const position = new GogoPosition(9);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const check = () => {
    ai.beginWindowPass(position);
    for (let wi = 0; wi < position.meta.windowCount; wi++) {
      const cells = Array.from(position.meta.windows.slice(wi * 5, wi * 5 + 5), p => position.board[p]);
      const black = cells.filter(c => c === 1).length;
      const white = cells.filter(c => c === 2).length;
      expect(!!(ai.activeWindows[wi >>> 5] & (1 << (wi & 31)))).toBe(
        (black >= 2 && white === 0) || (white >= 2 && black === 0));
      expect(!!(ai.winningWindows[wi >>> 5] & (1 << (wi & 31)))).toBe(
        (black === 4 && white === 0) || (white === 4 && black === 0));
    }
  };
  check();
  for (const move of [0, 9, 1, 10, 2, 11, 3, 12, 4]) {
    expect(position.play(move)).toBe(true);
    check();
  }
  expect(position.winner).toBe(BLACK);
  while (position.undo()) check();
});

test('marked scoring visits sparse candidates in board order across word boundaries', () => {
  const position = new GogoPosition(13);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const moves = new Int16Array(position.area);
  const scores = new Float64Array(position.area);
  for (const points of [[0, 31, 32, 63, 64, 127, 168], [], [168]]) {
    ai.candidateEpoch++;
    ai.tacticalCandidates.fill(0);
    for (const point of points) {
      ai.candidateMarks[point] = ai.candidateEpoch;
      ai.tacticalCandidates[point >>> 5] |= 1 << (point & 31);
    }
    const count = ai.generateMarkedMoves(position, moves, scores, -1);
    const expected = points.map(move => ({ move, score: ai.scoreMove(position, move, -1, false) }))
      .sort((a, b) => b.score - a.score);
    expect(Array.from(moves.slice(0, count))).toEqual(expected.map(p => p.move));
    expect(Array.from(scores.slice(0, count))).toEqual(expected.map(p => p.score));
  }
});
