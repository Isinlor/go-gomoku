/**
 * CLI script to generate puzzles.
 *
 * Usage:
 *   npx tsx scripts/generate-puzzles.ts [difficulty] [count] [seed]
 *
 * difficulty: beginner | intermediate | advanced (default: beginner)
 * count:      number of puzzles to generate (default: 10)
 * seed:       RNG seed (default: current timestamp)
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

const difficulty = difficultyMap[diffArg];
if (!difficulty) {
  console.error(`Unknown difficulty: ${diffArg}. Use: beginner, intermediate, advanced`);
  process.exit(1);
}

console.log(`Generating ${countArg} ${diffArg} puzzles (n=${difficulty.n}, m=${difficulty.m}, k=${difficulty.k}) seed=${seedArg}`);
console.log('---');

const startTime = performance.now();

function formatStats(s: GeneratorStats): string {
  const rate = s.positionsChecked > 0 ? (s.totalTimeMs / s.positionsChecked).toFixed(2) : '0';
  return `games=${s.gamesPlayed} positions=${s.positionsChecked} found=${s.puzzlesFound} time=${(s.totalTimeMs / 1000).toFixed(1)}s rate=${rate}ms/pos`;
}

const { puzzles, stats } = generatePuzzles(difficulty, countArg, {
  seed: seedArg,
  maxGames: 500_000,
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
  const id = `gen-${color}-${p.depth}-${p.threshold}-${i + 1}`;
  console.log(`  {`);
  console.log(`    id: '${id}',`);
  console.log(`    encoded: '${p.encoded}',`);
  console.log(`    toMove: ${p.toMove === BLACK ? 'BLACK' : 'WHITE'},`);
  console.log(`    solution: '${p.solution}',`);
  console.log(`    depth: ${p.depth},`);
  console.log(`    threshold: ${p.threshold},`);
  console.log(`  },`);
}
