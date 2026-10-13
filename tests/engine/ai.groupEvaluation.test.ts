import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoAI, GogoPosition } from '../../src/engine';

test.each([BLACK, WHITE])('a healthy connected edge group is evaluated using shared liberties (%s)', player => {
  const position = GogoPosition.fromAscii([
    'XXX......', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], player);
  expect(position.scanGroup(0, BLACK)).toBe(4);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const score = ai.evaluate(position);
  expect(player === BLACK ? score : -score).toBeGreaterThan(500);
});

test('evaluation queries a connected group once and reuses its cached info for every stone', () => {
  const position = GogoPosition.fromAscii([
    'XXX......', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const query = ai.primeScoredGroupInfo.bind(ai);
  let queries = 0;
  ai.primeScoredGroupInfo = (...args: any[]) => { queries++; return query(...args); };
  const before = ai.evaluate(position);
  expect(ai.evaluate(position)).toBe(before);
  expect(queries).toBe(1);
  expect(position.play(9)).toBe(true);
  ai.evaluate(position);
  expect(queries).toBe(2);
  position.undo();
  expect(ai.evaluate(position)).toBe(before);
  expect(queries).toBe(3);
});

test('move scoring reuses group information already prepared by evaluation', () => {
  const position = GogoPosition.fromAscii([
    '.XXX.....', '.OOO.....', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  ai.evaluate(position);
  const query = ai.primeScoredGroupInfo.bind(ai);
  let queries = 0;
  ai.primeScoredGroupInfo = (...args: any[]) => { queries++; return query(...args); };
  expect(Number.isFinite(ai.scoreMove(position, 0, -1, false))).toBe(true);
  expect(Number.isFinite(ai.scoreMove(position, 9, -1, false))).toBe(true);
  expect(queries).toBe(0);
});

test('isolated stones use their adjacent liberties without a full group traversal', () => {
  const position = GogoPosition.fromAscii([
    'X.O......', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const scan = position.scanGroup.bind(position);
  let traversals = 0;
  position.scanGroup = (...args: Parameters<typeof scan>) => { traversals++; return scan(...args); };
  ai.evaluate(position);
  expect(ai.scoredGroupLiberties[0]).toBe(2);
  expect(ai.scoredGroupLiberties[2]).toBe(3);
  expect(ai.scoredGroupSizes[0]).toBe(1);
  expect(ai.scoredGroupRoots[2]).toBe(2);
  expect(traversals).toBe(0);
});

test('tactical generation reuses evaluated groups and still includes every capture and escape liberty', () => {
  const position = GogoPosition.fromAscii([
    '.O.......', 'OX.......', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  ai.evaluate(position);
  const scan = position.scanGroup.bind(position);
  let traversals = 0;
  position.scanGroup = (...args: Parameters<typeof scan>) => { traversals++; return scan(...args); };
  ai.appendGroupTacticalMoves(position, WHITE, true);
  ai.appendGroupTacticalMoves(position, BLACK, false);
  const candidates = Array.from({ length: position.area }, (_, i) => i)
    .filter(i => ai.candidateMarks[i] === ai.candidateEpoch);
  expect(candidates).toEqual([0, 2, 11, 18, 19]);
  expect(traversals).toBe(0);
  const fresh = new GogoAI() as any;
  fresh.ensureBuffers(position.area);
  fresh.appendGroupTacticalMoves(position, WHITE, true);
  fresh.appendGroupTacticalMoves(position, BLACK, false);
  expect(Array.from(fresh.candidateMarks)).toEqual(Array.from(ai.candidateMarks));
});

test.each(['normal', 'tactical', 'full'])('a %s move batch prepares pattern scores once', mode => {
  const position = GogoPosition.fromAscii([
    '.XXX.....', '.OOO.....', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const prepare = ai.beginPatternPass.bind(ai);
  let preparations = 0;
  ai.beginPatternPass = (...args: any[]) => { preparations++; return prepare(...args); };
  const moves = new Int16Array(position.area), scores = new Float64Array(position.area);
  const count = mode === 'full'
    ? ai.generateFullBoardMoves(position, moves, scores, -1, false)
    : ai.generateOrderedMoves(position, moves, scores, -1, mode === 'tactical');
  expect(count).toBeGreaterThan(1);
  expect(preparations).toBe(1);
  for (let i = 0; i < count; i++) {
    expect(scores[i]).toBe(ai.scoreMove(position, moves[i], -1, mode === 'tactical'));
  }
});

test('a distant move preserves cached group information while local changes refresh it', () => {
  const position = GogoPosition.fromAscii([
    'XXX......', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const query = ai.primeScoredGroupInfo.bind(ai);
  const queried: number[] = [];
  ai.primeScoredGroupInfo = (...args: any[]) => { queried.push(args[1]); return query(...args); };
  ai.evaluate(position);
  expect(queried).toEqual([0]);
  expect(position.play(80)).toBe(true);
  ai.evaluate(position);
  expect(queried).toEqual([0, 80]);
  position.undo();
  ai.evaluate(position);
  expect(queried).toEqual([0, 80]);
  expect(position.play(9)).toBe(true);
  const score = ai.evaluate(position);
  expect(queried).toEqual([0, 80, 0]);
  const fresh = new GogoAI() as any;
  fresh.ensureBuffers(position.area);
  expect(score).toBe(fresh.evaluate(position));
});

test('incremental group caches agree with fresh scans after captures, undo and position replacement', () => {
  const ai = new GogoAI() as any;
  const position = new GogoPosition(9);
  ai.ensureBuffers(position.area);
  const check = (board: GogoPosition) => {
    const fresh = new GogoAI() as any;
    fresh.ensureBuffers(board.area);
    expect(ai.evaluate(board)).toBe(fresh.evaluate(board));
    for (let point = 0; point < board.area; point++) {
      if (board.board[point] === 0) continue;
      const liberties = board.scanGroup(point, board.board[point] as any);
      expect(ai.scoredGroupLiberties[point]).toBe(liberties);
      expect(ai.scoredGroupSizes[point]).toBe(board.scanGroupSize);
      const members: number[] = [];
      for (let member = ai.scoredGroupRoots[point]; member !== -1; member = ai.scoredGroupNext[member]) {
        members.push(member);
        expect(members.length).toBeLessThanOrEqual(board.area);
      }
      expect(members.toSorted((a, b) => a - b)).toEqual(Array.from(board.groupBuffer.slice(0, board.scanGroupSize)).sort((a, b) => a - b));
    }
  };
  check(position);
  for (const [x, y] of [[1, 0], [0, 0], [0, 1]]) {
    expect(position.playXY(x, y)).toBe(true);
    check(position);
  }
  expect(position.lastCapturedCount).toBe(1);
  for (let i = 0; i < 3; i++) { position.undo(); check(position); }
  check(GogoPosition.fromAscii([
    'XXX......', '.X.......', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], WHITE));
  check(position);
});

test('unchanged groups reuse their evaluated stone contributions', () => {
  const position = GogoPosition.fromAscii([
    'XXX......', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const reads = new Map<number, number>();
  const centerBias = new Proxy(position.meta.centerBias, {
    get(target, property) {
      const point = Number(property);
      if (Number.isInteger(point)) reads.set(point, (reads.get(point) ?? 0) + 1);
      return Reflect.get(target, property, target);
    },
  });
  (position as any).meta = { ...position.meta, centerBias };
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const initial = ai.evaluate(position);
  expect(ai.evaluate(position)).toBe(initial);
  expect([...reads.entries()]).toEqual([[0, 1], [1, 1], [2, 1]]);
  position.play(80);
  ai.evaluate(position);
  expect(reads.get(0)).toBe(1);
  expect(reads.get(80)).toBe(1);
});

test('joining cached groups and undoing the join refreshes both member lists and scores', () => {
  const position = GogoPosition.fromAscii([
    'X.X......', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const initial = ai.evaluate(position);
  expect(ai.scoredGroupSizes[0]).toBe(1);
  expect(ai.scoredGroupSizes[2]).toBe(1);
  expect(position.play(1)).toBe(true);
  const merged = ai.evaluate(position);
  expect([0, 1, 2].map(point => ai.scoredGroupSizes[point])).toEqual([3, 3, 3]);
  const fresh = new GogoAI() as any;
  fresh.ensureBuffers(position.area);
  expect(merged).toBe(fresh.evaluate(position));
  position.undo();
  expect(ai.evaluate(position)).toBe(initial);
  expect(ai.scoredGroupSizes[0]).toBe(1);
  expect(ai.scoredGroupSizes[2]).toBe(1);
  expect(ai.scoredGroupNext[0]).toBe(-1);
  expect(ai.scoredGroupNext[2]).toBe(-1);
});
