/** Compare three per-puzzle Vitest JSON reports from each revision. */
export function comparePuzzleRuns(masterReports, newReports) {
  if (masterReports.length !== 3 || newReports.length !== 3) {
    throw new Error('Expected exactly three reports per version');
  }
  const runs = [...masterReports, ...newReports].map((report) => {
    if (!report.success) throw new Error('Puzzle test run failed');
    const timings = new Map();
    for (const suite of report.testResults) {
      for (const test of suite.assertionResults) {
        if (!/^Classic AI solves (generated )?puzzle /.test(test.fullName)) continue;
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
  const names = [...runs[0].keys()];
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
