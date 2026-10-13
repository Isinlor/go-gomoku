// @vitest-environment node
import { expect, test } from 'vitest';
import { BLACK, WHITE, EMPTY, GogoPosition, otherPlayer, type Player } from '../../src/engine/gogomoku';
import { ForcedWinSearcher } from '../../src/engine/puzzleGenerator';
import { GogoAI } from '../../src/engine/ai';
import { completeForcedWin } from '../helpers/forcedWinOracle';

const directions = [
  { name: 'horizontal', point: (start: number, step: number) => [start + step, 4] },
  { name: 'vertical', point: (start: number, step: number) => [4, start + step] },
  { name: 'diagonal down', point: (start: number, step: number) => [start + step, start + step] },
  { name: 'diagonal up', point: (start: number, step: number) => [start + step, 8 - start - step] },
];
const cases = ([BLACK, WHITE] as Player[]).flatMap(attacker => directions.flatMap(direction =>
  [0, 1, 2].map(start => ({ attacker, direction, start })),
));

const captureCases = ([BLACK, WHITE] as Player[]).flatMap(attacker =>
  Array.from({ length: 8 }, (_, symmetry) => ({ attacker, symmetry })),
);

test.each(captureCases)('capture neighborhood boundaries: player=$attacker symmetry=$symmetry', { timeout: 5_000 }, ({ attacker, symmetry }) => {
  const searcher = new ForcedWinSearcher(81, 4);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(81);
  ai.resetProofSearch();
  ai.deadline = Infinity;
  let positive = 0;
  let negative = 0;
  // Remove one surrounding stone or one stone of the prospective winning
  // line, then all six. These are immediate neighbors of the capture proof.
  for (const removed of [0, 1, 2, 4, 8, 16, 32, 63]) {
    const board = ['O........', '.XO......', '.OXO.....', '...X.....', '..O.X....', '..O......', '..O......', '.........', '.........']
      .map(row => row.split(''));
    const candidates = [[2, 1], [1, 2], [3, 2], [2, 4], [2, 5], [2, 6]];
    candidates.forEach(([x, y], bit) => { if (removed & (1 << bit)) board[y][x] = '.'; });
    const transformed = Array.from({ length: 9 }, () => Array<string>(9).fill('.'));
    for (let y = 0; y < 9; y += 1) {
      for (let x = 0; x < 9; x += 1) {
        let tx = symmetry < 4 ? x : 8 - x;
        let ty = y;
        for (let turn = 0; turn < symmetry % 4; turn += 1) [tx, ty] = [8 - ty, tx];
        const cell = board[y][x];
        // The base fixture attacks with White; exchange colors for Black.
        transformed[ty][tx] = attacker === WHITE ? cell : cell === 'X' ? 'O' : cell === 'O' ? 'X' : '.';
      }
    }
    const pos = GogoPosition.fromAscii(transformed.map(row => row.join('')), attacker);
    const before = pos.toAscii();
    const hash = pos.hash;
    const expected = completeForcedWin(pos, attacker, 3);
    expect(searcher.hasForcedWin(pos, attacker, 3), `removed=${removed}`).toBe(expected);
    expect(ai.proofAttack(pos, 3, 0), `removed=${removed}`).toBe(expected);
    expect(pos.toAscii()).toEqual(before);
    expect(pos.hash).toBe(hash);
    expect(pos.toMove).toBe(attacker);
    expect(pos.ply).toBe(0);
    if (expected) positive += 1;
    else negative += 1;
  }
  expect(positive).toBeGreaterThan(0);
  expect(negative).toBeGreaterThan(0);
});

// Seven ternary cells include both overlapping XXX.XX patterns and every
// single-cell blocker/removal next to them. Edge/center placements exercise
// zero, one, and two open ends. The judge searches the entire 9x9 board.
test.each(cases)('complete line enumeration: player=$attacker $direction.name start=$start', { timeout: 10_000 }, ({ attacker, direction, start }) => {
  const searcher = new ForcedWinSearcher(81, 4);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(81);
  ai.deadline = Infinity;
  ai.resetProofSearch();
  let positive = 0;
  let negative = 0;
  let koChecks = 0;
  for (let code = 0; code < 3 ** 7; code += 1) {
    let value = code;
    const board = Array.from({ length: 9 }, () => Array<string>(9).fill('.'));
    const points: number[] = [];
    for (let step = 0; step < 7; step += 1) {
      const [x, y] = direction.point(start, step);
      const color = [EMPTY, attacker, otherPlayer(attacker)][value % 3];
      board[y][x] = color === BLACK ? 'X' : color === WHITE ? 'O' : '.';
      points.push(y * 9 + x);
      value = Math.floor(value / 3);
    }
    const pos = GogoPosition.fromAscii(board.map(row => row.join('')), otherPlayer(attacker));
    // Terminal lines are covered by the terminal-state tests, not threat tests.
    if (pos.winner !== EMPTY) continue;
    const before = pos.toAscii();
    const hash = pos.hash;
    // Also forbid each empty pattern cell in turn; ordinary play expires ko.
    for (const ko of [-1, ...points.filter(point => pos.board[point] === EMPTY)]) {
      pos.koPoint = ko;
      // Keep the synthetic restriction and its public Zobrist state consistent
      // so both engines can safely reuse their real transposition caches.
      const restrictedHash = hash ^ pos.meta.zobristKo64[pos.area]
        ^ pos.meta.zobristKo64[ko === -1 ? pos.area : ko];
      pos.hash = restrictedHash;
      const expected = completeForcedWin(pos, attacker, 2);
      const actual = searcher.hasForcedWin(pos, attacker, 2);
      const proof = ai.proofDefend(pos, 2, 0);
      // Build detailed assertion diagnostics only on a mismatch, keeping this
      // exhaustive sweep fast enough to run in the normal coverage suite.
      if (actual !== expected || proof !== expected) {
        expect({ actual, proof }, `code=${code}, ko=${ko}, board=${before.join('/')}`)
          .toEqual({ actual: expected, proof: expected });
      }
      if (pos.hash !== restrictedHash || pos.koPoint !== ko || pos.toMove !== otherPlayer(attacker) || pos.ply !== 0) {
        expect([pos.hash, pos.koPoint, pos.toMove, pos.ply]).toEqual([restrictedHash, ko, otherPlayer(attacker), 0]);
      }
      if (expected) positive += 1;
      else negative += 1;
      if (ko !== -1) koChecks += 1;
    }
    expect(pos.toAscii()).toEqual(before);
  }
  // Guard against vacuous enumeration or filtering out all boundary cases.
  expect(positive + negative).toBe(7216);
  expect(positive).toBeGreaterThan(0);
  expect(negative).toBeGreaterThan(0);
  expect(koChecks).toBeGreaterThan(0);
});
