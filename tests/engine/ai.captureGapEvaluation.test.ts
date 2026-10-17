import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoAI, GogoPosition, decodeGame, type Player } from '../../src/engine';

function setup(rows: string[], player: Player = BLACK) {
  const position = GogoPosition.fromAscii(rows, player);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  return { ai, position };
}

const empty = '.........';

test.each([BLACK, WHITE])('static evaluation recognizes the three-stone capture-gap precursor (%s)', player => {
  const rows = [empty, empty, empty, '....X....', '...X.X...', empty, empty, empty, empty];
  const { ai, position } = setup(player === BLACK ? rows : rows.map(row => row.replaceAll('X', 'O')), player);
  expect(ai.captureGapScore(position, position.index(4, 4))).toBe(player === BLACK ? 480 : -480);
  expect(ai.captureGapScore(position, position.index(4, 3))).toBe(0);
  const expected = ai.evaluate(position);
  // Independent totals: line potential 526, stone liberties/center 261.6,
  // plus one supported gap. This also verifies integration into leaf scoring.
  expect(expected).toBeCloseTo(526 + 261.6 + 480, 8);
  expect(position.playXY(4, 4)).toBe(true);
  expect(ai.captureGapScore(position, position.index(4, 4))).toBe(0);
  const fresh = new GogoAI() as any;
  fresh.ensureBuffers(position.area);
  expect(ai.evaluate(position)).toBe(fresh.evaluate(position));
  position.undo();
  expect(ai.evaluate(position)).toBe(expected);
});

test('the edge supplies support for a two-stone precursor', () => {
  const { ai, position } = setup([...Array(8).fill(empty), '...X.X...']);
  expect(ai.captureGapScore(position, position.index(4, 8))).toBe(480);
  expect(ai.captureGapScore(position, position.index(8, 8))).toBe(0);
});

test('unsupported pairs and mixed colors receive no capture-gap bonus', () => {
  const { ai, position } = setup([empty, empty, empty, empty, '..X.X.O..', empty, empty, empty, empty]);
  expect(ai.captureGapScore(position, position.index(3, 4))).toBe(0);
  expect(ai.captureGapScore(position, position.index(5, 4))).toBe(0);
  expect(ai.captureGapScore(position, position.index(0, 0))).toBe(0);
});

test('a supported gap is counted once even when both axes qualify', () => {
  const { ai, position } = setup([empty, empty, empty, '....O....', '...O.O...', '....O....', empty, empty, empty]);
  expect(ai.captureGapScore(position, position.index(4, 4))).toBe(-480);
});

test('capture-gap evaluation updates through captures and undo', () => {
  const { ai, position } = setup([empty, empty, '....O....', '...OXO...', '...X.X...', empty, empty, empty, empty], WHITE);
  const before = position.encodeGame();
  const original = ai.evaluate(position);
  expect(ai.captureGapScore(position, position.index(4, 4))).toBe(480);
  expect(position.playXY(4, 4)).toBe(true);
  expect(position.lastCapturedCount).toBe(1);
  expect(ai.captureGapScore(position, position.index(4, 4))).toBe(0);
  const fresh = new GogoAI() as any;
  fresh.ensureBuffers(position.area);
  expect(ai.evaluate(position)).toBe(fresh.evaluate(position));
  position.undo();
  expect(ai.evaluate(position)).toBe(original);
  expect(position.encodeGame()).toBe(before);
});

test('a gap connected to an opposing group is not a capture-backed block', () => {
  const { ai, position } = setup([empty, empty, empty, '....X....', '...X.X...', '....O....', empty, empty, empty]);
  expect(ai.captureGapScore(position, position.index(4, 4))).toBe(0);
});

test('a failed proof broadens discovery with a second evaluation and restores gap scoring on reuse', { tags: ['slow'] }, () => {
  const { ai, position } = setup([empty, empty, empty, '....X....', '...X.X...', empty, empty, empty, empty]);
  ai.deadline = Infinity;
  const before = position.encodeGame();
  expect(ai.evaluate(position)).toBeCloseTo(1267.6, 8);
  const state = { bestMove: position.index(2, 4), bestScore: 480, completedDepth: 1, hintMove: -1 };
  expect(ai.tryEarlyWinProof(position, state, 0, 1)).toBe(false);
  expect(ai.forcingQuiescence).toBe(false);
  expect(ai.evaluate(position)).toBeCloseTo(787.6, 8);
  ai.findBestMove(position, 0);
  expect(ai.forcingQuiescence).toBe(true);
  expect(ai.evaluate(position)).toBeCloseTo(1267.6, 8);
  expect(position.encodeGame()).toBe(before);
});

test('a failed depth-two gap probe leaves depth three available for the broader evaluation', { tags: ['slow'] }, () => {
  const position = decodeGame('B9 b9 g9');
  const rootPly = position.ply;
  const ai = new GogoAI({ maxDepth: 30, quiescenceDepth: 4, now: () => 0 }) as any;
  const root = ai.searchRoot.bind(ai);
  const depths: number[] = [];
  ai.searchRoot = (...args: any[]) => {
    if (args[0] === position && position.ply === rootPly) depths.push(args[1]);
    return root(...args);
  };
  const before = position.encodeGame();
  const result = ai.findBestMove(position, 1250);
  expect(result.forcedWin).toBe(true);
  expect(Math.max(...depths)).toBe(3);
  expect(result.nodes).toBeLessThan(30_000);
  expect(position.encodeGame()).toBe(before);
});
