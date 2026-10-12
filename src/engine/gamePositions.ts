import type { GogoAIOptions, SearchResult } from './ai';
import { BLACK, WHITE, type Player } from './gogomoku';

/** Search regression cases without a puzzle's unique winning move requirement. */
export interface GamePosition {
  readonly id: string;
  readonly encoded: string;
  readonly toMove: Player;
  readonly searchOptions: Readonly<Omit<GogoAIOptions, 'now'>>;
  readonly timeMs: number;
  /** Only deterministic SearchResult fields should be asserted. */
  readonly expectedResult: Readonly<Partial<SearchResult>>;
}

export const GAME_POSITIONS: readonly GamePosition[] = [
  {
    id: 'edge-attack-forced-win',
    encoded: 'B9 e9 e8 f9 g9',
    toMove: BLACK,
    searchOptions: { maxDepth: 30, quiescenceDepth: 4 },
    timeMs: 60_000,
    expectedResult: { forcedWin: true, heuristicWin: false, timedOut: false },
  },
  {
    id: 'edge-forced-loss',
    encoded: 'B9 e9 e8 f9',
    toMove: WHITE,
    searchOptions: { maxDepth: 30, quiescenceDepth: 4 },
    timeMs: 59_000,
    expectedResult: { forcedLoss: true, heuristicLoss: true, timedOut: false },
  },
];
