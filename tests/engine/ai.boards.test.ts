import { describe, expect, test } from 'vitest';

import { decodeGame, GogoAI, GogoPosition, WHITE } from '../../src/engine';

function depth2AI(pos: GogoPosition) {
  return new GogoAI({ maxDepth: 2, quiescenceDepth: 0, now: () => 0 }).findBestMove(pos, Infinity);
}

function rows(...boardRows: string[]): string[] {
  return boardRows.map((row) => row.replace(/\s+/g, ''));
}

describe('Gogo AI tactical scenarios (depth 2)', () => {
  test('Suicide blocker: forced loss when geometric block is illegal; one-stone fix removes forced loss', () => {
    const blocked = GogoPosition.fromAscii(rows(
      '. . . . . . B . .',
      '. W B B B B . B .',
      '. . . . . . B . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
    ), WHITE);
    expect(depth2AI(blocked).forcedLoss).toBe(true);

    const fixed = GogoPosition.fromAscii(rows(
      '. . . . . . B . .',
      '. W B B B B . . .',
      '. . . . . . B . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
    ), WHITE);

    expect(depth2AI(fixed).forcedLoss).toBe(false);
  });

  test('Ko blocker: history-defined ko blocks obvious defense; one-stone history change releases defense', () => {
    const koBlocked = decodeGame('B9 a5 g5 b5 f6 c5 f4 d5 e5 e6 h5 e4 h6 f5');
    expect(depth2AI(koBlocked).forcedLoss).toBe(true);

    // One-stone change: swap White's earlier e5 placement to a1.
    // This removes the ko-forbidden defense class collapse and makes e5 available as
    // a surviving response at depth 2.
    const koReleased = decodeGame('B9 a5 g5 b5 f6 c5 f4 d5 a1 e6 h5 e4 h6 f5');
    const defense = koReleased.index(4, 4);
    const best = depth2AI(koReleased);
    expect(best.move).toBe(defense);
    expect(best.forcedLoss).toBe(false);
  });

  test('Capture-only defense: AI returns the capturing move at depth 2 and no forced loss', () => {
    const pos = GogoPosition.fromAscii(rows(
      '. B . . . . . . .',
      'B B W . . . . . .',
      '. W B W . . . . .',
      '. . . B . . . . .',
      '. . . . B B . . .',
      '. . . . B . B . .',
      '. . . . . B . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
    ), WHITE);

    const best = depth2AI(pos);
    const captureMove = pos.index(2, 3);
    expect(best.move).toBe(captureMove);
    expect(best.forcedLoss).toBe(false);
  });

  test('Immediate counter-win: AI plays immediate win elsewhere at depth 2', () => {
    const pos = GogoPosition.fromAscii(rows(
      '. B B B B . . . .',
      'W W W W . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
    ), WHITE);

    const win = pos.index(4, 1);
    const best = depth2AI(pos);
    expect(best.move).toBe(win);
    expect(best.forcedWin).toBe(true);
  });

  test('Double threat: forced loss in 2, two one-stone changes remove it and preserve exact defenses', () => {
    const doubleThreat = GogoPosition.fromAscii(rows(
      '. B B B B . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
    ), WHITE);
    expect(depth2AI(doubleThreat).forcedLoss).toBe(true);

    const leftRemoved = GogoPosition.fromAscii(rows(
      'W B B B B . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
    ), WHITE);
    const defenseOnRight = leftRemoved.index(5, 0);
    const bestLeftRemoved = depth2AI(leftRemoved);
    expect(bestLeftRemoved.forcedLoss).toBe(false);
    expect(bestLeftRemoved.move).toBe(defenseOnRight);

    const rightRemoved = GogoPosition.fromAscii(rows(
      '. B B B B W . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
    ), WHITE);
    const defenseOnLeft = rightRemoved.index(0, 0);
    const bestRightRemoved = depth2AI(rightRemoved);
    expect(bestRightRemoved.forcedLoss).toBe(false);
    expect(bestRightRemoved.move).toBe(defenseOnLeft);
  });

  test('Overlapping threats: shared-stone capture is the only surviving move at depth 2', () => {
    const pos = GogoPosition.fromAscii(rows(
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . B . . . B . .',
      '. . . B W B . . .',
      '. . . W B W . . .',
      '. . . B . B . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
    ), WHITE);
    const best = depth2AI(pos);
    const capture = pos.index(4, 5);
    expect(best.move).toBe(capture);
    expect(best.forcedLoss).toBe(false);
  });
});
