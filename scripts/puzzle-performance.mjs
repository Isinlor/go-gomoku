import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_ATTEMPTS = 5;

/** Compare three per-puzzle Vitest JSON reports from each revision. */
export function comparePuzzleRuns(masterReports, newReports, expectedPuzzles) {
  if (masterReports.length !== 3 || newReports.length !== 3) {
    throw new Error('Expected exactly three reports per version');
  }
  const runs = [...masterReports, ...newReports].map((report) => {
    if (!report.success) throw new Error('Puzzle test run failed');
    const timings = new Map();
    for (const suite of report.testResults) {
      for (const test of suite.assertionResults) {
        if (!/^Classic AI solves (generated )?puzzle /.test(test.fullName) || test.status === 'skipped') continue;
        if (test.status !== 'passed' || !Number.isFinite(test.duration) || test.duration < 0) {
          throw new Error(`Invalid puzzle timing: ${test.fullName}`);
        }
        if (timings.has(test.fullName)) throw new Error(`Duplicate puzzle: ${test.fullName}`);
        timings.set(test.fullName, test.duration);
      }
    }
    if (timings.size === 0) throw new Error('No puzzle timings found');
    return timings;
  });
  const names = expectedPuzzles ?? [...runs[0].keys()];
  for (const run of runs) {
    if (run.size !== names.length || names.some((name) => !run.has(name))) {
      throw new Error('All runs must measure the same puzzles');
    }
  }
  return names.map((puzzle) => {
    const masterMs = Math.max(...runs.slice(0, 3).map((run) => run.get(puzzle)));
    const newMs = Math.min(...runs.slice(3).map((run) => run.get(puzzle)));
    return { puzzle, masterMs, newMs, passed: newMs <= masterMs };
  });
}


/** Run both checkouts serially; retry only puzzles not yet validated. */
export function runPuzzlePerformance(masterRoot, newRoot = process.cwd(), log = console.log) {
  let reports;
  try {
    if (!masterRoot) throw new Error('Usage: node scripts/puzzle-performance.mjs MASTER_CHECKOUT');
    masterRoot = realpathSync(masterRoot);
    newRoot = realpathSync(newRoot);
    reports = mkdtempSync(join(tmpdir(), 'puzzle-performance-reports-'));
    let pending;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const pattern = pending
        ? `^(?:${pending.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`
        : '^Classic AI solves (generated )?puzzle ';
      const samples = { master: [], new: [] };
      for (let run = 1; run <= 3; run++) {
        for (const version of ['master', 'new']) {
          const report = join(reports, `${version}-${run}.json`);
          // Both revisions use the candidate's runner and configuration.
          const result = spawnSync(process.execPath, [
            join(newRoot, 'node_modules/vitest/vitest.mjs'), 'run',
            '--root', version === 'master' ? masterRoot : newRoot,
            '--config', join(newRoot, 'vitest.puzzles.config.ts'),
            '--maxWorkers=1', '--no-file-parallelism',
            '--testNamePattern', pattern, '--reporter=json', `--outputFile=${report}`,
          ], { cwd: newRoot, stdio: 'inherit' });
          if (result.status !== 0) {
            log(`Puzzle runner failed for ${version} (exit status ${result.status})`);
            return 2;
          }
          samples[version].push(JSON.parse(readFileSync(report, 'utf8')));
        }
      }

      const results = comparePuzzleRuns(samples.master, samples.new, pending);
      for (const result of results) {
        log(`${result.passed ? 'PASS' : 'FAIL'} ${result.puzzle} (attempt ${attempt}/${MAX_ATTEMPTS}): fastest new ${result.newMs.toFixed(3)} ms, slowest master ${result.masterMs.toFixed(3)} ms`);
      }
      pending = results.filter((result) => !result.passed).map((result) => result.puzzle);
      if (pending.length === 0) return 0;
      if (attempt < MAX_ATTEMPTS) {
        log('Possible performance regression; repeating only failing puzzles with fresh samples.');
      }
    }
    log('Performance regression confirmed after five attempts for the remaining puzzles.');
    return 1;
  } catch (error) {
    log(error.message);
    return 2;
  } finally {
    if (reports) rmSync(reports, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runPuzzlePerformance(process.argv[2]);
}
