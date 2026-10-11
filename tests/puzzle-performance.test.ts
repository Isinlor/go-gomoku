// @vitest-environment node
import { expect, test } from 'vitest';
import { comparePuzzleRuns } from '../scripts/puzzle-performance.mjs';

const name = 'Classic AI solves puzzle black-3-3';
const generated = 'Classic AI solves generated puzzle gen-beginner-1';
function report(duration: unknown, fullName = name, status = 'passed') {
  return { success: true, testResults: [{ assertionResults: [
    { fullName, status, duration },
    { fullName: 'unrelated test', status: 'skipped' },
  ] }] };
}
const runs = (...times: number[]) => times.map((time) => report(time));

test('compares each puzzle using the fastest new and slowest master run, including equality', () => {
  expect(comparePuzzleRuns(runs(10, 20, 30), runs(40, 30, 50))).toEqual([
    { puzzle: name, masterMs: 30, newMs: 30, passed: true },
  ]);
  expect(comparePuzzleRuns(runs(10, 20, 30), runs(31, 40, 50))[0].passed).toBe(false);
});

test('compares generated puzzles independently and matches by name rather than report order', () => {
  const old = runs(10, 20, 30);
  const current = runs(5, 6, 7);
  old.forEach((r) => r.testResults[0].assertionResults.push({ fullName: generated, status: 'passed', duration: 2 }));
  current.forEach((r) => r.testResults[0].assertionResults.unshift({ fullName: generated, status: 'passed', duration: 3 }));
  expect(comparePuzzleRuns(old, current).map((r) => r.passed)).toEqual([true, false]);
});

test('requires exactly three reports from each version', () => {
  expect(() => comparePuzzleRuns(runs(1, 2), runs(1, 2, 3))).toThrow('three');
  expect(() => comparePuzzleRuns(runs(1, 2, 3), runs(1, 2))).toThrow('three');
});

test('rejects failed runs, missing puzzles and empty selections', () => {
  expect(() => comparePuzzleRuns([{ ...report(1), success: false }, ...runs(1, 1)], runs(1, 1, 1))).toThrow('failed');
  expect(() => comparePuzzleRuns([report(1, name, 'failed'), ...runs(1, 1)], runs(1, 1, 1))).toThrow('timing');
  expect(() => comparePuzzleRuns([report(1, name, 'skipped'), ...runs(1, 1)], runs(1, 1, 1))).toThrow('No puzzle');
  expect(() => comparePuzzleRuns(runs(1, 1, 1), [report(1, generated), ...runs(1, 1)])).toThrow('same puzzles');
  expect(() => comparePuzzleRuns(runs(1, 1, 1), [report(1, 'unrelated'), ...runs(1, 1)])).toThrow('No puzzle');
  expect(() => comparePuzzleRuns(runs(1, 1, 1), runs(1, 1, 1).map((r) => ({ ...r, testResults: [] })))).toThrow('No puzzle');
});

test.each([undefined, -1, NaN, Infinity, '1'])('rejects invalid timings: %s', (duration) => {
  expect(() => comparePuzzleRuns([report(duration), ...runs(1, 1)], runs(1, 1, 1))).toThrow('timing');
});

test('rejects duplicate puzzle names', () => {
  const duplicate = report(1);
  duplicate.testResults[0].assertionResults.push({ fullName: name, status: 'passed', duration: 1 });
  expect(() => comparePuzzleRuns([duplicate, ...runs(1, 1)], runs(1, 1, 1))).toThrow('Duplicate');
});


test('ignores skipped puzzles already validated in an earlier attempt', () => {
  const selected = runs(1, 1, 1);
  selected.forEach(r => r.testResults[0].assertionResults.push({ fullName: generated, status: 'skipped' }));
  expect(comparePuzzleRuns(selected, runs(1, 1, 1))).toHaveLength(1);
});

test('rejects a selected puzzle missing from all six reports', () => {
  expect(() => comparePuzzleRuns(runs(1, 1, 1), runs(1, 1, 1), [name, generated])).toThrow('same puzzles');
});
