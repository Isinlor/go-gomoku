import { expect, test } from 'vitest';
import { GogoAI, GogoPosition, computeZobristHashes } from '../../src/engine';

test.each([9, 11, 13] as const)('radius-two masks preserve geometry and move ordering on size %s', size => {
  const position = new GogoPosition(size);
  const meta = position.meta as any;
  const words = Math.ceil(position.area / 32);
  for (let point = 0; point < position.area; point++) {
    const actual = Array.from({ length: position.area }, (_, move) => move)
      .filter(move => (meta.near2Masks[point * words + (move >>> 5)] & (1 << (move & 31))) !== 0);
    expect(actual).toEqual(Array.from(meta.near2.slice(meta.near2Offsets[point], meta.near2Offsets[point + 1])));
  }
  for (const [x, y] of [[0, 0], [size - 1, size - 1], [2, 2], [3, 3]]) position.playXY(x, y);
  position.koPoint = position.index(1, 1);
  position.hash = computeZobristHashes(position);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const seen = new Set<number>();
  for (let point = 0; point < position.area; point++) {
    if (position.board[point] === 0) continue;
    for (let cursor = meta.near2Offsets[point]; cursor < meta.near2Offsets[point + 1]; cursor++) {
      const move = meta.near2[cursor];
      if (position.board[move] === 0 && move !== position.koPoint) seen.add(move);
    }
  }
  const expected = [...seen].map(move => ({ move, score: ai.scoreMove(position, move, -1, false) }))
    .sort((a, b) => b.score - a.score);
  const count = ai.generateNearbyMoves(position, ai.moveBuffers[0], ai.scoreBuffers[0], -1);
  expect(Array.from(ai.moveBuffers[0].slice(0, count))).toEqual(expected.map(item => item.move));
  expect(Array.from(ai.scoreBuffers[0].slice(0, count))).toEqual(expected.map(item => item.score));
});
