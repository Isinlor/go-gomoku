import { expect, test } from 'vitest';
import { BLACK, EMPTY, WHITE, GogoAI, GogoPosition, computeZobristHashes, otherPlayer } from '../../src/engine';

test.each([BLACK, WHITE])('sparse attacking candidates retain exact scores across bit words and ko (%s)', player => {
  const rows = Array(13).fill('.............');
  rows[0] = '.OO..........';
  rows[2] = '....XXX......';
  rows[9] = '........XX...';
  rows[12] = '......XXX....';
  const position = GogoPosition.fromAscii(rows, player);
  position.koPoint = 127;
  position.hash = computeZobristHashes(position);
  const ai = new GogoAI() as any;
  const oracle = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  oracle.ensureBuffers(position.area);
  const candidates = new Set<number>();
  const opponent = otherPlayer(player);
  const addEmpty = (point: number) => {
    if (position.board[point] === EMPTY && point !== position.koPoint) candidates.add(point);
  };
  for (let window = 0; window < position.meta.windowCount; window++) {
    const points = Array.from(position.meta.windows.slice(window * 5, window * 5 + 5));
    if (points.filter(point => position.board[point] === player).length >= 2
      && points.every(point => position.board[point] !== opponent)) points.forEach(addEmpty);
  }
  const seen = new Set<number>();
  for (let point = 0; point < position.area; point++) {
    if (position.board[point] !== opponent || seen.has(point)) continue;
    const liberties = position.scanGroup(point, opponent);
    for (let i = 0; i < position.scanGroupSize; i++) {
      const stone = position.groupBuffer[i];
      seen.add(stone);
      if (liberties < 1 || liberties > 2) continue;
      for (let offset = 0; offset < 4; offset++) addEmpty(position.meta.neighbors4[stone * 4 + offset]);
    }
  }
  const expected = [...candidates].sort((a, b) => a - b)
    .map(move => ({ move, score: oracle.scoreMove(position, move, -1, false) }))
    .sort((a, b) => b.score - a.score);
  const count = ai.generateAttackingMoves(position, ai.moveBuffers[0], ai.scoreBuffers[0], -1, 0, 2);
  expect(Array.from(ai.moveBuffers[0].slice(0, count))).toEqual(expected.map(item => item.move));
  expect(Array.from(ai.scoreBuffers[0].slice(0, count))).toEqual(expected.map(item => item.score));
  expect(position.koPoint).toBe(127);
});
