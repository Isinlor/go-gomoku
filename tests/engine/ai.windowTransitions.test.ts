import { expect, test } from 'vitest';
import { BLACK, GogoAI, GogoPosition } from '../../src/engine';

test('window classifications survive every valid count pair when an AI is reused', { tags: ['slow'] }, () => {
  const ai = new GogoAI() as any;
  ai.ensureBuffers(81);
  for (let black = 0; black <= 5; black++) {
    for (let white = 0; white <= 5 - black; white++) {
      const row = 'X'.repeat(black) + 'O'.repeat(white) + '.'.repeat(9 - black - white);
      const position = GogoPosition.fromAscii([row, ...Array(8).fill('.........')], BLACK);
      ai.beginWindowPass(position);
      const occupied = [];
      for (let point = 0; point < position.area; point++) {
        occupied.push(!!(ai.occupiedPoints[point >>> 5] & (1 << (point & 31))));
      }
      expect(occupied).toEqual(Array.from(position.board, cell => cell !== 0));
      const actual = [];
      const expected = [];
      for (let wi = 0; wi < position.meta.windowCount; wi++) {
        const cells = Array.from(position.meta.windows.slice(wi * 5, wi * 5 + 5), p => position.board[p]);
        const b = cells.filter(c => c === 1).length;
        const w = cells.filter(c => c === 2).length;
        actual.push([
          ai.windowCounts[wi],
          !!(ai.activeWindows[wi >>> 5] & (1 << (wi & 31))),
          !!(ai.winningWindows[wi >>> 5] & (1 << (wi & 31))),
        ]);
        expected.push([
          b * 6 + w,
          (b >= 2 && w === 0) || (w >= 2 && b === 0),
          (b === 4 && w === 0) || (w === 4 && b === 0),
        ]);
      }
      expect(actual, `window classifications for black=${black}, white=${white}`).toEqual(expected);
    }
  }
});

test('mixed windows keep counts without scheduling unchanged pattern work', () => {
  const position = GogoPosition.fromAscii(['XO.......', ...Array(8).fill('.........')], BLACK);
  const ai = new GogoAI() as any;
  ai.ensureBuffers(position.area);
  ai.beginPatternPass(position);
  const wi = Array.from({length: position.meta.windowCount}, (_, i) => i)
    .find(i => Array.from(position.meta.windows.slice(i * 5, i * 5 + 5)).join(',') === '0,1,2,3,4')!;
  expect(position.play(2)).toBe(true);
  ai.beginWindowPass(position);
  expect(ai.windowCounts[wi]).toBe(13);
  expect(ai.patternDirty[wi]).toBe(0);
  ai.beginPatternPass(position);
  const fresh = new GogoAI() as any;
  fresh.ensureBuffers(position.area);
  fresh.beginPatternPass(position);
  expect(ai.pointPatternBlack).toEqual(fresh.pointPatternBlack);
  expect(ai.pointPatternWhite).toEqual(fresh.pointPatternWhite);
  position.undo();
  ai.beginWindowPass(position);
  expect(ai.windowCounts[wi]).toBe(7);
  expect(ai.patternDirty[wi]).toBe(0);
});
