import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { extname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const MAX_ATTEMPTS = 5;
const RUNS = 3;
const PERFORMANCE_TOLERANCE = 1.01;
const PERFORMANCE_ALLOWANCE_MS = 1;
const require = createRequire(import.meta.url);

/** Node 24 strips TypeScript; resolve the engine's extensionless imports. */
export function loadEngine(root) {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context);
    },
  });
  try {
    const { GogoAI } = require(join(root, 'src/engine/ai.ts'));
    const { decodeGame, decodeMove } = require(join(root, 'src/engine/gogomoku.ts'));
    const { PUZZLES } = require(join(root, 'src/engine/puzzles.ts'));
    // The master checkout may predate the non-puzzle collection. Its engine
    // still runs the candidate's cases with the same options and assertions.
    const gamePositionsPath = join(root, 'src/engine/gamePositions.ts');
    const GAME_POSITIONS = existsSync(gamePositionsPath) ? require(gamePositionsPath).GAME_POSITIONS : [];
    return { GogoAI, decodeGame, decodeMove, PUZZLES, GAME_POSITIONS };
  } finally {
    hooks.deregister();
  }
}

/** Setup and result checks are outside the measured solver call for both case types. */
export function measurePuzzle(engine, puzzle, now = () => performance.now(), validateResult = true) {
  const position = engine.decodeGame(puzzle.encoded);
  assert.equal(position.toMove, puzzle.toMove, `${puzzle.id}: wrong player to move`);
  if ('expectedResult' in puzzle) {
    const ai = new engine.GogoAI(puzzle.searchOptions);
    const start = now();
    const result = ai.findBestMove(position, puzzle.timeMs);
    const elapsed = now() - start;
    assert(position.isLegal(result.move), `${puzzle.id}: illegal move`);
    assert.equal(position.encodeGame(), puzzle.encoded, `${puzzle.id}: search changed position`);
    if (validateResult) {
      for (const [field, expected] of Object.entries(puzzle.expectedResult)) {
        assert.equal(result[field], expected, `${puzzle.id}: incorrect SearchResult.${field}`);
      }
    }
    return validateResult ? elapsed : {
      elapsedMs: elapsed,
      solved: Object.entries(puzzle.expectedResult).every(([field, expected]) => result[field] === expected),
    };
  }
  const expected = engine.decodeMove(puzzle.solution, position.size);
  assert.notEqual(expected, -1, `${puzzle.id}: invalid solution`);
  const ai = new engine.GogoAI({ maxDepth: 10, quiescenceDepth: 4 });
  const budgets = puzzle.id.startsWith('gen-')
    ? { 3: 15_000, 5: 15_000, 7: 20_000 }
    : { 3: 500, 5: 2_000, 7: 8_000 };
  const budget = budgets[puzzle.depth] ?? 5_000;
  const start = now();
  const result = ai.findBestMove(position, budget);
  const elapsed = now() - start;
  if (validateResult) assert.equal(result.move, expected, `${puzzle.id}: AI failed to solve puzzle`);
  return validateResult ? elapsed : { elapsedMs: elapsed, solved: result.move === expected };
}

export function comparePuzzleRuns(masterRuns, newRuns) {
  assert(masterRuns.length === RUNS && newRuns.length === RUNS, 'Expected exactly three measurements per version');
  for (const time of [...masterRuns, ...newRuns]) {
    assert(Number.isFinite(time) && time >= 0, 'Invalid puzzle timing');
  }
  const masterMs = Math.max(...masterRuns);
  const newMs = Math.min(...newRuns);
  return { masterMs, newMs, passed: newMs <= masterMs * PERFORMANCE_TOLERANCE + PERFORMANCE_ALLOWANCE_MS };
}

/** Use the candidate's puzzles and game positions as identical inputs for both engines. */
export function benchmarkPuzzles(master, candidate, log = console.log, measure = measurePuzzle) {
  const puzzles = [...candidate.PUZZLES, ...(candidate.GAME_POSITIONS ?? [])];
  assert(puzzles.length > 0, 'No puzzles to benchmark');
  assert.equal(new Set(puzzles.map((puzzle) => puzzle.id)).size, puzzles.length, 'Duplicate puzzle IDs');
  let masterTotalMs = 0;
  let newTotalMs = 0;
  for (const puzzle of puzzles) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const masterRuns = [];
      const newRuns = [];
      let masterFailed = false;
      for (let run = 0; run < RUNS; run++) {
        // Master may miss an expected move or proof; the candidate must pass.
        const baseline = measure(master, puzzle, undefined, false);
        masterRuns.push(typeof baseline === 'number' ? baseline : baseline.elapsedMs);
        if (typeof baseline !== 'number' && !baseline.solved) masterFailed = true;
        newRuns.push(measure(candidate, puzzle));
      }
      const result = comparePuzzleRuns(masterRuns, newRuns);
      const passed = masterFailed || result.passed;
      log(`${passed ? 'PASS' : 'FAIL'} ${puzzle.id} (attempt ${attempt}/${MAX_ATTEMPTS}): fastest new ${result.newMs.toFixed(3)} ms, slowest master ${result.masterMs.toFixed(3)} ms${masterFailed ? '; master did not solve' : ''}`);
      if (passed) {
        // Sum medians rather than the optimistic extremes used for the noise-
        // tolerant individual regression check.
        masterTotalMs += masterRuns.sort((a, b) => a - b)[1];
        newTotalMs += newRuns.sort((a, b) => a - b)[1];
        break;
      }
      if (attempt === MAX_ATTEMPTS) {
        log(`Performance regression confirmed after five attempts for ${puzzle.id}.`);
        return 1;
      }
      log(`Possible performance regression; repeating ${puzzle.id} with fresh samples.`);
    }
  }
  log(`Total puzzle runtime: new ${newTotalMs.toFixed(3)} ms, master ${masterTotalMs.toFixed(3)} ms.`);
  return 0;
}

export function runPuzzlePerformance(masterRoot, newRoot = process.cwd(), log = console.log) {
  try {
    assert(masterRoot, 'Usage: node scripts/puzzle-performance.mjs MASTER_CHECKOUT');
    const master = loadEngine(realpathSync(masterRoot));
    const candidate = loadEngine(realpathSync(newRoot));
    return benchmarkPuzzles(master, candidate, log, measurePuzzle);
  } catch (error) {
    log(error.message);
    return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runPuzzlePerformance(process.argv[2], process.cwd(), console.log);
}
