import type { GogoAI, SearchResult } from './engine/ai';
import { BLACK, WHITE, EMPTY, type GogoPosition } from './engine/gogomoku';

export const EVALUATION_BUDGETS = [5, 25, 100] as const;
const RESULT_FLAGS = ['forcedDefensiveMove', 'forcedWin', 'forcedLoss', 'heuristicWin', 'heuristicLoss', 'timedOut'] as const;
type ResultFlag = typeof RESULT_FLAGS[number];
export interface Playout {
  winner: number;
  final: string;
  plies: number;
  termination: 'winner' | 'no-legal-moves' | 'ply-limit';
}
export interface EvaluatedBoard {
  encoded: string;
  scores: Record<typeof EVALUATION_BUDGETS[number], number>;
  strongest: Pick<SearchResult, 'move' | 'depth' | 'nodes'> & Partial<Record<ResultFlag, true>>;
  screening?: { score: number; strongest: EvaluatedBoard['strongest'] };
  playout?: Playout;
}

/** Each budget starts a fresh search; scores use the engine's side-to-move perspective. */
export function evaluateBoard(encoded: string, search: (encoded: string, ms: number) => SearchResult): EvaluatedBoard {
  const results = EVALUATION_BUDGETS.map(ms => search(encoded, ms));
  const strongest = results[2];
  return {
    encoded,
    scores: { 5: results[0].score, 25: results[1].score, 100: strongest.score },
    strongest: summarizeResult(strongest),
  };
}

function summarizeResult(strongest: SearchResult): EvaluatedBoard['strongest'] {
  const flags: Partial<Record<ResultFlag, true>> = {};
  for (const flag of RESULT_FLAGS) if (strongest[flag]) flags[flag] = true;
  return { move: strongest.move, depth: strongest.depth, nodes: strongest.nodes, ...flags };
}

function hasOutcomeClaim(flags: EvaluatedBoard['strongest']): boolean {
  return !!(flags.forcedWin || flags.forcedLoss || flags.heuristicWin || flags.heuristicLoss);
}

function rankingScore(board: EvaluatedBoard, budget: 100 | 10_000): number {
  if (budget === 100) return board.scores[100];
  if (!board.screening) throw new Error(`Missing 10-second evaluation: ${board.encoded}`);
  return board.screening.score;
}

export function rankBoards(boards: readonly EvaluatedBoard[], budget: 100 | 10_000 = 100): EvaluatedBoard[] {
  return [...boards].sort((a, b) => Math.abs(rankingScore(a, budget)) - Math.abs(rankingScore(b, budget))
    || a.encoded.localeCompare(b.encoded));
}

/** Walk the full 100ms ranking until enough positions survive the stronger search. */
export function screenBoards(boards: readonly EvaluatedBoard[], search: (encoded: string, ms: number) => SearchResult,
  target = 300): EvaluatedBoard[] {
  if (!Number.isInteger(target) || target < 1) throw new Error(`Invalid screening target: ${target}`);
  const selected: EvaluatedBoard[] = [];
  for (const board of boards) {
    if (!board.screening) {
      const result = search(board.encoded, 10_000);
      board.screening = { score: result.score, strongest: summarizeResult(result) };
    }
    if (hasOutcomeClaim(board.screening.strongest)) continue;
    selected.push(board);
    if (selected.length === target) return selected;
  }
  throw new Error(`Only screened ${selected.length} eligible boards; need ${target}`);
}

/** A finite cap prevents captures from trapping dataset generation in a cycle. */
export function playOut(position: GogoPosition, ai: Pick<GogoAI, 'findBestMove'>, maxPlies = 500): Playout {
  let plies = 0;
  while (position.winner === EMPTY && plies < maxPlies) {
    if (!position.hasAnyLegalMove()) break;
    const { move } = ai.findBestMove(position, 75);
    if (!position.play(move)) throw new Error(`Illegal playout move: ${move}`);
    plies += 1;
  }
  return { winner: position.winner, final: position.encodeGame(), plies,
    termination: position.winner !== EMPTY ? 'winner' : plies === maxPlies ? 'ply-limit' : 'no-legal-moves' };
}

/** Input is ranked; cached playouts allow interrupted runs to resume. */
export function collectBoards(boards: readonly EvaluatedBoard[], play: (encoded: string) => Playout, quota = 50): EvaluatedBoard[] {
  if (!Number.isInteger(quota) || quota < 1) throw new Error(`Invalid quota: ${quota}`);
  const collection: EvaluatedBoard[] = [];
  let white = 0;
  let black = 0;
  for (const board of boards) {
    const flags = board.screening?.strongest ?? board.strongest;
    if (hasOutcomeClaim(flags)) continue;
    const outcome = board.playout ?? play(board.encoded);
    board.playout = outcome;
    if (outcome.winner === WHITE && white < quota) { white += 1; collection.push(board); }
    if (outcome.winner === BLACK && black < quota) { black += 1; collection.push(board); }
    if (white === quota && black === quota) return collection;
  }
  throw new Error(`Only collected ${white} white and ${black} black wins; need ${quota} of each`);
}
