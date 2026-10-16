import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

test('immediate-win and response scans skip windows with only two or three stones', () => {
  const position = GogoPosition.fromAscii(['.XXX.....', '.........', '..OOO....', ...Array(6).fill('.........')], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  ai.beginWindowPass(position);
  let reads = 0;
  const counts = ai.windowCounts;
  ai.windowCounts = new Proxy(counts, { get(target, key) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
    return Reflect.get(target, key, target);
  } });
  expect(ai.findImmediateWin(position)).toBe(-1);
  expect(ai.findThreatResponses(position, 0)).toBe(-1);
  expect(reads).toBe(0);
});

test('four-window masks follow a blocked four, capture, undo, and position reuse', () => {
  const ai = new GogoAI() as any;
  const check = (position: GogoPosition) => {
    ai.ensureBuffers(position.area);
    ai.beginWindowPass(position);
    for (let wi = 0; wi < position.meta.windowCount; wi++) {
      const cells = Array.from(position.meta.windows.slice(wi * 5, wi * 5 + 5), p => position.board[p]);
      const black = cells.filter(c => c === 1).length;
      const white = cells.filter(c => c === 2).length;
      expect((ai.winningWindows[wi >>> 5] & (1 << (wi & 31))) !== 0)
        .toBe((black === 4 && white === 0) || (white === 4 && black === 0));
    }
  };
  const position = GogoPosition.fromAscii(['.XXXX....', '.........', '.........', ...Array(6).fill('.........')], 2);
  check(position);
  expect(position.play(0)).toBe(true);
  check(position);
  expect(position.undo()).toBe(true);
  check(position);
  const capture = GogoPosition.fromAscii(['.OOOOX...', '.XXXX....', '.........', ...Array(6).fill('.........')], BLACK);
  check(capture);
  expect(capture.play(0)).toBe(true);
  expect(capture.lastCapturedCount).toBe(4);
  check(capture);
  expect(capture.undo()).toBe(true);
  check(capture);
  check(position);
});

test.each(['generateOrderedMoves', 'generateFullBoardMoves'])('%s prepares pattern scoring once for all candidates', method => {
  const position = GogoPosition.fromAscii(['...XX....', '.........', '..OO.....', ...Array(6).fill('.........')], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  const prepare = ai.beginPatternPass.bind(ai);
  let passes = 0;
  ai.beginPatternPass = (...args: any[]) => { passes++; return prepare(...args); };
  expect(ai[method](position, ai.moveBuffers[0], ai.scoreBuffers[0], -1, false)).toBeGreaterThan(10);
  expect(passes).toBe(1);
});

test('window and evaluation caches read changed points rather than scanning the whole board', () => {
  const position = new GogoPosition(9);
  position.play(40);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  ai.evaluate(position);
  position.play(30);
  let reads = 0;
  const board = position.board;
  Object.defineProperty(position, 'board', { value: new Proxy(board, { get(target, key) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
    return Reflect.get(target, key, target);
  } }) });
  ai.evaluate(position);
  expect(reads).toBeLessThan(30);
});

test('incremental caches recover when more changes occur than the journal retains', () => {
  const position = new GogoPosition(9);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  ai.evaluate(position);
  for (let i = 0; i < 600; i++) { position.play(40); position.undo(); }
  position.play(30);
  const fresh = new GogoAI() as any;
  fresh.ensureBuffers(position.area);
  expect(ai.evaluate(position)).toBe(fresh.evaluate(position));
  expect(ai.windowCounts).toEqual(fresh.windowCounts);
  position.undo();
  expect(ai.evaluate(position)).toBe(0);
});

test('deferred pattern updates skip windows restored before scoring', () => {
  const position = new GogoPosition(9);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  ai.beginPatternPass(position);
  position.play(40);
  ai.beginWindowPass(position);
  position.undo();
  ai.beginWindowPass(position);
  let writes = 0;
  let score = ai.windowEvaluation;
  Object.defineProperty(ai, 'windowEvaluation', { get: () => score, set: value => { writes++; score = value; } });
  ai.beginPatternPass(position);
  expect(writes).toBe(0);
  expect(ai.dirtyWindowCount).toBe(0);
});

test('short move budgets reserve discovery time instead of launching speculative proofs', () => {
  const position = GogoPosition.fromAscii(['...XX....', '.........', '..OO.....', ...Array(6).fill('.........')], BLACK);
  let now = 0;
  const ai = new GogoAI({ maxDepth: 6, quiescenceDepth: 0, now: () => (now += 1) }) as any;
  const prove = ai.tryEarlyProof.bind(ai);
  let proofs = 0;
  ai.tryEarlyProof = (...args: any[]) => { proofs++; return prove(...args); };
  const result = ai.findBestMove(position, 25);
  expect(result.depth).toBeGreaterThan(0);
  expect(result.timedOut).toBe(true);
  expect(now).toBeGreaterThanOrEqual(25);
  expect(proofs).toBe(0);
  expect(position.ply).toBe(0);
});
