import {
  GogoAI, GogoPosition, decodeGame, encodeMove, decodeMove,
  EMPTY, BLACK, WHITE, BoardUniquenessChecker, PUZZLES,
} from '../src/engine/index.ts';
import type { Player } from '../src/engine/gogomoku.ts';

const WIN = 1_000_000_000;

function createRng(seed: number) {
  let state = seed >> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >> 0;
    return state / 0x100000000;
  };
}

interface PuzzleResult {
  encoded: string;
  solution: string;
  toMove: Player;
  depth: number;
  threshold: number;
}

/**
 * Verify all puzzle criteria. Returns a PuzzleResult on success, or a rejection reason string.
 *
 * Bug fixes vs. original version:
 * 1. Uniqueness verification uses verifyDepth (targetDepth + 4) instead of targetDepth,
 *    so forced wins at deeper depths (e.g. depth 7 for a depth-5 puzzle) are detected.
 * 2. Win-detection threshold uses WIN - verifyDepth instead of WIN - targetDepth,
 *    so wins scoring below WIN - targetDepth are still caught.
 */
function verifyPuzzle(
  position: GogoPosition,
  targetDepth: number,
  targetThreshold: number,
): PuzzleResult | string {
  if (position.winner !== EMPTY) return 'game over';
  if (position.ply > 60) return 'too many moves';

  // 1. Depth-targeted q0 must find forced win at exactly the target depth
  const deepAI = new GogoAI({ maxDepth: targetDepth, quiescenceDepth: 0, maxPly: 64 });
  const deepResult = deepAI.findBestMove(position, 30_000);
  if (deepResult.timedOut) return 'deep timed out';
  if (deepResult.score !== WIN - targetDepth) return `score ${deepResult.score}!=${WIN - targetDepth}`;
  const solutionMove = deepResult.move;
  const solutionStr = encodeMove(solutionMove, position.meta);
  const toMove = position.toMove;

  // 2. Not Obvious: depth 3, quiescence 0 must NOT select the solution
  const shallowAI = new GogoAI({ maxDepth: 3, quiescenceDepth: 0, maxPly: 64 });
  const shallowResult = shallowAI.findBestMove(position, 10_000);
  if (shallowResult.move === solutionMove) return 'too obvious';

  // 3+4. Unique solution + threshold check (combined pass over all non-solution moves)
  // FIX: Use deeper search to catch wins beyond targetDepth (e.g. depth 7 wins in a depth-5 puzzle)
  const verifyDepth = targetDepth + 4;
  const verifyAI = new GogoAI({ maxDepth: verifyDepth, quiescenceDepth: 2, maxPly: 64 });
  const maxOppScore = WIN - (targetThreshold - 1);
  for (let move = 0; move < position.area; move++) {
    if (move === solutionMove) continue;
    if (position.board[move] !== EMPTY) continue;
    // Try playing the move; if it's illegal, skip
    if (!position.play(move)) continue;
    const oppResult = verifyAI.findBestMove(position, 30_000);
    position.undo();
    // Uniqueness: solver must not win from this branch at ANY depth up to verifyDepth
    // FIX: Use WIN - verifyDepth instead of WIN - targetDepth
    const solverScore = -oppResult.score;
    if (solverScore >= WIN - verifyDepth) {
      return `${encodeMove(move, position.meta)} also wins (${solverScore})`;
    }
    // Threshold: if the opponent wins, it must take >= threshold plies total
    if (oppResult.score >= WIN - 20) {
      if (oppResult.score > maxOppScore) {
        return `after ${encodeMove(move, position.meta)} opp wins fast (${oppResult.score}>${maxOppScore})`;
      }
    }
  }

  // 5. Realistic: no depth-3 win at any prefix position
  const encoded = position.encodeGame();
  const parts = encoded.trim().split(/\s+/);
  const replayPos = new GogoPosition(position.size);
  const realisticAI = new GogoAI({ maxDepth: 3, quiescenceDepth: 0, maxPly: 64 });
  for (let i = 1; i < parts.length; i++) {
    const check = realisticAI.findBestMove(replayPos, 2_000);
    if (check.score >= WIN - 3) return `prefix ${i} has depth-3 win`;
    const idx = decodeMove(parts[i], position.size);
    if (idx === -1 || !replayPos.play(idx)) return `invalid game at move ${i}`;
  }

  return { encoded, solution: solutionStr, toMove, depth: targetDepth, threshold: targetThreshold };
}

function generateGame(rng: () => number): GogoPosition {
  const pos = new GogoPosition(9);
  const ai3 = new GogoAI({ maxDepth: 3, quiescenceDepth: 3, maxPly: 64 });
  const ai1 = new GogoAI({ maxDepth: 1, quiescenceDepth: 1, maxPly: 64 });

  // Random opening: 1-3 moves, preferring central area
  const openingCount = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < openingCount; i++) {
    const legal: number[] = [];
    for (let m = 0; m < pos.area; m++) {
      if (pos.board[m] === EMPTY && pos.isLegal(m)) legal.push(m);
    }
    if (legal.length === 0) break;
    legal.sort((a, b) => {
      const da = Math.abs(pos.meta.xs[a] - 4) + Math.abs(pos.meta.ys[a] - 4);
      const db = Math.abs(pos.meta.xs[b] - 4) + Math.abs(pos.meta.ys[b] - 4);
      return da - db;
    });
    const topN = Math.max(4, Math.ceil(legal.length / 4));
    pos.play(legal[Math.floor(rng() * topN)]);
  }

  // AI play with occasional weaker moves for variety
  while (pos.winner === EMPTY && pos.ply < 55) {
    const useWeak = rng() < 0.15;
    const ai = useWeak ? ai1 : ai3;
    const result = ai.findBestMove(pos, useWeak ? 100 : 400);
    if (result.move === -1) break;
    pos.play(result.move);
  }
  return pos;
}

function main(): void {
  const TARGET = 10;
  const DEPTH = 5;
  const THRESHOLD = 3;
  const puzzles: PuzzleResult[] = [];
  const knownPositions = PUZZLES.map((p) => decodeGame(p.encoded));
  let checker = new BoardUniquenessChecker(knownPositions, 60);
  const rng = createRng(42);
  let games = 0;
  let candidates = 0;
  const ai5 = new GogoAI({ maxDepth: DEPTH, quiescenceDepth: 0, maxPly: 64 });
  const ai3q0 = new GogoAI({ maxDepth: 3, quiescenceDepth: 0, maxPly: 64 });

  while (puzzles.length < TARGET && games < 8000) {
    games++;
    const game = generateGame(rng);
    const encoded = game.encodeGame();
    const parts = encoded.trim().split(/\s+/);
    const totalMoves = parts.length - 1;

    for (let pLen = 6; pLen <= totalMoves && pLen <= 60; pLen++) {
      const prefix = parts.slice(0, pLen + 1).join(' ');
      let pos: GogoPosition;
      try { pos = decodeGame(prefix); } catch { continue; }
      if (pos.winner !== EMPTY) continue;

      // Quick filter: depth-5 finds exact WIN-5
      const dr = ai5.findBestMove(pos, 5_000);
      if (dr.score !== WIN - DEPTH || dr.timedOut) continue;

      // Quick filter: depth-3 q0 does NOT select the solution
      const sr = ai3q0.findBestMove(pos, 3_000);
      if (sr.move === dr.move) continue;

      candidates++;
      const moveStr = encodeMove(dr.move, pos.meta);
      process.stdout.write(`[G${games} m${pLen}] candidate #${candidates} sol=${moveStr} ... `);

      const result = verifyPuzzle(pos, DEPTH, THRESHOLD);
      if (typeof result === 'string') { console.log(`REJECT: ${result}`); continue; }
      if (!checker.isUnique(pos)) { console.log('REJECT: duplicate'); continue; }

      puzzles.push(result);
      knownPositions.push(pos);
      checker = new BoardUniquenessChecker(knownPositions, 60);
      console.log(`✓ PUZZLE #${puzzles.length}`);
      if (puzzles.length >= TARGET) break;
    }

    if (games % 100 === 0) {
      console.log(`--- ${games} games, ${candidates} cands, ${puzzles.length}/${TARGET} ---`);
    }
  }

  console.log(`\n=== ${puzzles.length} puzzles from ${games} games, ${candidates} candidates ===\n`);
  for (let i = 0; i < puzzles.length; i++) {
    const p = puzzles[i];
    const color = p.toMove === BLACK ? 'black' : 'white';
    console.log(`  {`);
    console.log(`    id: '${color}-5-3-gen${i + 1}',`);
    console.log(`    encoded: '${p.encoded}',`);
    console.log(`    toMove: ${p.toMove === BLACK ? 'BLACK' : 'WHITE'},`);
    console.log(`    solution: '${p.solution}',`);
    console.log(`    depth: ${p.depth},`);
    console.log(`    threshold: ${p.threshold},`);
    console.log(`  },`);
  }
}

main();
