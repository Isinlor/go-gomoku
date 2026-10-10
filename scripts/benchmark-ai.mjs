import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const baselineRef = process.argv.find(arg => arg.startsWith('--baseline='))?.slice(11) ?? 'HEAD';
const reportPath = resolve(root, process.argv.find(arg => arg.startsWith('--output='))?.slice(9) ?? 'work/ai-benchmark.json');
const baselineCommit = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${baselineRef}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
const baselineSource = execFileSync('git', ['show', `${baselineCommit}:src/engine/ai.ts`], { cwd: root, encoding: 'utf8' });
await mkdir(resolve(root, 'work'), { recursive: true });
const temporary = await mkdtemp(resolve(root, 'work/ai-benchmark-'));
await writeFile(resolve(temporary, 'baseline.ts'), baselineSource.replaceAll("from './", "from '/src/engine/"));
const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, watch: null } });

try {
  const { GogoAI, decodeGame, decodeMove, PUZZLES } = await server.ssrLoadModule('/src/engine/index.ts');
  const { GogoAI: BaselineAI } = await server.ssrLoadModule(resolve(temporary, 'baseline.ts'));
  const puzzles = PUZZLES.filter(puzzle => /^gen-(intermediate|advanced)-/.test(puzzle.id));
  const runPuzzle = (AI, puzzle) => {
    const position = decodeGame(puzzle.encoded);
    const ai = new AI({ maxDepth: 10, quiescenceDepth: 4 });
    const start = performance.now();
    const result = ai.findBestMove(position, puzzle.depth === 7 ? 20_000 : 15_000);
    const ms = performance.now() - start;
    if (result.move !== decodeMove(puzzle.solution, position.size) || !result.forcedWin || result.timedOut) {
      throw new Error(`${puzzle.id}: the AI did not prove the expected winning move`);
    }
    return { ms, ...result };
  };
  const median = runs => runs.map(run => run.ms).sort((left, right) => left - right)[1];
  // Warm both implementations equally, then alternate their order to reduce
  // startup, tiering, and order effects. Only the next three runs are measured.
  for (let warmup = 0; warmup < 2; warmup++) {
    for (const puzzle of puzzles) { runPuzzle(BaselineAI, puzzle); runPuzzle(GogoAI, puzzle); }
  }
  const comparisons = [];
  for (const puzzle of puzzles) {
    const before = [], after = [];
    for (let run = 0; run < 3; run++) {
      if (run % 2 === 0) { before.push(runPuzzle(BaselineAI, puzzle)); after.push(runPuzzle(GogoAI, puzzle)); }
      else { after.push(runPuzzle(GogoAI, puzzle)); before.push(runPuzzle(BaselineAI, puzzle)); }
    }
    comparisons.push({ id: puzzle.id, before, after, beforeMedianMs: median(before), afterMedianMs: median(after), passed: median(after) <= median(before) });
  }
  const lossRuns = [];
  for (let run = 0; run < 3; run++) {
    const position = decodeGame('B9 e9 e8 f9');
    const original = position.encodeGame(), hash = position.hash;
    const ai = new GogoAI({ maxDepth: 30, quiescenceDepth: 4 });
    const start = performance.now();
    const result = ai.findBestMove(position, 59_000);
    const ms = performance.now() - start;
    const passed = ms < 60_000 && result.forcedLoss && !result.timedOut && position.encodeGame() === original && position.hash === hash && position.isLegal(result.move);
    lossRuns.push({ ms, ...result, passed });
  }
  const passed = comparisons.every(row => row.passed) && lossRuns.every(run => run.passed);
  const report = { baselineCommit, date: new Date().toISOString(), repetitions: 3, passed, comparisons, forcedLoss: { encoded: 'B9 e9 e8 f9', runs: lossRuns, medianMs: median(lossRuns) } };
  await mkdir(resolve(reportPath, '..'), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.table(comparisons.map(row => ({ puzzle: row.id, 'before ms': row.beforeMedianMs.toFixed(2), 'after ms': row.afterMedianMs.toFixed(2), passed: row.passed })));
  console.log(`Forced loss median: ${(report.forcedLoss.medianMs / 1000).toFixed(3)}s; all runs under 60s: ${lossRuns.every(run => run.passed)}`);
  console.log(`Report: ${reportPath}`);
  if (!passed) process.exitCode = 1;
} finally {
  await server.close();
  await rm(temporary, { recursive: true, force: true });
}
