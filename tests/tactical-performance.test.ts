// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as rules from '../src/engine/gogomoku';
import { extractTacticalCases, probeTacticalCase, benchmarkTactics, runTacticalCli } from '../scripts/tactical-performance.mjs';

const goal = { id: 'win', encoded: 'B9', goal: 'forcedWin' };
function fixture(threshold = 4, result: any = {}) {
  return { ...rules, GogoAI: class {
    findBestMove(_position: unknown, budget: number) {
      return { move: 0, depth: 3, nodes: 10, forcedWin: budget >= threshold, ...result };
    }
  } };
}
function dataset() {
  const signal = (engine: string, flags: string[], encoded = 'B9') => ({ engine, flags, encoded, elapsedMs: 10, result: { move: 0 } });
  return { results: [{ games: [{ signals: [
    signal('master', ['forcedWin', 'heuristicWin']), signal('candidate', ['forcedWin']),
    signal('candidate', ['forcedLoss', 'heuristicLoss'], 'B9 e5'),
    signal('master', ['forcedWin'], 'B9 d5'),
  ] }, {}] }] };
}

test('extracts and deduplicates recorded flags, stratifying selection across all four goals', () => {
  const cases = extractTacticalCases(dataset());
  expect(cases).toHaveLength(5);
  expect(cases.slice(0, 4).map(c => c.goal)).toEqual(['forcedWin', 'forcedLoss', 'heuristicWin', 'heuristicLoss']);
  expect(cases[0].sources.map(s => s.engine)).toEqual(['master', 'candidate']);
  expect(extractTacticalCases(dataset(), 2)).toHaveLength(2);
  expect(extractTacticalCases({ results: [{}] })).toEqual([]);
  expect(() => extractTacticalCases({})).toThrow('results');
  for (const limit of [0, -1, 1.5]) expect(() => extractTacticalCases(dataset(), limit)).toThrow('limit');
  const invalid = { results: [{ games: [{ signals: [{ encoded: 'B9', flags: ['unknown'] }] }] }] };
  expect(() => extractTacticalCases(invalid)).toThrow('signal');
});

test('probes fresh searches at increasing budgets and records the first successful detection', () => {
  let tick = 0;
  expect(probeTacticalCase(fixture(), goal, 75, () => tick++)).toMatchObject({ reached: true, budgetMs: 4, elapsedMs: 1, result: { nodes: 10 } });
  expect(probeTacticalCase(fixture(75), goal)).toMatchObject({ reached: true, budgetMs: 75 });
  expect(probeTacticalCase(fixture(100), goal)).toMatchObject({ reached: false, budgetMs: 75 });
  expect(probeTacticalCase(fixture(0), goal, 0.5)).toMatchObject({ reached: true, budgetMs: 0.5 });
  expect(probeTacticalCase(fixture(1), { ...goal, goal: 'heuristicWin' })).toMatchObject({ reached: true });
  expect(probeTacticalCase(fixture(100, { forcedLoss: true }), { ...goal, goal: 'heuristicLoss' })).toMatchObject({ reached: true });
  expect(probeTacticalCase(fixture(100), { ...goal, goal: 'heuristicWin' }, 1)).toMatchObject({ reached: false });
  for (const maxMs of [0, -1, Infinity]) expect(() => probeTacticalCase(fixture(), goal, maxMs)).toThrow('budget');
  expect(() => probeTacticalCase(fixture(), { ...goal, goal: 'unknown' })).toThrow('goal');
});

test('replay rejects illegal moves and searches that change the input position', () => {
  expect(() => probeTacticalCase(fixture(1, { move: -1 }), goal)).toThrow('illegal move');
  const changed = { ...rules, GogoAI: class {
    findBestMove(p: rules.GogoPosition) { p.play(0); return { move: 1 }; }
  } };
  expect(() => probeTacticalCase(changed, goal)).toThrow('changed position');
});

test('reports median time-to-flag, misses, and separate exact and heuristic hit rates', () => {
  const cases = [goal, { ...goal, id: 'heuristic', goal: 'heuristicWin' }];
  const result = benchmarkTactics(fixture(8), fixture(2), cases);
  expect(result).toMatchObject({ cases: 2, runs: 3, maxMs: 75, masterCostMs: 16, candidateCostMs: 4, costRatio: 4, exact: { masterHits: 1, candidateHits: 1 }, heuristic: { masterHits: 1, candidateHits: 1 } });
  expect(result.rows[0].candidate).toMatchObject({ reached: true, budgetMs: 2, nodes: 10 });
  expect(benchmarkTactics(fixture(100), fixture(2), [goal], { runs: 1, maxMs: 4 })).toMatchObject({ masterCostMs: 8, candidateCostMs: 2, exact: { masterHits: 0, candidateHits: 1 } });
  expect(benchmarkTactics(fixture(), fixture(), [goal], { runs: 1 })).toHaveProperty('maxMs', 75);
  expect(() => benchmarkTactics(fixture(), fixture(), [])).toThrow('cases');
  for (const runs of [0, -1, 2, 1.5]) expect(() => benchmarkTactics(fixture(), fixture(), [goal], { runs })).toThrow('runs');
});

test('CLI reads saved cases and reports JSON, with errors as operational failures', () => {
  const root = mkdtempSync(join(tmpdir(), 'tactical-'));
  const path = join(root, 'match.json');
  const logs: string[] = [];
  let loads = 0;
  try {
    writeFileSync(path, JSON.stringify(dataset()));
    expect(runTacticalCli([root, path, '2', '1', '4'], () => fixture(++loads === 1 ? 4 : 2), s => logs.push(s))).toBe(0);
    expect(JSON.parse(logs[0])).toHaveProperty('cases', 2);
    expect(runTacticalCli([], undefined, s => logs.push(s))).toBe(2);
    expect(runTacticalCli(['/nonexistent-tactical-master', path], undefined, s => logs.push(s))).toBe(2);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(runTacticalCli([root, path], () => fixture())).toBe(0);
      expect(JSON.parse(log.mock.calls[0][0])).toHaveProperty('runs', 3);
    } finally { log.mockRestore(); }
    writeFileSync(path, JSON.stringify({ results: [] }));
    expect(runTacticalCli([root, path], () => fixture(), s => logs.push(s))).toBe(2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI entry consumes argv and returns its failure status', async () => {
  const argv = process.argv, exitCode = process.exitCode;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    process.argv = [process.execPath, new URL('../scripts/tactical-performance.mjs', import.meta.url).pathname];
    vi.resetModules();
    await import('../scripts/tactical-performance.mjs');
    expect(process.exitCode).toBe(2);
  } finally {
    process.argv = argv;
    process.exitCode = exitCode;
    log.mockRestore();
    vi.resetModules();
  }
});

test('replays earlier turns with the same player, retaining the source signal position', () => {
  const match = { results: [{ games: [{ signals: [{
    engine: 'master', flags: ['forcedWin'], encoded: 'B9 e5 d5 e4 d4', elapsedMs: 75, result: {},
  }] }] }] };
  const cases = extractTacticalCases(match);
  expect(cases).toHaveLength(2);
  expect(cases[0]).toMatchObject({ encoded: 'B9 e5 d5 e4 d4', lookbackPlies: 0 });
  expect(cases[1]).toMatchObject({ encoded: 'B9 e5 d5', anchorEncoded: 'B9 e5 d5 e4 d4', lookbackPlies: 2 });
  expect(rules.decodeGame(cases[0].encoded).toMove).toBe(rules.decodeGame(cases[1].encoded).toMove);
  expect(extractTacticalCases(match, 32, 0)).toHaveLength(1);
  expect(extractTacticalCases(match, 32, 2)).toHaveLength(3);
  for (const lookback of [-1, 1.5]) expect(() => extractTacticalCases(match, 32, lookback)).toThrow('lookback');
  const result = benchmarkTactics(fixture(100), fixture(2), cases, { runs: 1, maxMs: 4 });
  expect(result.earlier).toMatchObject({ cases: 1, exactCandidateOnly: 1, heuristicCandidateOnly: 0 });
  expect(result.rows[1]).toHaveProperty('lookbackPlies', 2);
});

test('a small replay sample spans the saved match instead of taking only its first positions', () => {
  const match = { results: [{ games: [{ signals: Array.from({ length: 24 }, (_, i) => ({
    engine: 'master', flags: ['forcedWin'], encoded: `B9 ${rules.encodeMove(i, rules.decodeGame('B9').meta)}`, elapsedMs: 75, result: {},
  })) }] }] };
  expect(extractTacticalCases(match, 4).map(c => c.encoded)).toEqual([0, 6, 12, 18].map(i => `B9 ${rules.encodeMove(i, rules.decodeGame('B9').meta)}`));
});

test('tactical replay uses the same depth and quiescence settings as the app match', () => {
  const options: unknown[] = [];
  const selected = { ...fixture(1), GogoAI: class {
    constructor(settings: unknown) { options.push(settings); }
    findBestMove() { return { move: 0, forcedWin: true }; }
  } };
  probeTacticalCase(selected, { encoded: 'B9', goal: 'forcedWin' });
  expect(options).toEqual([{ maxDepth: 30, quiescenceDepth: 4, maxPly: 96 }]);
});
