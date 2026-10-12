import { decodeGame, decodeMove, EMPTY } from './gogomoku';

/** Starting position metadata shared by stored puzzles and generated candidates. */
export interface ComparablePuzzle {
  readonly encoded: string;
  readonly solution: string;
  readonly depth: number;
  readonly threshold: number;
}

export interface PuzzleSimilarities {
  readonly localDirect: number;
  readonly localRotated: number;
  readonly boardDirect: number;
  readonly boardSymmetric: number;
}

type Stone = readonly [x: number, y: number, color: number];
interface PreparedPuzzle {
  readonly group: string;
  readonly local: readonly Set<string>[];
  readonly board: readonly Set<string>[];
}

export function jaccardSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let intersection = 0;
  for (const stone of a) {
    if (b.has(stone)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/** Four rotations; optional reflection supplies the remaining D4 symmetries. */
function transformedSets(stones: readonly Stone[], centerTwice: number, reflect: boolean): Set<string>[] {
  const sets: Set<string>[] = [];
  for (let reflection = 0; reflection < (reflect ? 2 : 1); reflection += 1) {
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const set = new Set<string>();
      for (const [sx, sy, color] of stones) {
        let x = reflection === 0 ? sx : centerTwice - sx;
        let y = sy;
        for (let turn = 0; turn < rotation; turn += 1) {
          [x, y] = [centerTwice - y, x];
        }
        set.add(`${x},${y},${color}`);
      }
      sets.push(set);
    }
  }
  return sets;
}

function prepare(puzzle: ComparablePuzzle): PreparedPuzzle {
  // Replay only encoded: captured stones and the unplayed solution are absent.
  const pos = decodeGame(puzzle.encoded);
  const solution = decodeMove(puzzle.solution, pos.size);
  if (solution === -1) throw new Error(`Invalid solution: ${puzzle.solution}`);
  const solutionX = solution % pos.size;
  const solutionY = Math.floor(solution / pos.size);
  const board: Stone[] = [];
  const local: Stone[] = [];
  for (let point = 0; point < pos.area; point += 1) {
    const color = pos.board[point];
    if (color === EMPTY) continue;
    const x = point % pos.size;
    const y = Math.floor(point / pos.size);
    board.push([x, y, color]);
    const dx = x - solutionX;
    const dy = y - solutionY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) <= 2) local.push([dx, dy, color]);
  }
  return {
    group: `${pos.size},${puzzle.depth},${puzzle.threshold}`,
    local: transformedSets(local, 0, false),
    board: transformedSets(board, pos.size - 1, true),
  };
}

function compare(a: PreparedPuzzle, b: PreparedPuzzle): PuzzleSimilarities {
  return {
    localDirect: jaccardSimilarity(a.local[0], b.local[0]),
    localRotated: Math.max(...b.local.map(set => jaccardSimilarity(a.local[0], set))),
    boardDirect: jaccardSimilarity(a.board[0], b.board[0]),
    boardSymmetric: Math.max(...b.board.map(set => jaccardSimilarity(a.board[0], set))),
  };
}

/** Returns null when board size, depth or threshold differs. */
export function puzzleSimilarities(a: ComparablePuzzle, b: ComparablePuzzle): PuzzleSimilarities | null {
  const left = prepare(a);
  const right = prepare(b);
  return left.group === right.group ? compare(left, right) : null;
}

export function hasDuplicateSimilarity(scores: PuzzleSimilarities): boolean {
  return scores.localDirect >= 0.4 || scores.localRotated >= 0.72 ||
    scores.boardDirect >= 0.25 || scores.boardSymmetric >= 0.86;
}

/** Cache decoded stones and symmetries, partitioned by comparison metadata. */
export class PuzzleDuplicateIndex {
  private readonly groups = new Map<string, PreparedPuzzle[]>();

  constructor(existing: readonly ComparablePuzzle[] = []) {
    // Retain every existing puzzle even if the catalog itself contains duplicates.
    for (const puzzle of existing) this.store(prepare(puzzle));
  }

  /** Accept and remember a puzzle only when none of the four constraints rejects it. */
  add(puzzle: ComparablePuzzle): boolean {
    const candidate = prepare(puzzle);
    const group = this.groups.get(candidate.group);
    if (group?.some(other => hasDuplicateSimilarity(compare(other, candidate)))) return false;
    this.store(candidate);
    return true;
  }

  private store(puzzle: PreparedPuzzle): void {
    const group = this.groups.get(puzzle.group);
    if (group) group.push(puzzle);
    else this.groups.set(puzzle.group, [puzzle]);
  }
}
