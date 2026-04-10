import { GogoAI } from '../src/engine/ai';
import { decodeGame, decodeMove } from '../src/engine/gogomoku';
import { PUZZLES, type Puzzle } from '../src/engine/puzzles';

const classicTimeMs: Record<number, number> = { 3: 500, 5: 2_000, 7: 8_000 };
const genClassicTimeMs: Record<number, number> = { 3: 15_000, 5: 15_000, 7: 20_000 };

function benchPuzzle(puzzle: Puzzle): { id: string; ms: number; nodes: number; ok: boolean } {
  const position = decodeGame(puzzle.encoded);
  const expectedIndex = decodeMove(puzzle.solution, position.size);
  const isGen = puzzle.id.startsWith('gen-');
  const timeMs = isGen ? (genClassicTimeMs[puzzle.depth] ?? 5_000) : (classicTimeMs[puzzle.depth] ?? 5_000);
  const ai = new GogoAI({ maxDepth: 10, quiescenceDepth: 8, maxPly: 96 });

  const start = performance.now();
  const result = ai.findBestMove(position, timeMs);
  const elapsed = performance.now() - start;

  return { id: puzzle.id, ms: elapsed, nodes: result.nodes, ok: result.move === expectedIndex };
}

let totalMs = 0;
let allOk = true;
const results: { id: string; ms: number; nodes: number; ok: boolean }[] = [];

for (const puzzle of PUZZLES) {
  const r = benchPuzzle(puzzle);
  results.push(r);
  totalMs += r.ms;
  if (!r.ok) allOk = false;
}

console.log('--- Puzzle Benchmark Results ---');
for (const r of results) {
  console.log(`${r.id.padEnd(25)} ${r.ms.toFixed(1).padStart(10)} ms  ${String(r.nodes).padStart(10)} nodes  ${r.ok ? 'OK' : 'FAIL'}`);
}
console.log(`${'TOTAL'.padEnd(25)} ${totalMs.toFixed(1).padStart(10)} ms`);
console.log(`All correct: ${allOk}`);
