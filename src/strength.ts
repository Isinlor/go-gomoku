import { playGame, type AIPlayer } from './compare';
import { GogoPosition, type SupportedSize } from './engine';

export interface StrengthOptions {
  boardSize: SupportedSize;
  timeLimitMs: number;
  openings: readonly number[][];
  now?: () => number;
  positionFactory?: (size: SupportedSize) => GogoPosition;
}

export interface StrengthSummary {
  games: number;
  candidateWins: number;
  baselineWins: number;
  draws: number;
  invalidMoves: number;
  scoreRate: number;
  lowerBound95: number;
}

export interface StrengthGate {
  passed: boolean;
  reason: string;
}

export function defaultOpenings(size: SupportedSize): number[][] {
  const center = Math.floor(size / 2);
  const idx = (x: number, y: number) => (y * size) + x;

  const build = (...xy: Array<[number, number]>) => xy.map(([x, y]) => idx(x, y));

  return [
    [],
    build([center, center]),
    build([center, center], [center + 1, center]),
    build([center, center], [center, center + 1]),
    build([center - 1, center], [center + 1, center]),
    build([center, center - 1], [center, center + 1]),
    build([0, 0]),
    build([size - 1, size - 1]),
    build([0, size - 1]),
    build([size - 1, 0]),
  ];
}

export function applyOpening(position: GogoPosition, opening: readonly number[]): void {
  for (const move of opening) {
    if (!position.isLegal(move)) {
      throw new Error(`Illegal opening move: ${move}`);
    }
    position.play(move);
    if (position.winner !== 0) {
      throw new Error('Opening already has a winner');
    }
  }
}

export function evaluateStrength(
  candidateFactory: () => AIPlayer,
  baselineFactory: () => AIPlayer,
  options: StrengthOptions,
): StrengthSummary {
  const now = options.now ?? (() => Date.now());
  const positionFactory = options.positionFactory ?? ((size: SupportedSize) => new GogoPosition(size));
  const summary: StrengthSummary = {
    games: 0,
    candidateWins: 0,
    baselineWins: 0,
    draws: 0,
    invalidMoves: 0,
    scoreRate: 0,
    lowerBound95: 0,
  };

  for (const opening of options.openings) {
    for (const candidateColor of [1, 2] as const) {
      const position = positionFactory(options.boardSize);
      applyOpening(position, opening);
      const candidate = candidateFactory();
      const baseline = baselineFactory();
      const result = playGame(candidate, baseline, options.timeLimitMs, candidateColor, position, now);
      summary.games += 1;
      if (result.invalidMove) {
        summary.invalidMoves += 1;
      }
      if (result.winner === 1) summary.candidateWins += 1;
      else if (result.winner === 2) summary.baselineWins += 1;
      else summary.draws += 1;
    }
  }

  summary.scoreRate = computeScoreRate(summary.candidateWins, summary.draws, summary.games);
  summary.lowerBound95 = wilsonLowerBound(summary.candidateWins, summary.draws, summary.games);
  return summary;
}

export function computeScoreRate(wins: number, draws: number, games: number): number {
  if (games <= 0) return 0;
  return (wins + (0.5 * draws)) / games;
}

export function wilsonLowerBound(
  wins: number,
  draws: number,
  games: number,
  z = 1.96,
): number {
  if (games <= 0) return 0;
  const p = computeScoreRate(wins, draws, games);
  const z2 = z * z;
  const denom = 1 + (z2 / games);
  const center = p + (z2 / (2 * games));
  const margin = z * Math.sqrt(((p * (1 - p)) / games) + (z2 / (4 * games * games)));
  return (center - margin) / denom;
}

export function gateImprovement(summary: StrengthSummary, minLowerBound = 0.5): StrengthGate {
  if (summary.games === 0) {
    return { passed: false, reason: 'No games were played' };
  }
  if (summary.invalidMoves > 0) {
    return { passed: false, reason: `Invalid moves found: ${summary.invalidMoves}` };
  }
  if (summary.lowerBound95 <= minLowerBound) {
    return {
      passed: false,
      reason: `Lower confidence bound ${summary.lowerBound95.toFixed(3)} is not above ${minLowerBound.toFixed(3)}`,
    };
  }
  return {
    passed: true,
    reason: `Lower confidence bound ${summary.lowerBound95.toFixed(3)} is above ${minLowerBound.toFixed(3)}`,
  };
}

export function formatStrength(summary: StrengthSummary): string {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return [
    `Games: ${summary.games}`,
    `Candidate wins: ${summary.candidateWins}`,
    `Baseline wins: ${summary.baselineWins}`,
    `Draws: ${summary.draws}`,
    `Invalid moves: ${summary.invalidMoves}`,
    `Score rate: ${pct(summary.scoreRate)}`,
    `95% lower bound: ${pct(summary.lowerBound95)}`,
  ].join('\n');
}

