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
