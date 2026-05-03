/**
 * CLI script to generate puzzles.
 *
 * Usage:
 *   npx tsx scripts/generate-puzzles.ts [difficulty] [count] [seed] [targetPly]
 *
 * difficulty: beginner | intermediate | advanced (default: beginner)
 * count:      number of puzzles to generate (default: 10)
 * seed:       RNG seed (default: current timestamp)
 * targetPly:  only generate puzzles at this exact ply (default: any)
 */
import {
  BEGINNER,
  INTERMEDIATE,
  ADVANCED,
  EXPERT,
  generatePuzzles,
  type PuzzleDifficulty,
  type GeneratorStats,
} from '../src/engine/puzzleGenerator';
import { BLACK } from '../src/engine/gogomoku';

const difficultyMap: Record<string, PuzzleDifficulty> = {
  beginner: BEGINNER,
  intermediate: INTERMEDIATE,
  advanced: ADVANCED,
  expert: EXPERT
};

const diffArg = process.argv[2] ?? 'beginner';
const countArg = parseInt(process.argv[3] ?? '10', 10);
const seedArg = parseInt(process.argv[4] ?? String(Date.now()), 10);
const targetPlyArg = process.argv[5] !== undefined ? parseInt(process.argv[5], 10) : undefined;

const difficulty = difficultyMap[diffArg];
if (!difficulty) {
  console.error(`Unknown difficulty: ${diffArg}. Use: beginner, intermediate, advanced`);
  process.exit(1);
}

const plyLabel = targetPlyArg !== undefined ? ` ply=${targetPlyArg}` : '';
console.log(`Generating ${countArg} ${diffArg} puzzles (n=${difficulty.n}, m=${difficulty.m}, k=${difficulty.k}) seed=${seedArg}${plyLabel}`);
console.log('---');

const startTime = performance.now();

function formatStats(s: GeneratorStats): string {
  const rate = s.positionsChecked > 0 ? (s.totalTimeMs / s.positionsChecked).toFixed(2) : '0';
  return `games=${s.gamesPlayed} positions=${s.positionsChecked} found=${s.puzzlesFound} time=${(s.totalTimeMs / 1000).toFixed(1)}s rate=${rate}ms/pos`;
}

const { puzzles, stats } = generatePuzzles(difficulty, countArg, {
  seed: seedArg,
  // 5 million max games ensures sufficient coverage for constrained searches
  // (e.g. targetPly=6 yields ~1 puzzle per 5,500 games, so 100 puzzles needs ~550k games)
  maxGames: 5_000_000,
  targetPly: targetPlyArg,
  onProgress: (s: GeneratorStats) => {
    console.log(`  [progress] ${formatStats(s)}`);
  },
});

const elapsed = performance.now() - startTime;
console.log('---');
console.log(`Done in ${(elapsed / 1000).toFixed(1)}s — ${formatStats(stats)}`);
console.log('');

if (puzzles.length === 0) {
  console.log('No puzzles found!');
  process.exit(0);
}

// Output puzzles in TypeScript format
console.log('// Generated puzzles:');
for (let i = 0; i < puzzles.length; i += 1) {
  const p = puzzles[i];
  const color = p.toMove === BLACK ? 'black' : 'white';
  const ply = targetPlyArg !== undefined ? `-ply${targetPlyArg}` : '';
  const id = `gen-${color}-${p.depth}-${p.threshold}${ply}-${i + 1}`;
  console.log(`  {`);
  console.log(`    id: '${id}',`);
  console.log(`    encoded: '${p.encoded}',`);
  console.log(`    toMove: ${p.toMove === BLACK ? 'BLACK' : 'WHITE'},`);
  console.log(`    solution: '${p.solution}',`);
  console.log(`    depth: ${p.depth},`);
  console.log(`    threshold: ${p.threshold},`);
  console.log(`    wonEncoded: '${p.wonEncoded}',`);
  console.log(`    winningMoves: [${p.winningMoves.map((m) => `'${m}'`).join(', ')}],`);
  console.log(`  },`);
}
