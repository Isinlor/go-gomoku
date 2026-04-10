/**
 * Puzzle benchmark script.
 *
 * Measures GogoAI solve time, node count, and depth for every puzzle.
 * A puzzle PASSES when the AI finds the unique winning first move within
 * the given time limit.
 *
 * Usage:
 *   npx tsx scripts/benchmark.ts
 *
 * Time limits:
 *   Classic (hand-crafted) — depth 3: 500 ms, depth 5: 2 000 ms, depth 7: 8 000 ms
 *   Generated              — all depths: 20 000 ms
 */
import { GogoAI, decodeGame, decodeMove, PUZZLES } from '../src/engine/index.ts';

const CLASSIC_TIME_MS: Record<number, number> = { 3: 500, 5: 2_000, 7: 8_000 };
const GENERATED_TIME_MS = 20_000;

console.log('GogoAI Puzzle Benchmark');
console.log('='.repeat(80));
console.log(`${'Puzzle'.padEnd(28)} ${'Result'.padEnd(8)} ${'Time(ms)'.padEnd(12)} ${'Nodes'.padEnd(12)} Depth`);
console.log('-'.repeat(80));

let totalTime = 0;
let totalNodes = 0;
let allCorrect = true;

for (const puzzle of PUZZLES) {
  const isGenerated = puzzle.id.startsWith('gen-');
  const timeLimitMs = isGenerated
    ? GENERATED_TIME_MS
    : (CLASSIC_TIME_MS[puzzle.depth] ?? 5_000);

  const position = decodeGame(puzzle.encoded);
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 4 });

  const start = performance.now();
  const result = ai.findBestMove(position, timeLimitMs);
  const elapsed = performance.now() - start;

  const expectedIndex = decodeMove(puzzle.solution, position.size);
  const correct = result.move === expectedIndex;
  if (!correct) allCorrect = false;

  totalTime += elapsed;
  totalNodes += result.nodes;

  const status = correct ? 'PASS' : 'FAIL';
  console.log(
    `${puzzle.id.padEnd(28)} ${status.padEnd(8)} ${elapsed.toFixed(1).padStart(10)} ms  ${String(result.nodes).padStart(10)}  ${result.depth}`,
  );
}

console.log('='.repeat(80));
console.log(
  `${'TOTAL'.padEnd(28)} ${(allCorrect ? 'PASS' : 'FAIL').padEnd(8)} ${totalTime.toFixed(1).padStart(10)} ms  ${String(totalNodes).padStart(10)}`,
);
if (!allCorrect) {
  process.exit(1);
}
