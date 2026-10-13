import { APP_SEARCH_OPTIONS } from './strength-match.mjs';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './puzzle-performance.mjs';

const FLAGS = ['forcedWin', 'forcedLoss', 'heuristicWin', 'heuristicLoss'];

/** Deduplicate positions/targets and sample all four signal types evenly. */
export function extractTacticalCases(match, limit = 32, lookbackMoves = 1) {
  assert(Array.isArray(match.results), 'Expected match results');
  assert(Number.isInteger(limit) && limit > 0, 'Invalid case limit');
  assert(Number.isInteger(lookbackMoves) && lookbackMoves >= 0, 'Invalid lookback moves');
  const cases = new Map();
  for (const pair of match.results) {
    for (const game of pair.games ?? []) {
      for (const signal of game.signals ?? []) {
        for (const goal of signal.flags) {
          assert(FLAGS.includes(goal) && typeof signal.encoded === 'string', 'Invalid tactical signal');
          const tokens = signal.encoded.split(' ');
          // Two plies preserve the side to move. One ply would invert which
          // player's win/loss the recorded flag describes.
          for (let back = 0; back <= Math.min(lookbackMoves, (tokens.length - 1) >> 1); back++) {
            const encoded = tokens.slice(0, tokens.length - back * 2).join(' ');
            const key = `${goal}:${encoded}`;
            if (!cases.has(key)) cases.set(key, { id: `${goal}-${cases.size + 1}`, goal, encoded,
              anchorEncoded: signal.encoded, lookbackPlies: back * 2, sources: [] });
            cases.get(key).sources.push({ engine: signal.engine, elapsedMs: signal.elapsedMs, result: signal.result });
          }
        }
      }
    }
  }
  const groups = Array.from({ length: lookbackMoves + 1 }, (_, back) =>
    FLAGS.map(flag => [...cases.values()].filter(c => c.goal === flag && c.lookbackPlies === back * 2))).flat();
  const quotas = groups.map(() => 0);
  let allocated = 0;
  const target = Math.min(limit, cases.size);
  while (allocated < target) {
    for (let i = 0; i < groups.length && allocated < target; i++) {
      if (quotas[i] >= groups[i].length) continue;
      quotas[i]++;
      allocated++;
    }
  }
  // Spread each quota over the entire category, including later games.
  const sampled = groups.map((group, i) => Array.from({ length: quotas[i] }, (_, j) =>
    group[Math.floor(j * group.length / quotas[i])]));
  const selected = [];
  while (sampled.some(group => group.length > 0)) {
    for (const group of sampled) {
      if (group.length === 0) continue;
      selected.push(group.shift());
      if (selected.length === limit) return selected;
    }
  }
  return selected;
}

/** Fresh searches at increasing budgets estimate the earliest detection time.
 * A verified outcome also satisfies its corresponding heuristic target.
 * Recorded heuristics are observations, not ground-truth winning labels.
 */
export function probeTacticalCase(engine, entry, maxMs = 75, now = () => performance.now()) {
  assert(FLAGS.includes(entry.goal), 'Invalid tactical goal');
  assert(Number.isFinite(maxMs) && maxMs > 0, 'Invalid replay budget');
  const budgets = [1, 2, 4, 8, 16, 32].filter(ms => ms <= maxMs);
  if (budgets.at(-1) !== maxMs) budgets.push(maxMs);
  let measured;
  for (const budgetMs of budgets) {
    const position = engine.decodeGame(entry.encoded);
    const before = position.encodeGame();
    const ai = new engine.GogoAI(APP_SEARCH_OPTIONS);
    const started = now();
    const result = ai.findBestMove(position, budgetMs);
    const elapsedMs = now() - started;
    assert.equal(position.encodeGame(), before, 'Search changed position');
    assert(position.isLegal(result.move), 'AI returned an illegal move');
    const reached = Boolean(result[entry.goal]
      || (entry.goal === 'heuristicWin' && result.forcedWin)
      || (entry.goal === 'heuristicLoss' && result.forcedLoss));
    measured = { reached, budgetMs, elapsedMs, result };
    if (reached) return measured;
  }
  return measured;
}

export function benchmarkTactics(master, candidate, cases, { runs = 3, maxMs = 75 } = {}) {
  assert(cases.length > 0, 'No tactical cases; record a match with first signals');
  assert(Number.isInteger(runs) && runs > 0 && runs % 2 === 1, 'Expected an odd positive number of runs');
  const median = values => values.sort((a, b) => a - b)[runs >> 1];
  const rows = cases.map((entry, index) => {
    const samples = [[], []];
    for (let run = 0; run < runs; run++) {
      const order = (index + run) % 2 === 0 ? [0, 1] : [1, 0];
      for (const side of order) samples[side].push(probeTacticalCase(side === 0 ? master : candidate, entry, maxMs));
    }
    const summarize = values => ({
      reached: values.filter(v => v.reached).length > runs / 2,
      budgetMs: median(values.map(v => v.reached ? v.budgetMs : maxMs * 2)),
      elapsedMs: median(values.map(v => v.elapsedMs)),
      nodes: median(values.map(v => v.result.nodes)),
    });
    return { id: entry.id, goal: entry.goal, encoded: entry.encoded,
      lookbackPlies: entry.lookbackPlies ?? 0, anchorEncoded: entry.anchorEncoded,
      master: summarize(samples[0]), candidate: summarize(samples[1]) };
  });
  const masterCostMs = rows.reduce((sum, row) => sum + row.master.budgetMs, 0);
  const candidateCostMs = rows.reduce((sum, row) => sum + row.candidate.budgetMs, 0);
  const hits = heuristic => {
    const selected = rows.filter(row => row.goal.startsWith('heuristic') === heuristic);
    return { masterHits: selected.filter(row => row.master.reached).length,
      candidateHits: selected.filter(row => row.candidate.reached).length };
  };
  const earlier = rows.filter(row => row.lookbackPlies > 0);
  const candidateOnly = earlier.filter(row => row.candidate.reached && !row.master.reached);
  return { cases: cases.length, runs, maxMs, missPenaltyMs: maxMs * 2,
    earlier: { cases: earlier.length,
      exactCandidateOnly: candidateOnly.filter(row => !row.goal.startsWith('heuristic')).length,
      heuristicCandidateOnly: candidateOnly.filter(row => row.goal.startsWith('heuristic')).length },
    masterCostMs, candidateCostMs, costRatio: masterCostMs / candidateCostMs,
    exact: hits(false), heuristic: hits(true), rows };
}

export function runTacticalCli(args = process.argv.slice(2), load = loadEngine, log = console.log) {
  try {
    assert(args[0] && args[1], 'Usage: node scripts/tactical-performance.mjs MASTER_CHECKOUT MATCH_JSON [CASES=32] [RUNS=3] [MAX_MS=75]');
    const cases = extractTacticalCases(JSON.parse(readFileSync(args[1], 'utf8')), Number(args[2] ?? 32));
    const master = load(realpathSync(args[0]));
    const candidate = load(process.cwd());
    const runs = Number(args[3] ?? 3);
    const maxMs = Number(args[4] ?? 75);
    assert(cases.length > 0, 'No tactical cases; record a match with first signals');
    for (const engine of [master, candidate]) probeTacticalCase(engine, cases[0], maxMs);
    log(JSON.stringify(benchmarkTactics(master, candidate, cases, { runs, maxMs }), null, 2));
    return 0;
  } catch (error) {
    log(error.message);
    return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runTacticalCli();
}
