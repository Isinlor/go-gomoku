import { expect, test } from 'vitest';
import { BLACK, WHITE, GogoAI, GogoPosition } from '../../src/engine';

test.each([BLACK, WHITE])('a forced block leaves enough tactical horizon to see the following fork (%s)', defender => {
  const rows = ['XXXX.....', '.........', '.........', '.X.XX....', ...Array(5).fill('.........')];
  const position = GogoPosition.fromAscii(defender === WHITE ? rows : rows.map(row => row.replaceAll('X', 'O')), defender);
  const before = position.toAscii();
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  expect(ai.quiescence(position, -Infinity, Infinity, 0, 2)).toBeLessThan(-999_999_000);
  expect(position.toAscii()).toEqual(before);
  expect(position.toMove).toBe(defender);
});

test.each([BLACK, WHITE])('an immediate legal five is recognized at the tactical horizon (%s)', player => {
  const row = (player === BLACK ? 'X' : 'O').repeat(4) + '.....';
  const position = GogoPosition.fromAscii([row, ...Array(8).fill('.........')], player);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  expect(ai.quiescence(position, -Infinity, Infinity, 0, 0)).toBe(999_999_999);
  expect(position.ply).toBe(0);
});

test('the broader setup scout retains its fixed tactical horizon', () => {
  const position = GogoPosition.fromAscii(['XXXX.....', '.........', '.........', '.X.XX....', ...Array(5).fill('.........')], WHITE);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.forcingQuiescence = false;
  ai.deadline = Infinity;
  expect(ai.quiescence(position, -Infinity, Infinity, 0, 2)).toBeGreaterThan(-999_999_000);
  expect(position.ply).toBe(0);
});

test.each([BLACK, WHITE])('an unblockable threat is a tactical loss when other moves remain legal (%s)', defender => {
  const rows = ['XX.XX....', '..X......', ...Array(7).fill('.........')];
  const position = GogoPosition.fromAscii(defender === WHITE ? rows : rows.map(row => row.replaceAll('X', 'O')), defender);
  expect(position.isLegal(2)).toBe(false);
  expect(position.hasAnyLegalMove()).toBe(true);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  expect(ai.quiescence(position, -Infinity, Infinity, 0, 2)).toBe(-999_999_998);
  expect(position.ply).toBe(0);
});

test('an unanswerable threat remains neutral when the defender has no legal turn', () => {
  const position = GogoPosition.fromAscii([
    'XX.XXXXOX', 'OXXXOOXXX', 'XX.XOXOXO', 'OXXOOOXOX', 'XOOXXXOOO',
    'XXOXOOOOX', 'OOOXXXOXX', 'XOXOOXOXO', 'XOXOOOXOX',
  ], WHITE);
  expect(position.winner).toBe(0);
  expect(position.hasAnyLegalMove()).toBe(false);
  const ai = new GogoAI({ now: () => 0 }) as any;
  ai.ensureBuffers(position.area);
  ai.deadline = Infinity;
  expect(ai.quiescence(position, -Infinity, Infinity, 0, 2)).toBe(0);
  expect(position.ply).toBe(0);
});

test.each([BLACK, WHITE])('a mate found in quiescence is verified before deeper discovery can replace it (%s)', player => {
  const stone = player === BLACK ? 'X' : 'O';
  const position = GogoPosition.fromAscii(['.' + stone.repeat(3) + '.....', ...Array(8).fill('.........')], player);
  const result = new GogoAI({ maxDepth: 1, now: () => 0 }).findBestMove(position, 5);
  expect(result).toMatchObject({ move: 4, depth: 1, forcedWin: true, heuristicWin: true });
  expect(position.ply).toBe(0);
});

test('forcing cache entries respect the remaining recursion allowance', () => {
  const position = GogoPosition.fromAscii(['XXXX.....', '.........', '.........', '.X.XX....', ...Array(5).fill('.........')], WHITE);
  const setup = () => {
    const ai = new GogoAI({ maxPly: 4, now: () => 0 }) as any;
    ai.ensureBuffers(position.area);
    ai.deadline = Infinity;
    return ai;
  };
  const ai = setup();
  expect(ai.quiescence(position, -Infinity, Infinity, 0, 2)).toBeLessThan(-999_999_000);
  const expected = setup().quiescence(position, -Infinity, Infinity, 2, 2);
  expect(expected).toBeGreaterThan(-999_999_000);
  expect(ai.quiescence(position, -Infinity, Infinity, 2, 2)).toBe(expected);
});
