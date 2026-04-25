import { describe, expect, test } from 'vitest';

import {
  applyOpening,
  computeScoreRate,
  defaultOpenings,
  evaluateStrength,
  formatStrength,
  gateImprovement,
  wilsonLowerBound,
} from '../src/strength';
import { GogoPosition } from '../src/engine';
import type { AIPlayer } from '../src/compare';


const FULL_BOARD_NO_WINNER = GogoPosition.fromAscii([
  'XXXXOXXXX',
  'XXOXXXXOX',
  'OXXXXOXXX',
  'XXXOXXXXO',
  'XOXXXXOXX',
  'XXXXOXXXX',
  'XXOXXXXOX',
  'OXXXXOXXX',
  'XXXOXXXXO',
]);

function seqAI(moves: number[]): AIPlayer {
  let i = 0;
  return { findBestMove: () => ({ move: moves[i++] ?? -1 }) };
}

describe('strength utilities', () => {
  test('defaultOpenings includes empty and central openings', () => {
    const openings = defaultOpenings(9);
    expect(openings.length).toBe(10);
    expect(openings[0]).toEqual([]);
    expect(openings[1]).toEqual([40]);
    expect(openings[2]).toEqual([40, 41]);
  });

  test('applyOpening plays legal moves and rejects illegal or finished openings', () => {
    const pos = new GogoPosition(9);
    applyOpening(pos, [40, 41, 39]);
    expect(pos.stoneCount).toBe(3);

    const illegal = new GogoPosition(9);
    expect(() => applyOpening(illegal, [40, 40])).toThrow(/Illegal opening/);

    const winning = new GogoPosition(9);
    const openingWin = [0, 9, 1, 10, 2, 11, 3, 12, 4];
    expect(() => applyOpening(winning, openingWin)).toThrow(/winner/);
  });

  test('evaluateStrength returns paired-color totals and counts invalid moves', () => {
    const candidatePool = [
      seqAI([0, 1, 2, 3, 4]),
      seqAI([-1]),
      seqAI([0, 1, 2, 3, 4]),
      seqAI([0]),
    ];
    const baselinePool = [
      seqAI([9, 18, 27, 36]),
      seqAI([9]),
      seqAI([9, 18, 27, 36]),
      seqAI([0]),
    ];
    let ci = 0;
    let bi = 0;

    const summary = evaluateStrength(
      () => candidatePool[ci++],
      () => baselinePool[bi++],
      {
        boardSize: 9,
        timeLimitMs: 100,
        openings: [[], []],
        now: () => 0,
      },
    );

    expect(summary.games).toBe(4);
    expect(summary.candidateWins).toBe(2);
    expect(summary.baselineWins).toBe(2);
    expect(summary.draws).toBe(0);
    expect(summary.invalidMoves).toBe(2);
    expect(summary.scoreRate).toBe(0.5);
    expect(summary.lowerBound95).toBeGreaterThan(0);
  });


  test('evaluateStrength can record draws and use default clock', () => {
    const summary = evaluateStrength(
      () => seqAI([]),
      () => seqAI([]),
      {
        boardSize: 9,
        timeLimitMs: 10,
        openings: [[]],
        positionFactory: () => FULL_BOARD_NO_WINNER.clone(),
      },
    );

    expect(summary.games).toBe(2);
    expect(summary.draws).toBe(2);
    expect(summary.candidateWins).toBe(0);
    expect(summary.baselineWins).toBe(0);
    expect(summary.invalidMoves).toBe(0);
  });


  test('evaluateStrength default clock path is used on playable positions', () => {
    const summary = evaluateStrength(
      () => seqAI([0, 1, 2, 3, 4]),
      () => seqAI([9, 18, 27, 36]),
      {
        boardSize: 9,
        timeLimitMs: 100,
        openings: [[]],
      },
    );

    expect(summary.games).toBe(2);
    expect(summary.candidateWins + summary.baselineWins + summary.draws).toBe(2);
  });

  test('score and wilson helpers handle empty and non-empty samples', () => {
    expect(computeScoreRate(0, 0, 0)).toBe(0);
    expect(computeScoreRate(3, 2, 10)).toBe(0.4);

    expect(wilsonLowerBound(0, 0, 0)).toBe(0);
    const lb = wilsonLowerBound(8, 2, 10);
    expect(lb).toBeGreaterThan(0.4);
    expect(lb).toBeLessThan(1);
  });

  test('gateImprovement and formatter report pass/fail reasons', () => {
    expect(gateImprovement({
      games: 0,
      candidateWins: 0,
      baselineWins: 0,
      draws: 0,
      invalidMoves: 0,
      scoreRate: 0,
      lowerBound95: 0,
    }).passed).toBe(false);

    const invalidGate = gateImprovement({
      games: 10,
      candidateWins: 8,
      baselineWins: 1,
      draws: 1,
      invalidMoves: 1,
      scoreRate: 0.85,
      lowerBound95: 0.6,
    });
    expect(invalidGate.passed).toBe(false);
    expect(invalidGate.reason).toContain('Invalid moves');

    const lowGate = gateImprovement({
      games: 10,
      candidateWins: 5,
      baselineWins: 5,
      draws: 0,
      invalidMoves: 0,
      scoreRate: 0.5,
      lowerBound95: 0.3,
    }, 0.5);
    expect(lowGate.passed).toBe(false);

    const passGate = gateImprovement({
      games: 10,
      candidateWins: 7,
      baselineWins: 2,
      draws: 1,
      invalidMoves: 0,
      scoreRate: 0.75,
      lowerBound95: 0.55,
    }, 0.5);
    expect(passGate.passed).toBe(true);

    const text = formatStrength({
      games: 10,
      candidateWins: 7,
      baselineWins: 2,
      draws: 1,
      invalidMoves: 0,
      scoreRate: 0.75,
      lowerBound95: 0.55,
    });
    expect(text).toContain('Games: 10');
    expect(text).toContain('Score rate: 75.0%');
    expect(text).toContain('95% lower bound: 55.0%');
  });
});
