import { expect, test } from 'vitest';

import {
  BLACK,
  WHITE,
  decodeGame,
  decodeMove,
  getPuzzleById,
  PUZZLES,
} from '../../src/engine';

test('getPuzzleById returns a puzzle when id exists', () => {
  const puzzle = getPuzzleById('black-3-3');

  expect(puzzle).toBeDefined();
  expect(puzzle?.id).toBe('black-3-3');
  expect(puzzle?.toMove).toBe(BLACK);
});

test('getPuzzleById returns undefined when id does not exist', () => {
  expect(getPuzzleById('missing-id')).toBeUndefined();
});

test('every puzzle entry is internally consistent', () => {
  expect(PUZZLES.length).toBeGreaterThan(0);

  for (const puzzle of PUZZLES) {
    expect(puzzle.id.length).toBeGreaterThan(0);
    expect(puzzle.solution.length).toBeGreaterThan(0);
    expect(puzzle.depth).toBeGreaterThan(0);
    expect(puzzle.threshold).toBeGreaterThan(0);
    expect(puzzle.toMove === BLACK || puzzle.toMove === WHITE).toBe(true);

    const start = decodeGame(puzzle.encoded);
    expect(start.toMove).toBe(puzzle.toMove);

    const solutionIndex = decodeMove(puzzle.solution, start.size);
    expect(solutionIndex).toBeGreaterThanOrEqual(0);
    expect(start.isLegal(solutionIndex)).toBe(true);

    expect(puzzle.winningMoves.length).toBeGreaterThanOrEqual(1);
    expect(puzzle.winningMoves[0]).toBe(puzzle.solution);

    const solved = decodeGame(puzzle.wonEncoded);
    expect(solved.winner).toBe(puzzle.toMove);
  }
});

test('three new expert puzzles cover ko, sacrifice, and endgame themes', () => {
  for (const id of ['gen-expert-ko', 'gen-expert-sacrifice', 'gen-expert-endgame']) {
    const puzzle = getPuzzleById(id);
    expect(puzzle, id).toBeDefined();
    expect(puzzle!.depth).toBe(9);
    expect(puzzle!.threshold).toBe(4);
  }
});

test('new ko expert offers a legal ko-creating move', () => {
  const puzzle = getPuzzleById('gen-expert-ko')!;
  expect(puzzle).toBeDefined();
  const position = decodeGame(puzzle.encoded);
  let createsKo = false;
  for (let move = 0; move < position.area; move += 1) {
    if (!position.play(move)) continue;
    createsKo ||= position.koPoint !== -1;
    position.undo();
  }
  expect(createsKo).toBe(true);
});

test('new sacrifice expert leaves a multi-stone group capturable after its solution', () => {
  const puzzle = getPuzzleById('gen-expert-sacrifice')!;
  expect(puzzle).toBeDefined();
  const position = decodeGame(puzzle.encoded);
  const attacker = position.toMove;
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (let point = 0; point < position.area; point += 1) {
    if (position.board[point] !== attacker || seen.has(point)) continue;
    const liberties = position.scanGroup(point, attacker);
    const group = Array.from(position.groupBuffer.slice(0, position.scanGroupSize));
    group.forEach((stone) => seen.add(stone));
    if (liberties === 1 && group.length >= 2) groups.push(group);
  }
  expect(groups.length).toBeGreaterThan(0);
  position.play(decodeMove(puzzle.solution, position.size));
  let canSacrifice = false;
  for (let move = 0; move < position.area; move += 1) {
    if (!position.play(move)) continue;
    canSacrifice ||= groups.some((group) => group.every((stone) => position.board[stone] !== attacker));
    position.undo();
  }
  expect(canSacrifice).toBe(true);
});

test('new endgame expert starts with more than half its board occupied', () => {
  const puzzle = getPuzzleById('gen-expert-endgame')!;
  expect(puzzle).toBeDefined();
  const position = decodeGame(puzzle.encoded);
  expect(position.stoneCount).toBeGreaterThan(position.area / 2);
});

test('new experts are distinct board positions under symmetry and color reversal', () => {
  const canonical = (encoded: string) => {
    const p = decodeGame(encoded);
    const variants: string[] = [];
    for (const swap of [false, true]) {
      for (let transform = 0; transform < 8; transform += 1) {
        const cells = new Array<number>(p.area);
        let ko = -1;
        for (let i = 0; i < p.area; i += 1) {
          let x = i % p.size;
          let y = Math.floor(i / p.size);
          if (transform >= 4) x = p.size - 1 - x;
          for (let r = 0; r < transform % 4; r += 1) [x, y] = [p.size - 1 - y, x];
          const target = y * p.size + x;
          cells[target] = swap && p.board[i] !== 0 ? 3 - p.board[i] : p.board[i];
          if (i === p.koPoint) ko = target;
        }
        variants.push(`${p.size}:${swap ? 3 - p.toMove : p.toMove}:${ko}:${cells.join('')}`);
      }
    }
    return variants.sort()[0];
  };
  const newIds = ['gen-expert-ko', 'gen-expert-sacrifice', 'gen-expert-endgame'];
  for (const id of newIds) {
    const puzzle = getPuzzleById(id)!;
    expect(puzzle).toBeDefined();
    const key = canonical(puzzle.encoded);
    expect(PUZZLES.filter((other) => canonical(other.encoded) === key).map((other) => other.id)).toEqual([id]);
  }
});
