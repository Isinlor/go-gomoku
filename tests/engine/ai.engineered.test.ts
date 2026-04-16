import { describe, expect, test } from 'vitest';

import { BLACK, decodeGame, EMPTY, GogoAI, GogoPosition, WHITE } from '../../src/engine';

function depth2AI() {
  return new GogoAI({ maxDepth: 2, quiescenceDepth: 4, now: () => 0 });
}

function rows(...boardRows: string[]): string[] {
  return boardRows.map((row) => row.replace(/\s+/g, ''));
}

// Lightweight, mock-free Depth 2 solver for test assertions.
// Returns legal defender moves that either win immediately or survive the opponent's next turn.
function getSurvivingOrWinningMoves(pos: GogoPosition): number[] {
  const buffer = new Int16Array(pos.area);
  const count = pos.generateAllLegalMoves(buffer);
  const survivingMoves: number[] = [];
  const winningMoves: number[] = [];

  for (let i = 0; i < count; i += 1) {
    const move = buffer[i];

    pos.play(move);
    if (pos.winner !== EMPTY) {
      winningMoves.push(move);
      pos.undo();
      continue;
    }

    const oppBuffer = new Int16Array(pos.area);
    const oppCount = pos.generateAllLegalMoves(oppBuffer);
    let opponentCanWin = false;
    for (let j = 0; j < oppCount; j += 1) {
      const oppMove = oppBuffer[j];
      pos.play(oppMove);
      if (pos.winner !== EMPTY) {
        opponentCanWin = true;
      }
      pos.undo();
      if (opponentCanWin) {
        break;
      }
    }

    if (!opponentCanWin) {
      survivingMoves.push(move);
    }
    pos.undo();
  }

  return winningMoves.length > 0 ? winningMoves : survivingMoves;
}

function isForcedLossIn2(pos: GogoPosition): boolean {
  return getSurvivingOrWinningMoves(pos).length === 0;
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
    expect(isForcedLossIn2(blocked)).toBe(true);

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

    expect(isForcedLossIn2(fixed)).toBe(false);
    expect(getSurvivingOrWinningMoves(fixed)).toContain(fixed.index(6, 1));
  });

  test('Ko blocker: history-defined ko blocks obvious defense; one-stone history change releases defense', () => {
    const koBlocked = decodeGame('B9 a5 g5 b5 f6 c5 f4 d5 e5 e6 h5 e4 h6 f5');
    expect(isForcedLossIn2(koBlocked)).toBe(true);

    // One-stone change: swap White's earlier e5 placement to a1.
    // This removes the ko-forbidden defense class collapse and makes e5 available as
    // a surviving response at depth 2.
    const koReleased = decodeGame('B9 a5 g5 b5 f6 c5 f4 d5 a1 e6 h5 e4 h6 f5');
    const defense = koReleased.index(4, 4);
    expect(isForcedLossIn2(koReleased)).toBe(false);
    expect(getSurvivingOrWinningMoves(koReleased)).toContain(defense);
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

    const captureMove = pos.index(2, 3);
    const valid = getSurvivingOrWinningMoves(pos);
    expect(isForcedLossIn2(pos)).toBe(false);
    expect(valid).toEqual([captureMove]);

    const ai = depth2AI();
    const best = ai.findBestMove(pos, 100);
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
    const valid = getSurvivingOrWinningMoves(pos);
    expect(valid).toContain(win);

    const best = depth2AI().findBestMove(pos, 100);
    expect(best.move).toBe(win);
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
    expect(isForcedLossIn2(doubleThreat)).toBe(true);

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
    expect(isForcedLossIn2(leftRemoved)).toBe(false);
    expect(getSurvivingOrWinningMoves(leftRemoved)).toEqual([leftRemoved.index(5, 0)]);
    expect(depth2AI().findBestMove(leftRemoved, 100).move).toBe(leftRemoved.index(5, 0));

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
    expect(isForcedLossIn2(rightRemoved)).toBe(false);
    expect(getSurvivingOrWinningMoves(rightRemoved)).toEqual([rightRemoved.index(0, 0)]);
    expect(depth2AI().findBestMove(rightRemoved, 100).move).toBe(rightRemoved.index(0, 0));
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

    const capture = pos.index(4, 5);
    expect(isForcedLossIn2(pos)).toBe(false);
    const valid = getSurvivingOrWinningMoves(pos);
    expect(valid).toEqual([capture]);

    const best = depth2AI().findBestMove(pos, 100);
    expect(best.move).toBe(capture);
    expect(best.forcedLoss).toBe(false);
  });
});
